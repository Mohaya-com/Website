import {
  ApiError,
  approveSchema,
  cancelSchema,
  gateEventListQuerySchema,
  manualLookupSchema,
  rejectSchema,
  scanConfirmSchema,
  scanSchema,
  visitListQuerySchema,
  visitModifySchema,
  visitOnBehalfSchema,
  visitorCreateSchema,
  visitorListQuerySchema,
  visitorLookupSchema,
  visitorUpdateSchema,
  type PassDTO,
} from '@vms/shared';
import { requirePermission } from '../../auth/principal';
import { inTransaction } from '../../context';
import { enforceRateLimit, RATE_LIMITS } from '../../rate-limit';
import { actorOf, audit } from '../../services/audit';
import { ensureFresh } from '../../services/maintenance';
import { getActivePass, passQrValue } from '../../services/passes';
import { confirmScan, listGateEvents, manualLookup, verifyScan } from '../../services/scans';
import { getSettings } from '../../services/settings';
import {
  buildReview,
  dashboardSummary,
  fetchVisitDTO,
  listExpectedToday,
  listInside,
  listVisits,
  visitorHistory,
  visitorStats,
} from '../../services/visit-queries';
import { createVisitor, getVisitorFull, listVisitorVersions, lookupVisitorExact, searchVisitors, updateVisitorByStaff } from '../../services/visitors';
import { approveVisit, cancelVisit, modifyVisit, rejectVisit, submitVisitRequest } from '../../services/visits';
import { toVisitorFullDTO } from '../../dto';
import type { RouteDef } from '../core';

