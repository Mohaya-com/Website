import { z } from 'zod';
import { ID_IMAGE_MAX_BYTES, idScanSchema, ownerResponseSchema, quickEntrySchema } from '@vms/shared';
import { requirePermission } from '../../auth/principal';
import { decodeIdImage } from '../../services/arrivals';
import {
  createQuickEntry,
  exitQuickEntry,
  getGateBoard,
  getOwnerConfirmation,
  getQuickEntry,
  getQuickEntryImage,
  listInside,
  listQuickEntries,
  respondAsOwner,
  scanForGate,
} from '../../services/quick-entries';
import type { RouteDef } from '../core';

const UPLOAD_BODY_BYTES = Math.ceil((ID_IMAGE_MAX_BYTES * 4) / 3) + 64 * 1024;

const historyQuery = z.object({
  q: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const gateRoutes: RouteDef[] = [
  // Security at the gate: photo + villa → entry; one tap → exit.
  {
    method: 'POST',
    path: '/gate/scan',
    auth: 'staff',
    maxBodyBytes: UPLOAD_BODY_BYTES,
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'gate.quick_entry');
      const { idImage } = await rc.body(idScanSchema);
      return scanForGate(rc.ctx, staff, decodeIdImage(idImage, ID_IMAGE_MAX_BYTES));
    },
  },
  {
    method: 'POST',
    path: '/gate/entries',
    auth: 'staff',
    maxBodyBytes: UPLOAD_BODY_BYTES,
    handler: async (rc) => {
      const staff = requirePermission(rc.principal, 'gate.quick_entry');
      const { idImage, ...input } = await rc.body(quickEntrySchema);
      return createQuickEntry(rc.ctx, staff, { ...input, image: decodeIdImage(idImage, ID_IMAGE_MAX_BYTES) }, rc.meta);
    },
  },
  {
    method: 'GET',
    path: '/gate/board',
    auth: 'staff',
    handler: async (rc) => getGateBoard(rc.ctx, requirePermission(rc.principal, 'gate.quick_entry')),
  },
  {
    method: 'GET',
    path: '/gate/inside',
    auth: 'staff',
    handler: async (rc) => listInside(rc.ctx, requirePermission(rc.principal, 'gate.quick_entry')),
  },
  {
    method: 'GET',
    path: '/gate/entries',
    auth: 'staff',
    handler: async (rc) => listQuickEntries(rc.ctx, requirePermission(rc.principal, 'gate.quick_entry'), rc.query(historyQuery)),
  },
  {
    method: 'GET',
    path: '/gate/entries/:id',
    auth: 'staff',
    handler: async (rc) => getQuickEntry(rc.ctx, requirePermission(rc.principal, 'gate.quick_entry'), rc.params.id!),
  },
  {
    method: 'GET',
    path: '/gate/entries/:id/image',
    auth: 'staff',
    handler: async (rc) => {
      const image = await getQuickEntryImage(rc.ctx, requirePermission(rc.principal, 'gate.quick_entry'), rc.params.id!);
      return new Response(new Uint8Array(image.bytes), {
        headers: { 'Content-Type': image.type, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" },
      });
    },
  },
  {
    method: 'POST',
    path: '/gate/entries/:id/exit',
    auth: 'staff',
    handler: async (rc) => exitQuickEntry(rc.ctx, requirePermission(rc.principal, 'gate.quick_entry'), rc.params.id!),
  },

  // Villa owner: confirm or decline a visitor through the private link.
  {
    method: 'POST',
    path: '/public/owner/view',
    auth: 'public',
    handler: async (rc) => {
      const { token } = await rc.body(z.object({ token: z.string().max(200) }));
      return getOwnerConfirmation(rc.ctx, token, rc.meta);
    },
  },
  {
    method: 'POST',
    path: '/public/owner/respond',
    auth: 'public',
    handler: async (rc) => {
      const { token, response } = await rc.body(ownerResponseSchema);
      return respondAsOwner(rc.ctx, token, response, rc.meta);
    },
  },
];
