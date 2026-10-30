import { and, asc, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { arrivalRegistrations, gates, users, visitors, visits, type ArrivalRegistration, type DbExecutor } from '@vms/db';
import {
  ApiError,
  hasPermission,
  maskDocumentNumber,
  maskPhone,
  parseIdText,
  validateRequestTiming,
  zonedDateString,
  type ArrivalDetailDTO,
  type ArrivalListItemDTO,
  type ArrivalScanResultDTO,
  type ArrivalStatusDTO,
  type ArrivalSubmitResultDTO,
  type ClientKind,
  type DocumentExpiryNormalized,
  type DocumentType,
  type Locale,
  type PassDTO,
  type VisitReason,
} from '@vms/shared';
import type { StaffPrincipal } from '../auth/principal';
import type { RequestMeta } from '../auth/staff';
import { inTransaction, type ServerContext, type TxScope } from '../context';
import { randomCode, randomToken, sha256Hex } from '../crypto';
import { recognizeText } from '../providers/ocr';
import { enforceRateLimit } from '../rate-limit';
import { publish } from '../realtime';
import { findGateByCode } from './admin';
import { audit } from './audit';
import { getActivePass, passQrValue } from './passes';
import { getSettings } from './settings';
import { fetchVisitDTO } from './visit-queries';
import { createVisitor, updateVisitorByStaff } from './visitors';
import { approveVisit, submitVisitRequest } from './visits';

/**
 * Registration at arrival without a verification code. The visitor's entries (and optional ID photo)
 * are held as a request; nothing is trusted until an administrator compares them with the photo and
 * approves. Approval creates or updates the visitor profile (audited) and an approved visit with a pass.
 * The submitter can only follow their own request through a random status token, so a request for
 * someone else's identity number never exposes that person's profile or history.
 */

export const ARRIVAL_RATE_LIMITS = {
  submitIp: { name: 'arrival:submit:ip', limit: 10, windowSeconds: 60 * 60 },
  scanIp: { name: 'arrival:scan:ip', limit: 30, windowSeconds: 60 * 60 },
  statusIp: { name: 'arrival:status:ip', limit: 600, windowSeconds: 60 * 60 },
};
/** ID photos are deleted this many days after the decision (or after an unreviewed request expires). */
export const ID_IMAGE_RETENTION_DAYS = 30;
/** Requests nobody reviewed are closed after this many hours. */
export const PENDING_ARRIVAL_MAX_HOURS = 24;

// ───────────────────────────── Images ─────────────────────────────

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
};

/** Decodes an uploaded photo and checks that its bytes really are the declared image type. */
export function decodeIdImage(input: { type: string; data: string }, maxBytes: number): { type: string; bytes: Buffer } {
  const bytes = Buffer.from(input.data, 'base64');
  if (bytes.length > maxBytes) throw new ApiError(413, 'validation_error', { idImage: 'validation.idImageTooLarge' });
  if (!MAGIC[input.type]?.(bytes)) throw new ApiError(400, 'validation_error', { idImage: 'validation.idImageType' });
  return { type: input.type, bytes };
}

/** Reads an ID photo and suggests field values. The photo is not stored. */
export async function scanIdImage(ctx: ServerContext, image: { type: string; bytes: Buffer }, meta: RequestMeta): Promise<ArrivalScanResultDTO> {
  await enforceRateLimit(ctx, ARRIVAL_RATE_LIMITS.scanIp, meta.ip);
  const text = await recognizeText(image.bytes);
  if (!text?.trim()) return { recognized: false, fields: {} };
  const settings = await getSettings(ctx);
  return { recognized: true, fields: parseIdText(text, zonedDateString(ctx.clock.now(), settings.timezone)) };
}

// ───────────────────────────── Submission and status ─────────────────────────────

export interface ArrivalSubmission {
  documentType: DocumentType;
  documentNumber: string;
  fullName?: string | undefined;
  nationality?: string | undefined;
  mobile: string;
  villaNumber: string;
  reason: VisitReason;
  reasonDetails?: string | null | undefined;
  requestedEntryAt?: string | undefined;
  durationMinutes: number;
  gateCode?: string | null | undefined;
  locale?: Locale | undefined;
  idImage?: { type: string; bytes: Buffer } | null;
}

