import { ApiError, GATE_CODE_PATTERN, timeZoneOffsetMinutes, type PublicConfigDTO, type PublicGateDTO } from '@vms/shared';
import { DevSmsProvider } from '../../providers/sms';
import { enforceRateLimit, RATE_LIMITS } from '../../rate-limit';
import { findGateByCode } from '../../services/admin';
import { getSettings, isDemoData } from '../../services/settings';
import type { RouteDef } from '../core';

export const publicRoutes: RouteDef[] = [
  {
    method: 'GET',
    path: '/health',
    auth: 'public',
    handler: async (rc) => {
      await rc.ctx.db.execute('select 1');
      return { ok: true, time: rc.ctx.clock.now().toISOString() };
    },
  },
  {
    method: 'GET',
    path: '/public/config',
    auth: 'public',
    handler: async (rc): Promise<PublicConfigDTO> => {
      const s = await getSettings(rc.ctx);
      const now = rc.ctx.clock.now();
      return {
        compoundNameAr: s.compoundNameAr,
        compoundNameEn: s.compoundNameEn,
        timezone: s.timezone,
        timezoneOffsetMinutes: timeZoneOffsetMinutes(now, s.timezone),
        serverTime: now.toISOString(),
        defaultVisitDurationMinutes: s.defaultVisitDurationMinutes,
        maxVisitDurationMinutes: s.maxVisitDurationMinutes,
        maxAdvanceBookingDays: s.maxAdvanceBookingDays,
        identityChecksumValidation: s.identityChecksumValidation,
        allowVisitorSelfRegistration: s.allowVisitorSelfRegistration,
        sms: { provider: rc.ctx.sms.name, available: rc.ctx.sms.available, developmentMode: rc.ctx.sms.isDevelopment },
        push: { enabled: rc.ctx.push.enabled },
        demoData: await isDemoData(rc.ctx.db),
        appOrigin: rc.ctx.config.appOrigin,
      };
    },
  },
  {
    // Gate QR landing data: the gate's public name and supported actions only.
    method: 'GET',
    path: '/public/gates/:code',
    auth: 'public',
    handler: async (rc): Promise<PublicGateDTO> => {
      await enforceRateLimit(rc.ctx, RATE_LIMITS.publicIp, rc.meta.ip);
      const code = rc.params.code ?? '';
      if (!GATE_CODE_PATTERN.test(code)) throw new ApiError(404, 'not_found');
      const gate = await findGateByCode(rc.ctx.db, code);
      if (!gate) throw new ApiError(404, 'not_found');
      return { code: gate.code, nameAr: gate.nameAr, nameEn: gate.nameEn, supportsEntry: gate.supportsEntry, supportsExit: gate.supportsExit };
    },
  },
  {
    // DEVELOPMENT ONLY: codes "sent" by the development SMS provider. Unavailable with any other provider or in production.
    method: 'GET',
    path: '/dev/otp-outbox',
    auth: 'public',
    handler: async (rc) => {
      if (rc.ctx.config.isProduction || !(rc.ctx.sms instanceof DevSmsProvider)) throw new ApiError(404, 'not_found');
      return { items: rc.ctx.sms.outbox };
    },
  },
];
