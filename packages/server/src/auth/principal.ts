import type { OtpChallenge, User, Visitor } from '@vms/db';
import { ApiError, hasPermission, type Locale, type Permission, type PrincipalRole, type StaffRole } from '@vms/shared';

export interface StaffPrincipal {
  kind: 'staff';
  role: StaffRole;
  sessionId: string;
  userId: string;
  user: User;
  locale: Locale;
  expiresAt: Date;
}

export interface VisitorPrincipal {
  kind: 'visitor';
  role: 'visitor';
  sessionId: string;
  visitorId: string;
  visitor: Visitor;
  locale: Locale;
  expiresAt: Date;
}

/** A visitor who proved control of a mobile number for an unregistered identity and must now complete registration. */
export interface RegistrantPrincipal {
  kind: 'registrant';
  role: 'registrant';
  sessionId: string;
  challenge: OtpChallenge;
  locale: Locale;
  expiresAt: Date;
}

export type Principal = StaffPrincipal | VisitorPrincipal | RegistrantPrincipal;

export function roleOf(p: Principal | null): PrincipalRole | null {
  return p?.role ?? null;
}

export function requireAuthenticated(p: Principal | null): Principal {
  if (!p) throw new ApiError(401, 'unauthenticated');
  return p;
}

export function requireStaff(p: Principal | null): StaffPrincipal {
  const principal = requireAuthenticated(p);
  if (principal.kind !== 'staff') throw new ApiError(403, 'forbidden');
  return principal;
}

export function requirePermission(p: Principal | null, permission: Permission): StaffPrincipal {
  const staff = requireStaff(p);
  if (!hasPermission(staff.role, permission)) throw new ApiError(403, 'forbidden');
  return staff;
}

export function requireVisitor(p: Principal | null): VisitorPrincipal {
  const principal = requireAuthenticated(p);
  if (principal.kind === 'registrant') throw new ApiError(403, 'registration_required');
  if (principal.kind !== 'visitor') throw new ApiError(403, 'forbidden');
  return principal;
}

export function requireRegistrant(p: Principal | null): RegistrantPrincipal {
  const principal = requireAuthenticated(p);
  if (principal.kind !== 'registrant') throw new ApiError(403, 'forbidden');
  return principal;
}
