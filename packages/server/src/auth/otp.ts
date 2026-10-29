import { and, eq, isNull, sql } from 'drizzle-orm';
import { otpChallenges, visitors } from '@vms/db';
import { ApiError, OTP, type ClientKind, type DocumentType, type Locale, type OtpChallengeDTO } from '@vms/shared';
import type { ServerContext } from '../context';
import { inTransaction } from '../context';
import { hmacHex, randomDigits, safeEqual } from '../crypto';
import { sendInBackground } from '../providers/sms';
import { enforceRateLimit, RATE_LIMITS } from '../rate-limit';
import { audit } from '../services/audit';
import { getSettings } from '../services/settings';
import { resolveSmsProvider } from '../services/whatsapp';
import type { Principal } from './principal';
import { createSession, resolveSession } from './sessions';
import type { RequestMeta } from './staff';

function codeHash(ctx: ServerContext, challengeId: string, code: string): string {
  return hmacHex(ctx.config.otpSecret, `otp|${challengeId}|${code}`);
}

function otpMessage(locale: Locale, code: string): string {
  return locale === 'en'
    ? `${code} is your visitor verification code. Do not share it with anyone.`
    : `رمز التحقق الخاص بك: ${code}\nلا تشارك هذا الرمز مع أي شخص.`;
}

/**
 * Starts visitor verification. The response is identical whether or not the identity number is registered,
 * and whether or not the mobile number matches, so the endpoint cannot be used to enumerate identities.
 *   • registered + matching mobile   → code sent to the registered mobile (sign-in)
 *   • not registered                  → code sent to the entered mobile (new registration)
 *   • registered + different mobile   → nothing is sent; verification can never succeed.
 *     The visitor is directed to gate security (staff-assisted recovery). A public user can never
 *     replace the registered mobile number.
 */
export async function requestVisitorOtp(
  ctx: ServerContext,
  input: { documentType: DocumentType; documentNumber: string; mobile: string; locale?: Locale | undefined },
  meta: RequestMeta,
): Promise<OtpChallengeDTO> {
  const sms = await resolveSmsProvider(ctx);
  if (!sms.available) throw new ApiError(503, 'sms_unavailable');
  await enforceRateLimit(ctx, RATE_LIMITS.otpRequestIp, meta.ip);
  await enforceRateLimit(ctx, RATE_LIMITS.otpResendCooldown, `${input.documentNumber}|${input.mobile}`);
  await enforceRateLimit(ctx, RATE_LIMITS.otpRequestDocument, input.documentNumber);
  await enforceRateLimit(ctx, RATE_LIMITS.otpRequestMobile, input.mobile);

  const settings = await getSettings(ctx);
  const now = ctx.clock.now();
  const [existing] = await ctx.db.select().from(visitors).where(eq(visitors.documentNumber, input.documentNumber)).limit(1);

  let deliver: boolean;
  let visitorId: string | null = null;
  if (existing) {
    deliver = existing.mobile === input.mobile && existing.documentType === input.documentType;
    if (deliver) visitorId = existing.id;
  } else {
    deliver = settings.allowVisitorSelfRegistration;
  }

  const code = randomDigits(OTP.length);
  const id = crypto.randomUUID();
  const locale = input.locale ?? 'ar';
  await ctx.db.insert(otpChallenges).values({
    id,
    documentType: input.documentType,
    documentNumber: input.documentNumber,
    mobile: input.mobile,
    visitorId,
    codeHash: codeHash(ctx, id, code),
    delivered: deliver,
    locale,
    ipHash: meta.ipHash,
    expiresAt: new Date(now.getTime() + OTP.ttlSeconds * 1000),
    createdAt: now,
  });

  if (deliver) sendInBackground(sms, { to: input.mobile, body: otpMessage(locale, code), code });

  return {
    challengeId: id,
    expiresInSeconds: OTP.ttlSeconds,
    resendAfterSeconds: OTP.resendAfterSeconds,
    developmentDelivery: sms.isDevelopment,
  };
}

/** Completes verification. Every failure returns the same generic error. */
export async function verifyVisitorOtp(
  ctx: ServerContext,
  input: { challengeId: string; code: string; client: ClientKind },
  meta: RequestMeta,
): Promise<{ token: string; principal: Principal }> {
  await enforceRateLimit(ctx, RATE_LIMITS.otpVerifyIp, meta.ip);
  const invalid = () => new ApiError(400, 'otp_invalid');

  // Count the attempt in its own transaction so failed guesses are always recorded.
  const challenge = await inTransaction(ctx, async ({ tx, now }) => {
    const [row] = await tx.select().from(otpChallenges).where(eq(otpChallenges.id, input.challengeId)).for('update').limit(1);
    if (!row || row.verifiedAt || row.expiresAt <= now || row.attempts >= OTP.maxAttempts) return null;
    await tx.update(otpChallenges).set({ attempts: sql`${otpChallenges.attempts} + 1` }).where(eq(otpChallenges.id, row.id));
    return row;
  });
  if (!challenge || !challenge.delivered) throw invalid();
  if (!safeEqual(codeHash(ctx, challenge.id, input.code), challenge.codeHash)) throw invalid();

  const { token } = await inTransaction(ctx, async ({ tx, now }) => {
    const marked = await tx
      .update(otpChallenges)
      .set({ verifiedAt: now })
      .where(and(eq(otpChallenges.id, challenge.id), isNull(otpChallenges.verifiedAt)))
      .returning({ id: otpChallenges.id });
    if (marked.length === 0) throw invalid();

    const [current] = await tx.select().from(visitors).where(eq(visitors.documentNumber, challenge.documentNumber)).limit(1);
    if (challenge.visitorId) {
      // The profile must still exist with the same mobile number.
      if (!current || current.id !== challenge.visitorId || current.mobile !== challenge.mobile) throw invalid();
      const created = await createSession(ctx, tx, { kind: 'visitor', visitorId: current.id, client: input.client, userAgent: meta.userAgent }, now);
      await audit(tx, { actor: { type: 'visitor', visitorId: current.id }, action: 'auth.visitor_verified', entityType: 'session', entityId: created.session.id, metadata: { client: input.client }, ipHash: meta.ipHash, at: now });
      return created;
    }
    // New registration: refuse if a profile appeared for this identity in the meantime.
    if (current) throw invalid();
    return createSession(ctx, tx, { kind: 'registrant', otpChallengeId: challenge.id, client: input.client, userAgent: meta.userAgent }, now);
  });
  const principal = await resolveSession(ctx, token);
  if (!principal) throw invalid();
  return { token, principal };
}
