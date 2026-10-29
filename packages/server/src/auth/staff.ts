import { and, count, eq, sql } from 'drizzle-orm';
import { users } from '@vms/db';
import { ApiError, type ClientKind } from '@vms/shared';
import type { ServerContext } from '../context';
import { inTransaction } from '../context';
import { burnPasswordCheck, hashPassword, safeEqual, verifyPassword } from '../crypto';
import { enforceRateLimit, RATE_LIMITS } from '../rate-limit';
import { audit } from '../services/audit';
import type { StaffPrincipal } from './principal';
import { createSession, resolveSession, revokeUserSessions } from './sessions';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export interface RequestMeta {
  ip: string;
  ipHash: string;
  userAgent: string | null;
}

export async function staffLogin(
  ctx: ServerContext,
  input: { username: string; password: string; client: ClientKind },
  meta: RequestMeta,
): Promise<{ token: string; principal: StaffPrincipal }> {
  await enforceRateLimit(ctx, RATE_LIMITS.loginIp, meta.ip);
  await enforceRateLimit(ctx, RATE_LIMITS.loginUser, input.username);

  const now = ctx.clock.now();
  const [user] = await ctx.db.select().from(users).where(eq(users.username, input.username)).limit(1);
  if (!user) {
    await burnPasswordCheck(input.password);
    await audit(ctx.db, { actor: { type: 'system' }, action: 'auth.login_failed', entityType: 'session', metadata: { reason: 'unknown_user' }, ipHash: meta.ipHash, at: now });
    throw new ApiError(401, 'invalid_credentials');
  }
  if (user.lockedUntil && user.lockedUntil > now) {
    await burnPasswordCheck(input.password);
    throw new ApiError(429, 'rate_limited', undefined, { retryAfterSeconds: Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000) });
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid || !user.isActive) {
    if (!valid) {
      const failed = user.failedLoginCount + 1;
      await ctx.db
        .update(users)
        .set(
          failed >= MAX_FAILED_LOGINS
            ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) }
            : { failedLoginCount: failed },
        )
        .where(eq(users.id, user.id));
    }
    await audit(ctx.db, {
      actor: { type: 'system' },
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: user.id,
      metadata: { reason: valid ? 'inactive' : 'bad_password' },
      ipHash: meta.ipHash,
      at: now,
    });
    throw new ApiError(401, 'invalid_credentials');
  }

  const { token } = await inTransaction(ctx, async (scope) => {
    await scope.tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, user.id));
    const created = await createSession(ctx, scope.tx, { kind: 'staff', userId: user.id, client: input.client, userAgent: meta.userAgent }, now);
    await audit(scope.tx, {
      actor: { type: 'user', userId: user.id },
      action: 'auth.login',
      entityType: 'session',
      entityId: created.session.id,
      metadata: { client: input.client },
      ipHash: meta.ipHash,
      at: now,
    });
    return created;
  });
  const principal = (await resolveSession(ctx, token)) as StaffPrincipal;
  return { token, principal };
}

export async function changePassword(ctx: ServerContext, staff: StaffPrincipal, input: { currentPassword: string; newPassword: string }): Promise<void> {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, staff.userId)).limit(1);
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new ApiError(400, 'validation_error', { currentPassword: 'errors.invalid_credentials' });
  }
  if (await verifyPassword(input.newPassword, user.passwordHash)) {
    throw new ApiError(400, 'validation_error', { newPassword: 'validation.invalid' });
  }
  const passwordHash = await hashPassword(input.newPassword);
  await inTransaction(ctx, async ({ tx, now }) => {
    await tx.update(users).set({ passwordHash, mustChangePassword: false, updatedAt: now }).where(eq(users.id, staff.userId));
    await revokeUserSessions(tx, staff.userId, now, staff.sessionId);
    await audit(tx, { actor: { type: 'user', userId: staff.userId }, action: 'auth.password_changed', entityType: 'user', entityId: staff.userId, at: now });
  });
}

export async function isSetupAvailable(ctx: ServerContext): Promise<boolean> {
  if (!ctx.config.setupToken) return false;
  const [row] = await ctx.db.select({ n: count() }).from(users).where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
  return Number(row?.n ?? 0) === 0;
}

/** One-time web setup of the first administrator, guarded by SETUP_TOKEN and disabled once an admin exists. */
export async function setupFirstAdmin(
  ctx: ServerContext,
  input: { setupToken: string; username: string; fullName: string; password: string },
  meta: RequestMeta,
): Promise<void> {
  await enforceRateLimit(ctx, RATE_LIMITS.setupIp, meta.ip);
  const expected = ctx.config.setupToken;
  if (!expected || !safeEqual(input.setupToken, expected)) throw new ApiError(403, 'setup_unavailable');
  const passwordHash = await hashPassword(input.password);
  await inTransaction(ctx, async ({ tx, now }) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('vms_first_admin'))`);
    const [row] = await tx.select({ n: count() }).from(users).where(eq(users.role, 'admin'));
    if (Number(row?.n ?? 0) > 0) throw new ApiError(403, 'setup_unavailable');
    const [created] = await tx
      .insert(users)
      .values({ username: input.username, fullName: input.fullName, role: 'admin', passwordHash, mustChangePassword: false, createdAt: now, updatedAt: now })
      .returning();
    await audit(tx, { actor: { type: 'system' }, action: 'auth.first_admin_created', entityType: 'user', entityId: created!.id, metadata: { via: 'web_setup' }, ipHash: meta.ipHash, at: now });
  });
}
