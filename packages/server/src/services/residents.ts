import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { maintenanceRequests, quickEntries, residents, sessions, villas, type DbExecutor, type MaintenanceRequest, type Resident } from '@vms/db';
import {
  ApiError,
  extractPassToken,
  hasPermission,
  inferDocumentType,
  luhnValid,
  maskPhone,
  normalizeDigits,
  type ClientKind,
  type GateQrResultDTO,
  type GateVillaDTO,
  type InviteCreatedDTO,
  type InvitePassDTO,
  type MaintenanceCategory,
  type MaintenanceDTO,
  type MaintenanceStatus,
  type ResidentAdminDTO,
  type VisitorRecordDTO,
} from '@vms/shared';
import type { ResidentPrincipal, StaffPrincipal } from '../auth/principal';
import { createSession, resolveSession } from '../auth/sessions';
import type { RequestMeta } from '../auth/staff';
import { inTransaction, type ServerContext, type TxScope } from '../context';
import { burnPasswordCheck, hashPassword, hmacBase64Url, randomCode, sha256Hex, verifyPassword } from '../crypto';
import { enforceRateLimit } from '../rate-limit';
import { publish } from '../realtime';
import { audit } from './audit';
import { entryQuery, loadEntry, ownerTokenFor, toDTO, whatsappUrl } from './quick-entries';
import { getSettings } from './settings';

/**
 * Residents: one account per villa (username = villa number), approved once by an administrator.
 * Residents invite visitors (a QR the gate scans, no approval needed), confirm visitors the gate
 * recorded for their villa, follow their villa's visitor records, raise maintenance requests and keep
 * the villa's contact name and phone up to date.
 */

const RATE = {
  signupIp: { name: 'resident:signup:ip', limit: 10, windowSeconds: 60 * 60 },
  loginIp: { name: 'resident:login:ip', limit: 30, windowSeconds: 15 * 60 },
  loginVilla: { name: 'resident:login:villa', limit: 10, windowSeconds: 15 * 60 },
  invitePassIp: { name: 'invite:pass:ip', limit: 300, windowSeconds: 60 * 60 },
};
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

// ───────────────────────────── Sign-up, sign-in, administration ─────────────────────────────

async function findVillaByNumber(db: DbExecutor, number: string) {
  const [villa] = await db.select().from(villas).where(eq(villas.number, number)).limit(1);
  return villa ?? null;
}

/** First registration for a villa. Nobody can register a villa that already has an account. */
export async function signupResident(
  ctx: ServerContext,
  input: { villaNumber: string; password: string; fullName?: string | undefined; mobile?: string | null | undefined },
  meta: RequestMeta,
): Promise<{ status: 'pending' }> {
  await enforceRateLimit(ctx, RATE.signupIp, meta.ip);
  const passwordHash = await hashPassword(input.password);
  await inTransaction(ctx, async (scope) => {
    const { tx, now } = scope;
    let villa = await findVillaByNumber(tx, input.villaNumber);
    if (!villa) {
      const [inserted] = await tx.insert(villas).values({ number: input.villaNumber, isActive: true, createdAt: now, updatedAt: now }).onConflictDoNothing().returning();
      villa = inserted ?? (await findVillaByNumber(tx, input.villaNumber))!;
    }
    if (!villa.isActive) throw new ApiError(400, 'validation_error', { villaNumber: 'errors.villa_inactive' });
    const [existing] = await tx.select({ id: residents.id }).from(residents).where(eq(residents.villaId, villa.id)).limit(1);
    if (existing) throw new ApiError(409, 'villa_registered', { villaNumber: 'errors.villa_registered' });
    const [created] = await tx
      .insert(residents)
      .values({ villaId: villa.id, passwordHash, fullName: input.fullName ?? null, mobile: input.mobile ?? null, status: 'pending', createdAt: now })
      .onConflictDoNothing()
      .returning({ id: residents.id });
    if (!created) throw new ApiError(409, 'villa_registered', { villaNumber: 'errors.villa_registered' });
    await audit(tx, { actor: { type: 'system' }, action: 'resident.signed_up', entityType: 'resident', entityId: created.id, metadata: { villa: input.villaNumber, mobile: maskPhone(input.mobile) }, ipHash: meta.ipHash, at: now });
    await publish(tx, { t: 'residents' });
  });
  return { status: 'pending' };
}

