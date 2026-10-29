import { and, eq, isNull, ne } from 'drizzle-orm';
import { otpChallenges, sessions, users, visitors, type DbExecutor, type Session } from '@vms/db';
import {
  PERMISSIONS,
  maskDocumentNumber,
  maskPhone,
  type ClientKind,
  type Permission,
  type SessionInfoDTO,
} from '@vms/shared';
import type { ServerContext } from '../context';
import { randomToken, sha256Hex } from '../crypto';
import { toStaffUserDTO, toVisitorSelfDTO } from '../dto';
import type { Principal } from './principal';

const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface NewSession {
  kind: Session['kind'];
  userId?: string;
  visitorId?: string;
  otpChallengeId?: string;
  client: ClientKind;
  userAgent?: string | null;
}

function lifetimes(ctx: ServerContext, kind: Session['kind'], now: Date) {
  const s = ctx.config.sessions;
  if (kind === 'staff') {
    return {
      idle: new Date(now.getTime() + s.staffIdleHours * 3_600_000),
      max: new Date(now.getTime() + s.staffMaxDays * 86_400_000),
    };
  }
  if (kind === 'visitor') {
    const max = new Date(now.getTime() + s.visitorMaxDays * 86_400_000);
    return { idle: max, max };
  }
  const max = new Date(now.getTime() + s.registrantMinutes * 60_000);
  return { idle: max, max };
}

/** Creates an opaque session token. Only its SHA-256 hash is stored. */
export async function createSession(ctx: ServerContext, tx: DbExecutor, input: NewSession, now: Date): Promise<{ token: string; session: Session }> {
  const token = randomToken(32);
  const { idle, max } = lifetimes(ctx, input.kind, now);
  const [session] = await tx
    .insert(sessions)
    .values({
      tokenHash: sha256Hex(token),
      kind: input.kind,
      userId: input.userId ?? null,
      visitorId: input.visitorId ?? null,
      otpChallengeId: input.otpChallengeId ?? null,
      client: input.client,
      userAgent: input.userAgent?.slice(0, 200) ?? null,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: idle,
      expiresAt: max,
    })
    .returning();
  return { token, session: session! };
}

/** Resolves a bearer/cookie token to a principal, enforcing expiry, revocation and account status. */
export async function resolveSession(ctx: ServerContext, token: string | null | undefined): Promise<Principal | null> {
  if (!token || token.length < 20 || token.length > 128) return null;
  const now = ctx.clock.now();
  const [session] = await ctx.db.select().from(sessions).where(eq(sessions.tokenHash, sha256Hex(token))).limit(1);
  if (!session || session.revokedAt || session.expiresAt <= now || session.idleExpiresAt <= now) return null;

  let principal: Principal | null = null;
  if (session.kind === 'staff' && session.userId) {
    const [user] = await ctx.db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    if (!user || !user.isActive) return null;
    principal = { kind: 'staff', role: user.role, sessionId: session.id, userId: user.id, user, locale: user.locale, expiresAt: session.expiresAt };
  } else if (session.kind === 'visitor' && session.visitorId) {
    const [visitor] = await ctx.db.select().from(visitors).where(eq(visitors.id, session.visitorId)).limit(1);
    if (!visitor) return null;
    principal = { kind: 'visitor', role: 'visitor', sessionId: session.id, visitorId: visitor.id, visitor, locale: visitor.locale, expiresAt: session.expiresAt };
  } else if (session.kind === 'registrant' && session.otpChallengeId) {
    const [challenge] = await ctx.db.select().from(otpChallenges).where(eq(otpChallenges.id, session.otpChallengeId)).limit(1);
    if (!challenge || !challenge.verifiedAt) return null;
    principal = { kind: 'registrant', role: 'registrant', sessionId: session.id, challenge, locale: challenge.locale, expiresAt: session.expiresAt };
  }
  if (!principal) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS && session.kind === 'staff') {
    const { idle } = lifetimes(ctx, session.kind, now);
    const idleExpiresAt = idle < session.expiresAt ? idle : session.expiresAt;
    await ctx.db.update(sessions).set({ lastSeenAt: now, idleExpiresAt }).where(eq(sessions.id, session.id));
  }
  return principal;
}

export async function revokeSession(db: DbExecutor, sessionId: string, now: Date): Promise<void> {
  await db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function revokeUserSessions(db: DbExecutor, userId: string, now: Date, exceptSessionId?: string): Promise<void> {
  const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
  if (exceptSessionId) conditions.push(ne(sessions.id, exceptSessionId));
  await db.update(sessions).set({ revokedAt: now }).where(and(...conditions));
}

export async function revokeVisitorSessions(db: DbExecutor, visitorId: string, now: Date): Promise<void> {
  await db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.visitorId, visitorId), isNull(sessions.revokedAt)));
}

export function permissionsFor(principal: Principal): Permission[] {
  if (principal.kind !== 'staff') return [];
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => (PERMISSIONS[p] as readonly string[]).includes(principal.role));
}

export function toSessionInfo(principal: Principal, now: Date, tz: string): SessionInfoDTO {
  const base = { role: principal.role, permissions: permissionsFor(principal), expiresAt: principal.expiresAt.toISOString() };
  if (principal.kind === 'staff') return { ...base, kind: 'staff', user: toStaffUserDTO(principal.user) };
  if (principal.kind === 'visitor') return { ...base, kind: 'visitor', visitor: toVisitorSelfDTO(principal.visitor, now, tz) };
  return {
    ...base,
    kind: 'registrant',
    registrant: {
      documentType: principal.challenge.documentType,
      documentNumberMasked: maskDocumentNumber(principal.challenge.documentNumber),
      mobileMasked: maskPhone(principal.challenge.mobile),
    },
  };
}