async function generateReference(tx: DbExecutor): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const reference = `AR-${randomCode(6)}`;
    const [exists] = await tx.select({ id: arrivalRegistrations.id }).from(arrivalRegistrations).where(eq(arrivalRegistrations.reference, reference)).limit(1);
    if (!exists) return reference;
  }
  throw new ApiError(500, 'internal_error');
}

export async function submitArrival(ctx: ServerContext, input: ArrivalSubmission, meta: RequestMeta): Promise<ArrivalSubmitResultDTO> {
  const settings = await getSettings(ctx);
  if (!settings.allowArrivalRegistration) throw new ApiError(403, 'arrival_registration_disabled');
  await enforceRateLimit(ctx, ARRIVAL_RATE_LIMITS.submitIp, meta.ip);

  const now = ctx.clock.now();
  const entry = input.requestedEntryAt ? new Date(input.requestedEntryAt) : now;
  const timing = validateRequestTiming({ requestedEntryAt: entry, durationMinutes: input.durationMinutes, documentExpiryDate: null, now, settings });
  if (timing) throw new ApiError(400, 'validation_error', { [timing.field]: `validation.timing.${timing.error}` });
  const gate = input.gateCode ? await findGateByCode(ctx.db, input.gateCode) : null;

  const statusToken = randomToken(32);
  const reference = await inTransaction(ctx, async (scope) => {
    const ref = await generateReference(scope.tx);
    const [row] = await scope.tx
      .insert(arrivalRegistrations)
      .values({
        reference: ref,
        statusTokenHash: sha256Hex(statusToken),
        documentType: input.documentType,
        documentNumber: input.documentNumber,
        fullName: input.fullName ?? null,
        nationality: input.nationality ?? null,
        mobile: input.mobile,
        villaNumber: input.villaNumber,
        reason: input.reason,
        reasonDetails: input.reasonDetails?.trim() || null,
        requestedEntryAt: entry,
        durationMinutes: input.durationMinutes,
        requestedGateId: gate?.id ?? null,
        locale: input.locale ?? 'ar',
        idImage: input.idImage?.bytes ?? null,
        idImageType: input.idImage?.type ?? null,
        ipHash: meta.ipHash,
        createdAt: scope.now,
      })
      .returning({ id: arrivalRegistrations.id });
    await audit(scope.tx, {
      actor: { type: 'system' },
      action: 'arrival.submitted',
      entityType: 'arrival',
      entityId: row!.id,
      metadata: { reference: ref, documentNumber: maskDocumentNumber(input.documentNumber), mobile: maskPhone(input.mobile), villa: input.villaNumber, withImage: !!input.idImage },
      ipHash: meta.ipHash,
      at: scope.now,
    });
    await publish(scope.tx, { t: 'arrival' });
    return ref;
  });
  return { reference, statusToken };
}

async function findByToken(db: DbExecutor, token: string): Promise<ArrivalRegistration | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await db.select().from(arrivalRegistrations).where(eq(arrivalRegistrations.statusTokenHash, sha256Hex(token))).limit(1);
  return row ?? null;
}

export async function getArrivalStatus(ctx: ServerContext, token: string, meta: RequestMeta): Promise<ArrivalStatusDTO> {
  await enforceRateLimit(ctx, ARRIVAL_RATE_LIMITS.statusIp, meta.ip);
  const row = await findByToken(ctx.db, token);
  if (!row) throw new ApiError(404, 'not_found');
  let pass: PassDTO | null = null;
  let visitStatus: ArrivalStatusDTO['visitStatus'] = null;
  if (row.status === 'approved' && row.visitId && row.visitorId) {
    const settings = await getSettings(ctx);
    const now = ctx.clock.now();
    const visit = await fetchVisitDTO(ctx.db, row.visitId, 'visitor', now, settings, row.visitorId);
    if (visit) {
      visitStatus = visit.status;
      const active = visit.status === 'approved' ? await getActivePass(ctx.db, visit.id) : null;
      if (active && visit.entryWindowStart && visit.entryWindowEnd) {
        const [v] = await ctx.db.select({ fullName: visitors.fullName }).from(visitors).where(eq(visitors.id, row.visitorId));
        pass = {
          visitId: visit.id,
          reference: visit.reference,
          status: visit.status,
          qrValue: passQrValue(ctx, active),
          visitorName: v?.fullName ?? row.fullName ?? '',
          villaNumber: visit.villa.number,
          entryWindowStart: visit.entryWindowStart,
          entryWindowEnd: visit.entryWindowEnd,
          expectedExitAt: visit.expectedExitAt,
          issuedAt: active.issuedAt.toISOString(),
        };
      }
    }
  }
  return {
    reference: row.reference,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    villaNumber: row.villaNumber,
    rejectReason: row.rejectReason,
    visitStatus,
    pass,
  };
}

