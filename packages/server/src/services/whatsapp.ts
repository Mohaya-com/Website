import { eq, sql } from 'drizzle-orm';
import { settings as settingsTable } from '@vms/db';
import { ApiError, maskPhone, OTP, type WhatsAppStatusDTO, type WhatsAppTestResultDTO } from '@vms/shared';
import type { StaffPrincipal } from '../auth/principal';
import type { RequestMeta } from '../auth/staff';
import { inTransaction, type ServerContext } from '../context';
import { openSecret, randomDigits, sealSecret } from '../crypto';
import { describeError, logger } from '../logger';
import { WhatsAppCloudProvider, type SmsProvider } from '../providers/sms';
import {
  createAuthTemplate,
  findTemplate,
  GraphApiError,
  GraphUnreachableError,
  listPhoneNumbers,
  sendAuthCode,
  type GraphAuth,
  type WhatsAppConnection,
} from '../providers/whatsapp';
import { enforceRateLimit } from '../rate-limit';
import { publish } from '../realtime';
import { audit } from './audit';

/**
 * WhatsApp connection entered by an administrator in the settings (instead of server environment
 * variables). Stored in the settings table; the access token is encrypted with a key derived from
 * OTP_SECRET and is never returned by the API. A provider configured in the environment
 * (SMS_PROVIDER other than "disabled") always takes precedence.
 */

export const WHATSAPP_SETTINGS_KEY = 'integration.whatsapp';
const TOKEN_PURPOSE = 'whatsapp-access-token';
const CACHE_MS = 30_000;
const TEST_RATE_LIMIT = { name: 'whatsapp:test', limit: 10, windowSeconds: 60 * 60 };

export interface StoredWhatsApp {
  enabled: boolean;
  phoneNumberId: string;
  businessAccountId: string;
  templateName: string;
  templateLanguage: string;
  /** Sealed with sealSecret(OTP_SECRET). */
  token: string;
  tokenHint: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  templateStatus: string | null;
  checkedAt: string | null;
  lastTest: { at: string; ok: boolean; error: string | null } | null;
  lastDeliveryError: { at: string; error: string } | null;
  updatedAt: string | null;
}

function isStored(value: unknown): value is StoredWhatsApp {
  const v = value as Partial<StoredWhatsApp> | null;
  return !!v && typeof v.phoneNumberId === 'string' && typeof v.businessAccountId === 'string' && typeof v.token === 'string';
}

async function loadStored(ctx: ServerContext): Promise<StoredWhatsApp | null> {
  const [row] = await ctx.db.select().from(settingsTable).where(eq(settingsTable.key, WHATSAPP_SETTINGS_KEY));
  return isStored(row?.value) ? row.value : null;
}

async function cachedStored(ctx: ServerContext): Promise<StoredWhatsApp | null> {
  const cached = ctx.cache.whatsapp;
  if (cached && Date.now() - cached.loadedAt < CACHE_MS) return cached.value;
  const value = await loadStored(ctx);
  ctx.cache.whatsapp = { value, loadedAt: Date.now() };
  return value;
}

function openToken(ctx: ServerContext, stored: StoredWhatsApp): string | null {
  return openSecret(ctx.config.otpSecret, TOKEN_PURPOSE, stored.token);
}

function environmentProvider(ctx: ServerContext): WhatsAppStatusDTO['environmentProvider'] {
  return ctx.sms.name;
}

function connection(ctx: ServerContext, stored: StoredWhatsApp, accessToken: string): WhatsAppConnection {
  return {
    accessToken,
    apiVersion: ctx.config.sms.whatsapp.apiVersion,
    phoneNumberId: stored.phoneNumberId,
    templateName: stored.templateName,
    templateLanguage: stored.templateLanguage,
  };
}

/**
 * The provider used for visitor verification codes: the environment provider when one is configured,
 * otherwise the WhatsApp connection from the settings when it is enabled.
 */
export async function resolveSmsProvider(ctx: ServerContext): Promise<SmsProvider> {
  if (ctx.sms.name !== 'disabled') return ctx.sms;
  const stored = await cachedStored(ctx);
  if (!stored?.enabled) return ctx.sms;
  const token = openToken(ctx, stored);
  if (!token) return ctx.sms;
  return new WhatsAppCloudProvider(connection(ctx, stored, token), {
    onFailed: (err) => void recordDeliveryError(ctx, err),
    onSent: () => {
      if (stored.lastDeliveryError) void recordDeliveryError(ctx, null);
    },
  });
}

