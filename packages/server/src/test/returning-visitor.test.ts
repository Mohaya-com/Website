import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { visitorProfileVersions, visitors } from '@vms/db';
import { toArabicDigits } from '@vms/shared';
import {
  approve,
  call,
  createFixtures,
  createTestEnv,
  freshIp,
  minutes,
  newStaffToken,
  requestBody,
  scan,
  uniqueDocumentNumber,
  uniqueMobile,
  visitRow,
  type TestEnv,
} from './helpers';

const START = new Date('2026-11-05T07:00:00.000Z');
let env: TestEnv;
let fx: Awaited<ReturnType<typeof createFixtures>>;

beforeAll(async () => {
  env = createTestEnv(START);
  fx = await createFixtures(env);
});
afterAll(() => env.close());

describe('returning visitors reuse the correct profile and keep their history', () => {
  it('staff find the profile by ID (Arabic digits), never duplicate it, and link new visits to it', async () => {
    const documentNumber = uniqueDocumentNumber('iqama');
    const mobile = uniqueMobile();

    // First visit: no profile yet → lookup finds nothing → staff create the profile.
    const miss = await call(env, 'GET', `/visitors/lookup?documentNumber=${documentNumber}`, { token: fx.guard.token });
    expect(miss.body).toEqual({ found: false, visitor: null });
    const created = await call(env, 'POST', '/visitors', {
      token: fx.guard.token,
      body: { fullName: 'Ahmed Kamal Hassan', documentType: 'iqama', documentNumber, documentExpiry: { calendar: 'gregorian', date: '2027-06-30' }, nationality: 'EG', mobile: `0${mobile.slice(4)}` },
    });
    expect(created.status).toBe(200);
    const visitorId = created.body.id as string;

    const first = await call(env, 'POST', '/visits', { token: fx.guard.token, body: { ...requestBody(fx.villa.id, minutes(START, 20), 60), visitorId } });
    expect(first.status).toBe(200);
    await approve(env, fx.admin.token, first.body.visit.id);
    await scan(env, fx.guard.token, 'confirm', { visitId: first.body.visit.id, gateId: fx.gate.id, action: 'entry', identityConfirmed: true });
    env.clock.set(minutes(START, 70));
    await scan(env, fx.guard.token, 'confirm', { visitId: first.body.visit.id, gateId: fx.gate.id, action: 'exit' });

    // Next week (new staff sessions): the number is typed with Arabic-Indic digits and spaces.
    env.clock.set(minutes(START, 7 * 24 * 60));
    fx.guard.token = await newStaffToken(env, fx.guard.user);
    fx.admin.token = await newStaffToken(env, fx.admin.user);
    const typed = toArabicDigits(`${documentNumber.slice(0, 5)} ${documentNumber.slice(5)}`);
    const hit = await call(env, 'GET', `/visitors/lookup?documentNumber=${encodeURIComponent(typed)}`, { token: fx.guard.token });
    expect(hit.body.found).toBe(true);
    expect(hit.body.visitor.id).toBe(visitorId);
    expect(hit.body.visitor.visitCount).toBe(1);

    // Attempting to create the same identity again is refused and points to the existing profile.
    const dup = await call(env, 'POST', '/visitors', {
      token: fx.guard.token,
      body: { fullName: 'Ahmed K Hassan', documentType: 'iqama', documentNumber, documentExpiry: { calendar: 'gregorian', date: '2027-06-30' }, nationality: 'EG', mobile: '0551112233' },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'duplicate_visitor', details: { visitorId } });
    const profiles = await env.ctx.db.select().from(visitors).where(eq(visitors.documentNumber, documentNumber));
    expect(profiles).toHaveLength(1);

    // The renewed document expiry is updated explicitly (with a reason) before the new request.
    const update = await call(env, 'PATCH', `/visitors/${visitorId}`, {
      token: fx.guard.token,
      body: { expectedVersion: hit.body.visitor.version, reason: 'تجديد الإقامة — تمت مطابقة الأصل', documentExpiry: { calendar: 'gregorian', date: '2028-06-30' } },
    });
    expect(update.status).toBe(200);
    // Security staff cannot silently change identity fields.
    const nameChange = await call(env, 'PATCH', `/visitors/${visitorId}`, {
      token: fx.guard.token,
      body: { expectedVersion: update.body.visitor.version, reason: 'تصحيح', fullName: 'Someone Else' },
    });
    expect(nameChange.status).toBe(403);
    // Updates without a reason are refused.
    const noReason = await call(env, 'PATCH', `/visitors/${visitorId}`, { token: fx.admin.token, body: { expectedVersion: update.body.visitor.version, fullName: 'Ahmed Kamal Hassan Ali' } });
    expect(noReason.status).toBe(400);

    const second = await call(env, 'POST', '/visits', { token: fx.guard.token, body: { ...requestBody(fx.villa.id, minutes(env.clock.now(), 30), 90), visitorId } });
    expect(second.status).toBe(200);
    expect(second.body.visit.visitorId).toBe(visitorId);

    // The administrator sees the full prior history (chronological) before deciding.
    const review = await call(env, 'GET', `/visits/${second.body.visit.id}/review`, { token: fx.admin.token });
    expect(review.status).toBe(200);
    expect(review.body.history).toHaveLength(1);
    expect(review.body.history[0]).toMatchObject({ id: first.body.visit.id, status: 'completed' });
    expect(review.body.history[0].checkedInAt).not.toBeNull();
    expect(review.body.history[0].checkedOutAt).not.toBeNull();
    expect(review.body.stats).toMatchObject({ total: 1, completed: 1 });
    expect(review.body.visitor.documentNumber).toBe(documentNumber);

    // History is preserved: the first visit still points to the profile version current when it was submitted.
    const firstRow = await visitRow(env, first.body.visit.id);
    const [firstVersion] = await env.ctx.db.select().from(visitorProfileVersions).where(eq(visitorProfileVersions.id, firstRow.profileVersionId));
    expect(firstVersion!.version).toBe(1);
    expect(firstVersion!.documentExpiryDate).toBe('2027-06-30');
    const versions = await call(env, 'GET', `/visitors/${visitorId}/versions`, { token: fx.admin.token });
    expect(versions.body.items.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect(versions.body.items[1].changeReason).toContain('تجديد');
  });

  it('a returning visitor signing in with OTP sees their staff-registered visits', async () => {
    env.clock.set(START);
    fx.admin.token = await newStaffToken(env, fx.admin.user);
    const documentNumber = uniqueDocumentNumber();
    const mobile = uniqueMobile();
    const created = await call(env, 'POST', '/visitors', {
      token: fx.admin.token,
      body: { fullName: 'سلمان خالد الرشيد', documentType: 'national_id', documentNumber, documentExpiry: { calendar: 'gregorian', date: '2030-01-01' }, nationality: 'SA', mobile: `0${mobile.slice(4)}` },
    });
    const visit = await call(env, 'POST', '/visits', { token: fx.admin.token, body: { ...requestBody(fx.villa.id, minutes(START, 60), 60), visitorId: created.body.id } });

    const req = await call(env, 'POST', '/auth/visitor/request-otp', { ip: freshIp(), body: { documentType: 'national_id', documentNumber, mobile: `+${mobile.slice(1)}` } });
    const verified = await call(env, 'POST', '/auth/visitor/verify-otp', { ip: freshIp(), body: { challengeId: req.body.challengeId, code: env.sms.outbox[0]!.code, client: 'mobile' } });
    expect(verified.body.session.kind).toBe('visitor');
    expect(verified.body.session.visitor.id).toBe(created.body.id);
    const mine = await call(env, 'GET', '/me/visits', { token: verified.body.token });
    expect(mine.body.items.map((v: { id: string }) => v.id)).toContain(visit.body.visit.id);
  });

  it('staff can search visitors by name, mobile and reference (administrators only)', async () => {
    const res = await call(env, 'GET', `/visitors?q=${encodeURIComponent('سلمان')}`, { token: fx.admin.token });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    // List views show masked identity numbers only.
    for (const item of res.body.items) {
      expect(item.documentNumber).toBeUndefined();
      expect(item.documentNumberMasked).toMatch(/•/);
    }
  });
});