export async function loginResident(
  ctx: ServerContext,
  input: { username: string; password: string; client: ClientKind },
  meta: RequestMeta,
): Promise<{ token: string; principal: ResidentPrincipal }> {
  await enforceRateLimit(ctx, RATE.loginIp, meta.ip);
  await enforceRateLimit(ctx, RATE.loginVilla, input.username);
  const now = ctx.clock.now();
  const [row] = await ctx.db
    .select({ resident: residents })
    .from(residents)
    .innerJoin(villas, eq(villas.id, residents.villaId))
    .where(eq(villas.number, input.username))
    .limit(1);
  const resident = row?.resident;
  if (!resident) {
    await burnPasswordCheck(input.password);
    throw new ApiError(401, 'invalid_credentials');
  }
  if (resident.lockedUntil && resident.lockedUntil > now) {
    await burnPasswordCheck(input.password);
    throw new ApiError(429, 'rate_limited', undefined, { retryAfterSeconds: Math.ceil((resident.lockedUntil.getTime() - now.getTime()) / 1000) });
  }
  if (!(await verifyPassword(input.password, resident.passwordHash))) {
    const failed = resident.failedLoginCount + 1;
    await ctx.db
      .update(residents)
      .set(failed >= MAX_FAILED_LOGINS ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) } : { failedLoginCount: failed })
      .where(eq(residents.id, resident.id));
    throw new ApiError(401, 'invalid_credentials');
  }
  // The account state is revealed only to someone who knows the password.
  if (resident.status === 'pending') throw new ApiError(403, 'resident_pending');
  if (resident.status !== 'active') throw new ApiError(403, 'resident_disabled');

  const { token } = await inTransaction(ctx, async (scope) => {
    await scope.tx.update(residents).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }).where(eq(residents.id, resident.id));
    const created = await createSession(ctx, scope.tx, { kind: 'resident', residentId: resident.id, client: input.client, userAgent: meta.userAgent }, now);
    await audit(scope.tx, { actor: { type: 'system' }, action: 'resident.login', entityType: 'resident', entityId: resident.id, ipHash: meta.ipHash, at: now });
    return created;
  });
  return { token, principal: (await resolveSession(ctx, token)) as ResidentPrincipal };
}

function requireAdmin(staff: StaffPrincipal, permission: 'residents.manage' | 'maintenance.manage'): void {
  if (!hasPermission(staff.role, permission)) throw new ApiError(403, 'forbidden');
}

function toResidentDTO(r: Resident, villaNumber: string): ResidentAdminDTO {
  return {
    id: r.id,
    villaNumber,
    fullName: r.fullName,
    mobile: r.mobile,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
  };
}

export async function listResidents(ctx: ServerContext, staff: StaffPrincipal, status?: Resident['status']): Promise<{ items: ResidentAdminDTO[]; pendingCount: number }> {
  requireAdmin(staff, 'residents.manage');
  const rows = await ctx.db
    .select({ r: residents, villaNumber: villas.number })
    .from(residents)
    .innerJoin(villas, eq(villas.id, residents.villaId))
    .where(status ? eq(residents.status, status) : undefined)
    .orderBy(status === 'pending' ? asc(residents.createdAt) : asc(sql`length(${villas.number})`), asc(villas.number))
    .limit(1000);
  const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(residents).where(eq(residents.status, 'pending'));
  return { items: rows.map((x) => toResidentDTO(x.r, x.villaNumber)), pendingCount: count?.n ?? 0 };
}

async function revokeResidentSessions(tx: DbExecutor, residentId: string, now: Date) {
  await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.residentId, residentId), isNull(sessions.revokedAt)));
}

