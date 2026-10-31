import { ZodError, type ZodType } from 'zod';
import { ApiError, fieldErrorsFromIssues, type ApiErrorBody, type ClientKind } from '@vms/shared';
import type { Principal } from '../auth/principal';
import { resolveSession } from '../auth/sessions';
import type { RequestMeta } from '../auth/staff';
import type { ServerContext } from '../context';
import { hmacHex } from '../crypto';
import { describeError, logger } from '../logger';

export type AuthMode = 'public' | 'any' | 'staff' | 'visitor' | 'registrant' | 'member' | 'resident';

export interface RouteContext {
  ctx: ServerContext;
  req: Request;
  url: URL;
  params: Record<string, string>;
  principal: Principal | null;
  /** "mobile" when authenticated with a bearer token (or declared by the mobile app), otherwise "web". */
  client: ClientKind;
  meta: RequestMeta;
  token: string | null;
  body<T extends ZodType>(schema: T): Promise<import('zod').output<T>>;
  query<T extends ZodType>(schema: T): import('zod').output<T>;
}

export type Handler = (rc: RouteContext) => Promise<unknown>;

export interface RouteDef {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Larger request bodies for uploads (default 64 KB). */
  maxBodyBytes?: number;
  path: string;
  auth: AuthMode;
  /** Staff who must change their password may still call this route. */
  allowPasswordChange?: boolean;
  handler: Handler;
}

interface CompiledRoute extends RouteDef {
  regex: RegExp;
  keys: string[];
}

const MAX_BODY_BYTES = 64 * 1024;
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function errorResponse(status: number, code: string, fields?: Record<string, string>, details?: Record<string, unknown>): Response {
  const body: ApiErrorBody = { error: { code, message: `errors.${code}`, ...(fields ? { fields } : {}), ...(details ? { details } : {}) } };
  const headers: Record<string, string> = {};
  if (status === 429 && typeof details?.retryAfterSeconds === 'number') headers['Retry-After'] = String(details.retryAfterSeconds);
  return json(status, body, headers);
}

/** Maps database constraint violations to stable API errors without exposing row data. */
function mapDatabaseError(err: unknown): Response | null {
  const e = err as { code?: string; constraint?: string };
  if (typeof e?.code !== 'string') return null;
  const byConstraint: Record<string, [number, string]> = {
    visits_no_overlap: [409, 'overlapping_visit'],
    visits_one_checked_in_per_visitor: [409, 'conflict'],
    visitors_document_number_unique: [409, 'duplicate_visitor'],
    users_username_unique: [409, 'username_taken'],
    villas_number_unique: [409, 'villa_taken'],
    gate_events_visit_type_unique: [409, 'conflict'],
    visits_client_request_id_unique: [409, 'duplicate_request'],
  };
  if (e.constraint && byConstraint[e.constraint]) {
    const [status, code] = byConstraint[e.constraint]!;
    return errorResponse(status, code);
  }
  if (e.code === '23505' || e.code === '23P01') return errorResponse(409, 'conflict');
  if (e.code === '23514' || e.code === '22P02' || e.code === '22007' || e.code === '22008') return errorResponse(400, 'validation_error');
  if (e.code === '40001' || e.code === '40P01' || e.code === '55P03') return errorResponse(409, 'conflict');
  return null;
}

export function toErrorResponse(err: unknown): Response {
  if (err instanceof ApiError) return errorResponse(err.status, err.code, err.fields, err.details);
  if (err instanceof ZodError) return errorResponse(400, 'validation_error', fieldErrorsFromIssues(err.issues));
  const mapped = mapDatabaseError(err);
  if (mapped) return mapped;
  logger.error('http.unhandled_error', describeError(err));
  return errorResponse(500, 'internal_error');
}