// ───────────────────────────── Administrator review ─────────────────────────────

function requireReviewer(staff: StaffPrincipal): void {
  if (!hasPermission(staff.role, 'arrivals.review')) throw new ApiError(403, 'forbidden');
}

export async function listArrivals(
  ctx: ServerContext,
  staff: StaffPrincipal,
  query: { status: 'pending' | 'approved' | 'rejected'; page: number; pageSize: number },
): Promise<{ items: ArrivalListItemDTO[]; total: number; pendingCount: number }> {
  requireReviewer(staff);
  const where = eq(arrivalRegistrations.status, query.status);
  const rows = await ctx.db
    .select({
      r: {
        id: arrivalRegistrations.id,
        reference: arrivalRegistrations.reference,
        status: arrivalRegistrations.status,
        fullName: arrivalRegistrations.fullName,
        documentType: arrivalRegistrations.documentType,
        documentNumber: arrivalRegistrations.documentNumber,
        villaNumber: arrivalRegistrations.villaNumber,
        requestedEntryAt: arrivalRegistrations.requestedEntryAt,
        createdAt: arrivalRegistrations.createdAt,
        hasImage: sql<boolean>`${arrivalRegistrations.idImage} is not null`,
      },
      existingId: visitors.id,
    })
    .from(arrivalRegistrations)
    .leftJoin(visitors, eq(visitors.documentNumber, arrivalRegistrations.documentNumber))
    .where(where)
    .orderBy(query.status === 'pending' ? asc(arrivalRegistrations.createdAt) : desc(arrivalRegistrations.decidedAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  const [counts] = await ctx.db
    .select({
      total: sql<number>`count(*) filter (where ${arrivalRegistrations.status} = ${query.status})::int`,
      pending: sql<number>`count(*) filter (where ${arrivalRegistrations.status} = 'pending')::int`,
    })
    .from(arrivalRegistrations);
  return {
    items: rows.map(({ r, existingId }) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      fullName: r.fullName,
      documentType: r.documentType,
      documentNumberMasked: maskDocumentNumber(r.documentNumber),
      villaNumber: r.villaNumber,
      requestedEntryAt: r.requestedEntryAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      hasImage: !!r.hasImage,
      returningVisitor: !!existingId,
    })),
    total: counts?.total ?? 0,
    pendingCount: counts?.pending ?? 0,
  };
}

export async function getArrivalDetail(ctx: ServerContext, staff: StaffPrincipal, id: string, logView = true): Promise<ArrivalDetailDTO> {
  requireReviewer(staff);
  const [row] = await ctx.db
    .select({
      r: arrivalRegistrations,
      hasImage: sql<boolean>`${arrivalRegistrations.idImage} is not null`,
      gate: { id: gates.id, nameAr: gates.nameAr, nameEn: gates.nameEn },
      decidedByName: users.fullName,
    })
    .from(arrivalRegistrations)
    .leftJoin(gates, eq(gates.id, arrivalRegistrations.requestedGateId))
    .leftJoin(users, eq(users.id, arrivalRegistrations.decidedByUserId))
    .where(eq(arrivalRegistrations.id, id))
    .limit(1);
  if (!row) throw new ApiError(404, 'not_found');
  const r = row.r;
  const [existing] = await ctx.db.select().from(visitors).where(eq(visitors.documentNumber, r.documentNumber)).limit(1);
  let hasOpenVisit = false;
  if (existing) {
    const [open] = await ctx.db
      .select({ id: visits.id })
      .from(visits)
      .where(and(eq(visits.visitorId, existing.id), or(eq(visits.status, 'pending'), eq(visits.status, 'approved'), eq(visits.status, 'checked_in'))))
      .limit(1);
    hasOpenVisit = !!open;
  }
  if (logView) await audit(ctx.db, { actor: { type: 'user', userId: staff.userId }, action: 'arrival.viewed', entityType: 'arrival', entityId: r.id, metadata: { reference: r.reference }, at: ctx.clock.now() });
  return {
    id: r.id,
    reference: r.reference,
    status: r.status,
    documentType: r.documentType,
    documentNumber: r.documentNumber,
    fullName: r.fullName,
    nationality: r.nationality,
    documentExpiry:
      r.documentExpiryDate && r.documentExpiryCalendar && r.documentExpiryOriginal
        ? { date: r.documentExpiryDate, calendar: r.documentExpiryCalendar, original: r.documentExpiryOriginal }
        : null,
    mobile: r.mobile,
    villaNumber: r.villaNumber,
    reason: r.reason,
    reasonDetails: r.reasonDetails,
    requestedEntryAt: r.requestedEntryAt.toISOString(),
    durationMinutes: r.durationMinutes,
    requestedGate: row.gate?.id ? { id: row.gate.id, nameAr: row.gate.nameAr, nameEn: row.gate.nameEn } : null,
    createdAt: r.createdAt.toISOString(),
    hasImage: !!row.hasImage,
    imageRemoved: !!r.idImageRemovedAt,
    existingVisitor: existing
      ? { id: existing.id, fullName: existing.fullName, nationality: existing.nationality, mobile: existing.mobile, documentExpiryDate: existing.documentExpiryDate, hasOpenVisit }
      : null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decidedBy: r.decidedByUserId ? { type: 'user', name: row.decidedByName ?? null } : r.decidedAt ? { type: 'system', name: null } : null,
    rejectReason: r.rejectReason,
    visitorId: r.visitorId,
    visitId: r.visitId,
  };
}

