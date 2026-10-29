import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approve,
  call,
  createFixtures,
  createTestEnv,
  createVisitorWithSession,
  gateEventCount,
  minutes,
  passQr,
  scan,
  submitAsVisitor,
  visitRow,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let fx: Awaited<ReturnType<typeof createFixtures>>;

beforeAll(async () => {
  env = createTestEnv();
  fx = await createFixtures(env);
});
afterAll(() => env.close());

describe('approval is required for entry', () => {
  it('refuses entry for a pending request and records nothing', async () => {
    const { token } = await createVisitorWithSession(env);
    const visit = await submitAsVisitor(env, token, fx.villa.id, minutes(env.clock.now(), 30));
    expect(visit.status).toBe('pending');

    // No pass exists before approval.
    const pass = await call(env, 'GET', `/me/visits/${visit.id}/pass`, { token });
    expect(pass.status).toBe(404);

    // Manual lookup path: verification and confirmation are both refused.
    const verify = await scan(env, fx.guard.token, 'verify', { visitId: visit.id, gateId: fx.gate.id, action: 'entry' });
    expect(verify.body).toMatchObject({ ok: false, code: 'not_approved' });
    const confirm = await scan(env, fx.guard.token, 'confirm', { visitId: visit.id, gateId: fx.gate.id, action: 'entry', identityConfirmed: true });
    expect(confirm.body).toMatchObject({ ok: false, code: 'not_approved' });

    expect(await gateEventCount(env, visit.id)).toBe(0);
    expect((await visitRow(env, visit.id)).status).toBe('pending');
  });

  it('approval issues a pass but does not record entry; entry needs explicit staff confirmation', async () => {
    const { token } = await createVisitorWithSession(env);
    const visit = await submitAsVisitor(env, token, fx.villa.id, minutes(env.clock.now(), 30));
    const approved = await approve(env, fx.admin.token, visit.id);
    expect(approved.status).toBe('approved');
    expect(approved.checkedInAt).toBeNull();
    expect(approved.entryWindowStart).not.toBeNull();
    expect(await gateEventCount(env, visit.id)).toBe(0);

    const qr = await passQr(env, token, visit.id);
    expect(qr).toMatch(/^http:\/\/localhost:3000\/p#[A-Za-z0-9_-]{43}$/);

    const verify = await scan(env, fx.guard.token, 'verify', { qr, gateId: fx.gate.id, action: 'entry' });
    expect(verify.body).toMatchObject({ ok: true, code: 'entry_allowed' });
    expect(verify.body.visitor?.fullName).toBeTruthy();
    // Verification alone does not change state.
    expect((await visitRow(env, visit.id)).status).toBe('approved');

    const noIdentityCheck = await scan(env, fx.guard.token, 'confirm', { qr, gateId: fx.gate.id, action: 'entry' });
    expect(noIdentityCheck.body).toMatchObject({ ok: false, code: 'identity_not_confirmed' });
    expect(await gateEventCount(env, visit.id)).toBe(0);

    const confirm = await scan(env, fx.guard.token, 'confirm', { qr, gateId: fx.gate.id, action: 'entry', identityConfirmed: true });
    expect(confirm.body).toMatchObject({ ok: true, code: 'entry_recorded' });
    const row = await visitRow(env, visit.id);
    expect(row.status).toBe('checked_in');
    expect(row.checkInGateId).toBe(fx.gate.id);
    expect(row.checkInByUserId).toBe(fx.guard.user.id);
    expect(await gateEventCount(env, visit.id)).toBe(1);
  });

  it('refuses entry outside the approved window', async () => {
    const { token } = await createVisitorWithSession(env);
    const visit = await submitAsVisitor(env, token, fx.villa.id, minutes(env.clock.now(), 6 * 60), 120);
    await approve(env, fx.admin.token, visit.id);
    const qr = await passQr(env, token, visit.id);
    const early = await scan(env, fx.guard.token, 'verify', { qr, gateId: fx.gate.id, action: 'entry' });
    expect(early.body).toMatchObject({ ok: false, code: 'too_early' });
  });

  it('refuses entry at a gate that does not support entry', async () => {
    const { token } = await createVisitorWithSession(env);
    const visit = await submitAsVisitor(env, token, fx.villa.id, minutes(env.clock.now(), 10));
    await approve(env, fx.admin.token, visit.id);
    const qr = await passQr(env, token, visit.id);
    const res = await scan(env, fx.guard.token, 'confirm', { qr, gateId: fx.exitGate.id, action: 'entry', identityConfirmed: true });
    expect(res.body).toMatchObject({ ok: false, code: 'gate_not_allowed' });
  });
});

describe('only administrators can decide', () => {
  it('rejects approval attempts by security staff, visitors and anonymous callers', async () => {
    const { token } = await createVisitorWithSession(env);
    const visit = await submitAsVisitor(env, token, fx.villa.id, minutes(env.clock.now(), 60));

    expect((await call(env, 'POST', `/visits/${visit.id}/approve`, { token: fx.guard.token })).status).toBe(403);
    expect((await call(env, 'POST', `/visits/${visit.id}/reject`, { token: fx.guard.token, body: { reason: 'لا يوجد موعد' } })).status).toBe(403);
    expect((await call(env, 'POST', `/visits/${visit.id}/approve`, { token })).status).toBe(403);
    expect((await call(env, 'POST', `/visits/${visit.id}/approve`, {})).status).toBe(401);
    expect((await call(env, 'GET', `/visits/${visit.id}/review`, { token: fx.guard.token })).status).toBe(403);
    expect((await visitRow(env, visit.id)).status).toBe('pending');

    const ok = await call(env, 'POST', `/visits/${visit.id}/approve`, { token: fx.admin.token });
    expect(ok.status).toBe(200);
    expect(ok.body.decidedBy.name).toBe(fx.admin.user.fullName);
  });

  it('requires a rejection reason and records the decision', async () => {
    const { token } = await createVisitorWithSession(env);
    const visit = await submitAsVisitor(env, token, fx.villa.id, minutes(env.clock.now(), 60));
    const missing = await call(env, 'POST', `/visits/${visit.id}/reject`, { token: fx.admin.token, body: { reason: ' ' } });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields.reason).toBeDefined();

    const ok = await call(env, 'POST', `/visits/${visit.id}/reject`, { token: fx.admin.token, body: { reason: 'الساكن لم يؤكد الزيارة' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'rejected', rejectionReason: 'الساكن لم يؤكد الزيارة' });

    // A decided request cannot be decided again.
    const again = await call(env, 'POST', `/visits/${visit.id}/approve`, { token: fx.admin.token });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('invalid_transition');

    // The visitor sees the outcome and the reason, but not the administrator's name.
    const mine = await call(env, 'GET', `/me/visits/${visit.id}`, { token });
    expect(mine.body).toMatchObject({ status: 'rejected', rejectionReason: 'الساكن لم يؤكد الزيارة' });
    expect(mine.body.decidedBy.name).toBeNull();
  });

  it('security staff cannot read the audit log or manage accounts', async () => {
    expect((await call(env, 'GET', '/audit', { token: fx.guard.token })).status).toBe(403);
    expect((await call(env, 'GET', '/users', { token: fx.guard.token })).status).toBe(403);
    expect((await call(env, 'POST', '/users', { token: fx.guard.token, body: { username: 'evil', fullName: 'Evil User', role: 'admin' } })).status).toBe(403);
    expect((await call(env, 'PUT', '/settings', { token: fx.guard.token, body: {} })).status).toBe(403);
    expect((await call(env, 'GET', '/visitors?q=test', { token: fx.guard.token })).status).toBe(403);
    expect((await call(env, 'GET', '/audit', { token: fx.admin.token })).status).toBe(200);
  });

  it('rejects cookie-authenticated writes from foreign origins (CSRF)', async () => {
    const { token } = await createVisitorWithSession(env);
    const res = await env.api.handle(
      new Request('http://localhost:3000/api/v1/me/visits', {
        method: 'POST',
        headers: { cookie: `${env.ctx.config.cookieName}=${token}`, origin: 'https://evil.example', 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(403);
    const formPost = await env.api.handle(
      new Request('http://localhost:3000/api/v1/auth/logout', {
        method: 'POST',
        headers: { cookie: `${env.ctx.config.cookieName}=${token}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'a=1',
      }),
    );
    expect(formPost.status).toBe(415);
  });
});