export async function decideResident(ctx: ServerContext, scope: TxScope, staff: StaffPrincipal, id: string, action: 'approve' | 'reject' | 'disable' | 'enable'): Promise<ResidentAdminDTO> {
  requireAdmin(staff, 'residents.manage');
  const { tx, now } = scope;
  const [row] = await tx.select({ r: residents, villaNumber: villas.number }).from(residents).innerJoin(villas, eq(villas.id, residents.villaId)).where(eq(residents.id, id)).for('update', { of: residents }).limit(1);
  if (!row) throw new ApiError(404, 'not_found');
  const status = action === 'approve' || action === 'enable' ? 'active' : action === 'reject' ? 'rejected' : 'disabled';
  const [updated] = await tx.update(residents).set({ status, decidedAt: now, decidedByUserId: staff.userId }).where(eq(residents.id, id)).returning();
  if (status !== 'active') await revokeResidentSessions(tx, id, now);
  // The first approval also records the resident's name and phone as the villa contact, when empty.
  if (action === 'approve') {
    await tx
      .update(villas)
      .set({ ownerName: sql`coalesce(${villas.ownerName}, ${row.r.fullName})`, ownerMobile: sql`coalesce(${villas.ownerMobile}, ${row.r.mobile})`, updatedAt: now })
      .where(eq(villas.id, row.r.villaId));
  }
  await audit(tx, { actor: { type: 'user', userId: staff.userId }, action: `resident.${action}`, entityType: 'resident', entityId: id, metadata: { villa: row.villaNumber }, at: now });
  await publish(tx, { t: 'residents' });
  return toResidentDTO(updated!, row.villaNumber);
}

export async function resetResidentPassword(ctx: ServerContext, scope: TxScope, staff: StaffPrincipal, id: string, password: string): Promise<void> {
  requireAdmin(staff, 'residents.manage');
  const updated = await scope.tx.update(residents).set({ passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null }).where(eq(residents.id, id)).returning({ id: residents.id });
  if (!updated.length) throw new ApiError(404, 'not_found');
  await revokeResidentSessions(scope.tx, id, scope.now);
  await audit(scope.tx, { actor: { type: 'user', userId: staff.userId }, action: 'resident.password_reset', entityType: 'resident', entityId: id, at: scope.now });
}

/** Removes the account so the villa can be registered again. Visitor records and requests stay with the villa. */
export async function deleteResident(ctx: ServerContext, scope: TxScope, staff: StaffPrincipal, id: string): Promise<void> {
  requireAdmin(staff, 'residents.manage');
  const { tx, now } = scope;
  const [row] = await tx.select().from(residents).where(eq(residents.id, id)).limit(1);
  if (!row) throw new ApiError(404, 'not_found');
  await tx.delete(sessions).where(eq(sessions.residentId, id));
  await tx.update(quickEntries).set({ invitedByResidentId: null }).where(eq(quickEntries.invitedByResidentId, id));
  await tx.update(maintenanceRequests).set({ residentId: null }).where(eq(maintenanceRequests.residentId, id));
  await tx.delete(residents).where(eq(residents.id, id));
  await audit(tx, { actor: { type: 'user', userId: staff.userId }, action: 'resident.deleted', entityType: 'resident', entityId: id, at: now });
  await publish(tx, { t: 'residents' });
}

// ───────────────────────────── Villa contact ─────────────────────────────

export async function getVillaContact(ctx: ServerContext, resident: ResidentPrincipal): Promise<{ villaNumber: string; ownerName: string | null; ownerMobile: string | null }> {
  const [villa] = await ctx.db.select().from(villas).where(eq(villas.id, resident.villaId));
  return { villaNumber: resident.villaNumber, ownerName: villa?.ownerName ?? null, ownerMobile: villa?.ownerMobile ?? null };
}

export async function updateVillaContact(ctx: ServerContext, resident: ResidentPrincipal, input: { ownerName?: string | undefined; ownerMobile?: string | null | undefined }) {
  await inTransaction(ctx, async ({ tx, now }) => {
    await tx.update(villas).set({ ownerName: input.ownerName ?? null, ownerMobile: input.ownerMobile ?? null, updatedAt: now }).where(eq(villas.id, resident.villaId));
    await audit(tx, { actor: { type: 'system' }, action: 'resident.villa_contact_updated', entityType: 'resident', entityId: resident.residentId, metadata: { villa: resident.villaNumber }, at: now });
  });
  return getVillaContact(ctx, resident);
}

