import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withLuhnCheckDigit as withLuhnCheckDigitForTest } from '@vms/shared';
import { call, createFixtures, createTestEnv, freshIp, type TestEnv } from './helpers';

let env: TestEnv;
let fx: Awaited<ReturnType<typeof createFixtures>>;

beforeAll(async () => {
  env = createTestEnv();
  fx = await createFixtures(env);
});
afterAll(() => env.close());

const PNG = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'sample-iqama.png'));
const PASSWORD = 'Villa-pass-2026';

function villaNumber() {
  return `R-${Math.floor(Math.random() * 1e6)}`;
}

async function signup(number: string, extra: Record<string, unknown> = {}) {
  return call(env, 'POST', '/auth/resident/signup', { ip: freshIp(), body: { villaNumber: number, password: PASSWORD, passwordConfirm: PASSWORD, fullName: 'سالم القحطاني', mobile: '0551234567', ...extra } });
}
async function login(number: string, password = PASSWORD) {
  return call(env, 'POST', '/auth/resident/login', { ip: freshIp(), body: { username: number, password, client: 'mobile' } });
}
async function approvedResident() {
  const number = villaNumber();
  await signup(number);
  const list = await call(env, 'GET', '/residents?status=pending', { token: fx.admin.token });
  const r = list.body.items.find((i: { villaNumber: string }) => i.villaNumber === number);
  await call(env, 'POST', `/residents/${r.id}/decision`, { token: fx.admin.token, body: { action: 'approve' } });
  const res = await login(number);
  return { number, id: r.id as string, token: res.body.token as string };
}

