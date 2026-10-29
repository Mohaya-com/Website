import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLogs, settings as settingsTable } from '@vms/db';
import { ManualClock } from '../clock';
import { loadConfig, loadRootEnv } from '../config';
import { createServerContext } from '../context';
import { createApi } from '../http/api';
import { NoopPushProvider } from '../providers/push';
import { DevSmsProvider, DisabledSmsProvider } from '../providers/sms';
import { WHATSAPP_SETTINGS_KEY } from '../services/whatsapp';
import { BASE_TIME, call, createStaffUser, freshIp, uniqueDocumentNumber, uniqueMobile, type TestEnv } from './helpers';

const TOKEN = 'EAAGtestTOKENvalue1234567890abcdWXYZ';
const WABA = '102290129340398';
const PHONE_ID = '105954558954427';

/** In-memory stand-in for the Graph API endpoints the integration uses. */
const graph = {
  templates: [] as { id: string; name: string; language: string; status: string; category: string }[],
  calls: [] as { method: string; path: string; body: any }[],
  sendError: null as null | { status: number; body: unknown },
  reset() {
    this.templates = [];
    this.calls = [];
    this.sendError = null;
  },
};

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeGraph(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== 'graph.facebook.com') throw new Error(`unexpected fetch to ${url.hostname}`);
  const method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  const path = url.pathname.replace(/^\/v\d+\.\d\//, '');
  graph.calls.push({ method, path, body });
  const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
  if (auth !== `Bearer ${TOKEN}`) return Promise.resolve(respond(401, { error: { message: 'Invalid OAuth access token - Cannot parse access token', type: 'OAuthException', code: 190 } }));
  if (method === 'GET' && path === `${WABA}/phone_numbers`) {
    return Promise.resolve(respond(200, { data: [{ id: PHONE_ID, display_phone_number: '+1 555-010-4477', verified_name: 'Test Number' }] }));
  }
  if (path.endsWith('/phone_numbers')) return Promise.resolve(respond(400, { error: { message: 'Unsupported get request.', code: 100, error_subcode: 33 } }));
  if (method === 'GET' && path === `${WABA}/message_templates`) {
    return Promise.resolve(respond(200, { data: graph.templates.filter((t) => t.name === url.searchParams.get('name')) }));
  }
  if (method === 'POST' && path === `${WABA}/message_templates`) {
    const created = { id: '594425479261596', name: body.name, language: body.language, status: 'PENDING', category: 'AUTHENTICATION' };
    graph.templates.push(created);
    return Promise.resolve(respond(200, { id: created.id, status: created.status, category: created.category }));
  }
  if (method === 'POST' && path === `${PHONE_ID}/messages`) {
    if (graph.sendError) return Promise.resolve(respond(graph.sendError.status, graph.sendError.body));
    return Promise.resolve(respond(200, { messaging_product: 'whatsapp', contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: 'wamid.TEST' }] }));
  }
  return Promise.resolve(respond(404, { error: { message: 'Unknown path', code: 100 } }));
}

function createEnv(smsProvider: 'disabled' | 'dev'): TestEnv {
  loadRootEnv();
  const config = loadConfig({ ...process.env, NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL!, TRUST_PROXY: 'true', APP_ORIGIN: 'http://localhost:3000', SMS_PROVIDER: smsProvider, PUSH_PROVIDER: 'none' });
  const clock = new ManualClock(BASE_TIME);
  const sms = smsProvider === 'dev' ? new DevSmsProvider() : new DisabledSmsProvider();
  const ctx = createServerContext({ config: { ...config, databasePoolMax: 10 }, clock, sms, push: new NoopPushProvider() });
  return { ctx, api: createApi(ctx), clock, sms: sms as DevSmsProvider, close: () => ctx.close() };
}

let env: TestEnv;
let adminToken: string;
let guardToken: string;

beforeAll(async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(fakeGraph as typeof fetch);
  env = createEnv('disabled');
  await env.ctx.db.delete(settingsTable).where(eq(settingsTable.key, WHATSAPP_SETTINGS_KEY));
  adminToken = (await createStaffUser(env, 'admin')).token;
  guardToken = (await createStaffUser(env, 'security')).token;
});
afterAll(async () => {
  await env.ctx.db.delete(settingsTable).where(eq(settingsTable.key, WHATSAPP_SETTINGS_KEY));
  await env.close();
  vi.restoreAllMocks();
});
beforeEach(() => {
  graph.calls = [];
  graph.sendError = null;
});