// ───────────────────────────── Invitations and visitor records ─────────────────────────────

/** Derived like pass tokens, so the visitor's QR can be shown again; only its hash is stored. */
function inviteToken(ctx: ServerContext, entryId: string): string {
  return hmacBase64Url(ctx.config.passTokenSecret, `invite|${entryId}`);
}

export function inviteLink(ctx: ServerContext, entryId: string): string {
  return `${ctx.config.appOrigin}/i#${inviteToken(ctx, entryId)}`;
}

export async function createInvite(ctx: ServerContext, resident: ResidentPrincipal, input: { fullName: string; mobile?: string | null | undefined; expectedAt: string }): Promise<InviteCreatedDTO> {
  const id = await inTransaction(ctx, async ({ tx, now }) => {
    const entryId = crypto.randomUUID();
    await tx.insert(quickEntries).values({
      id: entryId,
      status: 'expected',
      villaId: resident.villaId,
      fullName: input.fullName,
      visitorMobile: input.mobile ?? null,
      expectedAt: new Date(input.expectedAt),
      invitedByResidentId: resident.residentId,
      inviteTokenHash: sha256Hex(inviteToken(ctx, entryId)),
      ownerTokenHash: sha256Hex(ownerTokenFor(ctx, entryId)),
      // Invited by the villa itself: nothing left to confirm.
      ownerResponse: 'confirmed',
      ownerRespondedAt: now,
      createdAt: now,
    });
    await audit(tx, { actor: { type: 'system' }, action: 'resident.invite_created', entityType: 'quick_entry', entityId: entryId, metadata: { villa: resident.villaNumber }, at: now });
    await publish(tx, { t: 'gate', villaId: resident.villaId });
    return entryId;
  });
  const invite = await loadEntry(ctx.db, id);
  const settings = await getSettings(ctx);
  const link = inviteLink(ctx, id);
  const text = `${settings.compoundNameAr}: دعوة لزيارة الفيلا ${resident.villaNumber}. اعرض رمز الدخول عند البوابة: ${link}`;
  return { invite, inviteLink: link, whatsappUrl: input.mobile ? whatsappUrl(input.mobile, text) : null };
}

export async function getInviteLink(ctx: ServerContext, resident: ResidentPrincipal, id: string): Promise<InviteCreatedDTO> {
  const [row] = await ctx.db.select({ villaId: quickEntries.villaId, invited: quickEntries.invitedByResidentId, mobile: quickEntries.visitorMobile }).from(quickEntries).where(eq(quickEntries.id, id)).limit(1);
  if (!row || row.villaId !== resident.villaId || !row.invited) throw new ApiError(404, 'not_found');
  const settings = await getSettings(ctx);
  const link = inviteLink(ctx, id);
  const text = `${settings.compoundNameAr}: دعوة لزيارة الفيلا ${resident.villaNumber}. اعرض رمز الدخول عند البوابة: ${link}`;
  return { invite: await loadEntry(ctx.db, id), inviteLink: link, whatsappUrl: row.mobile ? whatsappUrl(row.mobile, text) : null };
}

export async function cancelInvite(ctx: ServerContext, resident: ResidentPrincipal, id: string): Promise<VisitorRecordDTO> {
  await inTransaction(ctx, async ({ tx, now }) => {
    const [row] = await tx.select().from(quickEntries).where(eq(quickEntries.id, id)).for('update').limit(1);
    if (!row || row.villaId !== resident.villaId) throw new ApiError(404, 'not_found');
    if (row.status !== 'expected') throw new ApiError(409, 'invalid_transition', undefined, { status: row.status });
    await tx.update(quickEntries).set({ status: 'cancelled' }).where(eq(quickEntries.id, id));
    await audit(tx, { actor: { type: 'system' }, action: 'resident.invite_cancelled', entityType: 'quick_entry', entityId: id, at: now });
    await publish(tx, { t: 'gate', villaId: resident.villaId });
  });
  return loadEntry(ctx.db, id);
}

