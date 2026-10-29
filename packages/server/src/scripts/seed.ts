/**
 * DEVELOPMENT SEED — fictional demo data only. Refuses to run when NODE_ENV=production.
 *
 *   pnpm db:seed            seed an empty database
 *   pnpm db:seed --reset    drop everything, re-run migrations, then seed
 *
 * History is generated through the real business services with a controllable clock, so every
 * visit, decision, pass, gate event, notification and audit record is consistent with the rules.
 */
import { count } from 'drizzle-orm';
import { settings as settingsTable, users, type User, type Visitor } from '@vms/db';
import { resetDatabase } from '@vms/db/migrator';
import {
  addDaysToYmd,
  addMinutes,
  withLuhnCheckDigit,
  zonedDateString,
  zonedDateTimeToUtc,
  type DocumentType,
  type VisitReason,
} from '@vms/shared';
import type { StaffPrincipal, VisitorPrincipal } from '../auth/principal';
import { ManualClock } from '../clock';
import { loadConfig, loadRootEnv } from '../config';
import { createServerContext, inTransaction, type ServerContext } from '../context';
import { hashPassword } from '../crypto';
import { NoopPushProvider } from '../providers/push';
import { DevSmsProvider } from '../providers/sms';
import { createGate, createVilla } from '../services/admin';
import { runMaintenance } from '../services/maintenance';
import { getActivePass, passQrValue } from '../services/passes';
import { confirmScan } from '../services/scans';
import { DEMO_DATA_KEY } from '../services/settings';
import { createVisitor } from '../services/visitors';
import { approveVisit, cancelVisit, rejectVisit, submitVisitRequest } from '../services/visits';

loadRootEnv();
if (process.env.NODE_ENV === 'production') {
  console.error('✘ The development seed cannot run in production.');
  process.exit(1);
}

const TZ = 'Asia/Riyadh';
const realNow = new Date();
const clock = new ManualClock(realNow);

// Deterministic pseudo-random generator so the demo data is reproducible.
let prngState = 20261029;
const rand = () => {
  prngState = (prngState * 1103515245 + 12345) % 2147483648;
  return prngState / 2147483648;
};
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join('');

interface DemoVisitor {
  fullName: string;
  documentType: DocumentType;
  nationality: string;
  mobile: string;
  expiryOffsetDays: number;
}

const DEMO_VISITORS: DemoVisitor[] = [
  { fullName: 'خالد عبدالله الحربي', documentType: 'national_id', nationality: 'SA', mobile: '+966501234501', expiryOffsetDays: 900 },
  { fullName: 'نورة سعد القحطاني', documentType: 'national_id', nationality: 'SA', mobile: '+966551234502', expiryOffsetDays: 1400 },
  { fullName: 'محمد أحمد الزهراني', documentType: 'national_id', nationality: 'SA', mobile: '+966561234503', expiryOffsetDays: 640 },
  { fullName: 'سارة فهد العتيبي', documentType: 'national_id', nationality: 'SA', mobile: '+966541234504', expiryOffsetDays: 2100 },
  { fullName: 'أحمد محمود عبدالعزيز', documentType: 'iqama', nationality: 'EG', mobile: '+966501234505', expiryOffsetDays: 210 },
  { fullName: 'Rajesh Kumar Sharma', documentType: 'iqama', nationality: 'IN', mobile: '+966551234506', expiryOffsetDays: 330 },
  { fullName: 'Juan Dela Cruz', documentType: 'iqama', nationality: 'PH', mobile: '+966561234507', expiryOffsetDays: 120 },
  { fullName: 'عمر يوسف الأحمد', documentType: 'iqama', nationality: 'SY', mobile: '+966541234508', expiryOffsetDays: 3 },
  { fullName: 'ليلى حسن النجار', documentType: 'iqama', nationality: 'JO', mobile: '+201001234509', expiryOffsetDays: 480 },
  { fullName: 'فيصل ناصر الدوسري', documentType: 'national_id', nationality: 'SA', mobile: '+966501234510', expiryOffsetDays: 1700 },
  { fullName: 'عبدالرحمن علي الشهري', documentType: 'national_id', nationality: 'SA', mobile: '+966551234511', expiryOffsetDays: -20 },
  { fullName: 'Muhammad Bilal Khan', documentType: 'iqama', nationality: 'PK', mobile: '+966561234512', expiryOffsetDays: 260 },
];

const REASONS: VisitReason[] = ['personal', 'personal', 'personal', 'delivery', 'delivery', 'maintenance', 'service_provider', 'other'];

