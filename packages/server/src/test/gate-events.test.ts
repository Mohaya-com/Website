import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifications, visitors, visits } from '@vms/db';
import { runMaintenance } from '../services/maintenance';
import {
  approve,
  call,
  createFixtures,
  createTestEnv,
  createVisitorWithSession,
  gateEventCount,
  minutes,
  newStaffToken,
  passQr,
  requestBody,
  scan,
  submitAsVisitor,
  visitRow,
  type TestEnv,
} from './helpers';

const START = new Date('2026-11-04T07:00:00.000Z');
let env: TestEnv;
let fx: Awaited<ReturnType<typeof createFixtures>>;

beforeAll(async () => {
  env = createTestEnv(START);
  fx = await createFixtures(env);
});
afterAll(() => env.close());

async function approvedVisit(entryOffsetMinutes = 10, duration = 120) {
  env.clock.set(START);
  const v = await createVisitorWithSession(env);
  const visit = await submitAsVisitor(env, v.token, fx.villa.id, minutes(env.clock.now(), entryOffsetMinutes), duration);
  await approve(env, fx.admin.token, visit.id);
  const qr = await passQr(env, v.token, visit.id);
  return { ...v, visit, qr };
}

describe('duplicate and concurrent scans cannot create duplicate events', () => {
  it('records exactly one entry when the same pass is confirmed concurrently', async () => {
    const { visit, qr } = await approvedVisit();
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => scan(env, fx.guard.token, 'confirm', { qr, gateId: fx.gate.id, action: 'entry', identityConfirmed: true })),
    );
    const recorded = attempts.filter((a) => a.body.code === 'entry_recorded');
    expect(recorded).toHaveLength(1);
    for (const a of attempts.filter((x) => x.body.code !== 'entry_recorded')) {
      expect(a.body).toMatchObject({ ok: false, code: 'already_checked_in' });
    }
    expect(await gateEventCount(env, visit.id)).toBe(1);
  });

  it('records exactly one exit under concurrent confirmations, then refuses further use', async () => {
    const { visit, qr } = await approvedVisit();
    await scan(env, fx.guard.token, 'confirm', { qr, gateId: fx.gate.id, action: 'entry', identityConfirmed: true });
    const exits = await Promise.all(Array.from({ length: 6 }, () => scan(env, fx.guard.token, 'confirm', { qr, gateId: fx.gate.id, action: 'exit' })));
    expect(exits.filter((e) => e.body.code === 'exit_recorded')).toHaveLength(1);
    expect(await gateEventCount(env, visit.id)).toBe(2);
    expect((await visitRow(env, visit.id)).status).toBe('completed');

    // A completed pass cannot be reused for entry or exit.
    const reentry = await scan(env, fx.guard.token, 'confirm', { qr, gateId: fx.gate.id, action: 'entry', identityConfirmed: true });
    expect(reentry.body).toMatchObject({ ok: false, code: 'already_completed' });
    const reexit = await scan(env, fx.guard.token, 'verify', { qr, gateId: fx.gate.id, action: 'exit' });
    expect(reexit.body).toMatchObject({ ok: false, code: 'already_completed' });
  });

  it('duplicate submissions with the same client request id create one request', async () => {
    env.clock.set(START);
    const { token } = await createVisitorWithSession(env);
    const body = requestBody(fx.villa.id, minutes(env.clock.now(), 60));
    const results = await Promise.all(Array.from({ length: 4 }, () => call(env, 'POST', '/me/visits', { token, body })));
    const ids = new Set(results.filter((r) => r.status === 200).map((r) => r.body.visit.id));
    expect(ids.size).toBe(1);
    const mine = await call(env, 'GET', '/me/visits', { token });
    expect(mine.body.total).toBe(1);
  });

  it('prevents concurrent overlapping visits for the same visitor', async () => {
    env.clock.set(START);
    const { token, visitor } = await createVisitorWithSession(env);
    const entry = minutes(env.clock.now(), 60);
    const results = await Promise.all([
      call(env, 'POST', '/me/visits', { token, body: requestBody(fx.villa.id, entry, 120) }),
      call(env, 'POST', '/me/visits', { token, body: requestBody(fx.villa.id, minutes(entry, 30), 60) }),
      call(env, 'POST', '/visits', { token: fx.guard.token, body: { ...requestBody(fx.villa.id, minutes(entry, 15), 60), visitorId: visitor.id } }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('overlapping_visit');
    }
    const open = await env.ctx.db.select().from(visits).where(eq(visits.visitorId, visitor.id));
    expect(open).toHaveLength(1);
  });
});

