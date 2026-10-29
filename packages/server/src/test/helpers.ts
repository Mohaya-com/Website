import { eq } from 'drizzle-orm';
import { gateEvents, users, visits, type User } from '@vms/db';
import { addDaysToYmd, withLuhnCheckDigit, zonedDateString, type ScanResultDTO, type VisitDTO } from '@vms/shared';
import { ManualClock } from '../clock';
import { loadConfig, loadRootEnv } from '../config';
import { createServerContext, inTransaction, type ServerContext } from '../context';
import { hashPassword } from '../crypto';
import { createApi } from '../http/api';
import type { Router } from '../http/core';
import { NoopPushProvider } from '../providers/push';
import { DevSmsProvider } from '../providers/sms';
import { createGate, createVilla } from '../services/admin';
import { createSession } from '../auth/sessions';
import { createVisitor } from '../services/visitors';

export interface TestEnv {
  ctx: ServerContext;
  api: Router;
  clock: ManualClock;
  sms: DevSmsProvider;
  close(): Promise<void>;
}

/** A fixed "now" inside working hours (10:00 Asia/Riyadh). */
export const BASE_TIME = new Date('2026-11-02T07:00:00.000Z');

export function createTestEnv(start: Date = BASE_TIME): TestEnv {
  loadRootEnv();
  const url = process.env.TEST_DATABASE_URL!;
  const config = loadConfig({ ...process.env, NODE_ENV: 'test', DATABASE_URL: url, TRUST_PROXY: 'true', APP_ORIGIN: 'http://localhost:3000', SMS_PROVIDER: 'dev', PUSH_PROVIDER: 'none' });
  const clock = new ManualClock(start);
  const sms = new DevSmsProvider();
  const ctx = createServerContext({ config: { ...config, databasePoolMax: 20 }, clock, sms, push: new NoopPushProvider() });
  const api = createApi(ctx);
  return { ctx, api, clock, sms, close: () => ctx.close() };
}

