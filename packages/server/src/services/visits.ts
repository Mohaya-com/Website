import { and, eq, sql } from 'drizzle-orm';
import { gates, villas, visitDecisions, visitorProfileVersions, visitors, visits, type DbExecutor, type Visit, type Visitor } from '@vms/db';
import {
  ApiError,
  computeEntryWindow,
  computeExpectedExit,
  hasPermission,
  isCancellable,
  isDocumentExpiredAt,
  isDocumentValidOn,
  validateRequestTiming,
  visitDateYmd,
  type ClientKind,
  type SystemSettings,
  type VisitDTO,
  type VisitReason,
} from '@vms/shared';
import type { StaffPrincipal, VisitorPrincipal } from '../auth/principal';
import type { ServerContext, TxScope } from '../context';
import { randomCode } from '../crypto';
import { publish } from '../realtime';
import { actorOf, audit } from './audit';
import { notifyStaff, notifyVisitor } from './notifications';
import { issuePass, revokeActivePass } from './passes';
import { loadSettings } from './settings';
import { fetchVisitDTO, findOverlappingOpenVisit } from './visit-queries';

export interface VisitDetailsInput {
  villaId: string;
  reason: VisitReason;
  reasonDetails?: string | null | undefined;
  requestedEntryAt: string;
  durationMinutes: number;
  requestedGateId?: string | null | undefined;
}

type Submitter = StaffPrincipal | VisitorPrincipal;

export async function lockVisit(tx: DbExecutor, visitId: string): Promise<Visit | null> {
  const [row] = await tx.select().from(visits).where(eq(visits.id, visitId)).for('update').limit(1);
  return row ?? null;
}

async function generateReference(tx: DbExecutor): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const reference = `VR-${randomCode(4)}-${randomCode(4)}`;
    const [exists] = await tx.select({ id: visits.id }).from(visits).where(eq(visits.reference, reference)).limit(1);
    if (!exists) return reference;
  }
  throw new ApiError(500, 'internal_error');
}

async function currentVersionId(tx: DbExecutor, visitor: Visitor): Promise<string> {
  const [row] = await tx
    .select({ id: visitorProfileVersions.id })
    .from(visitorProfileVersions)
    .where(and(eq(visitorProfileVersions.visitorId, visitor.id), eq(visitorProfileVersions.version, visitor.version)))
    .limit(1);
  if (!row) throw new ApiError(500, 'internal_error');
  return row.id;
}

async function assertVillaActive(tx: DbExecutor, villaId: string): Promise<{ id: string; number: string }> {
  const [villa] = await tx.select().from(villas).where(eq(villas.id, villaId)).limit(1);
  if (!villa || !villa.isActive) throw new ApiError(400, 'validation_error', { villaId: 'errors.villa_inactive' });
  return { id: villa.id, number: villa.number };
}

async function assertGateActive(tx: DbExecutor, gateId: string | null | undefined): Promise<string | null> {
  if (!gateId) return null;
  const [gate] = await tx.select().from(gates).where(eq(gates.id, gateId)).limit(1);
  return gate && gate.isActive ? gate.id : null;
}

function validateTiming(entry: Date, durationMinutes: number, visitor: Visitor, now: Date, settings: SystemSettings) {
  const problem = validateRequestTiming({
    requestedEntryAt: entry,
    durationMinutes,
    documentExpiryDate: visitor.documentExpiryDate,
    now,
    settings,
  });
  if (problem) {
    const field = problem.field === 'documentExpiry' ? 'requestedEntryAt' : problem.field;
    throw new ApiError(400, problem.error === 'document_expired_on_visit_date' ? 'document_expired' : 'validation_error', {
      [field]: `validation.timing.${problem.error}`,
    });
  }
}

/**
 * Submits a new visit request (always pending — every visit requires administrator approval).
 * Idempotent on `clientRequestId`, so retried submissions never create duplicates.
 */
