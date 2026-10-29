import { getServerContext, type ServerContext } from '../context';
import { createRouter, type Router } from './core';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { eventRoutes, notificationRoutes } from './routes/notifications';
import { publicRoutes } from './routes/public';
import { staffRoutes } from './routes/staff';
import { visitorSelfRoutes } from './routes/visitor-self';

export function createApi(ctx: ServerContext): Router {
  return createRouter(ctx, [...publicRoutes, ...authRoutes, ...visitorSelfRoutes, ...staffRoutes, ...adminRoutes, ...notificationRoutes, ...eventRoutes]);
}

const ROUTER_KEY = Symbol.for('vms.apiRouter');
type GlobalWithRouter = typeof globalThis & { [ROUTER_KEY]?: Router };

/** Fetch-standard entry point. Mount it under /api/v1 in any server (Next.js route handler, Node, Bun, etc.). */
export async function handleApiRequest(req: Request): Promise<Response> {
  const g = globalThis as GlobalWithRouter;
  g[ROUTER_KEY] ??= createApi(getServerContext());
  return g[ROUTER_KEY].handle(req);
}
