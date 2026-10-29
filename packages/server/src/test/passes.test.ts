import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMaintenance } from '../services/maintenance';
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
  env = createTestEnv(new Date('2026-11-03T07:00:00.000Z'));
  fx = await createFixtures(env);
});
afterAll(() => env.close());

describe('expired or cancelled passes cannot admit visitors', () => {
  it('a cancelled visit’s pass is refused and records nothing', async () => {
    const { token } = await createVisitorWithSession(env);
    const visit = await submitAsVisitor(env, token, fx.villa.id, minutes(env.clock.now(), 20));
    await approve(env, fx.admin.token, visit.id);
    const qr = await passQr(env, token, visit.id);

    const cancel = await call(env, 'POST', `/me/visits/${visit.id}/cancel`, { token, body: { reason: 'تأجيل' } });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('cancelled');

    const verify = await scan(env, fx.guard.token, 'verify', { qr, gateId: fx.gate.id, action: 'entry' });
    expect(verify.body).toMatchObject({ ok: false, code: 'cancelled' });
    const confirm = await scan(env, fx.guard.token, 'confirm', { qr, gateId: fx.gate.id, action: 'entry', identityConfirmed: true });
    expect(confirm.body).toMatchObject({ ok: false, code: 'cancelled' });
    expect(await gateEventCount(env, visit.id)).toBe(0);
    // The pass is no longer retrievable.
    expect((await call(env, 'GET', `/me/visits/${visit.id}/pass`, { token })).status).toBe(404);
  });

  it('an approved visit expires when its entry window closes, and the pass stops working', async () => {
    const { token } = await createVisitorWithSession(env);
    const visit = await submitAsVisitor(env, token, fx.villa.id, minutes(env.clock.now(), 30), 60);
    const approved = await approve(env, fx.admin.token, visit.id);
    const qr = await passQr(env, token, visit.id);

    env.clock.set(minutes(new Date(approved.entryWindowEnd!), 1));
    // Even before the sweeper runs, the gate refuses entry outside the window.
    const late = await scan(env, fx.guard.token, 'verify', { qr, gateId: fx.gate.id, action: 'entry' });
    expect(late.body).toMatchObject({ ok: false, code: 'window_closed' });

    await runMaintenance(env.ctx);
    expect((await visitRow(env, visit.id)).status).toBe('expired');
    const after = await scan(env, fx.guard.token, 'confirm', { qr, gateId: fx.gate.id, action: 'entry', identityConfirmed: true });
    expect(after.body).toMatchObject({ ok: false, code: 'expired' });
    expect(await gateEventCount(env, visit.id)).toBe(0);
    env.clock.set(new Date('2026-11-03T07:00:00.000Z'));
  });

  it('pending requests whose entry window passed are no longer actionable', async () => {
    const { token } = await createVisitorWithSession(env);
    const visit = await submitAsVisitor(env, token, fx.villa.id, minutes(env.clock.now(), 10), 30);
    env.clock.advanceMinutes(60);
    const res = await call(env, 'POST', `/visits/${visit.id}/approve`, { token: fx.admin.token });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('window_passed');
    await runMaintenance(env.ctx);
    const row = await visitRow(env, visit.id);
    expect(row.status).toBe('cancelled');
    expect(row.cancelledByType).toBe('system');
    env.clock.set(new Date('2026-11-03T07:00:00.000Z'));
  });

  it('an expired identity document blocks submission, approval and check-in', async () => {
    // Document expires tomorrow: a visit the day after tomorrow is refused at submission.
    const { token, visitor } = await createVisitorWithSession(env, { expiryOffsetDays: 1 });
    const tooLate = await call(env, 'POST', '/me/visits', {
      token,
      body: { villaId: fx.villa.id, reason: 'personal', requestedEntryAt: minutes(env.clock.now(), 2 * 24 * 60).toISOString(), durationMinutes: 60, clientRequestId: crypto.randomUUID() },
    });
    expect(tooLate.status).toBe(400);
    expect(tooLate.body.error.code).toBe('document_expired');

    // A visit today is accepted and approved...
    const visit = await submitAsVisitor(env, token, fx.villa.id, minutes(env.clock.now(), 30), 60);
    const second = await submitAsVisitor(env, token, fx.villa.id, minutes(env.clock.now(), 3 * 60), 60);
    await approve(env, fx.admin.token, visit.id);
    const qr = await passQr(env, token, visit.id);

    // ...then staff record (with a reason) that the document actually expired yesterday.
    const profile = await call(env, 'GET', `/visitors/${visitor.id}`, { token: fx.admin.token });
    const update = await call(env, 'PATCH', `/visitors/${visitor.id}`, {
      token: fx.guard.token,
      body: { expectedVersion: profile.body.version, reason: 'تصحيح تاريخ الانتهاء بعد مطابقة الهوية الأصلية', documentExpiry: { calendar: 'gregorian', date: '2026-11-02' } },
    });
    expect(update.status).toBe(200);
    expect(update.body.changed).toEqual(['documentExpiry']);

    const entry = await scan(env, fx.guard.token, 'confirm', { qr, gateId: fx.gate.id, action: 'entry', identityConfirmed: true });
    expect(entry.body).toMatchObject({ ok: false, code: 'document_expired' });
    expect(await gateEventCount(env, visit.id)).toBe(0);

    const approval = await call(env, 'POST', `/visits/${second.id}/approve`, { token: fx.admin.token });
    expect(approval.status).toBe(409);
    expect(approval.body.error.code).toBe('document_expired');
    const review = await call(env, 'GET', `/visits/${second.id}/review`, { token: fx.admin.token });
    expect(review.body).toMatchObject({ canDecide: false, approvalBlockedReason: 'errors.document_expired', profileChangedSinceSubmission: true });
    expect(review.body.identity.expired).toBe(true);
  });

  it('changing an approved visit requires a new approval and invalidates the old pass', async () => {
    const { token } = await createVisitorWithSession(env);
    const visit = await submitAsVisitor(env, token, fx.villa.id, minutes(env.clock.now(), 45));
    const approved = await approve(env, fx.admin.token, visit.id);
    const oldQr = await passQr(env, token, visit.id);

    const modified = await call(env, 'PATCH', `/me/visits/${visit.id}`, {
      token,
      body: { expectedVersion: approved.version, requestedEntryAt: minutes(env.clock.now(), 90).toISOString() },
    });
    expect(modified.status).toBe(200);
    expect(modified.body.replaced).toBe(true);
    expect(modified.body.visit.status).toBe('pending');
    expect(modified.body.visit.supersedesVisitId).toBe(visit.id);
    expect((await visitRow(env, visit.id)).status).toBe('cancelled');

    const oldScan = await scan(env, fx.guard.token, 'verify', { qr: oldQr, gateId: fx.gate.id, action: 'entry' });
    expect(oldScan.body.ok).toBe(false);
    expect(['cancelled', 'pass_revoked']).toContain(oldScan.body.code);
  });

  it('unknown or forged QR values are rejected without revealing anything', async () => {
    const res = await scan(env, fx.guard.token, 'verify', { qr: 'http://localhost:3000/p#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', gateId: fx.gate.id, action: 'entry' });
    expect(res.body).toMatchObject({ ok: false, code: 'invalid_pass', visit: null, visitor: null });
    const garbage = await scan(env, fx.guard.token, 'verify', { qr: 'not-a-pass', gateId: fx.gate.id, action: 'entry' });
    expect(garbage.body.code).toBe('invalid_pass');
  });
});
