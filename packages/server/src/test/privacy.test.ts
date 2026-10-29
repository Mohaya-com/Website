import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approve,
  call,
  createFixtures,
  createTestEnv,
  createVisitorWithSession,
  freshIp,
  minutes,
  submitAsVisitor,
  uniqueDocumentNumber,
  uniqueMobile,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let fx: Awaited<ReturnType<typeof createFixtures>>;

beforeAll(async () => {
  env = createTestEnv();
  fx = await createFixtures(env);
});
afterAll(() => env.close());

const localMobile = (e164: string) => `0${e164.slice(4)}`;

describe('public identity lookup cannot expose another visitor', () => {
  it('returns identical responses for registered, mismatched and unregistered identities', async () => {
    const registeredMobile = uniqueMobile();
    const { visitor } = await createVisitorWithSession(env, { mobile: registeredMobile });

    const outboxBefore = env.sms.outbox.length;
    const cases = [
      { documentNumber: visitor.documentNumber, mobile: localMobile(registeredMobile) }, // owner
      { documentNumber: visitor.documentNumber, mobile: localMobile(uniqueMobile()) }, // someone else's number
      { documentNumber: uniqueDocumentNumber(), mobile: localMobile(uniqueMobile()) }, // unregistered
    ];
    const responses = [];
    for (const c of cases) {
      responses.push(await call(env, 'POST', '/auth/visitor/request-otp', { ip: freshIp(), body: { documentType: 'national_id', ...c } }));
    }
    for (const r of responses) {
      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual(['challengeId', 'developmentDelivery', 'expiresInSeconds', 'resendAfterSeconds']);
      expect(r.body.expiresInSeconds).toBe(responses[0]!.body.expiresInSeconds);
      // No personal data in the response.
      expect(JSON.stringify(r.body)).not.toContain(visitor.documentNumber);
      expect(JSON.stringify(r.body)).not.toContain('زائر');
    }
    // Codes were sent to the owner and to the unregistered applicant only — never to a different number.
    expect(env.sms.outbox.length - outboxBefore).toBe(2);
    expect(env.sms.outbox.some((m) => m.to.endsWith(registeredMobile.slice(-4)))).toBe(true);

    // The mismatched challenge can never be verified, whatever code is guessed.
    const mismatched = responses[1]!.body.challengeId;
    for (const code of ['000000', '123456', env.sms.outbox[0]!.code]) {
      const v = await call(env, 'POST', '/auth/visitor/verify-otp', { ip: freshIp(), body: { challengeId: mismatched, code, client: 'mobile' } });
      expect(v.status).toBe(400);
      expect(v.body.error.code).toBe('otp_invalid');
    }
  });

  it('shows stored information only after the owner verifies the OTP', async () => {
    const mobile = uniqueMobile();
    const { visitor } = await createVisitorWithSession(env, { mobile });
    const req = await call(env, 'POST', '/auth/visitor/request-otp', { ip: freshIp(), body: { documentType: 'national_id', documentNumber: visitor.documentNumber, mobile: localMobile(mobile) } });
    const code = env.sms.outbox[0]!.code;
    const wrong = await call(env, 'POST', '/auth/visitor/verify-otp', { ip: freshIp(), body: { challengeId: req.body.challengeId, code: code === '111111' ? '222222' : '111111', client: 'mobile' } });
    expect(wrong.status).toBe(400);
    const ok = await call(env, 'POST', '/auth/visitor/verify-otp', { ip: freshIp(), body: { challengeId: req.body.challengeId, code, client: 'mobile' } });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    expect(ok.body.session.kind).toBe('visitor');
    expect(ok.body.session.visitor.fullName).toBe(visitor.fullName);
    // Even the owner's own session only carries masked identity and mobile values.
    expect(ok.body.session.visitor.documentNumberMasked).not.toBe(visitor.documentNumber);
    expect(JSON.stringify(ok.body)).not.toContain(visitor.documentNumber);

    // Codes are single-use.
    const reuse = await call(env, 'POST', '/auth/visitor/verify-otp', { ip: freshIp(), body: { challengeId: req.body.challengeId, code, client: 'mobile' } });
    expect(reuse.status).toBe(400);
  });

  it('locks a challenge after too many wrong codes', async () => {
    const mobile = uniqueMobile();
    const { visitor } = await createVisitorWithSession(env, { mobile });
    const req = await call(env, 'POST', '/auth/visitor/request-otp', { ip: freshIp(), body: { documentType: 'national_id', documentNumber: visitor.documentNumber, mobile: localMobile(mobile) } });
    const code = env.sms.outbox[0]!.code;
    for (let i = 0; i < 5; i++) {
      await call(env, 'POST', '/auth/visitor/verify-otp', { ip: freshIp(), body: { challengeId: req.body.challengeId, code: code === '999999' ? '888888' : '999999', client: 'mobile' } });
    }
    const correct = await call(env, 'POST', '/auth/visitor/verify-otp', { ip: freshIp(), body: { challengeId: req.body.challengeId, code, client: 'mobile' } });
    expect(correct.status).toBe(400);
  });

  it('rate-limits repeated OTP requests for the same identity', async () => {
    const documentNumber = uniqueDocumentNumber();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      env.clock.advanceMinutes(2); // past the resend cool-down
      const r = await call(env, 'POST', '/auth/visitor/request-otp', { ip: freshIp(), body: { documentType: 'national_id', documentNumber, mobile: localMobile(uniqueMobile()) } });
      statuses.push(r.status);
    }
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(5);
    expect(statuses).toContain(429);
  });

  it('a new registrant can register only the verified identity and mobile', async () => {
    const documentNumber = uniqueDocumentNumber('iqama');
    const mobile = uniqueMobile();
    const req = await call(env, 'POST', '/auth/visitor/request-otp', { ip: freshIp(), body: { documentType: 'iqama', documentNumber, mobile: localMobile(mobile) } });
    const ok = await call(env, 'POST', '/auth/visitor/verify-otp', { ip: freshIp(), body: { challengeId: req.body.challengeId, code: env.sms.outbox[0]!.code, client: 'mobile' } });
    expect(ok.body.session.kind).toBe('registrant');
    const token = ok.body.token as string;
    // Registrants cannot use visitor features before completing registration.
    expect((await call(env, 'GET', '/me/visits', { token })).status).toBe(403);
    const reg = await call(env, 'POST', '/me/register', {
      token,
      body: { fullName: 'Maria Santos Reyes', nationality: 'PH', documentExpiry: { calendar: 'gregorian', date: '2028-01-31' } },
    });
    expect(reg.status).toBe(200);
    expect(reg.body.session.kind).toBe('visitor');
    expect(reg.body.session.visitor.mobileMasked.endsWith(mobile.slice(-4))).toBe(true);
    expect((await call(env, 'GET', '/me/visits', { token })).status).toBe(200);
  });

  it('visitors cannot read, cancel or obtain passes for another visitor’s visits', async () => {
    const a = await createVisitorWithSession(env);
    const b = await createVisitorWithSession(env);
    const visitB = await submitAsVisitor(env, b.token, fx.villa.id, minutes(env.clock.now(), 60));
    await approve(env, fx.admin.token, visitB.id);

    expect((await call(env, 'GET', `/me/visits/${visitB.id}`, { token: a.token })).status).toBe(404);
    expect((await call(env, 'GET', `/me/visits/${visitB.id}/pass`, { token: a.token })).status).toBe(404);
    expect((await call(env, 'POST', `/me/visits/${visitB.id}/cancel`, { token: a.token })).status).toBe(404);
    const listA = await call(env, 'GET', '/me/visits', { token: a.token });
    expect(listA.body.items.find((v: { id: string }) => v.id === visitB.id)).toBeUndefined();

    // Visitors cannot use staff endpoints, including the exact identity lookup.
    expect((await call(env, 'GET', `/visitors/lookup?documentNumber=${b.visitor.documentNumber}`, { token: a.token })).status).toBe(403);
    expect((await call(env, 'GET', `/visits/${visitB.id}`, { token: a.token })).status).toBe(403);
    expect((await call(env, 'GET', `/visitors/lookup?documentNumber=${b.visitor.documentNumber}`)).status).toBe(401);
  });
});