function compile(route: RouteDef): CompiledRoute {
  const keys: string[] = [];
  const pattern = route.path
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { ...route, keys, regex: new RegExp(`^${pattern}/?$`) };
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function clientIp(req: Request, trustProxy: boolean): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    // With a trusted reverse proxy, the first entry is the client; otherwise use the entry added by the server itself.
    const ip = trustProxy ? parts[0] : parts[parts.length - 1];
    if (ip) return ip;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

function corsHeaders(ctx: ServerContext, origin: string | null): Record<string, string> {
  if (!origin || !ctx.config.allowedOrigins.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client, Accept, Cache-Control, X-Requested-With',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function withHeaders(res: Response, headers: Record<string, string>): Response {
  for (const [k, v] of Object.entries(headers)) if (!res.headers.has(k)) res.headers.set(k, v);
  return res;
}

export interface Router {
  handle(req: Request, basePath?: string): Promise<Response>;
}

export function createRouter(ctx: ServerContext, routes: RouteDef[]): Router {
  const compiled = routes.map(compile);

  async function handle(req: Request, basePath = '/api/v1'): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    const cors = corsHeaders(ctx, origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors });

    const path = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) || '/' : url.pathname;
    let matched: CompiledRoute | undefined;
    let match: RegExpExecArray | null = null;
    let methodMismatch = false;
    for (const r of compiled) {
      const m = r.regex.exec(path);
      if (!m) continue;
      if (r.method !== req.method) {
        methodMismatch = true;
        continue;
      }
      matched = r;
      match = m;
      break;
    }
    if (!matched || !match) return withHeaders(errorResponse(methodMismatch ? 405 : 404, 'not_found'), cors);

    try {
      const authHeader = req.headers.get('authorization');
      const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
      const cookieToken = readCookie(req.headers.get('cookie'), ctx.config.cookieName);

      if (UNSAFE.has(req.method)) {
        // CSRF defenses for browser requests: JSON-only bodies and an allowed Origin.
        const contentType = req.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('application/json')) return withHeaders(errorResponse(415, 'validation_error'), cors);
        if (!bearer) {
          const fetchSite = req.headers.get('sec-fetch-site');
          const originAllowed = origin ? ctx.config.allowedOrigins.includes(origin) : fetchSite !== 'cross-site';
          if (!originAllowed) return withHeaders(errorResponse(403, 'csrf_failed'), cors);
        }
      }

      const token = bearer ?? cookieToken;
      const principal = token ? await resolveSession(ctx, token) : null;
      if (token && !principal && matched.auth !== 'public') return withHeaders(errorResponse(401, 'session_expired'), cors);

      switch (matched.auth) {
        case 'any':
          if (!principal) throw new ApiError(401, 'unauthenticated');
          break;
        case 'staff':
          if (!principal) throw new ApiError(401, 'unauthenticated');
          if (principal.kind !== 'staff') throw new ApiError(403, 'forbidden');
          break;
        case 'visitor':
          if (!principal) throw new ApiError(401, 'unauthenticated');
          if (principal.kind === 'registrant') throw new ApiError(403, 'registration_required');
          if (principal.kind !== 'visitor') throw new ApiError(403, 'forbidden');
          break;
        case 'registrant':
          if (!principal) throw new ApiError(401, 'unauthenticated');
          if (principal.kind !== 'registrant') throw new ApiError(403, 'forbidden');
          break;
        case 'member':
          if (!principal) throw new ApiError(401, 'unauthenticated');
          if (principal.kind === 'registrant') throw new ApiError(403, 'registration_required');
          if (principal.kind === 'resident') throw new ApiError(403, 'forbidden');
          break;
        case 'resident':
          if (!principal) throw new ApiError(401, 'unauthenticated');
          if (principal.kind !== 'resident') throw new ApiError(403, 'forbidden');
          break;
        default:
          break;
      }
      if (principal?.kind === 'staff' && principal.user.mustChangePassword && !matched.allowPasswordChange && matched.auth !== 'public') {
        throw new ApiError(403, 'password_change_required');
      }

      const ip = clientIp(req, ctx.config.trustProxy);
      const params: Record<string, string> = {};
      matched.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(match![i + 1] ?? '');
      });
      let parsedBody: unknown;
      let bodyRead = false;
      const rc: RouteContext = {
        ctx,
        req,
        url,
        params,
        principal,
        client: bearer || req.headers.get('x-client') === 'mobile' ? 'mobile' : 'web',
        token,
        meta: { ip, ipHash: hmacHex(ctx.config.otpSecret, `ip|${ip}`).slice(0, 32), userAgent: req.headers.get('user-agent') },
        async body(schema) {
          if (!bodyRead) {
            bodyRead = true;
            const text = await req.text();
            if (text.length > (matched.maxBodyBytes ?? MAX_BODY_BYTES)) throw new ApiError(413, 'validation_error');
            try {
              parsedBody = text ? JSON.parse(text) : {};
            } catch {
              throw new ApiError(400, 'validation_error');
            }
          }
          return schema.parse(parsedBody);
        },
        query(schema) {
          return schema.parse(Object.fromEntries(url.searchParams.entries()));
        },
      };
      const result = await matched.handler(rc);
      const res = result instanceof Response ? result : json(200, result ?? { ok: true });
      return withHeaders(res, cors);
    } catch (err) {
      return withHeaders(toErrorResponse(err), cors);
    }
  }

  return { handle };
}

export function sessionCookie(ctx: ServerContext, token: string, maxAgeSeconds: number): string {
  const parts = [`${ctx.config.cookieName}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`];
  if (ctx.config.secureCookies) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(ctx: ServerContext): string {
  return sessionCookie(ctx, '', 0);
}
