import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, quickEntries } from '@vms/db';
import { runMaintenance } from '../services/maintenance';
import { call, createFixtures, createTestEnv, freshIp, type TestEnv } from './helpers';

let env: TestEnv;
let fx: Awaited<ReturnType<typeof createFixtures>>;

beforeAll(async () => {
  env = createTestEnv();
  fx = await createFixtures(env);
});
afterAll(() => env.close());

const PNG = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'sample-iqama.png'));
const image = { type: 'image/png', data: PNG.toString('base64') };

async function enter(body: Record<string, unknown>, token = fx.guard.token) {
  return call(env, 'POST', '/gate/entries', { token, body: { idImage: image, ...body } });
}

describe('gate quick entry (security)', () => {
  it('reads the photo for the guard to check', async () => {
    const res = await call(env, 'POST', '/gate/scan', { token: fx.guard.token, body: { idImage: image } });
    expect(res.status).toBe(200);
    expect(res.body.fields).toMatchObject({ documentNumber: '2345678904', documentKind: 'iqama' });
  }, 60_000);

  it('records an entry from a photo and a villa number, with the time set automatically', async () => {
    const before = env.clock.now().toISOString();
    const res = await enter({ villaNumber: fx.villa.number.toLowerCase(), gateId: fx.gate.id });
    expect(res.status).toBe(200);
    expect(res.body.entry).toMatchObject({ status: 'inside', villaNumber: fx.villa.number, fullName: null, hasImage: true, enteredBy: expect.any(String) });
    expect(res.body.entry.enteredAt).toBe(before);
    expect(res.body.ownerLink).toMatch(/\/v#[A-Za-z0-9_-]{20,}$/);
    expect(res.body.ownerWhatsappUrl).toBeNull();

    const inside = await call(env, 'GET', '/gate/inside', { token: fx.guard.token });
    expect(inside.body.entries.some((e: { id: string }) => e.id === res.body.entry.id)).toBe(true);
  });

  it('requires the photo and the villa number, and refuses disabled villas', async () => {
    expect((await call(env, 'POST', '/gate/entries', { token: fx.guard.token, body: { villaNumber: '12' } })).body.error.fields.idImage).toBeDefined();
    expect((await enter({ villaNumber: '' })).body.error.fields.villaNumber).toBeDefined();
    const number = `Z-${Math.floor(Math.random() * 1e5)}`;
    await call(env, 'POST', '/villas', { token: fx.admin.token, body: { number, isActive: false } });
    expect((await enter({ villaNumber: number })).body.error.fields.villaNumber).toBe('errors.villa_inactive');
  });

  it('records the exit with one tap, and a second tap changes nothing', async () => {
    const { body } = await enter({ villaNumber: fx.villa.number, fullName: 'Sample Test Person', documentKind: 'passport', documentNumber: 'l898902c3' });
    expect(body.entry).toMatchObject({ documentKind: 'passport', documentNumber: 'L898902C3', fullName: 'Sample Test Person' });
    env.clock.advanceMinutes(45);
    const out = await call(env, 'POST', `/gate/entries/${body.entry.id}/exit`, { token: fx.guard.token });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: 'exited', exitedAt: env.clock.now().toISOString() });
    const again = await call(env, 'POST', `/gate/entries/${body.entry.id}/exit`, { token: fx.guard.token });
    expect(again.body.exitedAt).toBe(out.body.exitedAt);
    const inside = await call(env, 'GET', '/gate/inside', { token: fx.guard.token });
    expect(inside.body.entries.some((e: { id: string }) => e.id === body.entry.id)).toBe(false);
    const actions = (await env.ctx.db.select().from(auditLogs).where(eq(auditLogs.entityId, body.entry.id))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['gate.quick_entry', 'gate.quick_exit']));
  });

  it('lets the villa owner confirm through the private link, and offers WhatsApp when the owner mobile is known', async () => {
    const number = `O-${Math.floor(Math.random() * 1e5)}`;
    const villa = await call(env, 'POST', '/villas', { token: fx.admin.token, body: { number, ownerName: 'مالك', ownerMobile: '0501112233' } });
    expect(villa.body.ownerMobile).toBe('+966501112233');
    // Owner contact is never exposed to visitors through the public villa options.
    const options = await call(env, 'GET', '/villas/options', { token: fx.guard.token });
    expect(JSON.stringify(options.body)).not.toContain('501112233');

    const { body } = await enter({ villaNumber: number, fullName: 'Visitor Name' });
    expect(body.ownerWhatsappUrl).toMatch(/^https:\/\/wa\.me\/966501112233\?text=/);
    const token = body.ownerLink.split('#')[1];

    const view = await call(env, 'POST', '/public/owner/view', { ip: freshIp(), body: { token } });
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ villaNumber: number, fullName: 'Visitor Name', status: 'inside', response: null });
    expect(JSON.stringify(view.body)).not.toContain('base64');

    const confirmed = await call(env, 'POST', '/public/owner/respond', { ip: freshIp(), body: { token, response: 'confirmed' } });
    expect(confirmed.body.response).toBe('confirmed');
    const entry = await call(env, 'GET', `/gate/entries/${body.entry.id}`, { token: fx.guard.token });
    expect(entry.body.entry.ownerResponse).toBe('confirmed');
    expect((await call(env, 'POST', '/public/owner/view', { ip: freshIp(), body: { token: 'x'.repeat(43) } })).status).toBe(404);
  });

  it('is limited to staff, serves the photo privately, and deletes it after the retention period', async () => {
    const { body } = await enter({ villaNumber: fx.villa.number });
    expect((await call(env, 'GET', '/gate/inside')).status).toBe(401);
    const img = await env.api.handle(new Request(`http://localhost:3000/api/v1/gate/entries/${body.entry.id}/image`, { headers: { authorization: `Bearer ${fx.guard.token}` } }));
    expect(img.status).toBe(200);
    expect(img.headers.get('cache-control')).toContain('no-store');

    await call(env, 'POST', `/gate/entries/${body.entry.id}/exit`, { token: fx.guard.token });
    env.clock.advanceMinutes(31 * 24 * 60);
    await runMaintenance(env.ctx);
    const [row] = await env.ctx.db.select().from(quickEntries).where(eq(quickEntries.id, body.entry.id));
    expect(row!.idImage).toBeNull();
    expect(row!.idImageRemovedAt).not.toBeNull();
  });

});
