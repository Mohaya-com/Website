import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { arrivalRegistrations, settings as settingsTable, visitors } from '@vms/db';
import { addDaysToYmd, zonedDateString } from '@vms/shared';
import { runMaintenance } from '../services/maintenance';
import { call, createFixtures, createTestEnv, createVisitorWithSession, freshIp, scan, uniqueDocumentNumber, uniqueMobile, type TestEnv } from './helpers';

let env: TestEnv;
let fx: Awaited<ReturnType<typeof createFixtures>>;

beforeAll(async () => {
  env = createTestEnv();
  fx = await createFixtures(env);
});
afterAll(() => env.close());

const PNG = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'sample-iqama.png'));
const localMobile = (e164: string) => `0${e164.slice(4)}`;

function arrival(overrides: Record<string, unknown> = {}) {
  const today = zonedDateString(env.clock.now(), 'Asia/Riyadh');
  return {
    documentNumber: uniqueDocumentNumber(),
    mobile: localMobile(uniqueMobile()),
    villaNumber: fx.villa.number,
    reason: 'personal',
    durationMinutes: 120,
    gateCode: fx.gate.code,
    ...overrides,
  };
}

async function submit(body: Record<string, unknown>) {
  return call(env, 'POST', '/public/arrivals', { ip: freshIp(), body });
}
async function status(token: string) {
  return call(env, 'POST', '/public/arrivals/status', { ip: freshIp(), body: { token } });
}