/** The villa's visitors: upcoming invitations, visitors inside now, and past visits. */
export async function listVillaVisitors(ctx: ServerContext, resident: ResidentPrincipal): Promise<{ upcoming: VisitorRecordDTO[]; inside: VisitorRecordDTO[]; past: VisitorRecordDTO[] }> {
  const base = (status: 'expected' | 'inside' | 'exited' | 'cancelled' | ('exited' | 'cancelled')[]) =>
    entryQuery(ctx.db).where(and(eq(quickEntries.villaId, resident.villaId), Array.isArray(status) ? inArray(quickEntries.status, status) : eq(quickEntries.status, status)));
  const [upcoming, inside, past] = await Promise.all([
    base('expected').orderBy(asc(quickEntries.expectedAt)).limit(200),
    base('inside').orderBy(desc(quickEntries.enteredAt)).limit(200),
    base(['exited', 'cancelled']).orderBy(desc(sql`coalesce(${quickEntries.exitedAt}, ${quickEntries.createdAt})`)).limit(200),
  ]);
  return { upcoming: upcoming.map(toDTO), inside: inside.map(toDTO), past: past.map(toDTO) };
}

/** Visitors the gate recorded for the villa that the resident has not answered yet. */
export async function listPendingConfirmations(ctx: ServerContext, resident: ResidentPrincipal): Promise<VisitorRecordDTO[]> {
  const rows = await entryQuery(ctx.db)
    .where(and(eq(quickEntries.villaId, resident.villaId), isNull(quickEntries.ownerResponse), inArray(quickEntries.status, ['inside', 'exited'])))
    .orderBy(desc(quickEntries.enteredAt))
    .limit(100);
  return rows.map(toDTO);
}

export async function respondAsResident(ctx: ServerContext, resident: ResidentPrincipal, id: string, response: 'confirmed' | 'declined'): Promise<VisitorRecordDTO> {
  await inTransaction(ctx, async ({ tx, now }) => {
    const [row] = await tx.select().from(quickEntries).where(eq(quickEntries.id, id)).for('update').limit(1);
    if (!row || row.villaId !== resident.villaId) throw new ApiError(404, 'not_found');
    await tx.update(quickEntries).set({ ownerResponse: response, ownerRespondedAt: now }).where(eq(quickEntries.id, id));
    await audit(tx, { actor: { type: 'system' }, action: `gate.owner_${response}`, entityType: 'quick_entry', entityId: id, metadata: { by: 'resident' }, at: now });
    await publish(tx, { t: 'gate', villaId: resident.villaId });
  });
  return loadEntry(ctx.db, id);
}

/** The visitor's invitation page (public, by token). */
export async function getInvitePass(ctx: ServerContext, token: string, meta: RequestMeta): Promise<InvitePassDTO> {
  await enforceRateLimit(ctx, RATE.invitePassIp, meta.ip);
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new ApiError(404, 'not_found');
  const [row] = await ctx.db
    .select({ e: quickEntries, villaNumber: villas.number })
    .from(quickEntries)
    .innerJoin(villas, eq(villas.id, quickEntries.villaId))
    .where(eq(quickEntries.inviteTokenHash, sha256Hex(token)))
    .limit(1);
  if (!row) throw new ApiError(404, 'not_found');
  const settings = await getSettings(ctx);
  return {
    compoundName: settings.compoundNameAr,
    villaNumber: row.villaNumber,
    fullName: row.e.fullName,
    expectedAt: row.e.expectedAt?.toISOString() ?? null,
    status: row.e.status,
    qrValue: inviteLink(ctx, row.e.id),
  };
}

// ───────────────────────────── Gate: villa lookup, invitations, QR ─────────────────────────────

function requireGate(staff: StaffPrincipal): void {
  if (!hasPermission(staff.role, 'gate.quick_entry')) throw new ApiError(403, 'forbidden');
}

