import type { VisitStatus } from './constants';
import type { SystemSettings } from './settings';
import { MIN_VISIT_DURATION_MINUTES } from './settings';
import { addMinutes, zonedDateString } from './time';

/** Expected exit = requested entry + duration. */
export function computeExpectedExit(requestedEntryAt: Date, durationMinutes: number): Date {
  return addMinutes(requestedEntryAt, durationMinutes);
}

/**
 * The approved entry window. Entry is permitted from `entryWindowEarlyMinutes` before the requested
 * entry time until `entryWindowLateMinutes` after it, but never after the expected exit.
 */
export function computeEntryWindow(
  requestedEntryAt: Date,
  expectedExitAt: Date,
  settings: Pick<SystemSettings, 'entryWindowEarlyMinutes' | 'entryWindowLateMinutes'>,
): { start: Date; end: Date } {
  const start = addMinutes(requestedEntryAt, -settings.entryWindowEarlyMinutes);
  const lateEnd = addMinutes(requestedEntryAt, settings.entryWindowLateMinutes);
  const end = lateEnd.getTime() < expectedExitAt.getTime() ? lateEnd : expectedExitAt;
  return { start, end };
}

/** A document is valid through (and including) its expiry date. Dates are YYYY-MM-DD strings. */
export function isDocumentValidOn(expiryYmd: string, onYmd: string): boolean {
  return expiryYmd >= onYmd;
}

/** The calendar date of the visit (in the compound time zone) used for identity-expiry checks. */
export function visitDateYmd(requestedEntryAt: Date, timeZone: string): string {
  return zonedDateString(requestedEntryAt, timeZone);
}

export function isDocumentExpiredAt(expiryYmd: string, at: Date, timeZone: string): boolean {
  return !isDocumentValidOn(expiryYmd, zonedDateString(at, timeZone));
}

/** A checked-in visitor past the expected exit (plus grace) is overdue. They remain "inside". */
export function isOverdue(
  visit: { status: VisitStatus; expectedExitAt: Date | string },
  now: Date,
  graceMinutes = 0,
): boolean {
  if (visit.status !== 'checked_in') return false;
  const exit = typeof visit.expectedExitAt === 'string' ? new Date(visit.expectedExitAt) : visit.expectedExitAt;
  return now.getTime() > addMinutes(exit, graceMinutes).getTime();
}

export function overstayMinutes(expectedExitAt: Date, checkedOutAt: Date): number {
  return Math.max(0, Math.floor((checkedOutAt.getTime() - expectedExitAt.getTime()) / 60_000));
}

export type RequestTimingError =
  | 'entry_in_past'
  | 'entry_too_far'
  | 'duration_too_short'
  | 'duration_too_long'
  | 'document_expired_on_visit_date';

/** Validates requested timing against settings. `now` comes from the server clock. */
export function validateRequestTiming(input: {
  requestedEntryAt: Date;
  durationMinutes: number;
  documentExpiryDate?: string | null;
  now: Date;
  settings: Pick<SystemSettings, 'maxAdvanceBookingDays' | 'maxVisitDurationMinutes' | 'timezone' | 'entryWindowLateMinutes'>;
}): { field: 'requestedEntryAt' | 'durationMinutes' | 'documentExpiry'; error: RequestTimingError } | null {
  const { requestedEntryAt, durationMinutes, now, settings } = input;
  // Allow a short tolerance so "now" submitted from a slow device is still accepted.
  if (requestedEntryAt.getTime() < now.getTime() - 15 * 60_000) {
    return { field: 'requestedEntryAt', error: 'entry_in_past' };
  }
  if (requestedEntryAt.getTime() > now.getTime() + settings.maxAdvanceBookingDays * 86_400_000) {
    return { field: 'requestedEntryAt', error: 'entry_too_far' };
  }
  if (durationMinutes < MIN_VISIT_DURATION_MINUTES) return { field: 'durationMinutes', error: 'duration_too_short' };
  if (durationMinutes > settings.maxVisitDurationMinutes) return { field: 'durationMinutes', error: 'duration_too_long' };
  if (input.documentExpiryDate && !isDocumentValidOn(input.documentExpiryDate, visitDateYmd(requestedEntryAt, settings.timezone))) {
    return { field: 'documentExpiry', error: 'document_expired_on_visit_date' };
  }
  return null;
}
