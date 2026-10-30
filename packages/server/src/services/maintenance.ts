import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { otpChallenges, rateLimits, sessions, villas, visits } from '@vms/db';
import { addMinutes } from '@vms/shared';
import type { ServerContext } from '../context';
import { inTransaction } from '../context';
import { describeError, logger } from '../logger';
import { publish } from '../realtime';
import { sweepArrivals } from './arrivals';
import { sweepQuickEntryImages } from './quick-entries';
import { audit } from './audit';
import { notifyStaff, notifyVisitor } from './notifications';
import { revokeActivePass } from './passes';
import { loadSettings } from './settings';

export interface MaintenanceResult {
  autoCancelled: number;
  expired: number;
  overdueFlagged: number;
  arrivalsClosed: number;
  idImagesRemoved: number;
}

const BATCH = 200;

/**
 * Applies time-based lifecycle rules. Idempotent and safe to run concurrently (rows are claimed with
 * FOR UPDATE SKIP LOCKED). Business-critical checks never depend on it: approval and gate scans
 * re-check time windows themselves, so a delayed sweep cannot authorize anything.
 *   • pending requests whose entry window has passed → cancelled by the system (not actionable)
 *   • approved visits whose entry window closed without check-in → expired, pass revoked
 *   • checked-in visitors past expected exit (+ grace) → flagged overdue; they remain inside
 *     and are never checked out automatically
 */
export async function runMaintenance(ctx: ServerContext): Promise<MaintenanceResult> {
  const result: MaintenanceResult = { autoCancelled: 0, expired: 0, overdueFlagged: 0, arrivalsClosed: 0, idImagesRemoved: 0 };
  await inTransaction(ctx, async (scope) => {
    const { tx, now } = scope;
    const settings = await loadSettings(tx);
    const lateInterval = sql`make_interval(mins => ${settings.entryWindowLateMinutes})`;

    const stalePending = await tx
      .select({ id: visits.id, visitorId: visits.visitorId, reference: visits.reference })
      .from(visits)
      .where(and(eq(visits.status, 'pending'), sql`least(${visits.requestedEntryAt} + ${lateInterval}, ${visits.expectedExitAt}) < ${now}`))
      .limit(BATCH)
      .for('update', { skipLocked: true });
    for (const v of stalePending) {
      await tx
        .update(visits)
        .set({ status: 'cancelled', cancelledAt: now, cancelledByType: 'system', cancelReason: 'window_elapsed', version: sql`${visits.version} + 1`, updatedAt: now })
        .where(and(eq(visits.id, v.id), eq(visits.status, 'pending')));
      await audit(tx, { actor: { type: 'system' }, action: 'visit.auto_cancelled', entityType: 'visit', entityId: v.id, metadata: { reference: v.reference }, at: now });
      await notifyVisitor(ctx, scope, v.visitorId, 'visit_auto_cancelled', { reference: v.reference }, v.id);
      await publish(tx, { t: 'visit', visitId: v.id, visitorId: v.visitorId, status: 'cancelled' });
    }
    result.autoCancelled = stalePending.length;

    const toExpire = await tx
      .select({ id: visits.id, visitorId: visits.visitorId, reference: visits.reference })
      .from(visits)
      .where(and(eq(visits.status, 'approved'), lt(visits.entryWindowEnd, now)))
      .limit(BATCH)
      .for('update', { skipLocked: true });
    for (const v of toExpire) {
      await tx
        .update(visits)
        .set({ status: 'expired', expiredAt: now, version: sql`${visits.version} + 1`, updatedAt: now })
        .where(and(eq(visits.id, v.id), eq(visits.status, 'approved')));
      await revokeActivePass(tx, v.id, 'expired', now);
      await audit(tx, { actor: { type: 'system' }, action: 'visit.expired', entityType: 'visit', entityId: v.id, metadata: { reference: v.reference }, at: now });
      await notifyVisitor(ctx, scope, v.visitorId, 'visit_expired', { reference: v.reference }, v.id);
      await publish(tx, { t: 'visit', visitId: v.id, visitorId: v.visitorId, status: 'expired' });
    }
    result.expired = toExpire.length;

    const overdue = await tx
      .select({ id: visits.id, visitorId: visits.visitorId, reference: visits.reference, villa: villas.number })
      .from(visits)
      .innerJoin(villas, eq(villas.id, visits.villaId))
      .where(and(eq(visits.status, 'checked_in'), isNull(visits.overdueFlaggedAt), lt(visits.expectedExitAt, addMinutes(now, -settings.overdueGraceMinutes))))
      .limit(BATCH)
      .for('update', { of: visits, skipLocked: true });
    for (const v of overdue) {
      // Flag only: the visitor stays "checked_in" until staff explicitly record the exit.
      await tx.update(visits).set({ overdueFlaggedAt: now, updatedAt: now }).where(eq(visits.id, v.id));
      await audit(tx, { actor: { type: 'system' }, action: 'visit.overdue_flagged', entityType: 'visit', entityId: v.id, metadata: { reference: v.reference }, at: now });
      await notifyStaff(ctx, scope, ['admin', 'security'], 'visit_overdue', { reference: v.reference, villa: v.villa }, v.id);
      await publish(tx, { t: 'visit', visitId: v.id, visitorId: v.visitorId, status: 'checked_in' });
    }
    result.overdueFlagged = overdue.length;

    const arrivals = await sweepArrivals(scope);
    result.arrivalsClosed = arrivals.closed;
    result.idImagesRemoved = arrivals.imagesRemoved + (await sweepQuickEntryImages(scope));

    // Housekeeping (no personal data needs to be kept in these tables).
    const dayAgo = new Date(now.getTime() - 86_400_000);
    await tx.delete(rateLimits).where(lt(rateLimits.windowStart, dayAgo));
    await tx.delete(sessions).where(and(eq(sessions.kind, 'registrant'), lt(sessions.expiresAt, dayAgo)));
    await tx.delete(otpChallenges).where(and(lt(otpChallenges.createdAt, dayAgo), sql`not exists (select 1 from sessions s where s.otp_challenge_id = ${otpChallenges.id})`));
  });
  return result;
}

/** Runs maintenance at most once every few seconds per process before freshness-sensitive reads. */
export async function ensureFresh(ctx: ServerContext): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - ctx.cache.lastFreshnessSweep < 15_000) return;
  ctx.cache.lastFreshnessSweep = nowMs;
  try {
    await runMaintenance(ctx);
  } catch (err) {
    logger.warn('maintenance.lazy_failed', describeError(err));
  }
}

/** Background interval for long-running server processes. */
export function startMaintenanceLoop(ctx: ServerContext): () => void {
  const run = () =>
    runMaintenance(ctx)
      .then((r) => {
        if (r.autoCancelled || r.expired || r.overdueFlagged) logger.info('maintenance.run', { ...r });
      })
      .catch((err) => logger.warn('maintenance.failed', describeError(err)));
  const timer = setInterval(run, ctx.config.maintenanceIntervalSeconds * 1000);
  timer.unref?.();
  void run();
  return () => clearInterval(timer);
}
