import { z } from 'zod';
import {
  auditListQuerySchema,
  gateSchema,
  gateUpdateSchema,
  settingsUpdateSchema,
  staffUserCreateSchema,
  staffUserUpdateSchema,
  villaSchema,
  villaUpdateSchema,
  whatsappConfigSchema,
  whatsappEnableSchema,
  whatsappTestSchema,
  PAGE_SIZE_MAX,
} from '@vms/shared';
import { requirePermission, requireStaff } from '../../auth/principal';
import { inTransaction } from '../../context';
import {
  createGate,
  createStaffUser,
  createVilla,
  listAudit,
  listGates,
  listStaff,
  listVillas,
  resetStaffPassword,
  updateGate,
  updateStaffUser,
  updateVilla,
  villaOptions,
} from '../../services/admin';
import { getSettings, updateSettings } from '../../services/settings';
import {
  getWhatsAppStatus,
  refreshWhatsAppStatus,
  removeWhatsAppConfig,
  saveWhatsAppConfig,
  sendWhatsAppTest,
  setWhatsAppEnabled,
} from '../../services/whatsapp';
import type { RouteDef } from '../core';

const villaListQuery = z.object({
  q: z.string().trim().max(20).optional(),
  all: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(50),
});

export const adminRoutes: RouteDef[] = [
  // Gates: active gates for every staff member (scanner selection); full list and management for admins.
  {
    method: 'GET',
    path: '/gates',
    auth: 'staff',
    handler: async (rc) => {
      const staff = requireStaff(rc.principal);
      const all = rc.url.searchParams.get('all') === 'true' && staff.role === 'admin';
      return { items: await listGates(rc.ctx.db, all) };
    },
  },
  {
    method: 'POST',
    path: '/gates',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'gates.manage');
      const input = await rc.body(gateSchema);
      return inTransaction(rc.ctx, (scope) => createGate(scope, admin, input));
    },
  },
  {
    method: 'PATCH',
    path: '/gates/:id',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'gates.manage');
      const input = await rc.body(gateUpdateSchema);
      return inTransaction(rc.ctx, (scope) => updateGate(scope, admin, rc.params.id!, input));
    },
  },

  // Villas
  {
    method: 'GET',
    path: '/villas/options',
    auth: 'member',
    handler: async (rc) => ({ items: await villaOptions(rc.ctx.db) }),
  },
  {
    method: 'GET',
    path: '/villas',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'villas.manage');
      const q = rc.query(villaListQuery);
      return listVillas(rc.ctx.db, { q: q.q, includeInactive: q.all !== 'false', page: q.page, pageSize: q.pageSize });
    },
  },
  {
    method: 'POST',
    path: '/villas',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'villas.manage');
      const input = await rc.body(villaSchema);
      return inTransaction(rc.ctx, (scope) => createVilla(scope, admin, input));
    },
  },
  {
    method: 'PATCH',
    path: '/villas/:id',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'villas.manage');
      const input = await rc.body(villaUpdateSchema);
      return inTransaction(rc.ctx, (scope) => updateVilla(scope, admin, rc.params.id!, input));
    },
  },

  // Staff accounts
  {
    method: 'GET',
    path: '/users',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'users.manage');
      return { items: await listStaff(rc.ctx.db) };
    },
  },
  {
    method: 'POST',
    path: '/users',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'users.manage');
      const input = await rc.body(staffUserCreateSchema);
      return inTransaction(rc.ctx, (scope) => createStaffUser(scope, admin, input));
    },
  },
  {
    method: 'PATCH',
    path: '/users/:id',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'users.manage');
      const input = await rc.body(staffUserUpdateSchema);
      return inTransaction(rc.ctx, (scope) => updateStaffUser(scope, admin, rc.params.id!, input));
    },
  },
  {
    method: 'POST',
    path: '/users/:id/reset-password',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'users.manage');
      await rc.body(z.object({}));
      const temporaryPassword = await inTransaction(rc.ctx, (scope) => resetStaffPassword(scope, admin, rc.params.id!));
      return { temporaryPassword };
    },
  },

  // Settings
  {
    method: 'GET',
    path: '/settings',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'settings.manage');
      return getSettings(rc.ctx);
    },
  },
  {
    method: 'PUT',
    path: '/settings',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'settings.manage');
      const input = await rc.body(settingsUpdateSchema);
      return inTransaction(rc.ctx, (scope) => updateSettings(rc.ctx, scope, admin, input));
    },
  },

  // WhatsApp connection for visitor verification codes (administrators only; the token is never returned)
  {
    method: 'GET',
    path: '/settings/whatsapp',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'settings.manage');
      return getWhatsAppStatus(rc.ctx);
    },
  },
  {
    method: 'PUT',
    path: '/settings/whatsapp',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'settings.manage');
      return saveWhatsAppConfig(rc.ctx, admin, await rc.body(whatsappConfigSchema), rc.meta);
    },
  },
  {
    method: 'DELETE',
    path: '/settings/whatsapp',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'settings.manage');
      return removeWhatsAppConfig(rc.ctx, admin, rc.meta);
    },
  },
  {
    method: 'POST',
    path: '/settings/whatsapp/refresh',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'settings.manage');
      return refreshWhatsAppStatus(rc.ctx);
    },
  },
  {
    method: 'POST',
    path: '/settings/whatsapp/enabled',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'settings.manage');
      const { enabled } = await rc.body(whatsappEnableSchema);
      return setWhatsAppEnabled(rc.ctx, admin, enabled, rc.meta);
    },
  },
  {
    method: 'POST',
    path: '/settings/whatsapp/test',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'settings.manage');
      const { mobile } = await rc.body(whatsappTestSchema);
      return sendWhatsAppTest(rc.ctx, admin, mobile, rc.meta);
    },
  },

  // Audit log (administrators only)
  {
    method: 'GET',
    path: '/audit',
    auth: 'staff',
    handler: async (rc) => {
      requirePermission(rc.principal, 'audit.read');
      const settings = await getSettings(rc.ctx);
      return listAudit(rc.ctx.db, rc.query(auditListQuerySchema), settings.timezone);
    },
  },
];
