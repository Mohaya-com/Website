import { z } from 'zod';
import { arrivalApproveSchema, arrivalListQuerySchema, arrivalSubmitSchema, ID_IMAGE_MAX_BYTES, idScanSchema, requiredReasonSchema } from '@vms/shared';
import { requirePermission } from '../../auth/principal';
import { inTransaction } from '../../context';
import {
  approveArrival,
  decodeIdImage,
  getArrivalDetail,
  getArrivalImage,
  getArrivalStatus,
  listArrivals,
  rejectArrival,
  scanIdImage,
  submitArrival,
} from '../../services/arrivals';
import { getSettings } from '../../services/settings';
import type { RouteDef } from '../core';

/** Base64 of the largest accepted photo plus room for the other fields. */
const UPLOAD_BODY_BYTES = Math.ceil((ID_IMAGE_MAX_BYTES * 4) / 3) + 64 * 1024;

export const arrivalRoutes: RouteDef[] = [
  // Public: registration at arrival, without a verification code.
  {
    method: 'POST',
    path: '/public/arrivals/scan',
    auth: 'public',
    maxBodyBytes: UPLOAD_BODY_BYTES,
    handler: async (rc) => {
      const { idImage } = await rc.body(idScanSchema);
      return scanIdImage(rc.ctx, decodeIdImage(idImage, ID_IMAGE_MAX_BYTES), rc.meta);
    },
  },
  {
    method: 'POST',
    path: '/public/arrivals',
    auth: 'public',
    maxBodyBytes: UPLOAD_BODY_BYTES,
    handler: async (rc) => {
      const settings = await getSettings(rc.ctx);
      const input = await rc.body(arrivalSubmitSchema({ checksum: settings.identityChecksumValidation }));
      const idImage = input.idImage ? decodeIdImage(input.idImage, ID_IMAGE_MAX_BYTES) : null;
      return submitArrival(rc.ctx, { ...input, idImage }, rc.meta);
    },
  },
  {
    // POST keeps the status token out of URLs and access logs.
    method: 'POST',
    path: '/public/arrivals/status',
    auth: 'public',
    handler: async (rc) => {
      const { token } = await rc.body(z.object({ token: z.string().max(200) }));
      return getArrivalStatus(rc.ctx, token, rc.meta);
    },
  },

  // Administrators: verify each arrival against the ID photo.
  {
    method: 'GET',
    path: '/arrivals',
    auth: 'staff',
    handler: async (rc) => listArrivals(rc.ctx, requirePermission(rc.principal, 'arrivals.review'), rc.query(arrivalListQuerySchema)),
  },
  {
    method: 'GET',
    path: '/arrivals/:id',
    auth: 'staff',
    handler: async (rc) => getArrivalDetail(rc.ctx, requirePermission(rc.principal, 'arrivals.review'), rc.params.id!),
  },
  {
    method: 'GET',
    path: '/arrivals/:id/image',
    auth: 'staff',
    handler: async (rc) => {
      const image = await getArrivalImage(rc.ctx, requirePermission(rc.principal, 'arrivals.review'), rc.params.id!);
      return new Response(new Uint8Array(image.bytes), {
        headers: {
          'Content-Type': image.type,
          'Cache-Control': 'no-store, private',
          'Content-Disposition': 'inline',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
    },
  },
  {
    method: 'POST',
    path: '/arrivals/:id/approve',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'arrivals.review');
      const settings = await getSettings(rc.ctx);
      const input = await rc.body(arrivalApproveSchema({ checksum: settings.identityChecksumValidation }));
      return inTransaction(rc.ctx, (scope) => approveArrival(rc.ctx, scope, admin, rc.params.id!, input, rc.client));
    },
  },
  {
    method: 'POST',
    path: '/arrivals/:id/reject',
    auth: 'staff',
    handler: async (rc) => {
      const admin = requirePermission(rc.principal, 'arrivals.review');
      const { reason } = await rc.body(z.object({ reason: requiredReasonSchema }));
      return inTransaction(rc.ctx, (scope) => rejectArrival(rc.ctx, scope, admin, rc.params.id!, reason));
    },
  },
];
