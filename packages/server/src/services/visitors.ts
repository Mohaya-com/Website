import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { sessions, users, visitorProfileVersions, visitors, visits, type DbExecutor, type Visitor } from '@vms/db';
import {
  ApiError,
  PROFILE_FIELD_PERMISSIONS,
  hasPermission,
  maskDocumentNumber,
  maskPhone,
  type CalendarKind,
  type DocumentExpiryNormalized,
  type DocumentType,
  type Locale,
  type SystemSettings,
  type VisitorFullDTO,
  type VisitorSelfDTO,
  type VisitorSummaryDTO,
  type VisitorVersionDTO,
} from '@vms/shared';
import type { RegistrantPrincipal, StaffPrincipal, VisitorPrincipal } from '../auth/principal';
import { revokeVisitorSessions } from '../auth/sessions';
import type { ServerContext, TxScope } from '../context';
import { paginate, toVisitorFullDTO, toVisitorSelfDTO, toVisitorSummaryDTO } from '../dto';
import { actorOf, audit, type Actor } from './audit';
import { loadSettings } from './settings';
import { visitorStats } from './visit-queries';

export interface NewVisitorInput {
  fullName: string;
  documentType: DocumentType;
  documentNumber: string;
  documentExpiry: DocumentExpiryNormalized;
  nationality: string;
  mobile: string;
  locale?: Locale;
}

async function insertVersion(
  tx: DbExecutor,
  visitor: Visitor,
  changedFields: string[],
  changeReason: string | null,
  actor: Actor,
  now: Date,
): Promise<void> {
  await tx.insert(visitorProfileVersions).values({
    visitorId: visitor.id,
    version: visitor.version,
    fullName: visitor.fullName,
    documentType: visitor.documentType,
    documentNumber: visitor.documentNumber,
    documentExpiryDate: visitor.documentExpiryDate,
    documentExpiryCalendar: visitor.documentExpiryCalendar,
    documentExpiryOriginal: visitor.documentExpiryOriginal,
    nationality: visitor.nationality,
    mobile: visitor.mobile,
    changedFields,
    changeReason,
    changedByType: actor.type,
    changedByUserId: actor.type === 'user' ? actor.userId : null,
    changedByVisitorId: actor.type === 'visitor' ? actor.visitorId : null,
    createdAt: now,
  });
}