let ipCounter = 1;
/** Each test gets its own client IP so per-IP rate limits do not interfere across tests. */
export function freshIp(): string {
  ipCounter++;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export interface CallOptions {
  token?: string | null;
  body?: unknown;
  ip?: string;
  headers?: Record<string, string>;
}

export async function call<T = any>(env: TestEnv, method: string, path: string, opts: CallOptions = {}): Promise<{ status: number; body: T; headers: Headers }> {
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip ?? '10.0.0.1', ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (method !== 'GET') {
    headers['content-type'] ??= 'application/json';
    body = JSON.stringify(opts.body ?? {});
  }
  const res = await env.api.handle(new Request(`http://localhost:3000/api/v1${path}`, { method, headers, body }));
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
}

let docCounter = Math.floor(Math.random() * 1_000_000);
export function uniqueDocumentNumber(type: 'national_id' | 'iqama' = 'national_id'): string {
  docCounter++;
  const body = String(docCounter).padStart(8, '0');
  return withLuhnCheckDigit(type === 'national_id' ? `1${body}` : `2${body}`);
}

let mobileCounter = Math.floor(Math.random() * 1_000_000);
export function uniqueMobile(): string {
  mobileCounter++;
  return `+96650${String(mobileCounter).padStart(7, '0').slice(-7)}`;
}

let nameCounter = 0;
export async function createStaffUser(env: TestEnv, role: 'admin' | 'security'): Promise<{ user: User; token: string }> {
  nameCounter++;
  const now = env.clock.now();
  const [user] = await env.ctx.db
    .insert(users)
    .values({
      username: `${role}${nameCounter}x${Math.floor(Math.random() * 1e6)}`,
      fullName: role === 'admin' ? 'مدير اختبار' : 'حارس اختبار',
      role,
      passwordHash: await hashPassword('Test-password-123'),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const { token } = await createSession(env.ctx, env.ctx.db, { kind: 'staff', userId: user!.id, client: 'mobile' }, now);
  return { user: user!, token };
}

/** New session for an existing staff user at the current (test) clock time. */
export async function newStaffToken(env: TestEnv, user: User): Promise<string> {
  const { token } = await createSession(env.ctx, env.ctx.db, { kind: 'staff', userId: user.id, client: 'mobile' }, env.clock.now());
  return token;
}

export async function createFixtures(env: TestEnv) {
  const admin = await createStaffUser(env, 'admin');
  const guard = await createStaffUser(env, 'security');
  const principal = { kind: 'staff' as const, role: 'admin' as const, sessionId: 'x', userId: admin.user.id, user: admin.user, locale: 'ar' as const, expiresAt: new Date(Date.now() + 3_600_000) };
  const { gate, exitGate, villa } = await inTransaction(env.ctx, async (scope) => ({
    gate: await createGate(scope, principal, { nameAr: 'بوابة اختبار', nameEn: 'Test Gate', supportsEntry: true, supportsExit: true, isActive: true }),
    exitGate: await createGate(scope, principal, { nameAr: 'بوابة خروج', nameEn: 'Exit Only', supportsEntry: false, supportsExit: true, isActive: true }),
    villa: await createVilla(scope, principal, { number: `T-${Math.floor(Math.random() * 1e6)}`, label: null, isActive: true }),
  }));
  return { admin, guard, gate, exitGate, villa };
}

/** Creates a visitor profile directly and returns a visitor session token. */
export async function createVisitorWithSession(env: TestEnv, opts: { expiryOffsetDays?: number; mobile?: string; documentNumber?: string } = {}) {
  const today = zonedDateString(env.clock.now(), 'Asia/Riyadh');
  const expiry = addDaysToYmd(today, opts.expiryOffsetDays ?? 365);
  const visitor = await inTransaction(env.ctx, (scope) =>
    createVisitor(
      scope,
      {
        fullName: 'زائر اختبار تجريبي',
        documentType: 'national_id',
        documentNumber: opts.documentNumber ?? uniqueDocumentNumber(),
        documentExpiry: { calendar: 'gregorian', gregorian: expiry, original: expiry },
        nationality: 'SA',
        mobile: opts.mobile ?? uniqueMobile(),
      },
      { via: 'self' },
    ),
  );
  const { token } = await createSession(env.ctx, env.ctx.db, { kind: 'visitor', visitorId: visitor.id, client: 'mobile' }, env.clock.now());
  return { visitor, token };
}

export function requestBody(villaId: string, entry: Date, durationMinutes = 120, extra: Record<string, unknown> = {}) {
  return { villaId, reason: 'personal', requestedEntryAt: entry.toISOString(), durationMinutes, clientRequestId: crypto.randomUUID(), ...extra };
}

export async function submitAsVisitor(env: TestEnv, token: string, villaId: string, entry: Date, durationMinutes = 120): Promise<VisitDTO> {
  const res = await call<{ visit: VisitDTO }>(env, 'POST', '/me/visits', { token, body: requestBody(villaId, entry, durationMinutes) });
  if (res.status !== 200) throw new Error(`submit failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.visit;
}

export async function approve(env: TestEnv, adminToken: string, visitId: string): Promise<VisitDTO> {
  const res = await call<VisitDTO>(env, 'POST', `/visits/${visitId}/approve`, { token: adminToken, body: {} });
  if (res.status !== 200) throw new Error(`approve failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function passQr(env: TestEnv, visitorToken: string, visitId: string): Promise<string> {
  const res = await call<{ qrValue: string }>(env, 'GET', `/me/visits/${visitId}/pass`, { token: visitorToken });
  if (res.status !== 200) throw new Error(`pass failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.qrValue;
}

export async function scan(env: TestEnv, token: string, stage: 'verify' | 'confirm', body: Record<string, unknown>): Promise<{ status: number; body: ScanResultDTO }> {
  return call<ScanResultDTO>(env, 'POST', `/scan/${stage}`, { token, body });
}

export async function gateEventCount(env: TestEnv, visitId: string): Promise<number> {
  const rows = await env.ctx.db.select().from(gateEvents).where(eq(gateEvents.visitId, visitId));
  return rows.length;
}

export async function visitRow(env: TestEnv, visitId: string) {
  const [row] = await env.ctx.db.select().from(visits).where(eq(visits.id, visitId));
  return row!;
}

export const minutes = (date: Date, m: number) => new Date(date.getTime() + m * 60_000);
