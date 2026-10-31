import { z } from 'zod';
import {
  ID_IMAGE_MAX_BYTES,
  idScanSchema,
  gateQrSchema,
  inviteSchema,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
  MAINTENANCE_STATUSES,
  RESIDENT_STATUSES,
  residentDecisionSchema,
  residentLoginSchema,
  residentPasswordResetSchema,
  residentSignupSchema,
  villaContactSchema,
  villaNumberSchema,
} from '@vms/shared';
import { requirePermission, requireResident } from '../../auth/principal';
import { inTransaction } from '../../context';
import { decodeIdImage } from '../../services/arrivals';
import {
  cancelInvite,
  cancelMyMaintenance,
  createInvite,
  createMaintenance,
  decideResident,
  deleteResident,
  gateVillaInfo,
  getInviteLink,
  getInvitePass,
  getVillaContact,
  listMaintenance,
  listMyMaintenance,
  listPendingConfirmations,
  listResidents,
  listVillaVisitors,
  loginResident,
  resetResidentPassword,
  respondAsResident,
  scanForResident,
  scanGateQr,
  signupResident,
  updateMaintenance,
  updateVillaContact,
} from '../../services/residents';
import type { RouteDef } from '../core';
import { authResponse } from './auth';

const UPLOAD_BODY_BYTES = Math.ceil((ID_IMAGE_MAX_BYTES * 4) / 3) + 64 * 1024;

const responseSchema = z.object({ response: z.enum(['confirmed', 'declined']) });

export const residentRoutes: RouteDef[] = [
  // Sign-up (held for an administrator's approval) and sign-in with the villa number as the username.
  {
    method: 'POST',
    path: '/auth/resident/signup',
    auth: 'public',
    handler: async (rc) => {
      const { villaNumber, password, fullName, mobile } = await rc.body(residentSignupSchema);
      return signupResident(rc.ctx, { villaNumber, password, fullName, mobile }, rc.meta);
    },
  },
  {
    method: 'POST',
    path: '/auth/resident/login',
    auth: 'public',
    handler: async (rc) => {
      const input = await rc.body(residentLoginSchema);
      const { token, principal } = await loginResident(rc.ctx, input, rc.meta);
      return authResponse(rc, token, principal, input.client);
    },
  },

  // Resident portal
  { method: 'GET', path: '/resident/villa', auth: 'resident', handler: async (rc) => getVillaContact(rc.ctx, requireResident(rc.principal)) },
  {
    method: 'PUT',
    path: '/resident/villa',
    auth: 'resident',
    handler: async (rc) => updateVillaContact(rc.ctx, requireResident(rc.principal), await rc.body(villaContactSchema)),
  },
  { method: 'GET', path: '/resident/visitors', auth: 'resident', handler: async (rc) => listVillaVisitors(rc.ctx, requireResident(rc.principal)) },
  {
    method: 'POST',
    path: '/resident/invites',
    auth: 'resident',
    maxBodyBytes: UPLOAD_BODY_BYTES,
    handler: async (rc) => {
      const { idImage, ...input } = await rc.body(inviteSchema);
      return createInvite(rc.ctx, requireResident(rc.principal), { ...input, image: decodeIdImage(idImage, ID_IMAGE_MAX_BYTES) });
    },
  },
  {
    // Reads the visitor's ID photo so the resident does not have to type the details.
    method: 'POST',
    path: '/resident/scan',
    auth: 'resident',
    maxBodyBytes: UPLOAD_BODY_BYTES,
    handler: async (rc) => {
      const { idImage } = await rc.body(idScanSchema);
      return scanForResident(rc.ctx, requireResident(rc.principal), decodeIdImage(idImage, ID_IMAGE_MAX_BYTES));
    },
  },
  { method: 'GET', path: '/resident/invites/:id', auth: 'resident', handler: async (rc) => getInviteLink(rc.ctx, requireResident(rc.principal), rc.params.id!) },
  { method: 'POST', path: '/resident/invites/:id/cancel', auth: 'resident', handler: async (rc) => cancelInvite(rc.ctx, requireResident(rc.principal), rc.params.id!) },
  { method: 'GET', path: '/resident/confirmations', auth: 'resident', handler: async (rc) => ({ items: await listPendingConfirmations(rc.ctx, requireResident(rc.principal)) }) },
  {
    method: 'POST',
    path: '/resident/entries/:id/respond',
    auth: 'resident',
    handler: async (rc) => respondAsResident(rc.ctx, requireResident(rc.principal), rc.params.id!, (await rc.body(responseSchema)).response),
  },
  { method: 'GET', path: '/resident/maintenance', auth: 'resident', handler: async (rc) => ({ items: await listMyMaintenance(rc.ctx, requireResident(rc.principal)) }) },
  {
    method: 'POST',
    path: '/resident/maintenance',
    auth: 'resident',
    handler: async (rc) => createMaintenance(rc.ctx, requireResident(rc.principal), await rc.body(maintenanceCreateSchema)),
  },
  { method: 'POST', path: '/resident/maintenance/:id/cancel', auth: 'resident', handler: async (rc) => cancelMyMaintenance(rc.ctx, requireResident(rc.principal), rc.params.id!) },

  // The visitor's invitation page (by token in the body, never in the URL).
  {
    method: 'POST',
    path: '/public/invites/view',
    auth: 'public',
    handler: async (rc) => getInvitePass(rc.ctx, (await rc.body(z.object({ token: z.string().max(200) }))).token, rc.meta),
  },

  // Gate
  {
    method: 'GET',
    path: '/gate/villa',
    auth: 'staff',
    handler: async (rc) => gateVillaInfo(rc.ctx, requirePermission(rc.principal, 'gate.quick_entry'), rc.query(z.object({ number: villaNumberSchema })).number),
  },
  {
    method: 'POST',
    path: '/gate/qr',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'gate.quick_entry');
      const { qr, gateId } = await rc.body(gateQrSchema);
      return scanGateQr(rc.ctx, staff, qr, gateId);
    },
  },

  // Administrators
  {
    method: 'GET',
    path: '/residents',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'residents.manage');
      const { status } = rc.query(z.object({ status: z.enum(RESIDENT_STATUSES).optional() }));
      return listResidents(rc.ctx, staff, status);
    },
  },
  {
    method: 'POST',
    path: '/residents/:id/decision',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'residents.manage');
      const { action } = await rc.body(residentDecisionSchema);
      return inTransaction(rc.ctx, (scope) => decideResident(rc.ctx, scope, staff, rc.params.id!, action));
    },
  },
  {
    method: 'POST',
    path: '/residents/:id/password',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'residents.manage');
      const { password } = await rc.body(residentPasswordResetSchema);
      await inTransaction(rc.ctx, (scope) => resetResidentPassword(rc.ctx, scope, staff, rc.params.id!, password));
      return { ok: true };
    },
  },
  {
    method: 'DELETE',
    path: '/residents/:id',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'residents.manage');
      await inTransaction(rc.ctx, (scope) => deleteResident(rc.ctx, scope, staff, rc.params.id!));
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: '/maintenance',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'maintenance.manage');
      const { status } = rc.query(z.object({ status: z.enum(MAINTENANCE_STATUSES).optional() }));
      return listMaintenance(rc.ctx, staff, status);
    },
  },
  {
    method: 'PATCH',
    path: '/maintenance/:id',
    auth: 'staff',
    handler: async (rc) => updateMaintenance(rc.ctx, requirePermission(rc.principal, 'maintenance.manage'), rc.params.id!, await rc.body(maintenanceUpdateSchema)),
  },
];