function staffPrincipal(user: User): StaffPrincipal {
  return { kind: 'staff', role: user.role, sessionId: 'seed', userId: user.id, user, locale: user.locale, expiresAt: addMinutes(realNow, 60) };
}

function visitorPrincipal(visitor: Visitor): VisitorPrincipal {
  return { kind: 'visitor', role: 'visitor', sessionId: 'seed', visitorId: visitor.id, visitor, locale: visitor.locale, expiresAt: addMinutes(realNow, 60) };
}

const localTime = (ymd: string, hm: string) => zonedDateTimeToUtc(ymd, hm, TZ);

async function main() {
  const config = loadConfig();
  const reset = process.argv.includes('--reset');
  if (reset) {
    console.log('… Resetting database (drop + migrate)');
    await resetDatabase(config.databaseUrl);
  }
  const ctx: ServerContext = createServerContext({ config, clock, sms: new DevSmsProvider(), push: new NoopPushProvider() });
  try {
    const [existing] = await ctx.db.select({ n: count() }).from(users);
    if (Number(existing?.n ?? 0) > 0) {
      console.error('✘ The database already contains users. Run `pnpm db:seed --reset` to wipe and reseed (development only).');
      process.exitCode = 1;
      return;
    }
    await seed(ctx);
  } finally {
    await ctx.close();
  }
}