/** Typing a villa number at the gate shows the owner's name and phone and the visitors it expects. */
export async function gateVillaInfo(ctx: ServerContext, staff: StaffPrincipal, number: string): Promise<GateVillaDTO> {
  requireGate(staff);
  const villa = await findVillaByNumber(ctx.db, number);
  if (!villa) return { villa: null, expected: [] };
  const expected = await entryQuery(ctx.db)
    .where(and(eq(quickEntries.villaId, villa.id), eq(quickEntries.status, 'expected')))
    .orderBy(asc(quickEntries.expectedAt))
    .limit(50);
  return {
    villa: { id: villa.id, number: villa.number, ownerName: villa.ownerName, ownerMobile: villa.ownerMobile, isActive: villa.isActive },
    expected: expected.map(toDTO),
  };
}

/** Checks an invited visitor in (from the villa's expected list or by scanning their QR). */
export async function checkInInvite(ctx: ServerContext, staff: StaffPrincipal, id: string, gateId?: string | null): Promise<{ entry: VisitorRecordDTO; alreadyInside: boolean }> {
  requireGate(staff);
  let alreadyInside = false;
  await inTransaction(ctx, async ({ tx, now }) => {
    const [row] = await tx.select().from(quickEntries).where(eq(quickEntries.id, id)).for('update').limit(1);
    if (!row) throw new ApiError(404, 'not_found');
    if (row.status === 'inside') {
      alreadyInside = true;
      return;
    }
    if (row.status !== 'expected') throw new ApiError(409, 'invite_not_valid', undefined, { status: row.status });
    await tx.update(quickEntries).set({ status: 'inside', enteredAt: now, enteredByUserId: staff.userId, gateId: gateId ?? null }).where(eq(quickEntries.id, id));
    await audit(tx, { actor: { type: 'user', userId: staff.userId }, action: 'gate.invite_checked_in', entityType: 'quick_entry', entityId: id, at: now });
    await publish(tx, { t: 'gate', villaId: row.villaId, entered: row.fullName ?? '' });
  });
  return { entry: await loadEntry(ctx.db, id), alreadyInside };
}

/**
 * Interprets a QR scanned at the gate: a resident's invitation (checked in at once), a visit pass
 * (handled by the pass scanner), or any code that carries a valid Saudi identity number — for example a
 * QR whose text contains the number. Signed digital-ID QR codes cannot be decoded without the issuer.
 */
export async function scanGateQr(ctx: ServerContext, staff: StaffPrincipal, qr: string, gateId?: string | null): Promise<GateQrResultDTO> {
  requireGate(staff);
  const raw = qr.trim();
  const inviteMatch = /\/i#([A-Za-z0-9_-]{20,100})/.exec(raw) ?? /^([A-Za-z0-9_-]{43})$/.exec(raw);
  if (inviteMatch) {
    const [row] = await ctx.db.select({ id: quickEntries.id }).from(quickEntries).where(eq(quickEntries.inviteTokenHash, sha256Hex(inviteMatch[1]!))).limit(1);
    if (row) {
      const result = await checkInInvite(ctx, staff, row.id, gateId);
      return { kind: 'invite', entry: result.entry, alreadyInside: result.alreadyInside };
    }
  }
  if (extractPassToken(raw)) return { kind: 'pass' };
  const digits = normalizeDigits(raw);
  for (const m of digits.matchAll(/(?<!\d)[12]\d{9}(?!\d)/g)) {
    if (luhnValid(m[0])) return { kind: 'identity', documentNumber: m[0], documentType: inferDocumentType(m[0]) ?? 'national_id' };
  }
  return { kind: 'unknown' };
}

// ───────────────────────────── Maintenance ─────────────────────────────