export async function getArrivalImage(ctx: ServerContext, staff: StaffPrincipal, id: string): Promise<{ type: string; bytes: Buffer }> {
  requireReviewer(staff);
  const [row] = await ctx.db
    .select({ image: arrivalRegistrations.idImage, type: arrivalRegistrations.idImageType })
    .from(arrivalRegistrations)
    .where(eq(arrivalRegistrations.id, id))
    .limit(1);
  if (!row?.image || !row.type) throw new ApiError(404, 'not_found');
  return { type: row.type, bytes: row.image };
}

async function lockPending(scope: TxScope, id: string): Promise<ArrivalRegistration> {
  const [row] = await scope.tx.select().from(arrivalRegistrations).where(eq(arrivalRegistrations.id, id)).for('update').limit(1);
  if (!row) throw new ApiError(404, 'not_found');
  if (row.status !== 'pending') throw new ApiError(409, 'invalid_transition', undefined, { status: row.status });
  return row;
}

export interface ArrivalApproval {
  documentType: DocumentType;
  documentNumber: string;
  fullName: string;
  nationality: string;
  documentExpiry: DocumentExpiryNormalized;
  mobile: string;
  villaNumber: string;
}

/**
 * Approves an arrival with the administrator's (possibly corrected) values: creates the profile or
 * updates the existing one (versioned and audited), then creates and approves the visit, issuing the pass.
 */
export async function approveArrival(ctx: ServerContext, scope: TxScope, admin: StaffPrincipal, id: string, input: ArrivalApproval, channel: ClientKind): Promise<ArrivalDetailDTO> {
  requireReviewer(admin);
  const { tx, now } = scope;
  const row = await lockPending(scope, id);

  const [existing] = await tx.select().from(visitors).where(eq(visitors.documentNumber, input.documentNumber)).for('update').limit(1);
  let visitorId: string;
  if (existing) {
    visitorId = existing.id;
    const update: Parameters<typeof updateVisitorByStaff>[4] = { expectedVersion: existing.version, reason: `Arrival ${row.reference}` };
    if (existing.fullName !== input.fullName) update.fullName = input.fullName;
    if (existing.nationality !== input.nationality) update.nationality = input.nationality;
    if (existing.mobile !== input.mobile) update.mobile = input.mobile;
    if (existing.documentExpiryDate !== input.documentExpiry.gregorian || existing.documentExpiryOriginal !== input.documentExpiry.original) {
      update.documentExpiry = input.documentExpiry;
    }
    if (existing.documentType !== input.documentType) {
      update.documentType = input.documentType;
      update.documentNumber = input.documentNumber;
    }
    if (Object.keys(update).length > 2) await updateVisitorByStaff(ctx, scope, admin, visitorId, update);
  } else {
    const created = await createVisitor(
      scope,
      {
        fullName: input.fullName,
        documentType: input.documentType,
        documentNumber: input.documentNumber,
        documentExpiry: input.documentExpiry,
        nationality: input.nationality,
        mobile: input.mobile,
        locale: row.locale,
      },
      { via: 'staff', staff: admin },
    );
    visitorId = created.id;
  }

  // The visitor is at the gate: the visit starts no earlier than now.
  const entry = row.requestedEntryAt.getTime() < now.getTime() ? now : row.requestedEntryAt;
  const { visit } = await submitVisitRequest(ctx, scope, {
    principal: admin,
    visitorId,
    input: {
      villaNumber: input.villaNumber,
      reason: row.reason,
      reasonDetails: row.reasonDetails,
      requestedEntryAt: entry.toISOString(),
      durationMinutes: row.durationMinutes,
      requestedGateId: row.requestedGateId,
      clientRequestId: row.id,
    },
    channel,
  });
  await approveVisit(ctx, scope, admin, visit.id);

  await tx
    .update(arrivalRegistrations)
    .set({ status: 'approved', decidedAt: now, decidedByUserId: admin.userId, visitorId, visitId: visit.id })
    .where(eq(arrivalRegistrations.id, row.id));
  const corrected = (['fullName', 'nationality', 'mobile', 'villaNumber', 'documentNumber', 'documentType'] as const).filter((k) => row[k] !== input[k]);
  if (row.documentExpiryDate !== input.documentExpiry.gregorian) corrected.push('documentExpiry' as never);
  await audit(tx, {
    actor: { type: 'user', userId: admin.userId },
    action: 'arrival.approved',
    entityType: 'arrival',
    entityId: row.id,
    metadata: { reference: row.reference, visitReference: visit.reference, newProfile: !existing, corrected },
    at: now,
  });
  await publish(tx, { t: 'arrival' });
  return (await detailInTx(ctx, admin, row.id, tx))!;
}

