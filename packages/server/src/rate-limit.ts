import { sql } from 'drizzle-orm';
import { ApiError } from '@vms/shared';
import type { ServerContext } from './context';
import { hmacHex } from './crypto';

export interface RateLimitRule {
  /** Logical bucket, e.g. "login:ip". */
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  loginIp: { name: 'login:ip', limit: 20, windowSeconds: 15 * 60 },
  loginUser: { name: 'login:user', limit: 10, windowSeconds: 15 * 60 },
  otpRequestIp: { name: 'otp:req:ip', limit: 10, windowSeconds: 60 * 60 },
  otpRequestDocument: { name: 'otp:req:doc', limit: 5, windowSeconds: 60 * 60 },
  otpRequestMobile: { name: 'otp:req:mobile', limit: 5, windowSeconds: 60 * 60 },
  otpResendCooldown: { name: 'otp:cooldown', limit: 1, windowSeconds: 60 },
  otpVerifyIp: { name: 'otp:verify:ip', limit: 30, windowSeconds: 60 * 60 },
  lookupUser: { name: 'lookup:user', limit: 60, windowSeconds: 10 * 60 },
  scanUser: { name: 'scan:user', limit: 240, windowSeconds: 60 },
  setupIp: { name: 'setup:ip', limit: 5, windowSeconds: 60 * 60 },
  publicIp: { name: 'public:ip', limit: 120, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window counter stored in PostgreSQL so limits hold across server instances.
 * Identifiers (IPs, identity numbers, phone numbers) are HMAC-hashed before storage.
 */
export async function consumeRateLimit(ctx: ServerContext, rule: RateLimitRule, identifier: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const now = ctx.clock.now();
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const key = `${rule.name}:${hmacHex(ctx.config.otpSecret, `${rule.name}|${identifier}`).slice(0, 40)}`;
  const result = await ctx.db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${windowStart}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count
  `);
  const count = Number(result.rows[0]?.count ?? 1);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));
  return { allowed: count <= rule.limit, retryAfterSeconds };
}

export async function enforceRateLimit(ctx: ServerContext, rule: RateLimitRule, identifier: string): Promise<void> {
  const r = await consumeRateLimit(ctx, rule, identifier);
  if (!r.allowed) throw new ApiError(429, 'rate_limited', undefined, { retryAfterSeconds: r.retryAfterSeconds });
}
