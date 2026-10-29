import type {
  CalendarKind,
  DocumentType,
  GateAction,
  Locale,
  NotificationType,
  PrincipalRole,
  StaffRole,
  VisitReason,
  VisitStatus,
} from './constants';
import type { Permission } from './permissions';
import type { ScanCode } from './scan';

/** Data-transfer objects returned by the API (timestamps are ISO 8601 UTC strings). */

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    /** Translation key (e.g. "errors.forbidden"). */
    message: string;
    /** Field → translation key. */
    fields?: Record<string, string>;
    /** Extra non-sensitive details (e.g. retryAfterSeconds, existingVisitorId). */
    details?: Record<string, unknown>;
  };
}

export interface StaffUserDTO {
  id: string;
  username: string;
  fullName: string;
  role: StaffRole;
  isActive: boolean;
  phone: string | null;
  mustChangePassword: boolean;
  locale: Locale;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface SessionInfoDTO {
  kind: 'staff' | 'visitor' | 'registrant';
  role: PrincipalRole;
  permissions: Permission[];
  expiresAt: string;
  user?: StaffUserDTO;
  visitor?: VisitorSelfDTO;
  registrant?: { documentType: DocumentType; documentNumberMasked: string; mobileMasked: string };
}

export interface AuthResultDTO {
  session: SessionInfoDTO;
  /** Only returned to mobile clients (web uses an HttpOnly cookie). */
  token?: string;
}

export interface OtpChallengeDTO {
  challengeId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /** True only when the development SMS provider is active: no real SMS was sent. */
  developmentDelivery: boolean;
}

export interface VisitorSelfDTO {
  id: string;
  fullName: string;
  documentType: DocumentType;
  documentNumberMasked: string;
  nationality: string;
  mobileMasked: string;
  documentExpiryDate: string;
  documentExpiryCalendar: CalendarKind;
  documentExpiryOriginal: string;
  documentExpired: boolean;
  version: number;
  locale: Locale;
}

/** Masked profile used in lists. */
export interface VisitorSummaryDTO {
  id: string;
  fullName: string;
  documentType: DocumentType;
  documentNumberMasked: string;
  nationality: string;
  mobileMasked: string;
  documentExpiryDate: string;
  documentExpired: boolean;
  visitCount: number;
  lastVisitAt: string | null;
}

/** Compact masked visitor reference embedded in visit rows. */
export interface VisitorRefDTO {
  id: string;
  fullName: string;
  documentType: DocumentType;
  documentNumberMasked: string;
  nationality: string;
  mobileMasked: string;
  documentExpiryDate: string;
  documentExpired: boolean;
}

/** Full profile for authorized staff views (approval, profile management, gate verification). */
export interface VisitorFullDTO extends VisitorSummaryDTO {
  documentNumber: string;
  mobile: string;
  documentExpiryCalendar: CalendarKind;
  documentExpiryOriginal: string;
  version: number;
  createdVia: 'self' | 'staff';
  createdAt: string;
  updatedAt: string;
  hasOpenVisit: boolean;
}

export interface VisitorVersionDTO {
  version: number;
  changedFields: string[];
  changeReason: string | null;
  changedBy: { type: 'user' | 'visitor' | 'system'; name: string | null };
  createdAt: string;
  fullName: string;
  nationality: string;
  documentType: DocumentType;
  documentNumberMasked: string;
  documentExpiryDate: string;
  mobileMasked: string;
}

export interface GateDTO {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  supportsEntry: boolean;
  supportsExit: boolean;
  isActive: boolean;
}

export interface PublicGateDTO {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  supportsEntry: boolean;
  supportsExit: boolean;
}

export interface VillaDTO {
  id: string;
  number: string;
  label: string | null;
  isActive: boolean;
}

export interface ActorRefDTO {
  type: 'user' | 'visitor' | 'system';
  name: string | null;
}

export interface GateRefDTO {
  id: string;
  nameAr: string;
  nameEn: string;
}

export interface VisitDTO {
  id: string;
  reference: string;
  status: VisitStatus;
  isOverdue: boolean;
  visitorId: string;
  /** Present for staff responses (masked identity). */
  visitor?: VisitorRefDTO;
  villa: { id: string; number: string };
  reason: VisitReason;
  reasonDetails: string | null;
  requestedEntryAt: string;
  durationMinutes: number;
  expectedExitAt: string;
  entryWindowStart: string | null;
  entryWindowEnd: string | null;
  requestedGate: GateRefDTO | null;
  submittedAt: string;
  submittedBy: ActorRefDTO;
  decidedAt: string | null;
  decidedBy: ActorRefDTO | null;
  rejectionReason: string | null;
  cancelledAt: string | null;
  cancelledBy: ActorRefDTO | null;
  cancelReason: string | null;
  expiredAt: string | null;
  checkedInAt: string | null;
  checkInGate: GateRefDTO | null;
  checkInBy: ActorRefDTO | null;
  checkedOutAt: string | null;
  checkOutGate: GateRefDTO | null;
  checkOutBy: ActorRefDTO | null;
  overstayMinutes: number | null;
  supersedesVisitId: string | null;
  supersededByVisitId: string | null;
  version: number;
  hasActivePass: boolean;
  canCancel: boolean;
}

export interface VisitorHistoryStatsDTO {
  total: number;
  approved: number;
  rejected: number;
  completed: number;
  cancelled: number;
  expired: number;
  overstays: number;
}

export interface VisitReviewDTO {
  visit: VisitDTO;
  visitor: VisitorFullDTO;
  identity: {
    expired: boolean;
    validOnVisitDate: boolean;
    daysUntilExpiry: number;
  };
  /** Previous visits, oldest first (excluding this one). */
  history: VisitDTO[];
  stats: VisitorHistoryStatsDTO;
  canDecide: boolean;
  /** True when identity details changed after the request was submitted. */
  profileChangedSinceSubmission: boolean;
  /** Why approval is blocked, when it is (translation key). */
  approvalBlockedReason: string | null;
}

export interface PassDTO {
  visitId: string;
  reference: string;
  status: VisitStatus;
  qrValue: string;
  visitorName: string;
  villaNumber: string;
  entryWindowStart: string;
  entryWindowEnd: string;
  expectedExitAt: string;
  issuedAt: string;
}

export interface ScanVisitorDTO {
  id: string;
  fullName: string;
  documentType: DocumentType;
  documentNumber: string;
  nationality: string;
  mobileMasked: string;
  documentExpiryDate: string;
  documentExpired: boolean;
}

export interface ScanResultDTO {
  /** True when the requested action is allowed (verify) or was recorded (confirm). */
  ok: boolean;
  code: ScanCode;
  action: GateAction;
  gate: GateRefDTO;
  visit: VisitDTO | null;
  visitor: ScanVisitorDTO | null;
  checks: {
    approved: boolean;
    withinWindow: boolean | null;
    documentValid: boolean | null;
    passActive: boolean | null;
  };
  recordedAt: string | null;
}

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  params: Record<string, string>;
  visitId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditDTO {
  id: string;
  occurredAt: string;
  actor: { type: 'user' | 'visitor' | 'system'; id: string | null; name: string | null };
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
}

export interface GateEventDTO {
  id: string;
  type: GateAction;
  recordedAt: string;
  method: 'qr' | 'manual';
  gate: GateRefDTO;
  recordedBy: ActorRefDTO;
  visit: { id: string; reference: string; villaNumber: string; visitorName: string; documentNumberMasked: string; status: VisitStatus };
}

export interface DashboardSummaryDTO {
  pending: number;
  approvedUpcoming: number;
  inside: number;
  completedToday: number;
  overdue: number;
  expectedToday: number;
  generatedAt: string;
}

export type SmsProviderKind = 'dev' | 'twilio' | 'whatsapp' | 'disabled';

/** WhatsApp connection managed from the admin settings. The access token itself is never returned. */
export interface WhatsAppStatusDTO {
  /** SMS_PROVIDER from the server environment. Anything other than "disabled" takes precedence over these settings. */
  environmentProvider: SmsProviderKind;
  /** Visitor verification codes are currently sent through this connection. */
  active: boolean;
  configured: boolean;
  enabled: boolean;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  templateName: string;
  templateLanguage: string;
  /** Last four characters of the stored token, e.g. "…a1B2". */
  tokenHint: string | null;
  /** False when the stored token can no longer be decrypted (OTP_SECRET changed): enter it again. */
  tokenReadable: boolean;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  /** Meta template status: APPROVED, PENDING, REJECTED, PAUSED, DISABLED… */
  templateStatus: string | null;
  checkedAt: string | null;
  lastTest: { at: string; ok: boolean; error: string | null } | null;
  lastDeliveryError: { at: string; error: string } | null;
  updatedAt: string | null;
}

export interface WhatsAppTestResultDTO {
  ok: true;
  /** WhatsApp accepted the message. Acceptance is not proof of delivery to the phone. */
  messageId: string | null;
}

export interface PublicConfigDTO {
  compoundNameAr: string;
  compoundNameEn: string;
  timezone: string;
  timezoneOffsetMinutes: number;
  serverTime: string;
  defaultVisitDurationMinutes: number;
  maxVisitDurationMinutes: number;
  maxAdvanceBookingDays: number;
  identityChecksumValidation: boolean;
  allowVisitorSelfRegistration: boolean;
  sms: { provider: SmsProviderKind; available: boolean; developmentMode: boolean };
  push: { enabled: boolean };
  demoData: boolean;
  appOrigin: string;
}

export interface DevOtpMessageDTO {
  to: string;
  code: string;
  createdAt: string;
}
