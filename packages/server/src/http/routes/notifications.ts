import { z } from 'zod';
import { pageQuerySchema, pushTokenSchema } from '@vms/shared';
import { resolveSession } from '../../auth/sessions';
import type { Principal } from '../../auth/principal';
import { listNotifications, markRead, registerPushToken, unreadCount, unregisterPushToken } from '../../services/notifications';
import type { RealtimeEvent } from '../../realtime';
import type { RouteDef } from '../core';

export const notificationRoutes: RouteDef[] = [
  {
    method: 'GET',
    path: '/notifications',
    auth: 'member',
    handler: async (rc) => {
      const { page, pageSize } = rc.query(pageQuerySchema);
      return listNotifications(rc.ctx.db, rc.principal!, page, pageSize);
    },
  },
  {
    method: 'GET',
    path: '/notifications/unread-count',
    auth: 'member',
    handler: async (rc) => ({ count: await unreadCount(rc.ctx.db, rc.principal!) }),
  },
  {
    method: 'POST',
    path: '/notifications/read-all',
    auth: 'member',
    handler: async (rc) => {
      await markRead(rc.ctx.db, rc.principal!, rc.ctx.clock.now());
      return { ok: true };
    },
  },
  {
    method: 'POST',
    path: '/notifications/:id/read',
    auth: 'member',
    handler: async (rc) => {
      await markRead(rc.ctx.db, rc.principal!, rc.ctx.clock.now(), z.uuid().parse(rc.params.id));
      return { ok: true };
    },
  },
  {
    method: 'POST',
    path: '/push-tokens',
    auth: 'member',
    allowPasswordChange: true,
    handler: async (rc) => {
      const { token, platform } = await rc.body(pushTokenSchema);
      await registerPushToken(rc.ctx.db, rc.principal!, token, platform, rc.ctx.clock.now());
      return { ok: true };
    },
  },
  {
    method: 'DELETE',
    path: '/push-tokens',
    auth: 'member',
    allowPasswordChange: true,
    handler: async (rc) => {
      const { token } = await rc.body(z.object({ token: z.string().min(10).max(255) }));
      await unregisterPushToken(rc.ctx.db, rc.principal!, token);
      return { ok: true };
    },
  },
];

/** Whether a principal may receive a realtime event. Events carry identifiers only. */
export function canReceive(principal: Principal, event: RealtimeEvent): boolean {
  if (event.t === 'config') return true;
  if (event.t === 'arrival' || event.t === 'gate') return principal.kind === 'staff';
  if (principal.kind === 'staff') {
    if (event.t === 'visit') return true;
    return event.userId === principal.userId;
  }
  if (principal.kind === 'visitor') {
    return event.visitorId === principal.visitorId;
  }
  return false;
}

const encoder = new TextEncoder();

/** Server-Sent Events stream. Clients refetch affected queries when notified; polling remains the fallback. */
export const eventRoutes: RouteDef[] = [
  {
    method: 'GET',
    path: '/events',
    auth: 'member',
    handler: async (rc) => {
      const ctx = rc.ctx;
      const principal = rc.principal!;
      const token = rc.token;
      let cleanup: () => void = () => undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (chunk: string) => {
            try {
              controller.enqueue(encoder.encode(chunk));
            } catch {
              cleanup();
            }
          };
          send(`retry: 5000\nevent: ready\ndata: {}\n\n`);
          const unsubscribe = ctx.realtime.subscribe((event) => {
            if (canReceive(principal, event)) send(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
          });
          const heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);
          // Close the stream when the session is revoked or expires.
          const revalidate = setInterval(() => {
            void resolveSession(ctx, token).then((p) => {
              if (!p) {
                send(`event: session\ndata: {"expired":true}\n\n`);
                cleanup();
                try {
                  controller.close();
                } catch {
                  // already closed
                }
              }
            });
          }, 60_000);
          cleanup = () => {
            unsubscribe();
            clearInterval(heartbeat);
            clearInterval(revalidate);
          };
          rc.req.signal?.addEventListener('abort', () => {
            cleanup();
            try {
              controller.close();
            } catch {
              // already closed
            }
          });
        },
        cancel() {
          cleanup();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    },
  },
];
