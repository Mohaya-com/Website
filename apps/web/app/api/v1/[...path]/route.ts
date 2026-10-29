import { handleApiRequest } from '@vms/server';

/** Mounts the shared Fetch-standard API (also used by the mobile app) at /api/v1/*. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function handler(request: Request): Promise<Response> {
  return handleApiRequest(request);
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as OPTIONS };