function toMaintenanceDTO(m: MaintenanceRequest, villaNumber: string): MaintenanceDTO {
  return {
    id: m.id,
    reference: m.reference,
    villaNumber,
    category: m.category as MaintenanceCategory,
    description: m.description,
    status: m.status,
    adminNote: m.adminNote,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export async function createMaintenance(ctx: ServerContext, resident: ResidentPrincipal, input: { category: MaintenanceCategory; description: string }): Promise<MaintenanceDTO> {
  const row = await inTransaction(ctx, async ({ tx, now }) => {
    const [created] = await tx
      .insert(maintenanceRequests)
      .values({ reference: `MR-${randomCode(6)}`, villaId: resident.villaId, residentId: resident.residentId, category: input.category, description: input.description, createdAt: now, updatedAt: now })
      .returning();
    await audit(tx, { actor: { type: 'system' }, action: 'maintenance.created', entityType: 'maintenance', entityId: created!.id, metadata: { villa: resident.villaNumber, category: input.category }, at: now });
    await publish(tx, { t: 'maintenance', villaId: resident.villaId });
    return created!;
  });
  return toMaintenanceDTO(row, resident.villaNumber);
}

export async function listMyMaintenance(ctx: ServerContext, resident: ResidentPrincipal): Promise<MaintenanceDTO[]> {
  const rows = await ctx.db.select().from(maintenanceRequests).where(eq(maintenanceRequests.villaId, resident.villaId)).orderBy(desc(maintenanceRequests.createdAt)).limit(200);
  return rows.map((r) => toMaintenanceDTO(r, resident.villaNumber));
}

export async function cancelMyMaintenance(ctx: ServerContext, resident: ResidentPrincipal, id: string): Promise<MaintenanceDTO> {
  const row = await inTransaction(ctx, async ({ tx, now }) => {
    const [current] = await tx.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, id)).for('update').limit(1);
    if (!current || current.villaId !== resident.villaId) throw new ApiError(404, 'not_found');
    if (current.status !== 'open') throw new ApiError(409, 'invalid_transition', undefined, { status: current.status });
    const [updated] = await tx.update(maintenanceRequests).set({ status: 'cancelled', updatedAt: now }).where(eq(maintenanceRequests.id, id)).returning();
    await audit(tx, { actor: { type: 'system' }, action: 'maintenance.cancelled', entityType: 'maintenance', entityId: id, at: now });
    await publish(tx, { t: 'maintenance', villaId: resident.villaId });
    return updated!;
  });
  return toMaintenanceDTO(row, resident.villaNumber);
}

export async function listMaintenance(ctx: ServerContext, staff: StaffPrincipal, status?: MaintenanceStatus): Promise<{ items: MaintenanceDTO[]; openCount: number }> {
  requireAdmin(staff, 'maintenance.manage');
  const rows = await ctx.db
    .select({ m: maintenanceRequests, villaNumber: villas.number })
    .from(maintenanceRequests)
    .innerJoin(villas, eq(villas.id, maintenanceRequests.villaId))
    .where(status ? eq(maintenanceRequests.status, status) : undefined)
    .orderBy(desc(maintenanceRequests.createdAt))
    .limit(500);
  const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(maintenanceRequests).where(eq(maintenanceRequests.status, 'open'));
  return { items: rows.map((r) => toMaintenanceDTO(r.m, r.villaNumber)), openCount: count?.n ?? 0 };
}

export async function updateMaintenance(ctx: ServerContext, staff: StaffPrincipal, id: string, input: { status: MaintenanceStatus; adminNote?: string | null | undefined }): Promise<MaintenanceDTO> {
  requireAdmin(staff, 'maintenance.manage');
  const result = await inTransaction(ctx, async ({ tx, now }) => {
    const [updated] = await tx
      .update(maintenanceRequests)
      .set({ status: input.status, ...(input.adminNote !== undefined ? { adminNote: input.adminNote } : {}), updatedAt: now, updatedByUserId: staff.userId })
      .where(eq(maintenanceRequests.id, id))
      .returning();
    if (!updated) throw new ApiError(404, 'not_found');
    const [villa] = await tx.select({ number: villas.number }).from(villas).where(eq(villas.id, updated.villaId));
    await audit(tx, { actor: { type: 'user', userId: staff.userId }, action: 'maintenance.updated', entityType: 'maintenance', entityId: id, metadata: { status: input.status }, at: now });
    await publish(tx, { t: 'maintenance', villaId: updated.villaId });
    return { updated, villaNumber: villa?.number ?? '' };
  });
  return toMaintenanceDTO(result.updated, result.villaNumber);
}

