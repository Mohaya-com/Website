import { and, asc, count, desc, eq, ilike, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { auditLogs, gates, users, villas, visitors, type DbExecutor } from '@vms/db';
import { ApiError, type AuditDTO, type GateDTO, type StaffRole, type StaffUserDTO, type VillaDTO } from '@vms/shared';
import type { StaffPrincipal } from '../auth/principal';
import { revokeUserSessions } from '../auth/sessions';
import type { TxScope } from '../context';
import { generateTemporaryPassword, hashPassword, randomCode } from '../crypto';
import { paginate, toGateDTO, toStaffUserDTO, toVillaDTO } from '../dto';
import { actorOf, audit } from './audit';
import { localRangeToUtc } from './visit-queries';

// ───────────────────────────── Gates ─────────────────────────────

export async function listGates(db: DbExecutor, includeInactive: boolean): Promise<GateDTO[]> {
  const rows = await db
    .select()
    .from(gates)
    .where(includeInactive ? undefined : eq(gates.isActive, true))
    .orderBy(asc(gates.createdAt));
  return rows.map(toGateDTO);
}

export async function findGateByCode(db: DbExecutor, code: string) {
  const [gate] = await db.select().from(gates).where(and(eq(gates.code, code), eq(gates.isActive, true))).limit(1);
  return gate ?? null;
}

export async function createGate(
  scope: TxScope,
  admin: StaffPrincipal,
  input: { nameAr: string; nameEn: string; supportsEntry: boolean; supportsExit: boolean; isActive: boolean },
): Promise<GateDTO> {
  if (!input.supportsEntry && !input.supportsExit) throw new ApiError(400, 'validation_error', { supportsEntry: 'validation.gateActionRequired' });
  const [gate] = await scope.tx
    .insert(gates)
    .values({ ...input, code: randomCode(8), createdAt: scope.now, updatedAt: scope.now })
    .returning();
  await audit(scope.tx, { actor: actorOf(admin), action: 'gate.created', entityType: 'gate', entityId: gate!.id, metadata: { nameEn: input.nameEn }, at: scope.now });
  return toGateDTO(gate!);
}

export async function updateGate(
  scope: TxScope,
  admin: StaffPrincipal,
  id: string,
  input: Partial<{ nameAr: string; nameEn: string; supportsEntry: boolean; supportsExit: boolean; isActive: boolean; regenerateCode: boolean }>,
): Promise<GateDTO> {
  const [current] = await scope.tx.select().from(gates).where(eq(gates.id, id)).for('update').limit(1);
  if (!current) throw new ApiError(404, 'not_found');
  const { regenerateCode, ...fields } = input;
  const next = { ...current, ...fields };
  if (!next.supportsEntry && !next.supportsExit) throw new ApiError(400, 'validation_error', { supportsEntry: 'validation.gateActionRequired' });
  const [gate] = await scope.tx
    .update(gates)
    .set({ ...fields, ...(regenerateCode ? { code: randomCode(8) } : {}), updatedAt: scope.now })
    .where(eq(gates.id, id))
    .returning();
  await audit(scope.tx, {
    actor: actorOf(admin),
    action: 'gate.updated',
    entityType: 'gate',
    entityId: id,
    metadata: { fields: Object.keys(fields), codeRegenerated: Boolean(regenerateCode) },
    at: scope.now,
  });
  return toGateDTO(gate!);
}

// ───────────────────────────── Villas ─────────────────────────────

export async function listVillas(db: DbExecutor, query: { q?: string | undefined; includeInactive: boolean; page: number; pageSize: number }) {
  const conditions: (SQL | undefined)[] = [];
  if (!query.includeInactive) conditions.push(eq(villas.isActive, true));
  if (query.q) conditions.push(or(ilike(villas.number, `%${query.q}%`), ilike(villas.label, `%${query.q}%`)));
  const where = and(...conditions);
  const [totalRow] = await db.select({ n: count() }).from(villas).where(where);
  const rows = await db
    .select()
    .from(villas)
    .where(where)
    .orderBy(sql`length(${villas.number})`, asc(villas.number))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  return paginate(rows.map(toVillaDTO), Number(totalRow?.n ?? 0), query.page, query.pageSize);
}

/** All active villa numbers for request forms (villa numbers are not personal data). */
export async function villaOptions(db: DbExecutor): Promise<VillaDTO[]> {
  const rows = await db.select().from(villas).where(eq(villas.isActive, true)).orderBy(sql`length(${villas.number})`, asc(villas.number));
  return rows.map(toVillaDTO);
}

export async function createVilla(scope: TxScope, admin: StaffPrincipal, input: { number: string; label?: string | null | undefined; isActive: boolean }): Promise<VillaDTO> {
  const [dup] = await scope.tx.select({ id: villas.id }).from(villas).where(eq(villas.number, input.number)).limit(1);
  if (dup) throw new ApiError(409, 'villa_taken', { number: 'errors.villa_taken' });
  const [villa] = await scope.tx
    .insert(villas)
    .values({ number: input.number, label: input.label ?? null, isActive: input.isActive, createdAt: scope.now, updatedAt: scope.now })
    .returning();
  await audit(scope.tx, { actor: actorOf(admin), action: 'villa.created', entityType: 'villa', entityId: villa!.id, metadata: { number: input.number }, at: scope.now });
  return toVillaDTO(villa!);
}

export async function updateVilla(
  scope: TxScope,
  admin: StaffPrincipal,
  id: string,
  input: Partial<{ number: string; label: string | null; isActive: boolean }>,
): Promise<VillaDTO> {
  const [current] = await scope.tx.select().from(villas).where(eq(villas.id, id)).for('update').limit(1);
  if (!current) throw new ApiError(404, 'not_found');
  if (input.number && input.number !== current.number) {
    const [dup] = await scope.tx.select({ id: villas.id }).from(villas).where(and(eq(villas.number, input.number), ne(villas.id, id))).limit(1);
    if (dup) throw new ApiError(409, 'villa_taken', { number: 'errors.villa_taken' });
  }
  const [villa] = await scope.tx.update(villas).set({ ...input, updatedAt: scope.now }).where(eq(villas.id, id)).returning();
  await audit(scope.tx, { actor: actorOf(admin), action: 'villa.updated', entityType: 'villa', entityId: id, metadata: { fields: Object.keys(input), number: villa!.number }, at: scope.now });
  return toVillaDTO(villa!);
}

// ───────────────────────────── Staff users ─────────────────────────────

export async function listStaff(db: DbExecutor): Promise<StaffUserDTO[]> {
  const rows = await db.select().from(users).orderBy(desc(users.isActive), asc(users.role), asc(users.fullName));
  return rows.map(toStaffUserDTO);
}

async function activeAdminCount(db: DbExecutor, excludingUserId?: string): Promise<number> {
  const conditions = [eq(users.role, 'admin'), eq(users.isActive, true)];
  if (excludingUserId) conditions.push(ne(users.id, excludingUserId));
  const [row] = await db.select({ n: count() }).from(users).where(and(...conditions));
  return Number(row?.n ?? 0);
}

export async function createStaffUser(
  scope: TxScope,
  admin: StaffPrincipal,
  input: { username: string; fullName: string; role: StaffRole; phone?: string | null | undefined; password?: string | undefined },
): Promise<{ user: StaffUserDTO; temporaryPassword: string | null }> {
  const [dup] = await scope.tx.select({ id: users.id }).from(users).where(eq(users.username, input.username)).limit(1);
  if (dup) throw new ApiError(409, 'username_taken', { username: 'errors.username_taken' });
  const temporaryPassword = input.password ? null : generateTemporaryPassword();
  const [user] = await scope.tx
    .insert(users)
    .values({
      username: input.username,
      fullName: input.fullName,
      role: input.role,
      phone: input.phone ?? null,
      passwordHash: await hashPassword(input.password ?? temporaryPassword!),
      // Accounts always start with a password chosen by someone else, so it must be changed at first sign-in.
      mustChangePassword: true,
      createdByUserId: admin.userId,
      createdAt: scope.now,
      updatedAt: scope.now,
    })
    .returning();
  await audit(scope.tx, { actor: actorOf(admin), action: 'user.created', entityType: 'user', entityId: user!.id, metadata: { role: input.role, username: input.username }, at: scope.now });
  return { user: toStaffUserDTO(user!), temporaryPassword };
}

export async function updateStaffUser(
  scope: TxScope,
  admin: StaffPrincipal,
  id: string,
  input: Partial<{ fullName: string; role: StaffRole; isActive: boolean; phone: string | null }>,
): Promise<StaffUserDTO> {
  const [current] = await scope.tx.select().from(users).where(eq(users.id, id)).for('update').limit(1);
  if (!current) throw new ApiError(404, 'not_found');
  if (id === admin.userId && ((input.isActive !== undefined && !input.isActive) || (input.role && input.role !== current.role))) {
    throw new ApiError(403, 'cannot_modify_self');
  }
  const losesAdmin = current.role === 'admin' && current.isActive && (input.isActive === false || (input.role && input.role !== 'admin'));
  if (losesAdmin && (await activeAdminCount(scope.tx, id)) === 0) throw new ApiError(409, 'last_admin');
  const [user] = await scope.tx.update(users).set({ ...input, updatedAt: scope.now }).where(eq(users.id, id)).returning();
  if (input.isActive === false || (input.role && input.role !== current.role)) await revokeUserSessions(scope.tx, id, scope.now);
  await audit(scope.tx, {
    actor: actorOf(admin),
    action: 'user.updated',
    entityType: 'user',
    entityId: id,
    metadata: { fields: Object.keys(input), role: user!.role, isActive: user!.isActive },
    at: scope.now,
  });
  return toStaffUserDTO(user!);
}

export async function resetStaffPassword(scope: TxScope, admin: StaffPrincipal, id: string): Promise<string> {
  const [current] = await scope.tx.select().from(users).where(eq(users.id, id)).for('update').limit(1);
  if (!current) throw new ApiError(404, 'not_found');
  const temporaryPassword = generateTemporaryPassword();
  await scope.tx
    .update(users)
    .set({ passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, updatedAt: scope.now })
    .where(eq(users.id, id));
  await revokeUserSessions(scope.tx, id, scope.now);
  await audit(scope.tx, { actor: actorOf(admin), action: 'user.password_reset', entityType: 'user', entityId: id, at: scope.now });
  return temporaryPassword;
}

export async function setUserLocale(db: DbExecutor, userId: string, locale: 'ar' | 'en'): Promise<void> {
  await db.update(users).set({ locale }).where(eq(users.id, userId));
}

// ───────────────────────────── Audit log ─────────────────────────────

export async function listAudit(
  db: DbExecutor,
  query: { page: number; pageSize: number; action?: string | undefined; entityType?: string | undefined; actorUserId?: string | undefined; from?: string | undefined; to?: string | undefined },
  timezone: string,
) {
  const conditions: (SQL | undefined)[] = [];
  if (query.action) conditions.push(query.action.endsWith('.') ? ilike(auditLogs.action, `${query.action}%`) : eq(auditLogs.action, query.action));
  if (query.entityType) conditions.push(eq(auditLogs.entityType, query.entityType));
  if (query.actorUserId) conditions.push(eq(auditLogs.actorUserId, query.actorUserId));
  const range = localRangeToUtc(query.from, query.to, timezone);
  if (range.start) conditions.push(sql`${auditLogs.occurredAt} >= ${range.start}`);
  if (range.end) conditions.push(lt(auditLogs.occurredAt, range.end));
  const where = and(...conditions);
  const [totalRow] = await db.select({ n: count() }).from(auditLogs).where(where);
  const rows = await db
    .select({ a: auditLogs, userName: users.fullName, visitorName: visitors.fullName })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .leftJoin(visitors, eq(visitors.id, auditLogs.actorVisitorId))
    .where(where)
    .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  const items: AuditDTO[] = rows.map(({ a, userName, visitorName }) => ({
    id: String(a.id),
    occurredAt: a.occurredAt.toISOString(),
    actor: { type: a.actorType, id: a.actorUserId ?? a.actorVisitorId ?? null, name: userName ?? visitorName ?? null },
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    metadata: a.metadata,
  }));
  return paginate(items, Number(totalRow?.n ?? 0), query.page, query.pageSize);
}
