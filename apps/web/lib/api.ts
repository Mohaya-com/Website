import type { ApiErrorBody } from '@vms/shared';

/** Error thrown by the API client. `messageKey` is a translation key (errors.*). */
export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageKey: string,
    readonly fields: Record<string, string> = {},
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'ClientApiError';
  }
  get isNetwork() {
    return this.code === 'network' || this.code === 'timeout';
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Same-origin JSON client. Authentication uses the HttpOnly session cookie set by the server. */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ClientApiError(0, 'network', 'errors.network');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  options.signal?.addEventListener('abort', () => controller.abort());
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError' && !options.signal?.aborted) throw new ClientApiError(0, 'timeout', 'errors.timeout');
    if ((err as Error).name === 'AbortError') throw err;
    throw new ClientApiError(0, 'network', 'errors.network');
  } finally {
    clearTimeout(timeout);
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const body = data as ApiErrorBody | null;
    const code = body?.error?.code ?? 'internal_error';
    if ((res.status === 401) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('vms:unauthenticated', { detail: code }));
    }
    throw new ClientApiError(res.status, code, body?.error?.message ?? `errors.${code}`, body?.error?.fields ?? {}, body?.error?.details ?? {});
  }
  return data as T;
}

export function isApiError(err: unknown): err is ClientApiError {
  return err instanceof ClientApiError;
}
