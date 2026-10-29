import { and, count, desc, eq, gt, inArray, lt, ne, sql, type SQL } from 'drizzle-orm';
import { gateEvents, gates, users, villas, visitors, visits, type DbExecutor, type Gate, type Visit, type VisitPass, type Visitor } from '@vms/db';
import {
  ApiError,
  isDocumentExpiredAt,
  maskDocumentNumber,
  maskPhone,
  normalizeIdentifier,
  overstayMinutes,
  type GateAction,
  type GateEventDTO,
  type ScanCode,
  type ScanResultDTO,
  type ScanVisitorDTO,
  type SystemSettings,
  type VisitDTO,
} from '@vms/shared';
import type { StaffPrincipal } from '../auth/principal';
import type { ServerContext, TxScope } from '../context';
import { inTransaction } from '../context';
import { paginate } from '../dto';
import { publish } from '../realtime';
import { actorOf, audit } from './audit';
import { notifyVisitor } from './notifications';
import { consumePass, findPassByScan, getActivePass } from './passes';
import { loadSettings } from './settings';
import { fetchVisitDTO, localRangeToUtc, mapVisitRow, visitSelect } from './visit-queries';

export interface ScanInput {
  qr?: string | undefined;
  visitId?: string | undefined;
  gateId: string;
  action: GateAction;
}

interface Loaded {
  gate: Gate;
  pass: VisitPass | null;
  visit: Visit | null;
  visitor: Visitor | null;
  method: 'qr' | 'manual';
}

interface Evaluation {
  ok: boolean;
  code: ScanCode;
  checks: ScanResultDTO['checks'];
}

async function load(tx: DbExecutor, input: ScanInput, lock: boolean): Promise<Loaded> {
  const [gate] = await tx.select().from(gates).where(eq(gates.id, input.gateId)).limit(1);
  if (!gate) throw new ApiError(400, 'gate_inactive');
  let pass: VisitPass | null = null;
  let visitId: string | undefined = input.visitId;
  const method = input.qr ? 'qr' : 'manual';
  if (input.qr) {
    pass = await findPassByScan(tx, input.qr);
    if (!pass) return { gate, pass: null, visit: null, visitor: null, method };
    visitId = pass.visitId;
  }
  if (!visitId) return { gate, pass, visit: null, visitor: null, method };
  const base = tx.select().from(visits).where(eq(visits.id, visitId)).limit(1);
  const [visit] = lock ? await base.for('update') : await base;
  if (!visit) return { gate, pass, visit: null, visitor: null, method };
  if (lock && pass) {
    // Re-read the pass after locking the visit so its status is current.
    pass = (await findPassByScan(tx, input.qr!)) ?? pass;
  }
  const [visitor] = await tx.select().from(visitors).where(eq(visitors.id, visit.visitorId)).limit(1);
  return { gate, pass, visit, visitor: visitor ?? null, method };
}

function statusCode(visit: Visit): ScanCode {
  switch (visit.status) {
    case 'pending':
      return 'not_approved';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
      return 'cancelled';
    case 'expired':
      return 'expired';
    case 'checked_in':
      return 'already_checked_in';
    case 'completed':
      return 'already_completed';
    default:
      return 'invalid_pass';
  }
}

