import {
  changePasswordSchema,
  firstAdminSetupSchema,
  localeUpdateSchema,
  otpRequestSchema,
  otpVerifySchema,
  staffLoginSchema,
  type AuthResultDTO,
  type ClientKind,
} from '@vms/shared';
import { requestVisitorOtp, verifyVisitorOtp } from '../../auth/otp';
import type { Principal } from '../../auth/principal';
import { revokeSession, toSessionInfo } from '../../auth/sessions';
import { changePassword, isSetupAvailable, setupFirstAdmin, staffLogin } from '../../auth/staff';
import { audit } from '../../services/audit';
import { setUserLocale } from '../../services/admin';
import { getSettings } from '../../services/settings';
import { setVisitorLocale } from '../../services/visitors';
import { clearSessionCookie, json, sessionCookie, type RouteContext, type RouteDef } from '../core';
import { requireStaff } from '../../auth/principal';
import { eq } from 'drizzle-orm';
import { residents } from '@vms/db';

export async function authResponse(rc: RouteContext, token: string, principal: Principal, client: ClientKind): Promise<Response> {
  const settings = await getSettings(rc.ctx);
  const session = toSessionInfo(principal, rc.ctx.clock.now(), settings.timezone);
  if (client === 'mobile') {
    const body: AuthResultDTO = { session, token };
    return json(200, body);
  }
  const maxAge = (principal.expiresAt.getTime() - rc.ctx.clock.now().getTime()) / 1000;
  const body: AuthResultDTO = { session };
  return json(200, body, { 'Set-Cookie': sessionCookie(rc.ctx, token, maxAge) });
}

export const authRoutes: RouteDef[] = [
  {
    method: 'POST',
    path: '/auth/staff/login',
    auth: 'public',
    handler: async (rc) => {
      const input = await rc.body(staffLoginSchema);
      const { token, principal } = await staffLogin(rc.ctx, input, rc.meta);
      return authResponse(rc, token, principal, input.client);
    },
  },
  {
    method: 'POST',
    path: '/auth/visitor/request-otp',
    auth: 'public',
    handler: async (rc) => {
      const settings = await getSettings(rc.ctx);
      const input = await rc.body(otpRequestSchema({ checksum: settings.identityChecksumValidation }));
      return requestVisitorOtp(rc.ctx, input, rc.meta);
    },
  },
  {
    method: 'POST',
    path: '/auth/visitor/verify-otp',
    auth: 'public',
    handler: async (rc) => {
      const input = await rc.body(otpVerifySchema);
      const { token, principal } = await verifyVisitorOtp(rc.ctx, input, rc.meta);
      return authResponse(rc, token, principal, input.client);
    },
  },
  {
    // Returns null (not 401) when signed out, so clients can probe the session without error noise.
    method: 'GET',
    path: '/auth/session',
    auth: 'public',
    allowPasswordChange: true,
    handler: async (rc) => {
      if (!rc.principal) return json(200, null);
      const settings = await getSettings(rc.ctx);
      return toSessionInfo(rc.principal, rc.ctx.clock.now(), settings.timezone);
    },
  },
  {
    method: 'POST',
    path: '/auth/logout',
    auth: 'public',
    allowPasswordChange: true,
    handler: async (rc) => {
      const now = rc.ctx.clock.now();
      if (rc.principal) {
        await revokeSession(rc.ctx.db, rc.principal.sessionId, now);
        if (rc.principal.kind === 'staff') {
          await audit(rc.ctx.db, { actor: { type: 'user', userId: rc.principal.userId }, action: 'auth.logout', entityType: 'session', entityId: rc.principal.sessionId, at: now });
        }
      }
      return json(200, { ok: true }, rc.client === 'web' ? { 'Set-Cookie': clearSessionCookie(rc.ctx) } : {});
    },
  },
  {
    method: 'POST',
    path: '/auth/password',
    auth: 'staff',
    allowPasswordChange: true,
    handler: async (rc) => {
      const staff = requireStaff(rc.principal);
      await changePassword(rc.ctx, staff, await rc.body(changePasswordSchema));
      return { ok: true };
    },
  },
  {
    method: 'PUT',
    path: '/me/locale',
    auth: 'member',
    allowPasswordChange: true,
    handler: async (rc) => {
      const { locale } = await rc.body(localeUpdateSchema);
      const p = rc.principal!;
      if (p.kind === 'staff') await setUserLocale(rc.ctx.db, p.userId, locale);
      if (p.kind === 'visitor') await setVisitorLocale(rc.ctx.db, p.visitorId, locale);
      if (p.kind === 'resident') await rc.ctx.db.update(residents).set({ locale }).where(eq(residents.id, p.residentId));
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: '/setup/status',
    auth: 'public',
    handler: async (rc) => ({ available: await isSetupAvailable(rc.ctx) }),
  },
  {
    method: 'POST',
    path: '/setup/first-admin',
    auth: 'public',
    handler: async (rc) => {
      await setupFirstAdmin(rc.ctx, await rc.body(firstAdminSetupSchema), rc.meta);
      return { ok: true };
    },
  },
];
