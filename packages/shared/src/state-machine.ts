import type { VisitStatus } from './constants';

/**
 * Explicit visit lifecycle. The server enforces these transitions inside a transaction
 * (with the visit row locked), so concurrent requests cannot skip or repeat a step.
 */
export const VISIT_TRANSITIONS: Readonly<Record<VisitStatus, readonly VisitStatus[]>> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['checked_in', 'cancelled', 'expired'],
  checked_in: ['completed'],
  rejected: [],
  completed: [],
  cancelled: [],
  expired: [],
};

export function canTransition(from: VisitStatus, to: VisitStatus): boolean {
  return VISIT_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: VisitStatus,
    readonly to: VisitStatus,
  ) {
    super(`Invalid visit transition ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(from: VisitStatus, to: VisitStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminalStatus(status: VisitStatus): boolean {
  return VISIT_TRANSITIONS[status].length === 0;
}

/** Statuses during which a visitor may still cancel (before physical check-in). */
export function isCancellable(status: VisitStatus): boolean {
  return status === 'pending' || status === 'approved';
}
