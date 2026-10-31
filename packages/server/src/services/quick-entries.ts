import { and, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { gateEvents, gates, quickEntries, users, villas, visitors, visits, type DbExecutor, type QuickEntry } from '@vms/db';
import {
  ApiError,
  hasPermission,
  maskDocumentNumber,
  zonedDateString,
  type ArrivalScanResultDTO,
  type DocumentKind,
  type InsideNowDTO,
  type OwnerConfirmationDTO,
  type QuickEntryCreatedDTO,
  type QuickEntryDTO,
  type VisitorRecordDTO,
} from '@vms/shared';
import type { StaffPrincipal } from '../auth/principal';
import type { RequestMeta } from '../auth/staff';
import { inTransaction, type ServerContext, type TxScope } from '../context';
import { hmacBase64Url, sha256Hex } from '../crypto';
import { readIdImage } from '../providers/id-reader';
import { enforceRateLimit } from '../rate-limit';
import { publish } from '../realtime';
import { audit } from './audit';
import { getSettings } from './settings';

/**
 * Gate quick entry: security photographs the visitor's ID / Iqama / passport and types the villa
 * number; the entry time is recorded automatically. Exit is one tap from the list of everyone inside.
 * The villa owner can confirm or decline through a private link (shared by the guard over WhatsApp).
 */

const OWNER_RATE_LIMIT = { name: 'owner:ip', limit: 120, windowSeconds: 60 * 60 };
/** ID photos are deleted this many days after the visitor leaves. */
export const QUICK_ENTRY_IMAGE_RETENTION_DAYS = 30;

function requireGateStaff(staff: StaffPrincipal): void {
  if (!hasPermission(staff.role, 'gate.quick_entry')) throw new ApiError(403, 'forbidden');
}

/** The owner link token is derived (not stored), so the guard can share the link again at any time. */
function ownerToken(ctx: ServerContext, entryId: string): string {
  return hmacBase64Url(ctx.config.passTokenSecret, `owner|${entryId}`);
}

export function ownerTokenFor(ctx: ServerContext, entryId: string): string {
  return ownerToken(ctx, entryId);
}

export function ownerLink(ctx: ServerContext, entryId: string): string {
  return `${ctx.config.appOrigin}/v#${ownerToken(ctx, entryId)}`;
}

const enteredBy = alias(users, 'entered_by');
const exitedBy = alias(users, 'exited_by');

export function entryQuery(db: DbExecutor) {
  return db
    .select({
      e: quickEntries,
      villaNumber: villas.number,
      villaOwnerMobile: villas.ownerMobile,
      hasImage: sql<boolean>`${quickEntries.idImage} is not null`,
      gate: { id: gates.id, nameAr: gates.nameAr, nameEn: gates.nameEn },
      enteredByName: enteredBy.fullName,
      exitedByName: exitedBy.fullName,
    })
    .from(quickEntries)
    .innerJoin(villas, eq(villas.id, quickEntries.villaId))
    .leftJoin(gates, eq(gates.id, quickEntries.gateId))
    .leftJoin(enteredBy, eq(enteredBy.id, quickEntries.enteredByUserId))
    .leftJoin(exitedBy, eq(exitedBy.id, quickEntries.exitedByUserId));
}

export type EntryRow = Awaited<ReturnType<ReturnType<typeof entryQuery>['execute']>>[number];

export function toDTO(row: EntryRow): VisitorRecordDTO {
  const e = row.e;
  return {
    id: e.id,
    status: e.status,
    villaNumber: row.villaNumber,
    villaHasOwnerContact: !!row.villaOwnerMobile,
    gate: row.gate?.id ? { id: row.gate.id, nameAr: row.gate.nameAr, nameEn: row.gate.nameEn } : null,
    documentKind: (e.documentKind as QuickEntryDTO['documentKind']) ?? null,
    documentNumber: e.documentNumber,
    fullName: e.fullName,
    nationality: e.nationality,
    hasImage: !!row.hasImage,
    enteredAt: e.enteredAt?.toISOString() ?? null,
    enteredBy: row.enteredByName ?? null,
    exitedAt: e.exitedAt?.toISOString() ?? null,
    exitedBy: row.exitedByName ?? null,
    ownerResponse: e.ownerResponse,
    ownerRespondedAt: e.ownerRespondedAt?.toISOString() ?? null,
    expectedAt: e.expectedAt?.toISOString() ?? null,
    visitorMobile: e.visitorMobile,
    invitedByResident: !!e.invitedByResidentId,
  };
}

export async function loadEntry(db: DbExecutor, id: string): Promise<VisitorRecordDTO> {
  const [row] = await entryQuery(db).where(eq(quickEntries.id, id)).limit(1);
  if (!row) throw new ApiError(404, 'not_found');
  return toDTO(row);
}

/** Reads the photo for the guard to check (nothing is stored by this call). */
export async function scanForGate(ctx: ServerContext, staff: StaffPrincipal, image: { type: string; bytes: Buffer }): Promise<ArrivalScanResultDTO> {
  requireGateStaff(staff);
  const settings = await getSettings(ctx);
  const fields = await readIdImage(ctx.config, image, zonedDateString(ctx.clock.now(), settings.timezone));
  return fields ? { recognized: true, fields } : { recognized: false, fields: {} };
}

/** Finds the villa by its number, adding new numbers to the list (administrators can disable wrong ones). */
export async function resolveVillaNumber(scope: TxScope, staff: StaffPrincipal, number: string): Promise<{ id: string; ownerMobile: string | null }> {
  const { tx, now } = scope;
  let [villa] = await tx.select().from(villas).where(eq(villas.number, number)).limit(1);
  if (!villa) {
    const [created] = await tx.insert(villas).values({ number, isActive: true, createdAt: now, updatedAt: now }).onConflictDoNothing().returning();
    if (created) {
      await audit(tx, { actor: { type: 'user', userId: staff.userId }, action: 'villa.created', entityType: 'villa', entityId: created.id, metadata: { number, auto: true }, at: now });
      return { id: created.id, ownerMobile: null };
    }
    [villa] = await tx.select().from(villas).where(eq(villas.number, number)).limit(1);
  }
  if (!villa?.isActive) throw new ApiError(400, 'validation_error', { villaNumber: 'errors.villa_inactive' });
  return { id: villa.id, ownerMobile: villa.ownerMobile };
}

export interface QuickEntryCreate {
  villaNumber: string;
  image: { type: string; bytes: Buffer };
  documentKind?: DocumentKind | null | undefined;
  documentNumber?: string | undefined;
  fullName?: string | undefined;
  nationality?: string | undefined;
  gateId?: string | null | undefined;
}

export function whatsappUrl(mobile: string, text: string): string {
  return `https://wa.me/${mobile.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}

/** Records the entry now. */
export async function createQuickEntry(ctx: ServerContext, staff: StaffPrincipal, input: QuickEntryCreate, meta: RequestMeta): Promise<QuickEntryCreatedDTO> {
  requireGateStaff(staff);
  const settings = await getSettings(ctx);
  const { id, ownerMobile } = await inTransaction(ctx, async (scope) => {
    const villa = await resolveVillaNumber(scope, staff, input.villaNumber);
    if (input.gateId) {
      const [gate] = await scope.tx.select({ id: gates.id }).from(gates).where(and(eq(gates.id, input.gateId), eq(gates.isActive, true))).limit(1);
      if (!gate) throw new ApiError(400, 'validation_error', { gateId: 'errors.gate_inactive' });
    }
    const entryId = crypto.randomUUID();
    await scope.tx.insert(quickEntries).values({
      id: entryId,
      villaId: villa.id,
      gateId: input.gateId ?? null,
      documentKind: input.documentKind ?? null,
      documentNumber: input.documentNumber ?? null,
      fullName: input.fullName ?? null,
      nationality: input.nationality ?? null,
      idImage: input.image.bytes,
      idImageType: input.image.type,
      enteredAt: scope.now,
      enteredByUserId: staff.userId,
      ownerTokenHash: sha256Hex(ownerToken(ctx, entryId)),
      createdAt: scope.now,
    });
    await audit(scope.tx, {
      actor: { type: 'user', userId: staff.userId },
      action: 'gate.quick_entry',
      entityType: 'quick_entry',
      entityId: entryId,
      metadata: { villa: input.villaNumber, documentKind: input.documentKind ?? null, documentNumber: input.documentNumber ? maskDocumentNumber(input.documentNumber) : null },
      ipHash: meta.ipHash,
      at: scope.now,
    });
    await publish(scope.tx, { t: 'gate', villaId: villa.id, entered: input.fullName ?? '' });
    return { id: entryId, ownerMobile: villa.ownerMobile };
  });
  const entry = await loadEntry(ctx.db, id);
  const link = ownerLink(ctx, id);
  const who = entry.fullName ?? (entry.documentNumber ? maskDocumentNumber(entry.documentNumber) : '');
  const message = [`${settings.compoundNameAr}: زائر للفيلا ${entry.villaNumber}${who ? ` (${who})` : ''}.`, `للتأكيد أو الرفض: ${link}`].join('\n');
  return { entry, ownerLink: link, ownerWhatsappUrl: ownerMobile ? whatsappUrl(ownerMobile, message) : null };
}

export async function getQuickEntry(ctx: ServerContext, staff: StaffPrincipal, id: string): Promise<QuickEntryCreatedDTO> {
  requireGateStaff(staff);
  const entry = await loadEntry(ctx.db, id);
  const [villa] = await ctx.db.select({ ownerMobile: villas.ownerMobile }).from(quickEntries).innerJoin(villas, eq(villas.id, quickEntries.villaId)).where(eq(quickEntries.id, id));
  const settings = await getSettings(ctx);
  const link = ownerLink(ctx, id);
  const message = [`${settings.compoundNameAr}: زائر للفيلا ${entry.villaNumber}${entry.fullName ? ` (${entry.fullName})` : ''}.`, `للتأكيد أو الرفض: ${link}`].join('\n');
  return { entry, ownerLink: link, ownerWhatsappUrl: villa?.ownerMobile ? whatsappUrl(villa.ownerMobile, message) : null };
}

export async function getQuickEntryImage(ctx: ServerContext, staff: StaffPrincipal, id: string): Promise<{ type: string; bytes: Buffer }> {
  requireGateStaff(staff);
  const [row] = await ctx.db.select({ image: quickEntries.idImage, type: quickEntries.idImageType }).from(quickEntries).where(eq(quickEntries.id, id)).limit(1);
  if (!row?.image || !row.type) throw new ApiError(404, 'not_found');
  return { type: row.type, bytes: row.image };
}

/** Everyone inside now, newest first: quick entries plus visits checked in with a pass. */
export async function listInside(ctx: ServerContext, staff: StaffPrincipal): Promise<InsideNowDTO> {
  requireGateStaff(staff);
  const rows = await entryQuery(ctx.db).where(eq(quickEntries.status, 'inside')).orderBy(desc(quickEntries.enteredAt)).limit(500);
  const checkIn = alias(gateEvents, 'check_in');
  const legacy = await ctx.db
    .select({ id: visits.id, reference: visits.reference, fullName: visitors.fullName, villaNumber: villas.number, checkedInAt: checkIn.recordedAt })
    .from(visits)
    .innerJoin(visitors, eq(visitors.id, visits.visitorId))
    .innerJoin(villas, eq(villas.id, visits.villaId))
    .leftJoin(checkIn, and(eq(checkIn.visitId, visits.id), eq(checkIn.type, 'entry')))
    .where(eq(visits.status, 'checked_in'))
    .orderBy(desc(checkIn.recordedAt))
    .limit(500);
  return {
    entries: rows.map(toDTO),
    visits: legacy.map((v) => ({ ...v, checkedInAt: (v.checkedInAt ?? new Date(0)).toISOString() })),
  };
}

/** History for administrators and the gate log. */
export async function listQuickEntries(ctx: ServerContext, staff: StaffPrincipal, query: { page: number; pageSize: number; q?: string | undefined }) {
  requireGateStaff(staff);
  // Only people who actually came through the gate (not invitations still expected or cancelled).
  const entered = isNotNull(quickEntries.enteredAt);
  const where = query.q
    ? and(entered, sql`(${villas.number} ilike ${`%${query.q}%`} or ${quickEntries.fullName} ilike ${`%${query.q}%`} or ${quickEntries.documentNumber} ilike ${`%${query.q}%`})`)
    : entered;
  const rows = await entryQuery(ctx.db)
    .where(where)
    .orderBy(desc(quickEntries.enteredAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(quickEntries).innerJoin(villas, eq(villas.id, quickEntries.villaId)).where(where);
  return { items: rows.map(toDTO), total: count?.n ?? 0, page: query.page, pageSize: query.pageSize };
}

/** One tap at the gate: records the exit now. Repeating it is harmless. */
export async function exitQuickEntry(ctx: ServerContext, staff: StaffPrincipal, id: string): Promise<QuickEntryDTO> {
  requireGateStaff(staff);
  await inTransaction(ctx, async (scope) => {
    const [row] = await scope.tx.select().from(quickEntries).where(eq(quickEntries.id, id)).for('update').limit(1);
    if (!row) throw new ApiError(404, 'not_found');
    if (row.status === 'exited') return;
    await scope.tx.update(quickEntries).set({ status: 'exited', exitedAt: scope.now, exitedByUserId: staff.userId }).where(eq(quickEntries.id, id));
    await audit(scope.tx, { actor: { type: 'user', userId: staff.userId }, action: 'gate.quick_exit', entityType: 'quick_entry', entityId: id, at: scope.now });
    await publish(scope.tx, { t: 'gate', villaId: row.villaId });
  });
  return loadEntry(ctx.db, id);
}

// ───────────────────────────── Villa owner confirmation (public link) ─────────────────────────────

async function findByOwnerToken(db: DbExecutor, token: string): Promise<QuickEntry | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await db.select().from(quickEntries).where(eq(quickEntries.ownerTokenHash, sha256Hex(token))).limit(1);
  return row ?? null;
}

export async function getOwnerConfirmation(ctx: ServerContext, token: string, meta: RequestMeta): Promise<OwnerConfirmationDTO> {
  await enforceRateLimit(ctx, OWNER_RATE_LIMIT, meta.ip);
  const row = await findByOwnerToken(ctx.db, token);
  if (!row) throw new ApiError(404, 'not_found');
  const [villa] = await ctx.db.select({ number: villas.number }).from(villas).where(eq(villas.id, row.villaId));
  const settings = await getSettings(ctx);
  return {
    compoundName: settings.compoundNameAr,
    villaNumber: villa?.number ?? '',
    fullName: row.fullName,
    enteredAt: row.enteredAt?.toISOString() ?? null,
    status: row.status,
    response: row.ownerResponse,
  };
}

export async function respondAsOwner(ctx: ServerContext, token: string, response: 'confirmed' | 'declined', meta: RequestMeta): Promise<OwnerConfirmationDTO> {
  await enforceRateLimit(ctx, OWNER_RATE_LIMIT, meta.ip);
  const row = await findByOwnerToken(ctx.db, token);
  if (!row) throw new ApiError(404, 'not_found');
  await inTransaction(ctx, async (scope) => {
    await scope.tx.update(quickEntries).set({ ownerResponse: response, ownerRespondedAt: scope.now }).where(eq(quickEntries.id, row.id));
    await audit(scope.tx, { actor: { type: 'system' }, action: `gate.owner_${response}`, entityType: 'quick_entry', entityId: row.id, ipHash: meta.ipHash, at: scope.now });
    await publish(scope.tx, { t: 'gate', villaId: row.villaId });
  });
  return getOwnerConfirmation(ctx, token, meta);
}

// ───────────────────────────── Housekeeping ─────────────────────────────

/** Deletes ID photos once the retention period after exit has passed. */
export async function sweepQuickEntryImages(scope: TxScope): Promise<number> {
  const before = new Date(scope.now.getTime() - QUICK_ENTRY_IMAGE_RETENTION_DAYS * 86_400_000);
  const removed = await scope.tx
    .update(quickEntries)
    .set({ idImage: null, idImageType: null, idImageRemovedAt: scope.now })
    .where(and(isNotNull(quickEntries.idImage), isNull(quickEntries.idImageRemovedAt), isNotNull(quickEntries.exitedAt), lt(quickEntries.exitedAt, before)))
    .returning({ id: quickEntries.id });
  return removed.length;
}