export async function submitVisitRequest(
  ctx: ServerContext,
  scope: TxScope,
  args: { principal: Submitter; visitorId: string; input: VisitDetailsInput & { clientRequestId: string }; channel: ClientKind; supersedesVisitId?: string },
): Promise<{ visit: VisitDTO; duplicate: boolean }> {
  const { tx, now } = scope;
  const { principal, input } = args;
  const settings = await loadSettings(tx);

  const [existing] = await tx.select().from(visits).where(eq(visits.clientRequestId, input.clientRequestId)).limit(1);
  if (existing) {
    if (existing.visitorId !== args.visitorId) throw new ApiError(409, 'duplicate_request');
    const dto = await fetchVisitDTO(tx, existing.id, principal.kind === 'staff' ? 'staff' : 'visitor', now, settings);
    return { visit: dto!, duplicate: true };
  }

  // Lock the visitor row so concurrent submissions for the same visitor are serialized.
  const [visitor] = await tx.select().from(visitors).where(eq(visitors.id, args.visitorId)).for('update').limit(1);
  if (!visitor) throw new ApiError(404, 'not_found');

  const villa = await assertVillaActive(tx, input.villaId);
  const requestedGateId = await assertGateActive(tx, input.requestedGateId);
  const entry = new Date(input.requestedEntryAt);
  validateTiming(entry, input.durationMinutes, visitor, now, settings);
  const exit = computeExpectedExit(entry, input.durationMinutes);
  if (await findOverlappingOpenVisit(tx, visitor.id, entry, exit, args.supersedesVisitId)) throw new ApiError(409, 'overlapping_visit');

  const reference = await generateReference(tx);
  const [created] = await tx
    .insert(visits)
    .values({
      reference,
      visitorId: visitor.id,
      profileVersionId: await currentVersionId(tx, visitor),
      villaId: villa.id,
      reason: input.reason,
      reasonDetails: input.reason === 'other' ? (input.reasonDetails?.trim() ?? null) : input.reasonDetails?.trim() || null,
      requestedEntryAt: entry,
      durationMinutes: input.durationMinutes,
      expectedExitAt: exit,
      requestedGateId,
      status: 'pending',
      submittedAt: now,
      submittedByType: principal.kind === 'staff' ? 'user' : 'visitor',
      submittedByUserId: principal.kind === 'staff' ? principal.userId : null,
      submissionChannel: args.channel,
      clientRequestId: input.clientRequestId,
      supersedesVisitId: args.supersedesVisitId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const visit = created!;

  await audit(tx, {
    actor: actorOf(principal),
    action: 'visit.submitted',
    entityType: 'visit',
    entityId: visit.id,
    metadata: { reference, villa: villa.number, channel: args.channel, onBehalf: principal.kind === 'staff', supersedes: args.supersedesVisitId ?? null },
    at: now,
  });
  await notifyStaff(ctx, scope, ['admin'], 'visit_submitted', { reference, villa: villa.number }, visit.id);
  await publish(tx, { t: 'visit', visitId: visit.id, visitorId: visitor.id, status: visit.status });

  const dto = await fetchVisitDTO(tx, visit.id, principal.kind === 'staff' ? 'staff' : 'visitor', now, settings);
  return { visit: dto!, duplicate: false };
}

function assertCanActOnVisit(principal: Submitter, visit: Visit, permission: 'visits.modify' | 'visits.cancel_any') {
  if (principal.kind === 'visitor') {
    // Visitors can act only on their own visits; others are reported as not found.
    if (visit.visitorId !== principal.visitorId) throw new ApiError(404, 'not_found');
  } else if (!hasPermission(principal.role, permission)) {
    throw new ApiError(403, 'forbidden');
  }
}

export async function approveVisit(ctx: ServerContext, scope: TxScope, admin: StaffPrincipal, visitId: string, expectedVersion?: number): Promise<VisitDTO> {
  if (!hasPermission(admin.role, 'visits.approve')) throw new ApiError(403, 'forbidden');
  const { tx, now } = scope;
  const visit = await lockVisit(tx, visitId);
  if (!visit) throw new ApiError(404, 'not_found');
  if (expectedVersion !== undefined && visit.version !== expectedVersion) throw new ApiError(409, 'stale_version');
  if (visit.status !== 'pending') throw new ApiError(409, 'invalid_transition', undefined, { status: visit.status });

  const settings = await loadSettings(tx);
  const [visitor] = await tx.select().from(visitors).where(eq(visitors.id, visit.visitorId)).for('share').limit(1);
  if (!visitor) throw new ApiError(404, 'not_found');

  const window = computeEntryWindow(visit.requestedEntryAt, visit.expectedExitAt, settings);
  if (window.end.getTime() <= now.getTime()) throw new ApiError(409, 'window_passed');
  const tz = settings.timezone;
  if (!isDocumentValidOn(visitor.documentExpiryDate, visitDateYmd(visit.requestedEntryAt, tz)) || isDocumentExpiredAt(visitor.documentExpiryDate, now, tz)) {
    throw new ApiError(409, 'document_expired');
  }

  const updated = await tx
    .update(visits)
    .set({
      status: 'approved',
      decidedAt: now,
      decidedByUserId: admin.userId,
      entryWindowStart: window.start,
      entryWindowEnd: window.end,
      version: sql`${visits.version} + 1`,
      updatedAt: now,
    })
    .where(and(eq(visits.id, visit.id), eq(visits.status, 'pending')))
    .returning({ id: visits.id });
  if (updated.length !== 1) throw new ApiError(409, 'invalid_transition');

  await tx.insert(visitDecisions).values({
    visitId: visit.id,
    decision: 'approved',
    decidedByUserId: admin.userId,
    decidedAt: now,
    profileVersionId: await currentVersionId(tx, visitor),
    entryWindowStart: window.start,
    entryWindowEnd: window.end,
  });
  await issuePass(ctx, tx, visit.id, now);

  const [villa] = await tx.select({ number: villas.number }).from(villas).where(eq(villas.id, visit.villaId));
  await audit(tx, {
    actor: actorOf(admin),
    action: 'visit.approved',
    entityType: 'visit',
    entityId: visit.id,
    metadata: { reference: visit.reference, windowStart: window.start.toISOString(), windowEnd: window.end.toISOString() },
    at: now,
  });
  await notifyVisitor(ctx, scope, visit.visitorId, 'visit_approved', { reference: visit.reference, villa: villa?.number }, visit.id);
  await publish(tx, { t: 'visit', visitId: visit.id, visitorId: visit.visitorId, status: 'approved' });
  return (await fetchVisitDTO(tx, visit.id, 'staff', now, settings))!;
}

export async function rejectVisit(ctx: ServerContext, scope: TxScope, admin: StaffPrincipal, visitId: string, reason: string, expectedVersion?: number): Promise<VisitDTO> {
  if (!hasPermission(admin.role, 'visits.approve')) throw new ApiError(403, 'forbidden');
  const { tx, now } = scope;
  const visit = await lockVisit(tx, visitId);
  if (!visit) throw new ApiError(404, 'not_found');
  if (expectedVersion !== undefined && visit.version !== expectedVersion) throw new ApiError(409, 'stale_version');
  if (visit.status !== 'pending') throw new ApiError(409, 'invalid_transition', undefined, { status: visit.status });
  const settings = await loadSettings(tx);
  const [visitor] = await tx.select().from(visitors).where(eq(visitors.id, visit.visitorId)).limit(1);

  await tx
    .update(visits)
    .set({ status: 'rejected', decidedAt: now, decidedByUserId: admin.userId, rejectionReason: reason, version: sql`${visits.version} + 1`, updatedAt: now })
    .where(eq(visits.id, visit.id));
  await tx.insert(visitDecisions).values({
    visitId: visit.id,
    decision: 'rejected',
    decidedByUserId: admin.userId,
    decidedAt: now,
    reason,
    profileVersionId: await currentVersionId(tx, visitor!),
  });
  await audit(tx, { actor: actorOf(admin), action: 'visit.rejected', entityType: 'visit', entityId: visit.id, metadata: { reference: visit.reference }, at: now });
  await notifyVisitor(ctx, scope, visit.visitorId, 'visit_rejected', { reference: visit.reference }, visit.id);
  await publish(tx, { t: 'visit', visitId: visit.id, visitorId: visit.visitorId, status: 'rejected' });
  return (await fetchVisitDTO(tx, visit.id, 'staff', now, settings))!;
}

export async function cancelVisit(ctx: ServerContext, scope: TxScope, principal: Submitter, visitId: string, reason?: string): Promise<VisitDTO> {
  const { tx, now } = scope;
  const visit = await lockVisit(tx, visitId);
  if (!visit) throw new ApiError(404, 'not_found');
  assertCanActOnVisit(principal, visit, 'visits.cancel_any');
  // Cancellation is possible only before check-in.
  if (!isCancellable(visit.status)) throw new ApiError(409, 'invalid_transition', undefined, { status: visit.status });
  const settings = await loadSettings(tx);

  await tx
    .update(visits)
    .set({
      status: 'cancelled',
      cancelledAt: now,
      cancelledByType: principal.kind === 'staff' ? 'user' : 'visitor',
      cancelledByUserId: principal.kind === 'staff' ? principal.userId : null,
      cancelReason: reason?.trim() || null,
      version: sql`${visits.version} + 1`,
      updatedAt: now,
    })
    .where(eq(visits.id, visit.id));
  await revokeActivePass(tx, visit.id, 'cancelled', now);
  await audit(tx, {
    actor: actorOf(principal),
    action: 'visit.cancelled',
    entityType: 'visit',
    entityId: visit.id,
    metadata: { reference: visit.reference, previousStatus: visit.status },
    at: now,
  });
  if (principal.kind === 'staff') await notifyVisitor(ctx, scope, visit.visitorId, 'visit_cancelled', { reference: visit.reference }, visit.id);
  await publish(tx, { t: 'visit', visitId: visit.id, visitorId: visit.visitorId, status: 'cancelled' });
  return (await fetchVisitDTO(tx, visit.id, principal.kind === 'staff' ? 'staff' : 'visitor', now, settings))!;
}

/**
 * Modifies villa, reason or timing. Pending requests are updated in place. Approved requests are
 * replaced: the original is cancelled (its pass invalidated) and a new pending request is created,
 * because any change after approval requires a new approval.
 */
export async function modifyVisit(
  ctx: ServerContext,
  scope: TxScope,
  principal: Submitter,
  visitId: string,
  input: Partial<VisitDetailsInput> & { expectedVersion: number },
  channel: ClientKind,
): Promise<{ visit: VisitDTO; replaced: boolean }> {
  const { tx, now } = scope;
  const visit = await lockVisit(tx, visitId);
  if (!visit) throw new ApiError(404, 'not_found');
  assertCanActOnVisit(principal, visit, 'visits.modify');
  if (visit.version !== input.expectedVersion) throw new ApiError(409, 'stale_version');
  if (visit.status !== 'pending' && visit.status !== 'approved') throw new ApiError(409, 'invalid_transition', undefined, { status: visit.status });

  const settings = await loadSettings(tx);
  const audience = principal.kind === 'staff' ? 'staff' : 'visitor';
  const next = {
    villaId: input.villaId ?? visit.villaId,
    reason: input.reason ?? visit.reason,
    reasonDetails: input.reasonDetails !== undefined ? input.reasonDetails : visit.reasonDetails,
    requestedEntryAt: input.requestedEntryAt ? new Date(input.requestedEntryAt) : visit.requestedEntryAt,
    durationMinutes: input.durationMinutes ?? visit.durationMinutes,
  };
  const changed: string[] = [];
  if (next.villaId !== visit.villaId) changed.push('villa');
  if (next.reason !== visit.reason) changed.push('reason');
  if ((next.reasonDetails ?? null) !== (visit.reasonDetails ?? null)) changed.push('reasonDetails');
  if (next.requestedEntryAt.getTime() !== visit.requestedEntryAt.getTime()) changed.push('requestedEntryAt');
  if (next.durationMinutes !== visit.durationMinutes) changed.push('duration');
  if (changed.length === 0) return { visit: (await fetchVisitDTO(tx, visit.id, audience, now, settings))!, replaced: false };
  if (next.reason === 'other' && (!next.reasonDetails || next.reasonDetails.trim().length < 3)) {
    throw new ApiError(400, 'validation_error', { reasonDetails: 'validation.reasonDetailsRequired' });
  }

  const [visitor] = await tx.select().from(visitors).where(eq(visitors.id, visit.visitorId)).for('update').limit(1);
  const villa = await assertVillaActive(tx, next.villaId);
  validateTiming(next.requestedEntryAt, next.durationMinutes, visitor!, now, settings);

  if (visit.status === 'pending') {
    const exit = computeExpectedExit(next.requestedEntryAt, next.durationMinutes);
    if (await findOverlappingOpenVisit(tx, visit.visitorId, next.requestedEntryAt, exit, visit.id)) throw new ApiError(409, 'overlapping_visit');
    await tx
      .update(visits)
      .set({
        villaId: next.villaId,
        reason: next.reason,
        reasonDetails: next.reasonDetails?.trim() || null,
        requestedEntryAt: next.requestedEntryAt,
        durationMinutes: next.durationMinutes,
        expectedExitAt: exit,
        version: sql`${visits.version} + 1`,
        updatedAt: now,
      })
      .where(eq(visits.id, visit.id));
    await audit(tx, { actor: actorOf(principal), action: 'visit.modified', entityType: 'visit', entityId: visit.id, metadata: { reference: visit.reference, changedFields: changed }, at: now });
    await publish(tx, { t: 'visit', visitId: visit.id, visitorId: visit.visitorId, status: 'pending' });
    return { visit: (await fetchVisitDTO(tx, visit.id, audience, now, settings))!, replaced: false };
  }

  // Approved: cancel and replace with a new request that needs a fresh approval.
  await tx
    .update(visits)
    .set({
      status: 'cancelled',
      cancelledAt: now,
      cancelledByType: principal.kind === 'staff' ? 'user' : 'visitor',
      cancelledByUserId: principal.kind === 'staff' ? principal.userId : null,
      cancelReason: 'replaced_by_modification',
      version: sql`${visits.version} + 1`,
      updatedAt: now,
    })
    .where(eq(visits.id, visit.id));
  await revokeActivePass(tx, visit.id, 'replaced', now);
  await publish(tx, { t: 'visit', visitId: visit.id, visitorId: visit.visitorId, status: 'cancelled' });

  const { visit: replacement } = await submitVisitRequest(ctx, scope, {
    principal,
    visitorId: visit.visitorId,
    channel,
    supersedesVisitId: visit.id,
    input: {
      villaId: villa.id,
      reason: next.reason,
      reasonDetails: next.reasonDetails,
      requestedEntryAt: next.requestedEntryAt.toISOString(),
      durationMinutes: next.durationMinutes,
      requestedGateId: visit.requestedGateId,
      clientRequestId: crypto.randomUUID(),
    },
  });
  await audit(tx, {
    actor: actorOf(principal),
    action: 'visit.replaced',
    entityType: 'visit',
    entityId: visit.id,
    metadata: { reference: visit.reference, replacement: replacement.reference, changedFields: changed },
    at: now,
  });
  if (principal.kind === 'staff') await notifyVisitor(ctx, scope, visit.visitorId, 'visit_replaced', { reference: visit.reference }, replacement.id);
  return { visit: replacement, replaced: true };
}
