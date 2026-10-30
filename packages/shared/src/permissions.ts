import type { PrincipalRole, StaffRole } from './constants';

/**
 * Role → permission matrix. The server checks these on every protected action;
 * clients use the same matrix only to decide what to display.
 */
export const PERMISSIONS = {
  'dashboard.admin': ['admin'],
  'dashboard.security': ['admin', 'security'],
  'visits.approve': ['admin'],
  'visits.read': ['admin', 'security'],
  'visits.read_history': ['admin'],
  'visits.create_on_behalf': ['admin', 'security'],
  'visits.modify': ['admin', 'security'],
  'visits.cancel_any': ['admin'],
  'visits.view_pass': ['admin', 'security'],
  'visitors.lookup_exact': ['admin', 'security'],
  'visitors.search': ['admin'],
  'visitors.read_full': ['admin'],
  'visitors.create': ['admin', 'security'],
  /** Explicit, reasoned and audited updates of expiry date, nationality and (staff-assisted) mobile number. */
  'visitors.update_contact': ['admin', 'security'],
  /** Name, document type and number. */
  'visitors.update_identity': ['admin'],
  'scan.verify': ['admin', 'security'],
  'scan.confirm': ['admin', 'security'],
  'occupancy.read': ['admin', 'security'],
  'gate_log.read': ['admin', 'security'],
  'users.manage': ['admin'],
  'villas.manage': ['admin'],
  'gates.manage': ['admin'],
  'settings.manage': ['admin'],
  'audit.read': ['admin'],
  /** Review arrival registrations (made without a verification code) against the ID photo. */
  'arrivals.review': ['admin'],
  /** Record visitors at the gate with an ID photo and the villa, and record their exit. */
  'gate.quick_entry': ['admin', 'security'],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: PrincipalRole | null | undefined, permission: Permission): boolean {
  if (!role || role === 'visitor' || role === 'registrant') return false;
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

export function isStaffRole(role: PrincipalRole | null | undefined): role is StaffRole {
  return role === 'admin' || role === 'security';
}

/** Profile fields each staff role may change (always with a reason, always audited). */
export const PROFILE_FIELD_PERMISSIONS = {
  fullName: 'visitors.update_identity',
  documentType: 'visitors.update_identity',
  documentNumber: 'visitors.update_identity',
  documentExpiry: 'visitors.update_contact',
  nationality: 'visitors.update_contact',
  mobile: 'visitors.update_contact',
} as const satisfies Record<string, Permission>;