export async function rejectArrival(ctx: ServerContext, scope: TxScope, admin: StaffPrincipal, id: string, reason: string): Promise<ArrivalDetailDTO> {
  requireReviewer(admin);
  const row = await lockPending(scope, id);
  await scope.tx
    .update(arrivalRegistrations)
    .set({ status: 'rejected', decidedAt: scope.now, decidedByUserId: admin.userId, rejectReason: reason })
    .where(eq(arrivalRegistrations.id, row.id));
  await audit(scope.tx, { actor: { type: 'user', userId: admin.userId }, action: 'arrival.rejected', entityType: 'arrival', entityId: row.id, metadata: { reference: row.reference }, at: scope.now });
  await publish(scope.tx, { t: 'arrival' });
  return (await detailInTx(ctx, admin, row.id, scope.tx))!;
}

async function detailInTx(ctx: ServerContext, staff: StaffPrincipal, id: string, tx: DbExecutor): Promise<ArrivalDetailDTO | null> {
  // Read through the transaction so the caller sees its own changes.
  return getArrivalDetail({ ...ctx, db: tx as ServerContext['db'] }, staff, id, false);
}

// ───────────────────────────── Housekeeping ─────────────────────────────

/** Closes stale unreviewed requests and deletes ID photos after the retention period. */
export async function sweepArrivals(scope: TxScope): Promise<{ closed: number; imagesRemoved: number }> {
  const { tx, now } = scope;
  const staleBefore = new Date(now.getTime() - PENDING_ARRIVAL_MAX_HOURS * 3_600_000);
  const closed = await tx
    .update(arrivalRegistrations)
    .set({ status: 'rejected', decidedAt: now, rejectReason: 'expired' })
    .where(and(eq(arrivalRegistrations.status, 'pending'), lt(arrivalRegistrations.createdAt, staleBefore)))
    .returning({ id: arrivalRegistrations.id });
  const retentionBefore = new Date(now.getTime() - ID_IMAGE_RETENTION_DAYS * 86_400_000);
  const removed = await tx
    .update(arrivalRegistrations)
    .set({ idImage: null, idImageType: null, idImageRemovedAt: now })
    .where(and(isNotNull(arrivalRegistrations.idImage), isNull(arrivalRegistrations.idImageRemovedAt), isNotNull(arrivalRegistrations.decidedAt), lt(arrivalRegistrations.decidedAt, retentionBefore)))
    .returning({ id: arrivalRegistrations.id });
  for (const r of closed) {
    await audit(tx, { actor: { type: 'system' }, action: 'arrival.expired', entityType: 'arrival', entityId: r.id, at: now });
  }
  if (closed.length) await publish(tx, { t: 'arrival' });
  return { closed: closed.length, imagesRemoved: removed.length };
}

