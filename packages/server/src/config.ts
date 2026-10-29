import fs from 'node:fs';
import path from 'node:path';

export type SmsProviderName = 'dev' | 'twilio' | 'whatsapp' | 'disabled';

/** Graph API version for WhatsApp Cloud API calls (v25.0 is supported until July 2028). */
export const WHATSAPP_DEFAULT_API_VERSION = 'v25.0';
export type PushProviderName = 'none' | 'expo';

export interface ServerConfig {
  nodeEnv: string;
  isProduction: boolean;
  databaseUrl: string;
  databasePoolMax: number;
  appOrigin: string;
  /** Browser origins allowed to make cookie-authenticated, state-changing requests. */
  allowedOrigins: string[];
  trustProxy: boolean;
  passTokenSecret: string;
  otpSecret: string;
  setupToken: string | null;
  sms: {
    provider: SmsProviderName;
    twilio: { accountSid: string; authToken: string; from: string; messagingServiceSid: string };
    whatsapp: { accessToken: string; phoneNumberId: string; templateName: string; templateLanguage: string; apiVersion: string };
  };
  push: { provider: PushProviderName; expoAccessToken: string | null };
  sessions: { staffIdleHours: number; staffMaxDays: number; visitorMaxDays: number; registrantMinutes: number };
  maintenanceIntervalSeconds: number;
  cookieName: string;
  secureCookies: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEV_PASS_SECRET = 'insecure-development-pass-token-secret-do-not-use';
const DEV_OTP_SECRET = 'insecure-development-otp-secret-do-not-use-in-prod';

function int(value: string | undefined, fallback: number): number {
  const n = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Loads the repository-root .env when present (for scripts and tests; Next.js loads it via next.config). */
export function loadRootEnv(startDir: string = process.cwd()): void {
  // Inside Next.js the root .env is loaded by next.config.ts; avoid filesystem probing (and bundle tracing).
  if (process.env.NEXT_RUNTIME) return;
  let dir = path.resolve(/*turbopackIgnore: true*/ startDir);
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(/*turbopackIgnore: true*/ dir, '.env');
    if (fs.existsSync(candidate) && fs.existsSync(path.join(/*turbopackIgnore: true*/ dir, 'pnpm-workspace.yaml'))) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        // ignore malformed files; validation below reports missing values
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/**
 * Reads and validates configuration from environment variables.
 * Production refuses insecure defaults: missing secrets, the development SMS provider, or a non-HTTPS origin.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const problems: string[] = [];

  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) problems.push('DATABASE_URL is required');

  const appOrigin = (env.APP_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '');
  if (isProduction && !appOrigin.startsWith('https://')) problems.push('APP_ORIGIN must use https:// in production');

  const extraOrigins = (env.ADDITIONAL_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

  let passTokenSecret = env.PASS_TOKEN_SECRET ?? '';
  let otpSecret = env.OTP_SECRET ?? '';
  for (const [name, value] of [
    ['PASS_TOKEN_SECRET', passTokenSecret],
    ['OTP_SECRET', otpSecret],
  ] as const) {
    if (!value) {
      if (isProduction) problems.push(`${name} is required in production`);
    } else if (value.length < 32) {
      problems.push(`${name} must be at least 32 characters`);
    }
  }
  if (!isProduction) {
    if (!passTokenSecret || !otpSecret) {
      console.warn('[config] PASS_TOKEN_SECRET / OTP_SECRET not set — using INSECURE development defaults.');
    }
    passTokenSecret ||= DEV_PASS_SECRET;
    otpSecret ||= DEV_OTP_SECRET;
  }
  if (passTokenSecret && passTokenSecret === otpSecret) problems.push('PASS_TOKEN_SECRET and OTP_SECRET must be different');

  const setupToken = env.SETUP_TOKEN?.trim() || null;
  if (setupToken && setupToken.length < 32) problems.push('SETUP_TOKEN must be at least 32 characters');

  const smsProvider = (env.SMS_PROVIDER?.trim() || (isProduction ? 'disabled' : 'dev')) as SmsProviderName;
  if (!['dev', 'twilio', 'whatsapp', 'disabled'].includes(smsProvider)) problems.push(`Unknown SMS_PROVIDER "${smsProvider}"`);
  if (smsProvider === 'dev' && isProduction) problems.push('SMS_PROVIDER=dev is a development-only provider and cannot run in production');
  const twilio = {
    accountSid: env.TWILIO_ACCOUNT_SID ?? '',
    authToken: env.TWILIO_AUTH_TOKEN ?? '',
    from: env.TWILIO_FROM ?? '',
    messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID ?? '',
  };
  if (smsProvider === 'twilio' && (!twilio.accountSid || !twilio.authToken || (!twilio.from && !twilio.messagingServiceSid))) {
    problems.push('SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID');
  }

  const whatsapp = {
    accessToken: env.WHATSAPP_ACCESS_TOKEN?.trim() ?? '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? '',
    templateName: env.WHATSAPP_TEMPLATE_NAME?.trim() || 'otp_code',
    templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'ar',
    apiVersion: env.WHATSAPP_API_VERSION?.trim() || WHATSAPP_DEFAULT_API_VERSION,
  };
  if (!/^v\d{1,3}\.\d$/.test(whatsapp.apiVersion)) problems.push('WHATSAPP_API_VERSION must look like v25.0');
  if (smsProvider === 'whatsapp' && (!whatsapp.accessToken || !whatsapp.phoneNumberId)) {
    problems.push('SMS_PROVIDER=whatsapp requires WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID');
  }

  const pushProvider = (env.PUSH_PROVIDER ?? 'none') as PushProviderName;
  if (!['none', 'expo'].includes(pushProvider)) problems.push(`Unknown PUSH_PROVIDER "${pushProvider}"`);

  if (problems.length) throw new ConfigError(`Invalid server configuration:\n  - ${problems.join('\n  - ')}`);

  const secureCookies = appOrigin.startsWith('https://');
  return {
    nodeEnv,
    isProduction,
    databaseUrl,
    databasePoolMax: int(env.DATABASE_POOL_MAX, 10),
    appOrigin,
    allowedOrigins: [appOrigin, ...extraOrigins],
    trustProxy: env.TRUST_PROXY === 'true',
    passTokenSecret,
    otpSecret,
    setupToken,
    sms: { provider: smsProvider, twilio, whatsapp },
    push: { provider: pushProvider, expoAccessToken: env.EXPO_ACCESS_TOKEN?.trim() || null },
    sessions: {
      staffIdleHours: int(env.STAFF_SESSION_IDLE_HOURS, 12),
      staffMaxDays: int(env.STAFF_SESSION_MAX_DAYS, 7),
      visitorMaxDays: int(env.VISITOR_SESSION_MAX_DAYS, 30),
      registrantMinutes: 30,
    },
    maintenanceIntervalSeconds: int(env.MAINTENANCE_INTERVAL_SECONDS, 60),
    // The __Host- prefix requires Secure, Path=/ and no Domain — strongest cookie scoping when served over HTTPS.
    cookieName: secureCookies ? '__Host-vms_session' : 'vms_session',
    secureCookies,
  };
}
