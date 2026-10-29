/**
 * Minimal structured logger. Callers pass identifiers (UUIDs, references, codes) only —
 * never identity numbers, phone numbers, OTP codes (outside the dev SMS provider) or tokens.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEYS = /^(code)$|password|token|secret|otp|documentNumber|mobile|phone|authorization|cookie/i;

function sanitize(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : v;
  return out;
}

function write(level: Level, message: string, meta?: Record<string, unknown>) {
  if (process.env.VMS_LOG_SILENT === 'true' && level !== 'error') return;
  const line = { level, time: new Date().toISOString(), msg: message, ...sanitize(meta) };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== 'production') write('debug', m, meta);
  },
  info: (m: string, meta?: Record<string, unknown>) => write('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => write('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => write('error', m, meta),
};

/** Describes an error without leaking values: Postgres "detail" fields can include row data. */
export function describeError(err: unknown): Record<string, unknown> {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; message?: string; code?: string; constraint?: string };
    const pg = typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code);
    return pg ? { name: e.name, pgCode: e.code, constraint: e.constraint } : { name: e.name, message: e.message };
  }
  return { error: String(err) };
}