/** Keeps the last delivery failure visible to administrators (sanitized: no phone numbers). */
async function recordDeliveryError(ctx: ServerContext, err: unknown): Promise<void> {
  const value = err ? { at: ctx.clock.now().toISOString(), error: describeGraphError(err) } : null;
  try {
    await ctx.db.execute(sql`
      update settings set value = jsonb_set(value, '{lastDeliveryError}', ${JSON.stringify(value)}::jsonb)
      where key = ${WHATSAPP_SETTINGS_KEY}
    `);
    ctx.cache.whatsapp = null;
  } catch (e) {
    logger.warn('whatsapp.record_failed', describeError(e));
  }
}

function describeGraphError(err: unknown): string {
  if (err instanceof GraphApiError) return `${err.code !== null ? `(#${err.code}) ` : ''}${err.detail}`;
  if (err instanceof GraphUnreachableError) return 'unreachable';
  return 'error';
}

/** Maps a Graph API failure to an API error the settings page can explain. */
function toApiError(err: unknown, fallback: 'whatsapp_send_failed' | 'whatsapp_template_failed' | 'whatsapp_wrong_id'): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof GraphUnreachableError) return new ApiError(502, 'whatsapp_unreachable');
  if (err instanceof GraphApiError) {
    const details = { graphCode: err.code, detail: describeGraphError(err) };
    if (err.code === 190) return new ApiError(400, 'whatsapp_token_invalid', undefined, details);
    if (err.code === 3 || err.code === 10 || (err.code !== null && err.code >= 200 && err.code < 300)) {
      return new ApiError(400, 'whatsapp_permission_missing', undefined, details);
    }
    if (err.code === 100 && err.subcode === 33) return new ApiError(400, 'whatsapp_wrong_id', undefined, details);
    if (err.code === 131030) return new ApiError(400, 'whatsapp_recipient_not_allowed', undefined, details);
    return new ApiError(400, fallback, undefined, details);
  }
  logger.error('whatsapp.unexpected_error', describeError(err));
  return new ApiError(500, 'internal_error');
}

function toStatus(ctx: ServerContext, stored: StoredWhatsApp | null): WhatsAppStatusDTO {
  const tokenReadable = stored ? openToken(ctx, stored) !== null : false;
  return {
    environmentProvider: environmentProvider(ctx),
    active: ctx.sms.name === 'disabled' && !!stored?.enabled && tokenReadable,
    configured: !!stored,
    enabled: !!stored?.enabled,
    phoneNumberId: stored?.phoneNumberId ?? null,
    businessAccountId: stored?.businessAccountId ?? null,
    templateName: stored?.templateName ?? 'otp_code',
    templateLanguage: stored?.templateLanguage ?? 'ar',
    tokenHint: stored ? `…${stored.tokenHint}` : null,
    tokenReadable,
    displayPhoneNumber: stored?.displayPhoneNumber ?? null,
    verifiedName: stored?.verifiedName ?? null,
    templateStatus: stored?.templateStatus ?? null,
    checkedAt: stored?.checkedAt ?? null,
    lastTest: stored?.lastTest ?? null,
    lastDeliveryError: stored?.lastDeliveryError ?? null,
    updatedAt: stored?.updatedAt ?? null,
  };
}

export async function getWhatsAppStatus(ctx: ServerContext): Promise<WhatsAppStatusDTO> {
  return toStatus(ctx, await loadStored(ctx));
}

async function writeStored(ctx: ServerContext, admin: StaffPrincipal, value: StoredWhatsApp, action: string, metadata: Record<string, unknown>, meta: RequestMeta): Promise<void> {
  await inTransaction(ctx, async (scope) => {
    await scope.tx
      .insert(settingsTable)
      .values({ key: WHATSAPP_SETTINGS_KEY, value, updatedAt: scope.now, updatedByUserId: admin.userId })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: scope.now, updatedByUserId: admin.userId } });
    await audit(scope.tx, { actor: { type: 'user', userId: admin.userId }, action, entityType: 'settings', entityId: WHATSAPP_SETTINGS_KEY, metadata, ipHash: meta.ipHash, at: scope.now });
    await publish(scope.tx, { t: 'config' });
  });
  ctx.cache.whatsapp = null;
}