describe('resident accounts', () => {
  it('signs up with the villa number, waits for approval, then signs in with the villa number', async () => {
    const number = villaNumber();
    expect((await signup(number)).body).toEqual({ status: 'pending' });
    // Pending: the right password tells them to wait; a wrong one says nothing more.
    expect((await login(number)).body.error.code).toBe('resident_pending');
    expect((await login(number, 'Wrong-pass-123')).body.error.code).toBe('invalid_credentials');

    const list = await call(env, 'GET', '/residents?status=pending', { token: fx.admin.token });
    const r = list.body.items.find((i: { villaNumber: string }) => i.villaNumber === number);
    expect(r).toMatchObject({ status: 'pending', fullName: 'سالم القحطاني', mobile: '+966551234567' });
    expect((await call(env, 'POST', `/residents/${r.id}/decision`, { token: fx.guard.token, body: { action: 'approve' } })).status).toBe(403);
    await call(env, 'POST', `/residents/${r.id}/decision`, { token: fx.admin.token, body: { action: 'approve' } });

    const ok = await login(number);
    expect(ok.status).toBe(200);
    expect(ok.body.session).toMatchObject({ kind: 'resident', role: 'resident', resident: { villaNumber: number } });
    // Approval copies the resident's name and phone to the villa contact.
    const villa = await call(env, 'GET', '/resident/villa', { token: ok.body.token });
    expect(villa.body).toEqual({ villaNumber: number, ownerName: 'سالم القحطاني', ownerMobile: '+966551234567' });
  });

  it('refuses a second registration for the same villa until an administrator removes the account', async () => {
    const number = villaNumber();
    await signup(number);
    const again = await signup(number, { fullName: 'شخص آخر' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('villa_registered');

    const list = await call(env, 'GET', '/residents', { token: fx.admin.token });
    const r = list.body.items.find((i: { villaNumber: string }) => i.villaNumber === number);
    await call(env, 'DELETE', `/residents/${r.id}`, { token: fx.admin.token });
    expect((await signup(number, { fullName: 'شخص آخر' })).status).toBe(200);
  });

  it('keeps residents out of staff and visitor areas, and disabling ends their sessions', async () => {
    const r = await approvedResident();
    expect((await call(env, 'GET', '/gate/inside', { token: r.token })).status).toBe(403);
    expect((await call(env, 'GET', '/visits', { token: r.token })).status).toBe(403);
    expect((await call(env, 'GET', '/villas/options', { token: r.token })).status).toBe(403);
    expect((await call(env, 'GET', '/resident/visitors', { token: fx.guard.token })).status).toBe(403);

    await call(env, 'POST', `/residents/${r.id}/decision`, { token: fx.admin.token, body: { action: 'disable' } });
    expect((await call(env, 'GET', '/resident/villa', { token: r.token })).status).toBe(401);
    expect((await login(r.number)).body.error.code).toBe('resident_disabled');
  });

  it('lets the resident change only the villa contact name and phone', async () => {
    const r = await approvedResident();
    const res = await call(env, 'PUT', '/resident/villa', { token: r.token, body: { ownerName: 'أبو سالم', ownerMobile: '0559998877', number: 'HACK' } });
    expect(res.body).toEqual({ villaNumber: r.number, ownerName: 'أبو سالم', ownerMobile: '+966559998877' });
    const gate = await call(env, 'GET', `/gate/villa?number=${encodeURIComponent(r.number)}`, { token: fx.guard.token });
    expect(gate.body.villa).toMatchObject({ number: r.number, ownerName: 'أبو سالم', ownerMobile: '+966559998877' });
  });
});

describe('resident invitations and the gate', () => {
  it('invites a visitor, who is checked in by scanning the QR, then appears inside and exits with one tap', async () => {
    const r = await approvedResident();
    const expectedAt = new Date(env.clock.now().getTime() + 3_600_000).toISOString();
    const inv = await call(env, 'POST', '/resident/invites', { token: r.token, body: { fullName: 'خالد الزائر', mobile: '0501231234', expectedAt } });
    expect(inv.status).toBe(200);
    expect(inv.body.invite).toMatchObject({ status: 'expected', fullName: 'خالد الزائر', invitedByResident: true, ownerResponse: 'confirmed', enteredAt: null });
    expect(inv.body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/966501231234\?text=/);

    // The visitor's page shows the QR.
    const token = inv.body.inviteLink.split('#')[1];
    const pass = await call(env, 'POST', '/public/invites/view', { ip: freshIp(), body: { token } });
    expect(pass.body).toMatchObject({ villaNumber: r.number, fullName: 'خالد الزائر', status: 'expected' });

    // The gate sees it under the villa, then scans it.
    const villa = await call(env, 'GET', `/gate/villa?number=${encodeURIComponent(r.number)}`, { token: fx.guard.token });
    expect(villa.body.expected.map((e: { id: string }) => e.id)).toContain(inv.body.invite.id);
    const scan = await call(env, 'POST', '/gate/qr', { token: fx.guard.token, body: { qr: pass.body.qrValue, gateId: fx.gate.id } });
    expect(scan.body).toMatchObject({ kind: 'invite', alreadyInside: false, entry: { status: 'inside', enteredBy: expect.any(String) } });
    expect((await call(env, 'POST', '/gate/qr', { token: fx.guard.token, body: { qr: pass.body.qrValue } })).body.alreadyInside).toBe(true);

    const inside = await call(env, 'GET', '/gate/inside', { token: fx.guard.token });
    expect(inside.body.entries.map((e: { id: string }) => e.id)).toContain(inv.body.invite.id);
    const visitors = await call(env, 'GET', '/resident/visitors', { token: r.token });
    expect(visitors.body.inside.map((e: { id: string }) => e.id)).toContain(inv.body.invite.id);

    await call(env, 'POST', `/gate/entries/${inv.body.invite.id}/exit`, { token: fx.guard.token });
    const after = await call(env, 'GET', '/resident/visitors', { token: r.token });
    expect(after.body.past.map((e: { id: string }) => e.id)).toContain(inv.body.invite.id);
    expect(after.body.upcoming).toHaveLength(0);
  });

  it('lets the resident confirm a visitor the gate recorded, and cancel an invitation before arrival', async () => {
    const r = await approvedResident();
    const entry = await call(env, 'POST', '/gate/entries', { token: fx.guard.token, body: { villaNumber: r.number, idImage: { type: 'image/png', data: PNG.toString('base64') }, fullName: 'زائر البوابة' } });
    const pending = await call(env, 'GET', '/resident/confirmations', { token: r.token });
    expect(pending.body.items.map((e: { id: string }) => e.id)).toEqual([entry.body.entry.id]);
    const confirmed = await call(env, 'POST', `/resident/entries/${entry.body.entry.id}/respond`, { token: r.token, body: { response: 'confirmed' } });
    expect(confirmed.body.ownerResponse).toBe('confirmed');
    expect((await call(env, 'GET', '/resident/confirmations', { token: r.token })).body.items).toHaveLength(0);

    // Another villa's resident cannot see or answer it.
    const other = await approvedResident();
    expect((await call(env, 'POST', `/resident/entries/${entry.body.entry.id}/respond`, { token: other.token, body: { response: 'declined' } })).status).toBe(404);

    const inv = await call(env, 'POST', '/resident/invites', { token: r.token, body: { fullName: 'زائر ملغى', expectedAt: env.clock.now().toISOString() } });
    expect((await call(env, 'POST', `/resident/invites/${inv.body.invite.id}/cancel`, { token: r.token })).body.status).toBe('cancelled');
    const token = inv.body.inviteLink.split('#')[1];
    const scan = await call(env, 'POST', '/gate/qr', { token: fx.guard.token, body: { qr: inv.body.inviteLink.replace(/#.*/, `#${token}`) } });
    expect(scan.body.error.code).toBe('invite_not_valid');
  });

  it('reads an identity number from any QR text and recognises visit passes', async () => {
    const number = withLuhnCheckDigitForTest('104734313');
    expect((await call(env, 'POST', '/gate/qr', { token: fx.guard.token, body: { qr: `ID:${number};NAME:X` } })).body).toEqual({ kind: 'identity', documentNumber: number, documentType: 'national_id' });
    expect((await call(env, 'POST', '/gate/qr', { token: fx.guard.token, body: { qr: 'https://example.com/p#abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG' } })).body.kind).toBe('pass');
    expect((await call(env, 'POST', '/gate/qr', { token: fx.guard.token, body: { qr: 'hello' } })).body.kind).toBe('unknown');
  });
});

describe('maintenance requests', () => {
  it('are raised by residents and handled by administrators', async () => {
    const r = await approvedResident();
    const created = await call(env, 'POST', '/resident/maintenance', { token: r.token, body: { category: 'ac', description: 'المكيف لا يبرد في الصالة' } });
    expect(created.body).toMatchObject({ status: 'open', category: 'ac', villaNumber: r.number, reference: expect.stringMatching(/^MR-/) });
    expect((await call(env, 'POST', '/resident/maintenance', { token: r.token, body: { category: 'ac', description: 'x' } })).status).toBe(400);

    const admin = await call(env, 'GET', '/maintenance?status=open', { token: fx.admin.token });
    expect(admin.body.items.map((m: { id: string }) => m.id)).toContain(created.body.id);
    expect((await call(env, 'GET', '/maintenance', { token: fx.guard.token })).status).toBe(403);
    const updated = await call(env, 'PATCH', `/maintenance/${created.body.id}`, { token: fx.admin.token, body: { status: 'in_progress', adminNote: 'الفني في الطريق' } });
    expect(updated.body).toMatchObject({ status: 'in_progress', adminNote: 'الفني في الطريق' });

    const mine = await call(env, 'GET', '/resident/maintenance', { token: r.token });
    expect(mine.body.items[0]).toMatchObject({ id: created.body.id, status: 'in_progress' });
    // Only open requests can be cancelled by the resident.
    expect((await call(env, 'POST', `/resident/maintenance/${created.body.id}/cancel`, { token: r.token })).status).toBe(409);
  });
});