describe('exit requires an active check-in', () => {
  it('refuses exit for approved, pending and unknown visits', async () => {
    const { visit, qr, token } = await approvedVisit();
    const exit = await scan(env, fx.guard.token, 'confirm', { qr, gateId: fx.gate.id, action: 'exit' });
    expect(exit.body).toMatchObject({ ok: false, code: 'not_checked_in' });
    expect(await gateEventCount(env, visit.id)).toBe(0);

    const pending = await submitAsVisitor(env, token, fx.villa.id, minutes(env.clock.now(), 6 * 60), 60);
    const pendingExit = await scan(env, fx.guard.token, 'confirm', { visitId: pending.id, gateId: fx.gate.id, action: 'exit' });
    expect(pendingExit.body).toMatchObject({ ok: false, code: 'not_approved' });
  });

  it('allows exit at an exit-only gate', async () => {
    const { visit, qr } = await approvedVisit();
    await scan(env, fx.guard.token, 'confirm', { qr, gateId: fx.gate.id, action: 'entry', identityConfirmed: true });
    const exit = await scan(env, fx.guard.token, 'confirm', { qr, gateId: fx.exitGate.id, action: 'exit' });
    expect(exit.body).toMatchObject({ ok: true, code: 'exit_recorded' });
    const row = await visitRow(env, visit.id);
    expect(row.checkOutGateId).toBe(fx.exitGate.id);
    expect(row.checkOutByUserId).toBe(fx.guard.user.id);
  });
});

describe('overdue visitors remain inside until explicitly checked out', () => {
  it('flags overdue, notifies staff, never auto-checks-out, and still permits exit later', async () => {
    const { visit, qr, visitor } = await approvedVisit(5, 60);
    await scan(env, fx.guard.token, 'confirm', { qr, gateId: fx.gate.id, action: 'entry', identityConfirmed: true });

    // Two hours past the expected exit.
    env.clock.set(minutes(new Date(visit.expectedExitAt), 120));
    const result = await runMaintenance(env.ctx);
    expect(result.overdueFlagged).toBeGreaterThanOrEqual(1);
    let row = await visitRow(env, visit.id);
    expect(row.status).toBe('checked_in');
    expect(row.overdueFlaggedAt).not.toBeNull();
    expect(row.checkedOutAt).toBeNull();

    const staffAlerts = await env.ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.visitId, visit.id), eq(notifications.type, 'visit_overdue')));
    expect(staffAlerts.some((n) => n.recipientUserId === fx.guard.user.id)).toBe(true);
    expect(staffAlerts.some((n) => n.recipientUserId === fx.admin.user.id)).toBe(true);
    // Notification payloads never contain identity details.
    for (const n of staffAlerts) expect(Object.keys(n.params).sort()).toEqual(['reference', 'villa']);

    const inside = await call(env, 'GET', '/visits/inside', { token: fx.guard.token });
    const listed = inside.body.items.find((v: { id: string }) => v.id === visit.id);
    expect(listed).toMatchObject({ status: 'checked_in', isOverdue: true });

    // Days later (window long closed, and the document now expired), the visitor is still inside.
    env.clock.set(minutes(new Date(visit.expectedExitAt), 3 * 24 * 60));
    await runMaintenance(env.ctx);
    expect((await visitRow(env, visit.id)).status).toBe('checked_in');
    await env.ctx.db.update(visitors).set({ documentExpiryDate: '2026-11-05' }).where(eq(visitors.id, visitor.id));

    // The guard's earlier session has expired (12-hour idle timeout); a fresh sign-in is required.
    expect((await scan(env, fx.guard.token, 'verify', { qr, gateId: fx.gate.id, action: 'exit' })).status).toBe(401);
    const freshGuard = await newStaffToken(env, fx.guard.user);
    const exit = await scan(env, freshGuard, 'confirm', { qr, gateId: fx.gate.id, action: 'exit' });
    expect(exit.body).toMatchObject({ ok: true, code: 'exit_recorded' });
    row = await visitRow(env, visit.id);
    expect(row.status).toBe('completed');
    expect(row.overstayMinutes).toBeGreaterThan(3 * 24 * 60 - 1);
    env.clock.set(START);
  });
});