async function evaluate(tx: DbExecutor, l: Loaded, action: GateAction, now: Date, settings: SystemSettings): Promise<Evaluation> {
  const checks: ScanResultDTO['checks'] = { approved: false, withinWindow: null, documentValid: null, passActive: null };
  const fail = (code: ScanCode): Evaluation => ({ ok: false, code, checks });
  if (!l.gate.isActive || (action === 'entry' && !l.gate.supportsEntry) || (action === 'exit' && !l.gate.supportsExit)) return fail('gate_not_allowed');
  if (!l.visit || !l.visitor) return fail('invalid_pass');
  const v = l.visit;
  checks.approved = ['approved', 'checked_in', 'completed'].includes(v.status);
  if (l.method === 'qr') {
    checks.passActive = l.pass?.status === 'active';
    if (!l.pass) return fail('invalid_pass');
    if (l.pass.status === 'consumed') return fail('already_completed');
    if (l.pass.status === 'revoked') {
      return fail(v.status === 'cancelled' || v.status === 'expired' || v.status === 'rejected' ? statusCode(v) : 'pass_revoked');
    }
  }

  if (action === 'exit') {
    // Exit is always permitted for an active check-in, even if the entry window or the document has since expired.
    if (v.status === 'checked_in') return { ok: true, code: 'exit_allowed', checks };
    if (v.status === 'approved') return fail('not_checked_in');
    return fail(statusCode(v));
  }

  if (v.status !== 'approved') return fail(statusCode(v));
  if (l.method === 'manual') {
    const active = await getActivePass(tx, v.id);
    checks.passActive = Boolean(active);
    if (!active) return fail('pass_revoked');
  }
  const start = v.entryWindowStart!;
  const end = v.entryWindowEnd!;
  checks.withinWindow = now >= start && now <= end;
  checks.documentValid = !isDocumentExpiredAt(l.visitor.documentExpiryDate, now, settings.timezone);
  if (now < start) return fail('too_early');
  if (now > end) return fail('window_closed');
  if (!checks.documentValid) return fail('document_expired');
  const [inside] = await tx
    .select({ id: visits.id })
    .from(visits)
    .where(and(eq(visits.visitorId, v.visitorId), eq(visits.status, 'checked_in'), ne(visits.id, v.id)))
    .limit(1);
  if (inside) return fail('visitor_inside_elsewhere');
  return { ok: true, code: 'entry_allowed', checks };
}

function toScanVisitor(v: Visitor, now: Date, tz: string): ScanVisitorDTO {
  return {
    id: v.id,
    fullName: v.fullName,
    documentType: v.documentType,
    documentNumber: v.documentNumber,
    nationality: v.nationality,
    mobileMasked: maskPhone(v.mobile),
    documentExpiryDate: v.documentExpiryDate,
    documentExpired: isDocumentExpiredAt(v.documentExpiryDate, now, tz),
  };
}

async function buildResult(tx: DbExecutor, l: Loaded, action: GateAction, e: Evaluation, now: Date, settings: SystemSettings, recordedAt: Date | null): Promise<ScanResultDTO> {
  const visit: VisitDTO | null = l.visit ? await fetchVisitDTO(tx, l.visit.id, 'staff', now, settings) : null;
  return {
    ok: e.ok,
    code: e.code,
    action,
    gate: { id: l.gate.id, nameAr: l.gate.nameAr, nameEn: l.gate.nameEn },
    visit,
    visitor: l.visitor ? toScanVisitor(l.visitor, now, settings.timezone) : null,
    checks: e.checks,
    recordedAt: recordedAt ? recordedAt.toISOString() : null,
  };
}

/** Validates a scanned pass (or manual selection) without changing anything. */
export async function verifyScan(ctx: ServerContext, staff: StaffPrincipal, input: ScanInput, ipHash: string | null): Promise<ScanResultDTO> {
  const now = ctx.clock.now();
  const settings = await loadSettings(ctx.db);
  const loaded = await load(ctx.db, input, false);
  const evaluation = await evaluate(ctx.db, loaded, input.action, now, settings);
  await audit(ctx.db, {
    actor: actorOf(staff),
    action: evaluation.ok ? 'scan.verified' : 'scan.rejected',
    entityType: 'visit',
    entityId: loaded.visit?.id ?? null,
    metadata: { code: evaluation.code, action: input.action, gateId: loaded.gate.id, method: loaded.method, reference: loaded.visit?.reference ?? null },
    ipHash,
    at: now,
  });
  return buildResult(ctx.db, loaded, input.action, evaluation, now, settings, null);
}

