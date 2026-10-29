import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { villas } from '@vms/db';
import { call, createFixtures, createTestEnv, createVisitorWithSession, minutes, type TestEnv } from './helpers';

let env: TestEnv;
let fx: Awaited<ReturnType<typeof createFixtures>>;

beforeAll(async () => {
  env = createTestEnv();
  fx = await createFixtures(env);
});
afterAll(() => env.close());

let offset = 0;
function body(villaNumber: string) {
  offset += 300; // a separate time slot per request so visits never overlap
  const entry = minutes(env.clock.now(), 120 + offset);
  return { villaNumber, reason: 'personal', requestedEntryAt: entry.toISOString(), durationMinutes: 60, clientRequestId: crypto.randomUUID() };
}

describe('typed villa numbers', () => {
  it('adds a new villa number to the list and reuses it, accepting Arabic digits', async () => {
    const { token } = await createVisitorWithSession(env);
    const number = `${Math.floor(Math.random() * 90000) + 10000}`;
    const arabic = number.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);

    const first = await call(env, 'POST', '/me/visits', { token, body: body(` ${arabic} `) });
    expect(first.status).toBe(200);
    expect(first.body.visit.villa.number).toBe(number);

    const second = await call(env, 'POST', '/me/visits', { token, body: body(number) });
    expect(second.status).toBe(200);
    expect(second.body.visit.villa.id).toBe(first.body.visit.villa.id);
    expect(await env.ctx.db.select().from(villas).where(eq(villas.number, number))).toHaveLength(1);
  });

  it('matches an existing villa regardless of letter case', async () => {
    const { token } = await createVisitorWithSession(env);
    const res = await call(env, 'POST', '/me/visits', { token, body: body(fx.villa.number.toLowerCase()) });
    expect(res.status).toBe(200);
    expect(res.body.visit.villa.id).toBe(fx.villa.id);
  });

  it('refuses a villa number an administrator disabled, and requires a number', async () => {
    const { token } = await createVisitorWithSession(env);
    const number = `X-${Math.floor(Math.random() * 1e5)}`;
    const created = await call(env, 'POST', '/villas', { token: fx.admin.token, body: { number, isActive: false } });
    expect(created.status).toBe(200);
    const refused = await call(env, 'POST', '/me/visits', { token, body: body(number) });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.villaNumber).toBe('errors.villa_inactive');

    const missing = await call(env, 'POST', '/me/visits', { token, body: { ...body(''), villaNumber: undefined } });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields.villaNumber).toBeDefined();
    const invalid = await call(env, 'POST', '/me/visits', { token, body: body('<script>') });
    expect(invalid.status).toBe(400);
  });

  it('still accepts a villa id from older app versions', async () => {
    const { token } = await createVisitorWithSession(env);
    const { villaNumber: _ignored, ...rest } = body('');
    const res = await call(env, 'POST', '/me/visits', { token, body: { ...rest, villaId: fx.villa.id } });
    expect(res.status).toBe(200);
    expect(res.body.visit.villa.id).toBe(fx.villa.id);
  });
});