export const staffRoutes: RouteDef[] = [
  // ───────────── Dashboard ─────────────
  {
    method: 'GET',
    path: '/dashboard/summary',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'dashboard.security');
      await ensureFresh(rc.ctx);
      const settings = await getSettings(rc.ctx);
      return dashboardSummary(rc.ctx.db, rc.ctx.clock.now(), settings);
    },
  },

  // ───────────── Visitor profiles ─────────────
  {
    method: 'GET',
    path: '/visitors/lookup',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'visitors.lookup_exact');
      await enforceRateLimit(rc.ctx, RATE_LIMITS.lookupUser, staff.userId);
      const { documentNumber } = rc.query(visitorLookupSchema);
      const visitor = await lookupVisitorExact(rc.ctx, staff, documentNumber, rc.meta.ipHash);
      return { found: Boolean(visitor), visitor };
    },
  },
  {
    method: 'GET',
    path: '/visitors',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'visitors.search');
      const settings = await getSettings(rc.ctx);
      return searchVisitors(rc.ctx.db, rc.query(visitorListQuerySchema), rc.ctx.clock.now(), settings);
    },
  },
  {
    method: 'POST',
    path: '/visitors',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'visitors.create');
      const settings = await getSettings(rc.ctx);
      const input = await rc.body(visitorCreateSchema({ checksum: settings.identityChecksumValidation }));
      const visitor = await inTransaction(rc.ctx, (scope) => createVisitor(scope, input, { via: 'staff', staff }));
      return toVisitorFullDTO(visitor, await visitorStats(rc.ctx.db, visitor.id), rc.ctx.clock.now(), settings.timezone);
    },
  },
  {
    method: 'GET',
    path: '/visitors/:id',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'visitors.read_full');
      const settings = await getSettings(rc.ctx);
      const visitor = await getVisitorFull(rc.ctx.db, rc.params.id!, rc.ctx.clock.now(), settings);
      if (!visitor) throw new ApiError(404, 'not_found');
      return visitor;
    },
  },
  {
    method: 'PATCH',
    path: '/visitors/:id',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'visitors.update_contact');
      const settings = await getSettings(rc.ctx);
      const input = await rc.body(visitorUpdateSchema({ checksum: settings.identityChecksumValidation }));
      return inTransaction(rc.ctx, (scope) => updateVisitorByStaff(rc.ctx, scope, staff, rc.params.id!, input));
    },
  },
  {
    method: 'GET',
    path: '/visitors/:id/visits',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'visits.read_history');
      const settings = await getSettings(rc.ctx);
      const history = await visitorHistory(rc.ctx.db, rc.params.id!, rc.ctx.clock.now(), settings);
      return { items: history.reverse() };
    },
  },
  {
    method: 'GET',
    path: '/visitors/:id/versions',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'visitors.read_full');
      return { items: await listVisitorVersions(rc.ctx.db, rc.params.id!) };
    },
  },

  // ───────────── Visits ─────────────
  {
    method: 'GET',
    path: '/visits',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'visits.read_history');
      await ensureFresh(rc.ctx);
      const settings = await getSettings(rc.ctx);
      return listVisits(rc.ctx.db, rc.query(visitListQuerySchema), rc.ctx.clock.now(), settings);
    },
  },
  {
    method: 'POST',
    path: '/visits',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'visits.create_on_behalf');
      const input = await rc.body(visitOnBehalfSchema);
      return inTransaction(rc.ctx, (scope) => submitVisitRequest(rc.ctx, scope, { principal: staff, visitorId: input.visitorId, input, channel: rc.client }));
    },
  },
  {
    method: 'GET',
    path: '/visits/inside',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'occupancy.read');
      await ensureFresh(rc.ctx);
      const settings = await getSettings(rc.ctx);
      return { items: await listInside(rc.ctx.db, rc.ctx.clock.now(), settings) };
    },
  },
  {
    method: 'GET',
    path: '/visits/expected',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'visits.read');
      await ensureFresh(rc.ctx);
      const settings = await getSettings(rc.ctx);
      return { items: await listExpectedToday(rc.ctx.db, rc.ctx.clock.now(), settings) };
    },
  },
  {
    method: 'GET',
    path: '/visits/:id',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'visits.read');
      const settings = await getSettings(rc.ctx);
      const dto = await fetchVisitDTO(rc.ctx.db, rc.params.id!, 'staff', rc.ctx.clock.now(), settings);
      if (!dto) throw new ApiError(404, 'not_found');
      return dto;
    },
  },
  {
    method: 'GET',
    path: '/visits/:id/review',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'visits.approve');
      await ensureFresh(rc.ctx);
      const settings = await getSettings(rc.ctx);
      const review = await buildReview(rc.ctx.db, rc.params.id!, rc.ctx.clock.now(), settings);
      if (!review) throw new ApiError(404, 'not_found');
      return review;
    },
  },
  {
    method: 'POST',
    path: '/visits/:id/approve',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'visits.approve');
      const { expectedVersion } = await rc.body(approveSchema);
      return inTransaction(rc.ctx, (scope) => approveVisit(rc.ctx, scope, admin, rc.params.id!, expectedVersion));
    },
  },
  {
    method: 'POST',
    path: '/visits/:id/reject',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'visits.approve');
      const { reason, expectedVersion } = await rc.body(rejectSchema);
      return inTransaction(rc.ctx, (scope) => rejectVisit(rc.ctx, scope, admin, rc.params.id!, reason, expectedVersion));
    },
  },
  {
    method: 'POST',
    path: '/visits/:id/cancel',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'visits.cancel_any');
      const { reason } = await rc.body(cancelSchema);
      return inTransaction(rc.ctx, (scope) => cancelVisit(rc.ctx, scope, admin, rc.params.id!, reason));
    },
  },
  {
    method: 'PATCH',
    path: '/visits/:id',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'visits.modify');
      const input = await rc.body(visitModifySchema);
      return inTransaction(rc.ctx, (scope) => modifyVisit(rc.ctx, scope, staff, rc.params.id!, input, rc.client));
    },
  },
  {
    method: 'GET',
    path: '/visits/:id/pass',
    auth: 'staff',
    handler: async (rc): Promise<PassDTO> => {
      const staff = requirePermission(rc.principal, 'visits.view_pass');
      const settings = await getSettings(rc.ctx);
      const now = rc.ctx.clock.now();
      const visit = await fetchVisitDTO(rc.ctx.db, rc.params.id!, 'staff', now, settings);
      if (!visit || !visit.entryWindowStart || !visit.entryWindowEnd) throw new ApiError(404, 'not_found');
      const pass = await getActivePass(rc.ctx.db, visit.id);
      if (!pass) throw new ApiError(404, 'not_found');
      await audit(rc.ctx.db, { actor: actorOf(staff), action: 'visit.pass_viewed', entityType: 'visit', entityId: visit.id, metadata: { reference: visit.reference }, at: now });
      return {
        visitId: visit.id,
        reference: visit.reference,
        status: visit.status,
        qrValue: passQrValue(rc.ctx, pass),
        visitorName: visit.visitor?.fullName ?? '',
        villaNumber: visit.villa.number,
        entryWindowStart: visit.entryWindowStart,
        entryWindowEnd: visit.entryWindowEnd,
        expectedExitAt: visit.expectedExitAt,
        issuedAt: pass.issuedAt.toISOString(),
      };
    },
  },

  // ───────────── Gate scanning ─────────────
  {
    method: 'POST',
    path: '/scan/verify',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'scan.verify');
      await enforceRateLimit(rc.ctx, RATE_LIMITS.scanUser, staff.userId);
      return verifyScan(rc.ctx, staff, await rc.body(scanSchema), rc.meta.ipHash);
    },
  },
  {
    method: 'POST',
    path: '/scan/confirm',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'scan.confirm');
      await enforceRateLimit(rc.ctx, RATE_LIMITS.scanUser, staff.userId);
      return confirmScan(rc.ctx, staff, await rc.body(scanConfirmSchema), rc.meta.ipHash);
    },
  },
  {
    method: 'POST',
    path: '/scan/lookup',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'scan.verify');
      await enforceRateLimit(rc.ctx, RATE_LIMITS.lookupUser, staff.userId);
      return { items: await manualLookup(rc.ctx, staff, await rc.body(manualLookupSchema), rc.meta.ipHash) };
    },
  },
  {
    method: 'GET',
    path: '/gate-events',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'gate_log.read');
      const settings = await getSettings(rc.ctx);
      return listGateEvents(rc.ctx.db, rc.query(gateEventListQuerySchema), settings);
    },
  },
];