/**
 * Records entry or exit after explicit staff confirmation. The visit row is locked and every rule is
 * re-evaluated inside the transaction, so concurrent or repeated scans cannot create duplicate events
 * (the unique (visit_id, type) index on gate_events is a second safeguard).
 */
export async function confirmScan(
  ctx: ServerContext,
  staff: StaffPrincipal,
  input: ScanInput & { identityConfirmed?: boolean | undefined; notes?: string | undefined },
  ipHash: string | null,
): Promise<ScanResultDTO> {
  return inTransaction(ctx, async (scope: TxScope) => {
    const { tx, now } = scope;
    const settings = await loadSettings(tx);
    const loaded = await load(tx, input, true);
    let evaluation = await evaluate(tx, loaded, input.action, now, settings);
    if (evaluation.ok && input.action === 'entry' && input.identityConfirmed !== true) {
      evaluation = { ...evaluation, ok: false, code: 'identity_not_confirmed' };
    }
    if (!evaluation.ok || !loaded.visit) {
      await audit(tx, {
        actor: actorOf(staff),
        action: 'scan.rejected',
        entityType: 'visit',
        entityId: loaded.visit?.id ?? null,
        metadata: { code: evaluation.code, action: input.action, gateId: loaded.gate.id, method: loaded.method, stage: 'confirm' },
        ipHash,
        at: now,
      });
      return buildResult(tx, loaded, input.action, evaluation, now, settings, null);
    }

    const visit = loaded.visit;
    const passId = loaded.pass?.id ?? (await getActivePass(tx, visit.id))?.id ?? null;
    await tx.insert(gateEvents).values({
      visitId: visit.id,
      type: input.action,
      gateId: loaded.gate.id,
      recordedByUserId: staff.userId,
      recordedAt: now,
      method: loaded.method,
      passId,
      notes: input.notes?.trim() || null,
    });

    if (input.action === 'entry') {
      await tx
        .update(visits)
        .set({ status: 'checked_in', checkedInAt: now, checkInGateId: loaded.gate.id, checkInByUserId: staff.userId, version: sql`${visits.version} + 1`, updatedAt: now })
        .where(and(eq(visits.id, visit.id), eq(visits.status, 'approved')));
    } else {
      await tx
        .update(visits)
        .set({
          status: 'completed',
          checkedOutAt: now,
          checkOutGateId: loaded.gate.id,
          checkOutByUserId: staff.userId,
          overstayMinutes: overstayMinutes(visit.expectedExitAt, now),
          version: sql`${visits.version} + 1`,
          updatedAt: now,
        })
        .where(and(eq(visits.id, visit.id), eq(visits.status, 'checked_in')));
      // The pass can never be used again.
      if (passId) await consumePass(tx, passId, now);
    }

    await audit(tx, {
      actor: actorOf(staff),
      action: input.action === 'entry' ? 'visit.checked_in' : 'visit.checked_out',
      entityType: 'visit',
      entityId: visit.id,
      metadata: { reference: visit.reference, gateId: loaded.gate.id, method: loaded.method },
      ipHash,
      at: now,
    });
    await notifyVisitor(ctx, scope, visit.visitorId, input.action === 'entry' ? 'visit_checked_in' : 'visit_checked_out', { reference: visit.reference }, visit.id);
    await publish(tx, { t: 'visit', visitId: visit.id, visitorId: visit.visitorId, status: input.action === 'entry' ? 'checked_in' : 'completed' });

    const recorded: Evaluation = { ...evaluation, ok: true, code: input.action === 'entry' ? 'entry_recorded' : 'exit_recorded' };
    const reloaded = { ...loaded, visit: (await tx.select().from(visits).where(eq(visits.id, visit.id)))[0] ?? visit };
    return buildResult(tx, reloaded, input.action, recorded, now, settings, now);
  });
}

const REFERENCE_PATTERN = /^VR-?([0-9A-Z]{4})-?([0-9A-Z]{4})$/;

