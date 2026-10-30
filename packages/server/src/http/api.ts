import { getServerContext, type ServerContext } from '../context';
import { createRouter, type Router } from './core';
import { adminRoutes } from './routes/admin';
import { arrivalRoutes } from './routes/arrivals';
import { gateRoutes } from './routes/gate';
import { authRoutes } from './routes/auth';
import { eventRoutes, notificationRoutes } from './routes/notifications';
import { publicRoutes } from './routes/public';
import { staffRoutes } from './routes/staff';
import { visitorSelfRoutes } from './routes/visitor-self';

export function createApi(ctx: ServerContext): Router {
  return createRouter(ctx, [...publicRoutes, ...arrivalRoutes, ...gateRoutes, ...authRoutes, ...visitorSelfRoutes, ...staffRoutes, ...adminRoutes, ...notificationRoutes, ...eventRoutes]);
}

// Module-level cache: rebuilt on hot reload in development, while the database context stays process-wide.
let router: Router | null = null;

/** Fetch-standard entry point. Mount it under /api/v1 in any server (Next.js route handler, Node, Bun, etc.). */
export async function handleApiRequest(req: Request): Promise<Response> {
  router ??= createApi(getServerContext());
  return router.handle(req);
}