async function seed(ctx: ServerContext) {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin-demo-2026!';
  const securityPassword = process.env.SEED_SECURITY_PASSWORD || 'Guard-demo-2026!';

  // ── Staff, settings, gates, villas ──
  const startOfHistory = addMinutes(realNow, -40 * 24 * 60);
  clock.set(startOfHistory);
  const [adminHash, guardHash] = await Promise.all([hashPassword(adminPassword), hashPassword(securityPassword)]);
  const staff = await inTransaction(ctx, async ({ tx, now }) => {
    await tx.insert(settingsTable).values({ key: DEMO_DATA_KEY, value: true, updatedAt: now });
    const rows = await tx
      .insert(users)
      .values([
        { username: 'admin', fullName: 'هند سليمان المطيري', role: 'admin', passwordHash: adminHash, createdAt: now, updatedAt: now },
        { username: 'admin2', fullName: 'Daniel Brooks', role: 'admin', passwordHash: adminHash, locale: 'en', createdAt: now, updatedAt: now },
        { username: 'guard1', fullName: 'ماجد سعيد الغامدي', role: 'security', passwordHash: guardHash, createdAt: now, updatedAt: now },
        { username: 'guard2', fullName: 'تركي محمد العنزي', role: 'security', passwordHash: guardHash, createdAt: now, updatedAt: now },
      ])
      .returning();
    return rows;
  });
  const admin = staffPrincipal(staff.find((u) => u.username === 'admin')!);
  const guards = staff.filter((u) => u.role === 'security').map(staffPrincipal);

  const gatesCreated = await inTransaction(ctx, async (scope) => [
    await createGate(scope, admin, { nameAr: 'البوابة الرئيسية', nameEn: 'Main Gate', supportsEntry: true, supportsExit: true, isActive: true }),
    await createGate(scope, admin, { nameAr: 'البوابة الشمالية', nameEn: 'North Gate', supportsEntry: true, supportsExit: true, isActive: true }),
    await createGate(scope, admin, { nameAr: 'بوابة الخدمات', nameEn: 'Service Gate', supportsEntry: true, supportsExit: false, isActive: true }),
  ]);
  const [mainGate, northGate] = gatesCreated as [(typeof gatesCreated)[number], (typeof gatesCreated)[number]];

  const villaIds: { id: string; number: string }[] = [];
  await inTransaction(ctx, async (scope) => {
    for (const block of ['A', 'B', 'C']) {
      const countInBlock = block === 'C' ? 12 : 24;
      for (let i = 1; i <= countInBlock; i++) {
        const v = await createVilla(scope, admin, { number: `${block}-${String(i).padStart(2, '0')}`, label: block === 'C' ? 'فلل الحديقة' : null, isActive: true });
        villaIds.push({ id: v.id, number: v.number });
      }
    }
  });

  // ── Visitor profiles ──
  const today = zonedDateString(realNow, TZ);
  const visitors: Visitor[] = [];
  for (const [i, d] of DEMO_VISITORS.entries()) {
    const prefix = d.documentType === 'national_id' ? `10${digits(7)}` : `2${digits(8)}`;
    // One profile has an expiry date 20 days in the past, to demonstrate expired-document handling.
    const expiry = addDaysToYmd(today, d.expiryOffsetDays);
    const v = await inTransaction(ctx, (scope) =>
      createVisitor(
        scope,
        {
          fullName: d.fullName,
          documentType: d.documentType,
          documentNumber: withLuhnCheckDigit(prefix),
          documentExpiry: { calendar: 'gregorian', gregorian: expiry, original: expiry },
          nationality: d.nationality,
          mobile: d.mobile,
        },
        i % 3 === 0 ? { via: 'self' } : { via: 'staff', staff: pick(guards) },
      ),
    );
    visitors.push(v);
  }

  // ── 30 days of history ──
  let created = 0;
  for (let dayOffset = 30; dayOffset >= 1; dayOffset--) {
    const ymd = addDaysToYmd(today, -dayOffset);
    const visitsToday = 1 + Math.floor(rand() * 3);
    const used = new Set<number>();
    for (let k = 0; k < visitsToday; k++) {
      let vi = Math.floor(rand() * visitors.length);
      // Skip visitors already scheduled that day and visitors whose document is expired on that date.
      for (let tries = 0; tries < visitors.length && (used.has(vi) || visitors[vi]!.documentExpiryDate < ymd); tries++) {
        vi = (vi + 1) % visitors.length;
      }
      if (used.has(vi) || visitors[vi]!.documentExpiryDate < ymd) continue;
      used.add(vi);
      const visitor = visitors[vi]!;
      const hour = 9 + Math.floor(rand() * 9);
      const entry = localTime(ymd, `${String(hour).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`);
      const duration = pick([60, 90, 120, 180, 240]);
      const outcome = rand();
      await simulateVisit(ctx, { admin, guards, visitor, villa: pick(villaIds), entry, duration, outcome, gates: [mainGate.id, northGate.id] });
      created++;
    }
  }

  // ── Current situation (relative to the real current time) ──
  const nowRounded = new Date(Math.ceil(realNow.getTime() / (15 * 60_000)) * 15 * 60_000);
  // Visitor index 10 (expired document) is intentionally left without a current visit.
  const scenarios: { vi: number; kind: 'inside' | 'overdue' | 'approved' | 'pending' | 'completed'; entryOffset: number; duration: number }[] = [
    { vi: 0, kind: 'inside', entryOffset: -60, duration: 180 },
    { vi: 4, kind: 'overdue', entryOffset: -240, duration: 120 },
    { vi: 1, kind: 'approved', entryOffset: 60, duration: 120 },
    { vi: 5, kind: 'approved', entryOffset: 150, duration: 60 },
    { vi: 2, kind: 'pending', entryOffset: 90, duration: 120 },
    { vi: 6, kind: 'pending', entryOffset: 24 * 60, duration: 240 },
    { vi: 7, kind: 'pending', entryOffset: 30, duration: 60 },
    { vi: 3, kind: 'completed', entryOffset: -300, duration: 90 },
    { vi: 9, kind: 'completed', entryOffset: -200, duration: 60 },
  ];
  for (const s of scenarios) {
    const visitor = visitors[s.vi]!;
    const entry = addMinutes(nowRounded, s.entryOffset);
    const villa = pick(villaIds);
    clock.set(addMinutes(entry, s.entryOffset < 0 ? -90 : -Math.min(s.entryOffset, 120) - 30));
    if (clock.now() > realNow) clock.set(addMinutes(realNow, -5));
    const principal = s.vi % 2 === 0 ? visitorPrincipal(visitor) : pick(guards);
    const { visit } = await inTransaction(ctx, (scope) =>
      submitVisitRequest(ctx, scope, {
        principal,
        visitorId: visitor.id,
        channel: s.vi % 2 === 0 ? 'mobile' : 'web',
        input: { villaId: villa.id, reason: pick(REASONS), reasonDetails: 'نقل أثاث للفيلا', requestedEntryAt: entry.toISOString(), durationMinutes: s.duration, clientRequestId: crypto.randomUUID() },
      }),
    );
    if (s.kind === 'pending') continue;
    clock.advanceMinutes(20);
    await inTransaction(ctx, (scope) => approveVisit(ctx, scope, admin, visit.id));
    if (s.kind === 'approved') continue;
    clock.set(addMinutes(entry, 5));
    const pass = await getActivePass(ctx.db, visit.id);
    await confirmScan(ctx, pick(guards), { qr: passQrValue(ctx, pass!), gateId: mainGate.id, action: 'entry', identityConfirmed: true }, null);
    if (s.kind === 'completed') {
      clock.set(addMinutes(entry, s.duration - 10));
      await confirmScan(ctx, pick(guards), { qr: passQrValue(ctx, pass!), gateId: northGate.id, action: 'exit' }, null);
    }
    created++;
  }

  clock.set(realNow);
  const result = await runMaintenance(ctx);

  console.log('\n✔ Development seed complete (all data is FICTIONAL)\n');
  console.log(`  Visits generated:      ${created}`);
  console.log(`  Maintenance applied:   ${result.expired} expired, ${result.autoCancelled} auto-cancelled, ${result.overdueFlagged} flagged overdue`);
  console.log('\n  Demo staff accounts (development only):');
  console.log(`    Administrator   admin   / ${adminPassword}`);
  console.log(`    Administrator   admin2  / ${adminPassword}   (English UI preference)`);
  console.log(`    Gate security   guard1  / ${securityPassword}`);
  console.log(`    Gate security   guard2  / ${securityPassword}`);
  console.log('\n  Demo visitor sign-in: use any seeded visitor ID with its mobile number; the OTP appears at /dev/otp.');
  console.log(`    Example: ${visitors[0]!.documentNumber} + 0501234501`);
  console.log(`\n  Gate QR codes: Main Gate code ${mainGate.code}, North Gate code ${northGate.code}\n`);
}