/** Authorized manual lookup when a pass cannot be scanned: by request reference or exact identity number. */
export async function manualLookup(
  ctx: ServerContext,
  staff: StaffPrincipal,
  input: { query: string; action: GateAction },
  ipHash: string | null,
): Promise<VisitDTO[]> {
  const now = ctx.clock.now();
  const settings = await loadSettings(ctx.db);
  const q = normalizeIdentifier(input.query).toUpperCase();
  const statuses = input.action === 'entry' ? (['approved', 'pending'] as const) : (['checked_in'] as const);
  let condition: SQL | undefined;
  const ref = REFERENCE_PATTERN.exec(q);
  if (ref) {
    condition = eq(visits.reference, `VR-${ref[1]}-${ref[2]}`);
  } else if (/^\d{10}$/.test(q)) {
    const [visitor] = await ctx.db.select({ id: visitors.id }).from(visitors).where(eq(visitors.documentNumber, q)).limit(1);
    await audit(ctx.db, {
      actor: actorOf(staff),
      action: 'visitor.lookup',
      entityType: 'visitor',
      entityId: visitor?.id ?? null,
      metadata: { found: Boolean(visitor), documentNumber: maskDocumentNumber(q), context: 'gate_manual_lookup' },
      ipHash,
      at: now,
    });
    if (!visitor) return [];
    condition = and(
      eq(visits.visitorId, visitor.id),
      inArray(visits.status, [...statuses]),
      input.action === 'entry' ? gt(visits.expectedExitAt, new Date(now.getTime() - 86_400_000)) : undefined,
    );
  } else {
    return [];
  }
  const rows = await visitSelect(ctx.db).where(condition).orderBy(desc(visits.requestedEntryAt)).limit(10);
  return rows.map((r) => mapVisitRow(r, 'staff', now, settings));
}

export async function listGateEvents(
  db: DbExecutor,
  query: { page: number; pageSize: number; gateId?: string | undefined; type?: GateAction | undefined; from?: string | undefined; to?: string | undefined },
  settings: SystemSettings,
) {
  const conditions: (SQL | undefined)[] = [];
  if (query.gateId) conditions.push(eq(gateEvents.gateId, query.gateId));
  if (query.type) conditions.push(eq(gateEvents.type, query.type));
  const range = localRangeToUtc(query.from, query.to, settings.timezone);
  if (range.start) conditions.push(sql`${gateEvents.recordedAt} >= ${range.start}`);
  if (range.end) conditions.push(lt(gateEvents.recordedAt, range.end));
  const where = and(...conditions);
  const [totalRow] = await db.select({ n: count() }).from(gateEvents).where(where);
  const rows = await db
    .select({ e: gateEvents, gate: gates, staffName: users.fullName, visit: visits, villaNumber: villas.number, visitor: visitors })
    .from(gateEvents)
    .innerJoin(gates, eq(gates.id, gateEvents.gateId))
    .innerJoin(users, eq(users.id, gateEvents.recordedByUserId))
    .innerJoin(visits, eq(visits.id, gateEvents.visitId))
    .innerJoin(villas, eq(villas.id, visits.villaId))
    .innerJoin(visitors, eq(visitors.id, visits.visitorId))
    .where(where)
    .orderBy(desc(gateEvents.recordedAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  const items: GateEventDTO[] = rows.map((r) => ({
    id: r.e.id,
    type: r.e.type,
    recordedAt: r.e.recordedAt.toISOString(),
    method: r.e.method,
    gate: { id: r.gate.id, nameAr: r.gate.nameAr, nameEn: r.gate.nameEn },
    recordedBy: { type: 'user', name: r.staffName },
    visit: {
      id: r.visit.id,
      reference: r.visit.reference,
      villaNumber: r.villaNumber,
      visitorName: r.visitor.fullName,
      documentNumberMasked: maskDocumentNumber(r.visitor.documentNumber),
      status: r.visit.status,
    },
  }));
  return paginate(items, Number(totalRow?.n ?? 0), query.page, query.pageSize);
}