const config = { phoneNumberId: PHONE_ID, businessAccountId: WABA, accessToken: TOKEN };
const localMobile = (e164: string) => `0${e164.slice(4)}`;

describe('WhatsApp connection from the admin settings', () => {
  it('is restricted to administrators', async () => {
    expect((await call(env, 'GET', '/settings/whatsapp', { token: guardToken })).status).toBe(403);
    expect((await call(env, 'PUT', '/settings/whatsapp', { token: guardToken, body: config })).status).toBe(403);
    expect((await call(env, 'POST', '/settings/whatsapp/test', { token: guardToken, body: { mobile: '0501234567' } })).status).toBe(403);
    expect((await call(env, 'GET', '/settings/whatsapp')).status).toBe(401);
  });

  it('explains a wrong token or mismatched IDs without saving anything', async () => {
    const badToken = await call(env, 'PUT', '/settings/whatsapp', { token: adminToken, body: { ...config, accessToken: 'EAAGwrongTOKEN0000000000000000' } });
    expect(badToken.status).toBe(400);
    expect(badToken.body.error.code).toBe('whatsapp_token_invalid');

    const swapped = await call(env, 'PUT', '/settings/whatsapp', { token: adminToken, body: { ...config, phoneNumberId: WABA, businessAccountId: PHONE_ID } });
    expect(swapped.status).toBe(400);
    expect(swapped.body.error.code).toBe('whatsapp_wrong_id');

    const otherPhone = await call(env, 'PUT', '/settings/whatsapp', { token: adminToken, body: { ...config, phoneNumberId: '999999999999' } });
    expect(otherPhone.body.error.code).toBe('whatsapp_phone_not_in_account');

    const status = await call(env, 'GET', '/settings/whatsapp', { token: adminToken });
    expect(status.body.configured).toBe(false);
  });

  it('verifies the account, creates the authentication template and stores the token encrypted', async () => {
    graph.reset();
    const res = await call(env, 'PUT', '/settings/whatsapp', { token: adminToken, ip: freshIp(), body: { ...config, phoneNumberId: ' ١٠٥٩٥٤٥٥٨٩٥٤٤٢٧ ' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, enabled: false, active: false, phoneNumberId: PHONE_ID, templateName: 'otp_code', templateLanguage: 'ar', templateStatus: 'PENDING', verifiedName: 'Test Number', tokenHint: '…WXYZ', tokenReadable: true });
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);

    const create = graph.calls.find((c) => c.method === 'POST' && c.path === `${WABA}/message_templates`);
    expect(create?.body).toMatchObject({ name: 'otp_code', language: 'ar', category: 'AUTHENTICATION' });
    expect(create?.body.components).toContainEqual({ type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] });

    const [row] = await env.ctx.db.select().from(settingsTable).where(eq(settingsTable.key, WHATSAPP_SETTINGS_KEY));
    expect(JSON.stringify(row!.value)).not.toContain(TOKEN);
    const auditRows = await env.ctx.db.select().from(auditLogs).where(like(auditLogs.action, 'whatsapp.%'));
    expect(auditRows.some((r) => r.action === 'whatsapp.configured')).toBe(true);
    expect(JSON.stringify(auditRows)).not.toContain(TOKEN);

    // Saving again without a token keeps the stored one and does not create a second template.
    graph.calls = [];
    const again = await call(env, 'PUT', '/settings/whatsapp', { token: adminToken, body: { phoneNumberId: PHONE_ID, businessAccountId: WABA, accessToken: '' } });
    expect(again.status).toBe(200);
    expect(graph.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('cannot be turned on until Meta approves the template', async () => {
    const res = await call(env, 'POST', '/settings/whatsapp/enabled', { token: adminToken, body: { enabled: true } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('whatsapp_template_not_approved');
    expect((await call(env, 'GET', '/public/config')).body.sms).toEqual({ provider: 'disabled', available: false, developmentMode: false });
    expect((await call(env, 'POST', '/auth/visitor/request-otp', { ip: freshIp(), body: { documentType: 'national_id', documentNumber: uniqueDocumentNumber(), mobile: localMobile(uniqueMobile()) } })).status).toBe(503);
  });

  it('sends a test message and reports Meta errors in plain language', async () => {
    const ok = await call(env, 'POST', '/settings/whatsapp/test', { token: adminToken, body: { mobile: '0501234567' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, messageId: 'wamid.TEST' });
    const sent = graph.calls.find((c) => c.path === `${PHONE_ID}/messages`)!;
    expect(sent.body.to).toBe('966501234567');
    expect(sent.body.template.name).toBe('otp_code');

    graph.sendError = { status: 400, body: { error: { message: '(#131030) Recipient phone number +966501234567 not in allowed list', code: 131030 } } };
    const blocked = await call(env, 'POST', '/settings/whatsapp/test', { token: adminToken, body: { mobile: '0501234567' } });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe('whatsapp_recipient_not_allowed');
    expect(JSON.stringify(blocked.body)).not.toContain('501234567');
    const status = await call(env, 'GET', '/settings/whatsapp', { token: adminToken });
    expect(status.body.lastTest).toMatchObject({ ok: false });
    expect(status.body.lastTest.error).not.toContain('501234567');

    const invalid = await call(env, 'POST', '/settings/whatsapp/test', { token: adminToken, body: { mobile: '12' } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.fields.mobile).toBeDefined();
  });

  it('delivers visitor verification codes over WhatsApp once enabled', async () => {
    graph.templates.forEach((t) => (t.status = 'APPROVED'));
    const on = await call(env, 'POST', '/settings/whatsapp/enabled', { token: adminToken, body: { enabled: true } });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ enabled: true, active: true, templateStatus: 'APPROVED' });
    expect((await call(env, 'GET', '/public/config')).body.sms).toEqual({ provider: 'whatsapp', available: true, developmentMode: false });

    const mobile = uniqueMobile();
    const req = await call(env, 'POST', '/auth/visitor/request-otp', { ip: freshIp(), body: { documentType: 'national_id', documentNumber: uniqueDocumentNumber(), mobile: localMobile(mobile) } });
    expect(req.status).toBe(200);
    expect(req.body.developmentDelivery).toBe(false);
    const message = await vi.waitFor(() => {
      const m = graph.calls.find((c) => c.path === `${PHONE_ID}/messages` && c.body.to === mobile.slice(1));
      if (!m) throw new Error('not sent yet');
      return m;
    });
    const code = message.body.template.components[0].parameters[0].text as string;
    expect(code).toMatch(/^\d{6}$/);
    expect(message.body.template.components[1]).toEqual({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] });

    const verify = await call(env, 'POST', '/auth/visitor/verify-otp', { ip: freshIp(), body: { challengeId: req.body.challengeId, code, client: 'mobile' } });
    expect(verify.status).toBe(200);
  });

  it('shows the last delivery failure to administrators without the visitor number', async () => {
    graph.sendError = { status: 400, body: { error: { message: 'Message failed to send to 966512345678', code: 131026 } } };
    await call(env, 'POST', '/auth/visitor/request-otp', { ip: freshIp(), body: { documentType: 'national_id', documentNumber: uniqueDocumentNumber(), mobile: '0512345678' } });
    const status = await vi.waitFor(async () => {
      const s = await call(env, 'GET', '/settings/whatsapp', { token: adminToken });
      if (!s.body.lastDeliveryError) throw new Error('not recorded yet');
      return s.body;
    });
    expect(status.lastDeliveryError.error).toContain('131026');
    expect(status.lastDeliveryError.error).not.toContain('512345678');
  });

  it('can be turned off and removed', async () => {
    const off = await call(env, 'POST', '/settings/whatsapp/enabled', { token: adminToken, body: { enabled: false } });
    expect(off.body).toMatchObject({ enabled: false, active: false });
    expect((await call(env, 'GET', '/public/config')).body.sms.available).toBe(false);

    const removed = await call(env, 'DELETE', '/settings/whatsapp', { token: adminToken });
    expect(removed.status).toBe(200);
    expect(removed.body.configured).toBe(false);
    const actions = (await env.ctx.db.select().from(auditLogs).where(like(auditLogs.action, 'whatsapp.%'))).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['whatsapp.configured', 'whatsapp.test_sent', 'whatsapp.test_failed', 'whatsapp.enabled', 'whatsapp.disabled', 'whatsapp.removed']));
  });

  it('never overrides a provider configured in the server environment', async () => {
    const devEnv = createEnv('dev');
    try {
      const admin = await createStaffUser(devEnv, 'admin');
      const saved = await call(devEnv, 'PUT', '/settings/whatsapp', { token: admin.token, body: config });
      expect(saved.body).toMatchObject({ environmentProvider: 'dev', configured: true, active: false });
      await call(devEnv, 'POST', '/settings/whatsapp/enabled', { token: admin.token, body: { enabled: true } });
      expect((await call(devEnv, 'GET', '/public/config')).body.sms.provider).toBe('dev');
      await call(devEnv, 'DELETE', '/settings/whatsapp', { token: admin.token });
    } finally {
      await devEnv.close();
    }
  });
});
