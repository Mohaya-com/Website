import { OTP } from '@vms/shared';

/**
 * Minimal WhatsApp Cloud API (Meta Graph API) client: phone number lookup, the authentication
 * template (copy-code button) and sending a verification code. Object IDs are validated as digits
 * before they reach a URL, and nothing returned by Meta is logged verbatim.
 */

const GRAPH_ORIGIN = 'https://graph.facebook.com';
const TIMEOUT_MS = 10_000;

export interface GraphAuth {
  accessToken: string;
  apiVersion: string;
}

export interface WhatsAppConnection extends GraphAuth {
  phoneNumberId: string;
  templateName: string;
  templateLanguage: string;
}

/** An error response from the Graph API. `detail` has phone-number-like digit runs removed. */
export class GraphApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly detail: string,
  ) {
    super(`WhatsApp Cloud API error HTTP ${httpStatus}${code !== null ? ` (#${code}${subcode ? `/${subcode}` : ''})` : ''}: ${detail}`);
    this.name = 'GraphApiError';
  }
}

export class GraphUnreachableError extends Error {
  constructor(cause: unknown) {
    super(`WhatsApp Cloud API unreachable: ${cause instanceof Error ? cause.name : 'error'}`);
    this.name = 'GraphUnreachableError';
  }
}

/** Removes digit runs that could be phone numbers from text returned by Meta. */
export function scrubDigits(text: string): string {
  return text.replace(/\+?\d[\d\s-]{5,}\d/g, '…').slice(0, 300);
}

async function graph<T>(auth: GraphAuth, method: 'GET' | 'POST', path: string, options: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const url = new URL(`${GRAPH_ORIGIN}/${auth.apiVersion}/${path}`);
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${auth.accessToken}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : null,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new GraphUnreachableError(err);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  const error = (data as { error?: Record<string, unknown> } | null)?.error;
  if (!res.ok || error) {
    const e = error ?? {};
    const message = typeof e.error_user_msg === 'string' && e.error_user_msg ? e.error_user_msg : typeof e.message === 'string' ? e.message : `HTTP ${res.status}`;
    throw new GraphApiError(res.status, typeof e.code === 'number' ? e.code : null, typeof e.error_subcode === 'number' ? e.error_subcode : null, scrubDigits(message));
  }
  return data as T;
}

export interface BusinessPhoneNumber {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
}

/** Phone numbers of a WhatsApp Business Account. Also proves the token can manage that account. */
export async function listPhoneNumbers(auth: GraphAuth, businessAccountId: string): Promise<BusinessPhoneNumber[]> {
  const res = await graph<{ data?: BusinessPhoneNumber[] }>(auth, 'GET', `${businessAccountId}/phone_numbers`, {
    query: { fields: 'id,display_phone_number,verified_name', limit: '100' },
  });
  return res.data ?? [];
}

export interface MessageTemplate {
  id?: string;
  name: string;
  language: string;
  status: string;
  category?: string;
}

export async function findTemplate(auth: GraphAuth, businessAccountId: string, name: string, language: string): Promise<MessageTemplate | null> {
  const res = await graph<{ data?: MessageTemplate[] }>(auth, 'GET', `${businessAccountId}/message_templates`, {
    query: { name, fields: 'id,name,language,status,category', limit: '100' },
  });
  return res.data?.find((t) => t.name === name && t.language === language) ?? null;
}

/** Creates the authentication template: preset body with the code, security line, expiry footer and a copy-code button. */
export async function createAuthTemplate(auth: GraphAuth, businessAccountId: string, name: string, language: string): Promise<MessageTemplate> {
  const res = await graph<{ id?: string; status?: string; category?: string }>(auth, 'POST', `${businessAccountId}/message_templates`, {
    body: {
      name,
      language,
      category: 'AUTHENTICATION',
      components: [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: Math.max(1, Math.round(OTP.ttlSeconds / 60)) },
        { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
      ],
    },
  });
  return { id: res.id, name, language, status: res.status ?? 'PENDING', category: res.category };
}

/** Sends the verification code with the authentication template. Returns the WhatsApp message id. */
export async function sendAuthCode(conn: WhatsAppConnection, to: string, code: string): Promise<string | null> {
  const res = await graph<{ messages?: { id?: string }[] }>(conn, 'POST', `${conn.phoneNumberId}/messages`, {
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: conn.templateName,
        language: { code: conn.templateLanguage },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    },
  });
  return res.messages?.[0]?.id ?? null;
}