describe('arrival registration without a verification code', () => {
  it('accepts a submission without any session and returns only a reference and a status token', async () => {
    const res = await submit(arrival({ idImage: { type: 'image/png', data: PNG.toString('base64') } }));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['reference', 'statusToken']);
    expect(res.body.reference).toMatch(/^AR-/);

    const s = await status(res.body.statusToken);
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ reference: res.body.reference, status: 'pending', pass: null });
    expect(JSON.stringify(s.body)).not.toContain('سالم');

    const [row] = await env.ctx.db.select().from(arrivalRegistrations).where(eq(arrivalRegistrations.reference, res.body.reference));
    expect(row!.idImage?.length).toBe(PNG.length);
    expect(row!.statusTokenHash).not.toBe(res.body.statusToken);
    expect((await status('x'.repeat(43))).status).toBe(404);
  });

  it('validates identity, mobile and image content', async () => {
    const badChecksum = await submit(arrival({ documentNumber: '1000000000' }));
    expect(badChecksum.status).toBe(400);
    expect(badChecksum.body.error.fields.documentNumber).toBeDefined();

    const fakeImage = await submit(arrival({ idImage: { type: 'image/jpeg', data: Buffer.from('<html>not an image</html>').toString('base64') } }));
    expect(fakeImage.status).toBe(400);
    expect(fakeImage.body.error.fields.idImage).toBe('validation.idImageType');

    const missingVilla = await submit(arrival({ villaNumber: '' }));
    expect(missingVilla.body.error.fields.villaNumber).toBeDefined();
    const badName = await submit(arrival({ fullName: 'x' }));
    expect(badName.body.error.fields.fullName).toBeDefined();
  });

  it('is reviewed by administrators only', async () => {
    const res = await submit(arrival());
    const list = await call(env, 'GET', '/arrivals?status=pending', { token: fx.admin.token });
    expect(list.status).toBe(200);
    expect(list.body.items.some((i: { reference: string }) => i.reference === res.body.reference)).toBe(true);
    expect(list.body.pendingCount).toBeGreaterThan(0);
    expect((await call(env, 'GET', '/arrivals', { token: fx.guard.token })).status).toBe(403);
    expect((await call(env, 'GET', '/arrivals')).status).toBe(401);
  });

  it('creates the profile and an approved visit with a pass on approval', async () => {
    const body = arrival({ villaNumber: `N-${Math.floor(Math.random() * 1e5)}`, idImage: { type: 'image/png', data: PNG.toString('base64') } });
    const res = await submit(body);
    const [row] = await env.ctx.db.select().from(arrivalRegistrations).where(eq(arrivalRegistrations.reference, res.body.reference));

    const image = await env.api.handle(new Request(`http://localhost:3000/api/v1/arrivals/${row!.id}/image`, { headers: { authorization: `Bearer ${fx.admin.token}` } }));
    expect(image.status).toBe(200);
    expect(image.headers.get('cache-control')).toContain('no-store');
    expect(Buffer.from(await image.arrayBuffer()).equals(PNG)).toBe(true);

    const detail = await call(env, 'GET', `/arrivals/${row!.id}`, { token: fx.admin.token });
    expect(detail.body).toMatchObject({ status: 'pending', documentNumber: body.documentNumber, documentType: 'national_id', fullName: null, nationality: null, documentExpiry: null, existingVisitor: null, hasImage: true });

    // Approval needs the name, nationality and expiry the administrator reads from the photo.
    const incomplete = await call(env, 'POST', `/arrivals/${row!.id}/approve`, { token: fx.admin.token, body: { ...detail.body, mobile: detail.body.mobile } });
    expect(incomplete.status).toBe(400);

    // The administrator corrects the name before approving.
    const approved = await call(env, 'POST', `/arrivals/${row!.id}/approve`, {
      token: fx.admin.token,
      body: { ...detail.body, fullName: 'سالم أحمد محمد القحطاني', nationality: 'SA', documentExpiry: { calendar: 'gregorian', date: addDaysToYmd(zonedDateString(env.clock.now(), 'Asia/Riyadh'), 400) }, mobile: detail.body.mobile },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    const [visitor] = await env.ctx.db.select().from(visitors).where(eq(visitors.documentNumber, body.documentNumber as string));
    expect(visitor!.fullName).toBe('سالم أحمد محمد القحطاني');
    expect(visitor!.documentType).toBe('national_id');

    const s = await status(res.body.statusToken);
    expect(s.body.status).toBe('approved');
    expect(s.body.visitStatus).toBe('approved');
    expect(s.body.pass.qrValue).toMatch(/\/p#/);
    expect(s.body.pass.villaNumber).toBe(body.villaNumber);

    // The pass works at the gate.
    const verified = await scan(env, fx.guard.token, 'verify', { qr: s.body.pass.qrValue, gateId: fx.gate.id, action: 'entry' });
    expect(verified.status).toBe(200);
    expect(verified.body.ok).toBe(true);

    const again = await call(env, 'POST', `/arrivals/${row!.id}/approve`, {
      token: fx.admin.token,
      body: { ...detail.body, fullName: 'سالم أحمد', nationality: 'SA', documentExpiry: { calendar: 'gregorian', date: '2030-01-01' } },
    });
    expect(again.status).toBe(409);
  });

  it('updates an existing profile instead of creating a duplicate, and never shows it to the submitter', async () => {
    const existing = await createVisitorWithSession(env, { mobile: uniqueMobile() });
    const newMobile = uniqueMobile();
    const res = await submit(arrival({ documentNumber: existing.visitor.documentNumber, mobile: localMobile(newMobile), fullName: 'اسم مختلف تماما' }));
    expect(res.status).toBe(200);
    const s = await status(res.body.statusToken);
    expect(JSON.stringify(s.body)).not.toContain(existing.visitor.fullName);

    const [row] = await env.ctx.db.select().from(arrivalRegistrations).where(eq(arrivalRegistrations.reference, res.body.reference));
    const detail = await call(env, 'GET', `/arrivals/${row!.id}`, { token: fx.admin.token });
    expect(detail.body.existingVisitor).toMatchObject({ id: existing.visitor.id, fullName: existing.visitor.fullName });

    // Keep the registered name, accept the new mobile.
    const approved = await call(env, 'POST', `/arrivals/${row!.id}/approve`, {
      token: fx.admin.token,
      body: { ...detail.body, fullName: existing.visitor.fullName, nationality: existing.visitor.nationality, documentExpiry: { calendar: 'gregorian', date: existing.visitor.documentExpiryDate }, mobile: detail.body.mobile },
    });
    expect(approved.status).toBe(200);
    const [v] = await env.ctx.db.select().from(visitors).where(eq(visitors.id, existing.visitor.id));
    expect(v!.mobile).toBe(newMobile);
    expect(v!.fullName).toBe(existing.visitor.fullName);
    expect(v!.version).toBe(existing.visitor.version + 1);
  });

  it('can be rejected with a reason the visitor sees', async () => {
    const res = await submit(arrival());
    const [row] = await env.ctx.db.select().from(arrivalRegistrations).where(eq(arrivalRegistrations.reference, res.body.reference));
    expect((await call(env, 'POST', `/arrivals/${row!.id}/reject`, { token: fx.admin.token, body: { reason: 'x' } })).status).toBe(400);
    const rejected = await call(env, 'POST', `/arrivals/${row!.id}/reject`, { token: fx.admin.token, body: { reason: 'صورة الهوية غير واضحة' } });
    expect(rejected.status).toBe(200);
    const s = await status(res.body.statusToken);
    expect(s.body).toMatchObject({ status: 'rejected', rejectReason: 'صورة الهوية غير واضحة', pass: null });
  });

  it('closes unreviewed requests after a day and deletes ID photos after the retention period', async () => {
    const res = await submit(arrival({ idImage: { type: 'image/png', data: PNG.toString('base64') } }));
    env.clock.advanceMinutes(25 * 60);
    await runMaintenance(env.ctx);
    const [closed] = await env.ctx.db.select().from(arrivalRegistrations).where(eq(arrivalRegistrations.reference, res.body.reference));
    expect(closed!.status).toBe('rejected');
    expect(closed!.idImage).not.toBeNull();

    env.clock.advanceMinutes(31 * 24 * 60);
    await runMaintenance(env.ctx);
    const [purged] = await env.ctx.db.select().from(arrivalRegistrations).where(eq(arrivalRegistrations.reference, res.body.reference));
    expect(purged!.idImage).toBeNull();
    expect(purged!.idImageRemovedAt).not.toBeNull();
  });

  it('can be switched off in the settings', async () => {
    await env.ctx.db.insert(settingsTable).values({ key: 'allowArrivalRegistration', value: false }).onConflictDoUpdate({ target: settingsTable.key, set: { value: false } });
    env.ctx.cache.settings = null;
    try {
      const res = await submit(arrival());
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('arrival_registration_disabled');
      expect((await call(env, 'GET', '/public/config')).body.allowArrivalRegistration).toBe(false);
    } finally {
      await env.ctx.db.delete(settingsTable).where(eq(settingsTable.key, 'allowArrivalRegistration'));
      env.ctx.cache.settings = null;
    }
  });

  it('reads the identity number, name, nationality and expiry from an ID photo', async () => {
    const res = await call(env, 'POST', '/public/arrivals/scan', { ip: freshIp(), body: { idImage: { type: 'image/png', data: PNG.toString('base64') } } });
    expect(res.status).toBe(200);
    expect(res.body.recognized).toBe(true);
    expect(res.body.fields).toMatchObject({ documentNumber: '2345678904', documentType: 'iqama', nationality: 'EG', expiry: { calendar: 'gregorian', date: '2027-03-18' } });
    expect(res.body.fields.fullName).toBe('Sample Test Person');
  }, 60_000);
});