async function simulateVisit(
  ctx: ServerContext,
  args: {
    admin: StaffPrincipal;
    guards: StaffPrincipal[];
    visitor: Visitor;
    villa: { id: string; number: string };
    entry: Date;
    duration: number;
    outcome: number;
    gates: string[];
  },
) {
  const { admin, guards, visitor, villa, entry, duration, outcome } = args;
  const reason = pick(REASONS);
  clock.set(addMinutes(entry, -(60 + Math.floor(rand() * 600))));
  const selfService = rand() < 0.45;
  const { visit } = await inTransaction(ctx, (scope) =>
    submitVisitRequest(ctx, scope, {
      principal: selfService ? visitorPrincipal(visitor) : pick(guards),
      visitorId: visitor.id,
      channel: selfService ? 'mobile' : 'web',
      input: {
        villaId: villa.id,
        reason,
        reasonDetails: reason === 'other' ? 'تركيب أجهزة منزلية' : null,
        requestedEntryAt: entry.toISOString(),
        durationMinutes: duration,
        clientRequestId: crypto.randomUUID(),
      },
    }),
  );
  clock.advanceMinutes(15 + Math.floor(rand() * 30));
  if (outcome < 0.1) {
    await inTransaction(ctx, (scope) => rejectVisit(ctx, scope, admin, visit.id, pick(['لا يوجد تأكيد من الساكن على الزيارة', 'الفيلا غير مأهولة حاليًا', 'بيانات الطلب غير مكتملة'])));
    return;
  }
  if (outcome < 0.16) {
    await inTransaction(ctx, (scope) => cancelVisit(ctx, scope, visitorPrincipal(visitor), visit.id, 'تغيّر موعد الزيارة'));
    return;
  }
  await inTransaction(ctx, (scope) => approveVisit(ctx, scope, admin, visit.id));
  if (outcome < 0.22) {
    // Never arrived → expires when the entry window closes.
    clock.set(addMinutes(entry, duration + 5));
    await runMaintenance(ctx);
    return;
  }
  const pass = await getActivePass(ctx.db, visit.id);
  const qr = passQrValue(ctx, pass!);
  clock.set(addMinutes(entry, Math.floor(rand() * 40) - 10));
  const guard = pick(guards);
  const manual = rand() < 0.15;
  await confirmScan(ctx, guard, { ...(manual ? { visitId: visit.id } : { qr }), gateId: pick(args.gates), action: 'entry', identityConfirmed: true }, null);
  const overstay = outcome > 0.93 ? 30 + Math.floor(rand() * 90) : -Math.floor(rand() * 30);
  clock.set(addMinutes(entry, duration + overstay));
  if (overstay > 0) await runMaintenance(ctx);
  await confirmScan(ctx, pick(guards), { ...(manual ? { visitId: visit.id } : { qr }), gateId: pick(args.gates), action: 'exit' }, null);
}

main().catch((err: Error) => {
  console.error('✘ Seed failed:', err.message);
  process.exit(1);
});