/** Looks the template up and creates it when it does not exist yet. Returns its review status. */
async function ensureTemplate(auth: GraphAuth, businessAccountId: string, name: string, language: string): Promise<string> {
  try {
    const existing = await findTemplate(auth, businessAccountId, name, language);
    if (existing) return existing.status;
    return (await createAuthTemplate(auth, businessAccountId, name, language)).status;
  } catch (err) {
    throw toApiError(err, 'whatsapp_template_failed');
  }
}

/**
 * Verifies the connection with Meta (token, account and phone number), creates the authentication
 * template if needed, then stores the connection. Sending stays as it was (enabled or not).
 */
export async function saveWhatsAppConfig(
  ctx: ServerContext,
  admin: StaffPrincipal,
  input: { phoneNumberId: string; businessAccountId: string; accessToken?: string | undefined; templateName: string; templateLanguage: string },
  meta: RequestMeta,
): Promise<WhatsAppStatusDTO> {
  const existing = await loadStored(ctx);
  const newToken = input.accessToken?.trim() || null;
  const accessToken = newToken ?? (existing ? openToken(ctx, existing) : null);
  if (!accessToken) throw new ApiError(400, 'validation_error', { accessToken: 'validation.required' });
  const auth: GraphAuth = { accessToken, apiVersion: ctx.config.sms.whatsapp.apiVersion };

  let phone;
  try {
    phone = (await listPhoneNumbers(auth, input.businessAccountId)).find((p) => p.id === input.phoneNumberId);
  } catch (err) {
    throw toApiError(err, 'whatsapp_wrong_id');
  }
  if (!phone) throw new ApiError(400, 'whatsapp_phone_not_in_account');
  const templateStatus = await ensureTemplate(auth, input.businessAccountId, input.templateName, input.templateLanguage);

  const now = ctx.clock.now().toISOString();
  const sameNumber = existing?.phoneNumberId === input.phoneNumberId && existing.templateName === input.templateName && existing.templateLanguage === input.templateLanguage;
  const value: StoredWhatsApp = {
    enabled: (existing?.enabled ?? false) && templateStatus === 'APPROVED',
    phoneNumberId: input.phoneNumberId,
    businessAccountId: input.businessAccountId,
    templateName: input.templateName,
    templateLanguage: input.templateLanguage,
    token: newToken ? sealSecret(ctx.config.otpSecret, TOKEN_PURPOSE, newToken) : existing!.token,
    tokenHint: newToken ? newToken.slice(-4) : existing!.tokenHint,
    displayPhoneNumber: phone.display_phone_number ?? null,
    verifiedName: phone.verified_name ?? null,
    templateStatus,
    checkedAt: now,
    lastTest: sameNumber ? (existing?.lastTest ?? null) : null,
    lastDeliveryError: sameNumber && !newToken ? (existing?.lastDeliveryError ?? null) : null,
    updatedAt: now,
  };
  await writeStored(ctx, admin, value, 'whatsapp.configured', { templateStatus, tokenChanged: !!newToken, businessNumber: maskPhone(value.displayPhoneNumber ? `+${value.displayPhoneNumber.replace(/\D/g, '')}` : null) }, meta);
  return toStatus(ctx, value);
}

function requireStored(ctx: ServerContext, stored: StoredWhatsApp | null): { stored: StoredWhatsApp; token: string } {
  if (!stored) throw new ApiError(409, 'whatsapp_not_configured');
  const token = openToken(ctx, stored);
  if (!token) throw new ApiError(409, 'whatsapp_token_unreadable');
  return { stored, token };
}

/** Re-reads the template review status from Meta (for example after it was pending). */
export async function refreshWhatsAppStatus(ctx: ServerContext): Promise<WhatsAppStatusDTO> {
  const { stored, token } = requireStored(ctx, await loadStored(ctx));
  const auth: GraphAuth = { accessToken: token, apiVersion: ctx.config.sms.whatsapp.apiVersion };
  let templateStatus: string;
  try {
    templateStatus = (await findTemplate(auth, stored.businessAccountId, stored.templateName, stored.templateLanguage))?.status ?? 'MISSING';
  } catch (err) {
    throw toApiError(err, 'whatsapp_wrong_id');
  }
  const value: StoredWhatsApp = { ...stored, templateStatus, checkedAt: ctx.clock.now().toISOString() };
  await ctx.db.update(settingsTable).set({ value }).where(eq(settingsTable.key, WHATSAPP_SETTINGS_KEY));
  ctx.cache.whatsapp = null;
  return toStatus(ctx, value);
}

