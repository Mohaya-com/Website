/** Visit lifecycle statuses. Stored as a Postgres enum with the same values. */
export const VISIT_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'checked_in',
  'completed',
  'cancelled',
  'expired',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** Statuses that occupy the visitor's calendar (an "active" visit). */
export const OPEN_VISIT_STATUSES = ['pending', 'approved', 'checked_in'] as const satisfies readonly VisitStatus[];

export const VISIT_REASONS = ['personal', 'delivery', 'maintenance', 'service_provider', 'other'] as const;
export type VisitReason = (typeof VISIT_REASONS)[number];

export const DOCUMENT_TYPES = ['national_id', 'iqama'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const STAFF_ROLES = ['admin', 'security'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type PrincipalRole = StaffRole | 'visitor' | 'registrant' | 'resident';

export const MAINTENANCE_CATEGORIES = ['plumbing', 'electrical', 'ac', 'carpentry', 'cleaning', 'other'] as const;
export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];
export const MAINTENANCE_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];
export const RESIDENT_STATUSES = ['pending', 'active', 'rejected', 'disabled'] as const;
export type ResidentStatus = (typeof RESIDENT_STATUSES)[number];

export const GATE_ACTIONS = ['entry', 'exit'] as const;
export type GateAction = (typeof GATE_ACTIONS)[number];

export const CALENDARS = ['gregorian', 'hijri'] as const;
export type CalendarKind = (typeof CALENDARS)[number];

export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ar';

export const CLIENT_KINDS = ['web', 'mobile'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

export const NOTIFICATION_TYPES = [
  'visit_submitted',
  'visit_approved',
  'visit_rejected',
  'visit_cancelled',
  'visit_auto_cancelled',
  'visit_expired',
  'visit_checked_in',
  'visit_checked_out',
  'visit_overdue',
  'visit_replaced',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const DEFAULT_TIMEZONE = 'Asia/Riyadh';
export const DEFAULT_COUNTRY = 'SA';

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

/** OTP configuration shared by server and clients (clients use it for countdowns). */
export const OTP = {
  length: 6,
  ttlSeconds: 300,
  resendAfterSeconds: 60,
  maxAttempts: 5,
} as const;
