import { and, asc, count, desc, eq, gt, ilike, inArray, lt, max, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { gates, users, villas, visitorProfileVersions, visitors, visits, type DbExecutor, type Visitor } from '@vms/db';
import {
  OPEN_VISIT_STATUSES,
  addDaysToYmd,
  addMinutes,
  computeEntryWindow,
  isCancellable,
  isDocumentExpiredAt,
  isDocumentValidOn,
  isOverdue,
  visitDateYmd,
  zonedDateString,
  zonedDateTimeToUtc,
  type DashboardSummaryDTO,
  type GateRefDTO,
  type SystemSettings,
  type VisitDTO,
  type VisitListQuery,
  type VisitReviewDTO,
  type VisitorHistoryStatsDTO,
} from '@vms/shared';
import { iso, paginate, toVisitorFullDTO, toVisitorRefDTO, type VisitorStats } from '../dto';

const submitter = alias(users, 'submitter_user');
const decider = alias(users, 'decider_user');
const canceller = alias(users, 'canceller_user');
const checkInUser = alias(users, 'check_in_user');
const checkOutUser = alias(users, 'check_out_user');
const reqGate = alias(gates, 'requested_gate');
const inGate = alias(gates, 'in_gate');
const outGate = alias(gates, 'out_gate');

export type Audience = 'staff' | 'visitor';

/** Single select used by every visit read, so all endpoints return consistent DTOs. */
export function visitSelect(db: DbExecutor) {
  return db
    .select({
      visit: visits,
      visitor: visitors,
      villa: { id: villas.id, number: villas.number },
      submitterName: submitter.fullName,
      deciderName: decider.fullName,
      cancellerName: canceller.fullName,
      checkInName: checkInUser.fullName,
      checkOutName: checkOutUser.fullName,
      reqGate: { id: reqGate.id, nameAr: reqGate.nameAr, nameEn: reqGate.nameEn },
      inGate: { id: inGate.id, nameAr: inGate.nameAr, nameEn: inGate.nameEn },
      outGate: { id: outGate.id, nameAr: outGate.nameAr, nameEn: outGate.nameEn },
      hasActivePass: sql<boolean>`exists (select 1 from visit_passes p where p.visit_id = ${visits.id} and p.status = 'active')`,
      supersededById: sql<string | null>`(select v2.id from visits v2 where v2.supersedes_visit_id = ${visits.id} limit 1)`,
    })
    .from(visits)
    .innerJoin(visitors, eq(visitors.id, visits.visitorId))
    .innerJoin(villas, eq(villas.id, visits.villaId))
    .leftJoin(submitter, eq(submitter.id, visits.submittedByUserId))
    .leftJoin(decider, eq(decider.id, visits.decidedByUserId))
    .leftJoin(canceller, eq(canceller.id, visits.cancelledByUserId))
    .leftJoin(checkInUser, eq(checkInUser.id, visits.checkInByUserId))
    .leftJoin(checkOutUser, eq(checkOutUser.id, visits.checkOutByUserId))
    .leftJoin(reqGate, eq(reqGate.id, visits.requestedGateId))
    .leftJoin(inGate, eq(inGate.id, visits.checkInGateId))
    .leftJoin(outGate, eq(outGate.id, visits.checkOutGateId))
    .$dynamic();
}

export type VisitRow = Awaited<ReturnType<ReturnType<typeof visitSelect>['execute']>>[number];

const gateRef = (g: { id: string | null; nameAr: string | null; nameEn: string | null } | null): GateRefDTO | null =>
  g && g.id ? { id: g.id, nameAr: g.nameAr ?? '', nameEn: g.nameEn ?? '' } : null;

export function mapVisitRow(row: VisitRow, audience: Audience, now: Date, settings: SystemSettings): VisitDTO {
  const v = row.visit;
  const staff = audience === 'staff';
  const userRef = (name: string | null | undefined) => ({ type: 'user' as const, name: staff ? (name ?? null) : null });
  return {
    id: v.id,
    reference: v.reference,
    status: v.status,
    isOverdue: isOverdue(v, now, settings.overdueGraceMinutes),
    visitorId: v.visitorId,
    ...(staff ? { visitor: toVisitorRefDTO(row.visitor, now, settings.timezone) } : {}),
    villa: { id: row.villa.id, number: row.villa.number },
    reason: v.reason,
    reasonDetails: v.reasonDetails,
    requestedEntryAt: v.requestedEntryAt.toISOString(),
    durationMinutes: v.durationMinutes,
    expectedExitAt: v.expectedExitAt.toISOString(),
    entryWindowStart: iso(v.entryWindowStart),
    entryWindowEnd: iso(v.entryWindowEnd),
    requestedGate: gateRef(row.reqGate),
    submittedAt: v.submittedAt.toISOString(),
    submittedBy: v.submittedByType === 'user' ? userRef(row.submitterName) : { type: 'visitor', name: null },
    decidedAt: iso(v.decidedAt),
    decidedBy: v.decidedByUserId ? userRef(row.deciderName) : null,
    rejectionReason: v.rejectionReason,
    cancelledAt: iso(v.cancelledAt),
    cancelledBy: v.cancelledByType ? (v.cancelledByType === 'user' ? userRef(row.cancellerName) : { type: v.cancelledByType, name: null }) : null,
    cancelReason: v.cancelReason,
    expiredAt: iso(v.expiredAt),
    checkedInAt: iso(v.checkedInAt),
    checkInGate: gateRef(row.inGate),
    checkInBy: v.checkInByUserId ? userRef(row.checkInName) : null,
    checkedOutAt: iso(v.checkedOutAt),
    checkOutGate: gateRef(row.outGate),
    checkOutBy: v.checkOutByUserId ? userRef(row.checkOutName) : null,
    overstayMinutes: v.overstayMinutes,
    supersedesVisitId: v.supersedesVisitId,
    supersededByVisitId: row.supersededById ?? null,
    version: v.version,
    hasActivePass: Boolean(row.hasActivePass),
    canCancel: isCancellable(v.status),
  };
}

export async function fetchVisitDTO(db: DbExecutor, visitId: string, audience: Audience, now: Date, settings: SystemSettings, visitorId?: string): Promise<VisitDTO | null> {
  const where = visitorId ? and(eq(visits.id, visitId), eq(visits.visitorId, visitorId)) : eq(visits.id, visitId);
  const [row] = await visitSelect(db).where(where).limit(1);
  return row ? mapVisitRow(row, audience, now, settings) : null;
}

/** Converts an inclusive local date range (compound time zone) to UTC bounds. */
export function localRangeToUtc(from: string | undefined, to: string | undefined, tz: string): { start?: Date; end?: Date } {
  return {
    start: from ? zonedDateTimeToUtc(from, '00:00', tz) : undefined,
    end: to ? zonedDateTimeToUtc(addDaysToYmd(to, 1), '00:00', tz) : undefined,
  };
}

function searchCondition(q: string): SQL | undefined {
  const term = q.trim();
  if (!term) return undefined;
  const digits = term.replace(/\D/g, '');
  const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const conditions: (SQL | undefined)[] = [ilike(visits.reference, like), ilike(visitors.fullName, like)];
  if (digits.length >= 4) {
    conditions.push(sql`${visitors.documentNumber} like ${`${digits}%`}`);
    conditions.push(sql`${visitors.mobile} like ${`%${digits}%`}`);
  }
  return or(...conditions);
}

export async function listVisits(db: DbExecutor, query: VisitListQuery, now: Date, settings: SystemSettings) {
  const conditions: (SQL | undefined)[] = [];
  if (query.status.length) conditions.push(inArray(visits.status, query.status));
  if (query.villaId) conditions.push(eq(visits.villaId, query.villaId));
  if (query.gateId) conditions.push(or(eq(visits.checkInGateId, query.gateId), eq(visits.checkOutGateId, query.gateId), eq(visits.requestedGateId, query.gateId)));
  if (query.nationality) conditions.push(eq(visitors.nationality, query.nationality));
  const range = localRangeToUtc(query.from, query.to, settings.timezone);
  if (range.start) conditions.push(sql`${visits.requestedEntryAt} >= ${range.start}`);
  if (range.end) conditions.push(lt(visits.requestedEntryAt, range.end));
  if (query.q) conditions.push(searchCondition(query.q));
  if (query.overdue === true) {
    conditions.push(eq(visits.status, 'checked_in'), lt(visits.expectedExitAt, addMinutes(now, -settings.overdueGraceMinutes)));
  }
  const where = and(...conditions);
  const order =
    query.sort === 'oldest'
      ? [asc(visits.submittedAt)]
      : query.sort === 'entry_asc'
        ? [asc(visits.requestedEntryAt)]
        : query.sort === 'entry_desc'
          ? [desc(visits.requestedEntryAt)]
          : [desc(visits.submittedAt)];

  const [totalRow] = await db
    .select({ n: count() })
    .from(visits)
    .innerJoin(visitors, eq(visitors.id, visits.visitorId))
    .where(where);
  const rows = await visitSelect(db)
    .where(where)
    .orderBy(...order)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  return paginate(
    rows.map((r) => mapVisitRow(r, 'staff', now, settings)),
    Number(totalRow?.n ?? 0),
    query.page,
    query.pageSize,
  );
}

export async function listOwnVisits(db: DbExecutor, visitorId: string, page: number, pageSize: number, now: Date, settings: SystemSettings) {
  const where = eq(visits.visitorId, visitorId);
  const [totalRow] = await db.select({ n: count() }).from(visits).where(where);
  const rows = await visitSelect(db)
    .where(where)
    .orderBy(desc(visits.requestedEntryAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return paginate(
    rows.map((r) => mapVisitRow(r, 'visitor', now, settings)),
    Number(totalRow?.n ?? 0),
    page,
    pageSize,
  );
}

export async function listInside(db: DbExecutor, now: Date, settings: SystemSettings): Promise<VisitDTO[]> {
  const rows = await visitSelect(db).where(eq(visits.status, 'checked_in')).orderBy(asc(visits.checkedInAt)).limit(500);
  return rows.map((r) => mapVisitRow(r, 'staff', now, settings));
}

/** Approved visits whose entry window is still open or upcoming, with requested entry before the end of today. */
export async function listExpectedToday(db: DbExecutor, now: Date, settings: SystemSettings): Promise<VisitDTO[]> {
  const endOfToday = zonedDateTimeToUtc(addDaysToYmd(zonedDateString(now, settings.timezone), 1), '00:00', settings.timezone);
  const rows = await visitSelect(db)
    .where(and(eq(visits.status, 'approved'), gt(visits.entryWindowEnd, now), lt(visits.requestedEntryAt, endOfToday)))
    .orderBy(asc(visits.requestedEntryAt))
    .limit(200);
  return rows.map((r) => mapVisitRow(r, 'staff', now, settings));
}

export async function dashboardSummary(db: DbExecutor, now: Date, settings: SystemSettings): Promise<DashboardSummaryDTO> {
  const tz = settings.timezone;
  const startOfToday = zonedDateTimeToUtc(zonedDateString(now, tz), '00:00', tz);
  const endOfToday = zonedDateTimeToUtc(addDaysToYmd(zonedDateString(now, tz), 1), '00:00', tz);
  const overdueBefore = addMinutes(now, -settings.overdueGraceMinutes);
  const result = await db.execute<{
    pending: number;
    approved_upcoming: number;
    inside: number;
    completed_today: number;
    overdue: number;
    expected_today: number;
  }>(sql`
    select
      count(*) filter (where status = 'pending')::int as pending,
      count(*) filter (where status = 'approved' and entry_window_end > ${now})::int as approved_upcoming,
      count(*) filter (where status = 'checked_in')::int as inside,
      count(*) filter (where status = 'completed' and checked_out_at >= ${startOfToday} and checked_out_at < ${endOfToday})::int as completed_today,
      count(*) filter (where status = 'checked_in' and expected_exit_at < ${overdueBefore})::int as overdue,
      count(*) filter (where status = 'approved' and entry_window_end > ${now} and requested_entry_at < ${endOfToday})::int as expected_today
    from visits
    where status in ('pending', 'approved', 'checked_in') or (status = 'completed' and checked_out_at >= ${startOfToday})
  `);
  const r = result.rows[0];
  return {
    pending: Number(r?.pending ?? 0),
    approvedUpcoming: Number(r?.approved_upcoming ?? 0),
    inside: Number(r?.inside ?? 0),
    completedToday: Number(r?.completed_today ?? 0),
    overdue: Number(r?.overdue ?? 0),
    expectedToday: Number(r?.expected_today ?? 0),
    generatedAt: now.toISOString(),
  };
}

export async function visitorStats(db: DbExecutor, visitorId: string): Promise<VisitorStats> {
  const [row] = await db
    .select({
      visitCount: count(),
      lastVisitAt: max(visits.checkedInAt),
      hasOpen: sql<boolean>`bool_or(${visits.status} in ('pending', 'approved', 'checked_in'))`,
    })
    .from(visits)
    .where(eq(visits.visitorId, visitorId));
  return { visitCount: Number(row?.visitCount ?? 0), lastVisitAt: row?.lastVisitAt ?? null, hasOpenVisit: Boolean(row?.hasOpen) };
}

/** Visitor history ordered chronologically (oldest first). */
export async function visitorHistory(db: DbExecutor, visitorId: string, now: Date, settings: SystemSettings, excludeVisitId?: string): Promise<VisitDTO[]> {
  const rows = await visitSelect(db)
    .where(eq(visits.visitorId, visitorId))
    .orderBy(asc(visits.requestedEntryAt))
    .limit(500);
  return rows.filter((r) => r.visit.id !== excludeVisitId).map((r) => mapVisitRow(r, 'staff', now, settings));
}

export function historyStats(history: VisitDTO[]): VisitorHistoryStatsDTO {
  return {
    total: history.length,
    approved: history.filter((v) => v.decidedBy && !v.rejectionReason).length,
    rejected: history.filter((v) => v.status === 'rejected').length,
    completed: history.filter((v) => v.status === 'completed').length,
    cancelled: history.filter((v) => v.status === 'cancelled').length,
    expired: history.filter((v) => v.status === 'expired').length,
    overstays: history.filter((v) => (v.overstayMinutes ?? 0) > 0 || v.isOverdue).length,
  };
}

/** Why an administrator cannot approve this request now (translation key), or null. */
export function approvalBlockedReason(
  visit: { status: string; requestedEntryAt: Date; expectedExitAt: Date },
  visitor: Visitor,
  now: Date,
  settings: SystemSettings,
): string | null {
  if (visit.status !== 'pending') return 'errors.invalid_transition';
  const window = computeEntryWindow(visit.requestedEntryAt, visit.expectedExitAt, settings);
  if (window.end.getTime() <= now.getTime()) return 'errors.window_passed';
  if (!isDocumentValidOn(visitor.documentExpiryDate, visitDateYmd(visit.requestedEntryAt, settings.timezone))) return 'errors.document_expired';
  if (isDocumentExpiredAt(visitor.documentExpiryDate, now, settings.timezone)) return 'errors.document_expired';
  return null;
}

export async function buildReview(db: DbExecutor, visitId: string, now: Date, settings: SystemSettings): Promise<VisitReviewDTO | null> {
  const [row] = await visitSelect(db).where(eq(visits.id, visitId)).limit(1);
  if (!row) return null;
  const visitor = row.visitor;
  const tz = settings.timezone;
  const [stats, history, submittedVersion] = await Promise.all([
    visitorStats(db, visitor.id),
    visitorHistory(db, visitor.id, now, settings, visitId),
    db.select({ version: visitorProfileVersions.version }).from(visitorProfileVersions).where(eq(visitorProfileVersions.id, row.visit.profileVersionId)),
  ]);
  const today = zonedDateString(now, tz);
  const [y, m, d] = visitor.documentExpiryDate.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const daysUntilExpiry = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
  const blocked = approvalBlockedReason(row.visit, visitor, now, settings);
  return {
    visit: mapVisitRow(row, 'staff', now, settings),
    visitor: toVisitorFullDTO(visitor, stats, now, tz),
    identity: {
      expired: isDocumentExpiredAt(visitor.documentExpiryDate, now, tz),
      validOnVisitDate: isDocumentValidOn(visitor.documentExpiryDate, visitDateYmd(row.visit.requestedEntryAt, tz)),
      daysUntilExpiry,
    },
    history,
    stats: historyStats(history),
    canDecide: row.visit.status === 'pending' && blocked === null,
    profileChangedSinceSubmission: (submittedVersion[0]?.version ?? visitor.version) !== visitor.version,
    approvalBlockedReason: row.visit.status === 'pending' ? blocked : null,
  };
}

export const OPEN_STATUSES = [...OPEN_VISIT_STATUSES];

export async function findOverlappingOpenVisit(db: DbExecutor, visitorId: string, entry: Date, exit: Date, excludeVisitId?: string): Promise<string | null> {
  const conditions = [
    eq(visits.visitorId, visitorId),
    inArray(visits.status, OPEN_STATUSES),
    lt(visits.requestedEntryAt, exit),
    gt(visits.expectedExitAt, entry),
  ];
  if (excludeVisitId) conditions.push(sql`${visits.id} <> ${excludeVisitId}`);
  const [row] = await db.select({ id: visits.id }).from(visits).where(and(...conditions)).limit(1);
  return row?.id ?? null;
}

