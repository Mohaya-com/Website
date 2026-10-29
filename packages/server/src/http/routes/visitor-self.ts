import { ApiError, cancelSchema, pageQuerySchema, visitModifySchema, visitorRegistrationSchema, visitorSelfUpdateSchema, visitRequestSchema, type PassDTO } from '@vms/shared';
import { requireRegistrant, requireVisitor } from '../../auth/principal';
import { resolveSession, toSessionInfo } from '../../auth/sessions';
import { inTransaction } from '../../context';
import { toVisitorSelfDTO } from '../../dto';
import { ensureFresh } from '../../services/maintenance';
import { getActivePass, passQrValue } from '../../services/passes';
import { getSettings } from '../../services/settings';
import { completeRegistration, selfUpdateExpiry } from '../../services/visitors';
import { fetchVisitDTO, listOwnVisits } from '../../services/visit-queries';
import { cancelVisit, modifyVisit, submitVisitRequest } from '../../services/visits';
import type { RouteDef } from '../core';

export const visitorSelfRoutes: RouteDef[] = [
  {
    method: 'POST',
    path: '/me/register',
    auth: 'registrant',
    handler: async (rc) => {
      const registrant = requireRegistrant(rc.principal);
      const input = await rc.body(visitorRegistrationSchema);
      await inTransaction(rc.ctx, (scope) => completeRegistration(rc.ctx, scope, registrant, input));
      // Same token, upgraded to a visitor session.
      const principal = await resolveSession(rc.ctx, rc.token);
      if (!principal) throw new ApiError(401, 'session_expired');
      const settings = await getSettings(rc.ctx);
      return { session: toSessionInfo(principal, rc.ctx.clock.now(), settings.timezone) };
    },
  },
  {
    method: 'GET',
    path: '/me/profile',
    auth: 'visitor',
    handler: async (rc) => {
      const visitor = requireVisitor(rc.principal);
      const settings = await getSettings(rc.ctx);
      return toVisitorSelfDTO(visitor.visitor, rc.ctx.clock.now(), settings.timezone);
    },
  },
  {
    method: 'PATCH',
    path: '/me/profile',
    auth: 'visitor',
    handler: async (rc) => {
      const visitor = requireVisitor(rc.principal);
      const input = await rc.body(visitorSelfUpdateSchema);
      return inTransaction(rc.ctx, (scope) => selfUpdateExpiry(scope, visitor, input));
    },
  },
  {
    method: 'GET',
    path: '/me/visits',
    auth: 'visitor',
    handler: async (rc) => {
      const visitor = requireVisitor(rc.principal);
      const { page, pageSize } = rc.query(pageQuerySchema);
      await ensureFresh(rc.ctx);
      const settings = await getSettings(rc.ctx);
      return listOwnVisits(rc.ctx.db, visitor.visitorId, page, pageSize, rc.ctx.clock.now(), settings);
    },
  },
  {
    method: 'POST',
    path: '/me/visits',
    auth: 'visitor',
    handler: async (rc) => {
      const visitor = requireVisitor(rc.principal);
      const input = await rc.body(visitRequestSchema);
      return inTransaction(rc.ctx, (scope) => submitVisitRequest(rc.ctx, scope, { principal: visitor, visitorId: visitor.visitorId, input, channel: rc.client }));
    },
  },
  {
    method: 'GET',
    path: '/me/visits/:id',
    auth: 'visitor',
    handler: async (rc) => {
      const visitor = requireVisitor(rc.principal);
      await ensureFresh(rc.ctx);
      const settings = await getSettings(rc.ctx);
      const dto = await fetchVisitDTO(rc.ctx.db, rc.params.id!, 'visitor', rc.ctx.clock.now(), settings, visitor.visitorId);
      if (!dto) throw new ApiError(404, 'not_found');
      return dto;
    },
  },
  {
    method: 'PATCH',
    path: '/me/visits/:id',
    auth: 'visitor',
    handler: async (rc) => {
      const visitor = requireVisitor(rc.principal);
      const input = await rc.body(visitModifySchema);
      return inTransaction(rc.ctx, (scope) => modifyVisit(rc.ctx, scope, visitor, rc.params.id!, input, rc.client));
    },
  },
  {
    method: 'POST',
    path: '/me/visits/:id/cancel',
    auth: 'visitor',
    handler: async (rc) => {
      const visitor = requireVisitor(rc.principal);
      const { reason } = await rc.body(cancelSchema);
      return inTransaction(rc.ctx, (scope) => cancelVisit(rc.ctx, scope, visitor, rc.params.id!, reason));
    },
  },
  {
    method: 'GET',
    path: '/me/visits/:id/pass',
    auth: 'visitor',
    handler: async (rc): Promise<PassDTO> => {
      const visitor = requireVisitor(rc.principal);
      const settings = await getSettings(rc.ctx);
      const now = rc.ctx.clock.now();
      const visit = await fetchVisitDTO(rc.ctx.db, rc.params.id!, 'visitor', now, settings, visitor.visitorId);
      if (!visit) throw new ApiError(404, 'not_found');
      const pass = visit.status === 'approved' || visit.status === 'checked_in' ? await getActivePass(rc.ctx.db, visit.id) : null;
      if (!pass || !visit.entryWindowStart || !visit.entryWindowEnd) throw new ApiError(404, 'not_found');
      return {
        visitId: visit.id,
        reference: visit.reference,
        status: visit.status,
        qrValue: passQrValue(rc.ctx, pass),
        visitorName: visitor.visitor.fullName,
        villaNumber: visit.villa.number,
        entryWindowStart: visit.entryWindowStart,
        entryWindowEnd: visit.entryWindowEnd,
        expectedExitAt: visit.expectedExitAt,
        issuedAt: pass.issuedAt.toISOString(),
      };
    },
  },
];