/** Creates a profile. The unique index on document_number prevents duplicates even under concurrency. */
export async function createVisitor(
  scope: TxScope,
  input: NewVisitorInput,
  creator: { via: 'self' } | { via: 'staff'; staff: StaffPrincipal },
): Promise<Visitor> {
  const { tx, now } = scope;
  const [dup] = await tx.select({ id: visitors.id }).from(visitors).where(eq(visitors.documentNumber, input.documentNumber)).limit(1);
  if (dup) {
    // Only staff (who may look identities up by exact number) learn which profile already exists.
    throw new ApiError(409, 'duplicate_visitor', undefined, creator.via === 'staff' ? { visitorId: dup.id } : undefined);
  }
  const [visitor] = await tx
    .insert(visitors)
    .values({
      fullName: input.fullName,
      documentType: input.documentType,
      documentNumber: input.documentNumber,
      documentExpiryDate: input.documentExpiry.gregorian,
      documentExpiryCalendar: input.documentExpiry.calendar,
      documentExpiryOriginal: input.documentExpiry.original,
      nationality: input.nationality,
      mobile: input.mobile,
      locale: input.locale ?? 'ar',
      version: 1,
      createdVia: creator.via,
      createdByUserId: creator.via === 'staff' ? creator.staff.userId : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const actor: Actor = creator.via === 'staff' ? { type: 'user', userId: creator.staff.userId } : { type: 'visitor', visitorId: visitor!.id };
  await insertVersion(tx, visitor!, ['created'], null, actor, now);
  await audit(tx, {
    actor,
    action: 'visitor.created',
    entityType: 'visitor',
    entityId: visitor!.id,
    metadata: { via: creator.via, documentType: input.documentType, documentNumber: maskDocumentNumber(input.documentNumber) },
    at: now,
  });
  return visitor!;
}

/** A verified registrant completes their own profile; the session is upgraded to a visitor session. */
export async function completeRegistration(
  ctx: ServerContext,
  scope: TxScope,
  registrant: RegistrantPrincipal,
  input: { fullName: string; nationality: string; documentExpiry: DocumentExpiryNormalized; locale?: Locale | undefined },
): Promise<Visitor> {
  const settings = await loadSettings(scope.tx);
  if (!settings.allowVisitorSelfRegistration) throw new ApiError(403, 'self_registration_disabled');
  const c = registrant.challenge;
  const visitor = await createVisitor(
    scope,
    {
      fullName: input.fullName,
      documentType: c.documentType,
      documentNumber: c.documentNumber,
      documentExpiry: input.documentExpiry,
      nationality: input.nationality,
      mobile: c.mobile,
      locale: input.locale ?? registrant.locale,
    },
    { via: 'self' },
  ).catch((err: unknown) => {
    // A profile appeared after verification: respond generically.
    if (err instanceof ApiError && err.code === 'duplicate_visitor') throw new ApiError(409, 'conflict');
    throw err;
  });
  await scope.tx
    .update(sessions)
    .set({ kind: 'visitor', visitorId: visitor.id, otpChallengeId: null, expiresAt: new Date(scope.now.getTime() + ctx.config.sessions.visitorMaxDays * 86_400_000), idleExpiresAt: new Date(scope.now.getTime() + ctx.config.sessions.visitorMaxDays * 86_400_000) })
    .where(eq(sessions.id, registrant.sessionId));
  return visitor;
}

export interface StaffProfileUpdate {
  expectedVersion: number;
  reason: string;
  fullName?: string | undefined;
  documentType?: DocumentType | undefined;
  documentNumber?: string | undefined;
  documentExpiry?: DocumentExpiryNormalized | undefined;
  nationality?: string | undefined;
  mobile?: string | undefined;
}

/**
 * Explicit, reasoned and audited profile update by staff. Each changed field is permission-checked.
 * Previous visits keep pointing at the profile version that was current when they were submitted.
 */
export async function updateVisitorByStaff(
  ctx: ServerContext,
  scope: TxScope,
  staff: StaffPrincipal,
  visitorId: string,
  input: StaffProfileUpdate,
): Promise<{ visitor: VisitorFullDTO; changed: string[] }> {
  const { tx, now } = scope;
  const [current] = await tx.select().from(visitors).where(eq(visitors.id, visitorId)).for('update').limit(1);
  if (!current) throw new ApiError(404, 'not_found');
  if (current.version !== input.expectedVersion) throw new ApiError(409, 'stale_version');

  const changes: Partial<Visitor> = {};
  const changed: string[] = [];
  const auditChanges: Record<string, unknown> = {};
  const check = (field: keyof typeof PROFILE_FIELD_PERMISSIONS) => {
    if (!hasPermission(staff.role, PROFILE_FIELD_PERMISSIONS[field])) {
      throw new ApiError(403, 'forbidden', { [field]: 'errors.forbidden' });
    }
    changed.push(field);
  };

  if (input.fullName !== undefined && input.fullName !== current.fullName) {
    check('fullName');
    changes.fullName = input.fullName;
    auditChanges.fullName = 'changed';
  }
  if (input.documentType !== undefined && input.documentNumber !== undefined && (input.documentType !== current.documentType || input.documentNumber !== current.documentNumber)) {
    check('documentNumber');
    if (input.documentNumber !== current.documentNumber) {
      const [dup] = await tx.select({ id: visitors.id }).from(visitors).where(eq(visitors.documentNumber, input.documentNumber)).limit(1);
      if (dup) throw new ApiError(409, 'duplicate_visitor', undefined, { visitorId: dup.id });
    }
    changes.documentType = input.documentType;
    changes.documentNumber = input.documentNumber;
    auditChanges.document = { from: maskDocumentNumber(current.documentNumber), to: maskDocumentNumber(input.documentNumber) };
  }
  if (input.documentExpiry && input.documentExpiry.gregorian !== current.documentExpiryDate) {
    check('documentExpiry');
    changes.documentExpiryDate = input.documentExpiry.gregorian;
    changes.documentExpiryCalendar = input.documentExpiry.calendar as CalendarKind;
    changes.documentExpiryOriginal = input.documentExpiry.original;
    auditChanges.documentExpiry = { from: current.documentExpiryDate, to: input.documentExpiry.gregorian };
  }
  if (input.nationality !== undefined && input.nationality !== current.nationality) {
    check('nationality');
    changes.nationality = input.nationality;
    auditChanges.nationality = { from: current.nationality, to: input.nationality };
  }
  if (input.mobile !== undefined && input.mobile !== current.mobile) {
    check('mobile');
    changes.mobile = input.mobile;
    auditChanges.mobile = { from: maskPhone(current.mobile), to: maskPhone(input.mobile) };
  }

  const settings = await loadSettings(tx);
  if (changed.length === 0) {
    return { visitor: toVisitorFullDTO(current, await visitorStats(tx, current.id), now, settings.timezone), changed };
  }

  const [updated] = await tx
    .update(visitors)
    .set({ ...changes, version: current.version + 1, updatedAt: now })
    .where(eq(visitors.id, current.id))
    .returning();
  await insertVersion(tx, updated!, changed, input.reason, actorOf(staff), now);
  // Changing the registered mobile ends the visitor's existing sessions (staff-assisted recovery).
  if (changes.mobile) await revokeVisitorSessions(tx, current.id, now);
  await audit(tx, {
    actor: actorOf(staff),
    action: 'visitor.updated',
    entityType: 'visitor',
    entityId: current.id,
    metadata: { changedFields: changed, changes: auditChanges, reason: input.reason, version: updated!.version },
    at: now,
  });
  return { visitor: toVisitorFullDTO(updated!, await visitorStats(tx, current.id), now, settings.timezone), changed };
}

/** The visitor renews their document expiry date (explicit and audited). */
export async function selfUpdateExpiry(
  scope: TxScope,
  principal: VisitorPrincipal,
  input: { expectedVersion: number; documentExpiry: DocumentExpiryNormalized },
): Promise<VisitorSelfDTO> {
  const { tx, now } = scope;
  const [current] = await tx.select().from(visitors).where(eq(visitors.id, principal.visitorId)).for('update').limit(1);
  if (!current) throw new ApiError(404, 'not_found');
  if (current.version !== input.expectedVersion) throw new ApiError(409, 'stale_version');
  const settings = await loadSettings(tx);
  if (current.documentExpiryDate === input.documentExpiry.gregorian) return toVisitorSelfDTO(current, now, settings.timezone);
  const [updated] = await tx
    .update(visitors)
    .set({
      documentExpiryDate: input.documentExpiry.gregorian,
      documentExpiryCalendar: input.documentExpiry.calendar,
      documentExpiryOriginal: input.documentExpiry.original,
      version: current.version + 1,
      updatedAt: now,
    })
    .where(eq(visitors.id, current.id))
    .returning();
  await insertVersion(tx, updated!, ['documentExpiry'], 'self_service_renewal', actorOf(principal), now);
  await audit(tx, {
    actor: actorOf(principal),
    action: 'visitor.self_updated',
    entityType: 'visitor',
    entityId: current.id,
    metadata: { changedFields: ['documentExpiry'], changes: { documentExpiry: { from: current.documentExpiryDate, to: input.documentExpiry.gregorian } } },
    at: now,
  });
  return toVisitorSelfDTO(updated!, now, settings.timezone);
}

/** Exact lookup by identity number for authorized staff (audited). */
export async function lookupVisitorExact(
  ctx: ServerContext,
  staff: StaffPrincipal,
  documentNumber: string,
  ipHash: string | null,
): Promise<VisitorFullDTO | null> {
  const now = ctx.clock.now();
  const [visitor] = await ctx.db.select().from(visitors).where(eq(visitors.documentNumber, documentNumber)).limit(1);
  await audit(ctx.db, {
    actor: actorOf(staff),
    action: 'visitor.lookup',
    entityType: 'visitor',
    entityId: visitor?.id ?? null,
    metadata: { found: Boolean(visitor), documentNumber: maskDocumentNumber(documentNumber) },
    ipHash,
    at: now,
  });
  if (!visitor) return null;
  const settings = await loadSettings(ctx.db);
  return toVisitorFullDTO(visitor, await visitorStats(ctx.db, visitor.id), now, settings.timezone);
}

export async function getVisitorFull(db: DbExecutor, visitorId: string, now: Date, settings: SystemSettings): Promise<VisitorFullDTO | null> {
  const [visitor] = await db.select().from(visitors).where(eq(visitors.id, visitorId)).limit(1);
  if (!visitor) return null;
  return toVisitorFullDTO(visitor, await visitorStats(db, visitor.id), now, settings.timezone);
}

/** Administrator search by name, identity number, mobile or request reference (masked results). */
export async function searchVisitors(
  db: DbExecutor,
  query: { q?: string | undefined; nationality?: string | undefined; page: number; pageSize: number },
  now: Date,
  settings: SystemSettings,
) {
  const conditions: (SQL | undefined)[] = [];
  if (query.nationality) conditions.push(eq(visitors.nationality, query.nationality));
  const q = query.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const options: (SQL | undefined)[] = [ilike(visitors.fullName, like)];
    if (digits.length >= 4) {
      options.push(sql`${visitors.documentNumber} like ${`${digits}%`}`, sql`${visitors.mobile} like ${`%${digits}%`}`);
    }
    if (/^VR-/i.test(q)) {
      options.push(inArray(visitors.id, db.select({ id: visits.visitorId }).from(visits).where(ilike(visits.reference, `${q.toUpperCase()}%`))));
    }
    conditions.push(or(...options));
  }
  const where = and(...conditions);
  const [totalRow] = await db.select({ n: count() }).from(visitors).where(where);
  const statsSub = db
    .select({
      visitorId: visits.visitorId,
      visitCount: sql<number>`count(*)::int`.as('visit_count'),
      lastVisitAt: sql<Date | null>`max(${visits.checkedInAt})`.as('last_visit_at'),
    })
    .from(visits)
    .groupBy(visits.visitorId)
    .as('stats');
  const rows = await db
    .select({ visitor: visitors, visitCount: statsSub.visitCount, lastVisitAt: statsSub.lastVisitAt })
    .from(visitors)
    .leftJoin(statsSub, eq(statsSub.visitorId, visitors.id))
    .where(where)
    .orderBy(desc(visitors.updatedAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  const items: VisitorSummaryDTO[] = rows.map((r) =>
    toVisitorSummaryDTO(r.visitor, { visitCount: Number(r.visitCount ?? 0), lastVisitAt: r.lastVisitAt ? new Date(r.lastVisitAt) : null }, now, settings.timezone),
  );
  return paginate(items, Number(totalRow?.n ?? 0), query.page, query.pageSize);
}

export async function listVisitorVersions(db: DbExecutor, visitorId: string): Promise<VisitorVersionDTO[]> {
  const rows = await db
    .select({ v: visitorProfileVersions, userName: users.fullName })
    .from(visitorProfileVersions)
    .leftJoin(users, eq(users.id, visitorProfileVersions.changedByUserId))
    .where(eq(visitorProfileVersions.visitorId, visitorId))
    .orderBy(asc(visitorProfileVersions.version));
  return rows.map(({ v, userName }) => ({
    version: v.version,
    changedFields: v.changedFields,
    changeReason: v.changeReason,
    changedBy: { type: v.changedByType, name: userName ?? null },
    createdAt: v.createdAt.toISOString(),
    fullName: v.fullName,
    nationality: v.nationality,
    documentType: v.documentType,
    documentNumberMasked: maskDocumentNumber(v.documentNumber),
    documentExpiryDate: v.documentExpiryDate,
    mobileMasked: maskPhone(v.mobile),
  }));
}

export async function setVisitorLocale(db: DbExecutor, visitorId: string, locale: Locale): Promise<void> {
  await db.update(visitors).set({ locale }).where(eq(visitors.id, visitorId));
}