/** Sends a test code to a number the administrator enters. Works before sending is enabled. */
export async function sendWhatsAppTest(ctx: ServerContext, admin: StaffPrincipal, mobile: string, meta: RequestMeta): Promise<WhatsAppTestResultDTO> {
  await enforceRateLimit(ctx, TEST_RATE_LIMIT, admin.userId);
  const { stored, token } = requireStored(ctx, await loadStored(ctx));
  const at = ctx.clock.now();
  let messageId: string | null = null;
  let failure: unknown = null;
  try {
    messageId = await sendAuthCode(connection(ctx, stored, token), mobile, randomDigits(OTP.length));
  } catch (err) {
    failure = err;
  }
  const lastTest = { at: at.toISOString(), ok: !failure, error: failure ? describeGraphError(failure) : null };
  await ctx.db.execute(sql`
    update settings set value = jsonb_set(value, '{lastTest}', ${JSON.stringify(lastTest)}::jsonb)
    where key = ${WHATSAPP_SETTINGS_KEY}
  `);
  await audit(ctx.db, {
    actor: { type: 'user', userId: admin.userId },
    action: failure ? 'whatsapp.test_failed' : 'whatsapp.test_sent',
    entityType: 'settings',
    entityId: WHATSAPP_SETTINGS_KEY,
    metadata: { to: maskPhone(mobile), ...(failure ? { error: lastTest.error } : {}) },
    ipHash: meta.ipHash,
    at,
  });
  ctx.cache.whatsapp = null;
  if (failure) throw toApiError(failure, 'whatsapp_send_failed');
  return { ok: true, messageId };
}

/** Turns sending visitor codes over WhatsApp on or off. Turning it on requires an approved template. */
export async function setWhatsAppEnabled(ctx: ServerContext, admin: StaffPrincipal, enabled: boolean, meta: RequestMeta): Promise<WhatsAppStatusDTO> {
  const { stored, token } = requireStored(ctx, await loadStored(ctx));
  let templateStatus = stored.templateStatus;
  if (enabled) {
    try {
      templateStatus = (await findTemplate({ accessToken: token, apiVersion: ctx.config.sms.whatsapp.apiVersion }, stored.businessAccountId, stored.templateName, stored.templateLanguage))?.status ?? 'MISSING';
    } catch (err) {
      throw toApiError(err, 'whatsapp_wrong_id');
    }
    if (templateStatus !== 'APPROVED') {
      await ctx.db.update(settingsTable).set({ value: { ...stored, templateStatus, checkedAt: ctx.clock.now().toISOString() } }).where(eq(settingsTable.key, WHATSAPP_SETTINGS_KEY));
      ctx.cache.whatsapp = null;
      throw new ApiError(409, 'whatsapp_template_not_approved', undefined, { templateStatus });
    }
  }
  if (stored.enabled === enabled && templateStatus === stored.templateStatus) return toStatus(ctx, stored);
  const value: StoredWhatsApp = { ...stored, enabled, templateStatus, checkedAt: enabled ? ctx.clock.now().toISOString() : stored.checkedAt };
  await writeStored(ctx, admin, value, enabled ? 'whatsapp.enabled' : 'whatsapp.disabled', {}, meta);
  return toStatus(ctx, value);
}

export async function removeWhatsAppConfig(ctx: ServerContext, admin: StaffPrincipal, meta: RequestMeta): Promise<WhatsAppStatusDTO> {
  await inTransaction(ctx, async (scope) => {
    const deleted = await scope.tx.delete(settingsTable).where(eq(settingsTable.key, WHATSAPP_SETTINGS_KEY)).returning({ key: settingsTable.key });
    if (!deleted.length) return;
    await audit(scope.tx, { actor: { type: 'user', userId: admin.userId }, action: 'whatsapp.removed', entityType: 'settings', entityId: WHATSAPP_SETTINGS_KEY, ipHash: meta.ipHash, at: scope.now });
    await publish(scope.tx, { t: 'config' });
  });
  ctx.cache.whatsapp = null;
  return toStatus(ctx, null);
}
