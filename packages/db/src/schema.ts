import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  customType,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/*
 * Database schema. Business invariants are enforced twice: in the server's transactional services
 * and here, through constraints, so that no code path (or concurrent request) can violate them:
 *   • one profile per identity number              → visitors.document_number UNIQUE
 *   • one "inside" visit per visitor                → visits_one_checked_in_per_visitor (partial unique)
 *   • no overlapping open visits per visitor        → visits_no_overlap (exclusion constraint, migration 0001)
 *   • one entry and one exit event per visit        → gate_events (visit_id, type) UNIQUE
 *   • one active pass per visit                     → visit_passes_one_active (partial unique)
 *   • append-only audit log                         → trigger audit_logs_immutable (migration 0001)
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const staffRoleEnum = pgEnum('staff_role', ['admin', 'security']);
export const documentTypeEnum = pgEnum('document_type', ['national_id', 'iqama']);
export const visitStatusEnum = pgEnum('visit_status', [
  'pending',
  'approved',
  'rejected',
  'checked_in',
  'completed',
  'cancelled',
  'expired',
]);
export const visitReasonEnum = pgEnum('visit_reason', ['personal', 'delivery', 'maintenance', 'service_provider', 'other']);
export const calendarKindEnum = pgEnum('calendar_kind', ['gregorian', 'hijri']);
export const gateActionEnum = pgEnum('gate_action', ['entry', 'exit']);
export const passStatusEnum = pgEnum('pass_status', ['active', 'revoked', 'consumed']);
export const actorTypeEnum = pgEnum('actor_type', ['user', 'visitor', 'system']);
export const sessionKindEnum = pgEnum('session_kind', ['staff', 'visitor', 'registrant']);
export const clientKindEnum = pgEnum('client_kind', ['web', 'mobile']);
export const localeEnum = pgEnum('locale', ['ar', 'en']);
export const gateEventMethodEnum = pgEnum('gate_event_method', ['qr', 'manual']);
export const decisionEnum = pgEnum('visit_decision', ['approved', 'rejected']);

// ───────────────────────────── Staff users ─────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    fullName: text('full_name').notNull(),
    role: staffRoleEnum('role').notNull(),
    passwordHash: text('password_hash').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    phone: text('phone'),
    locale: localeEnum('locale').notNull().default('ar'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    createdByUserId: uuid('created_by_user_id').references((): AnyPgColumn => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_username_unique').on(t.username),
    check('users_username_format', sql`${t.username} ~ '^[a-z0-9._-]{3,64}$'`),
  ],
);

// ───────────────────────────── Visitor profiles ─────────────────────────────

export const visitors = pgTable(
  'visitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fullName: text('full_name').notNull(),
    documentType: documentTypeEnum('document_type').notNull(),
    /** Stored as a string of Western digits (normalized), never as a number. */
    documentNumber: text('document_number').notNull(),
    /** Normalized Gregorian date. */
    documentExpiryDate: date('document_expiry_date', { mode: 'string' }).notNull(),
    /** The calendar the expiry date was entered in, and the value as entered. */
    documentExpiryCalendar: calendarKindEnum('document_expiry_calendar').notNull().default('gregorian'),
    documentExpiryOriginal: text('document_expiry_original').notNull(),
    nationality: text('nationality').notNull(),
    /** E.164 */
    mobile: text('mobile').notNull(),
    locale: localeEnum('locale').notNull().default('ar'),
    version: integer('version').notNull().default(1),
    createdVia: text('created_via').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('visitors_document_number_unique').on(t.documentNumber),
    index('visitors_mobile_idx').on(t.mobile),
    index('visitors_nationality_idx').on(t.nationality),
    index('visitors_full_name_trgm_idx').using('gin', sql`${t.fullName} gin_trgm_ops`),
    check('visitors_document_number_format', sql`${t.documentNumber} ~ '^[0-9]{10}$'`),
    check(
      'visitors_document_prefix',
      sql`(${t.documentType} = 'national_id' AND left(${t.documentNumber}, 1) = '1') OR (${t.documentType} = 'iqama' AND left(${t.documentNumber}, 1) = '2')`,
    ),
    check('visitors_mobile_e164', sql`${t.mobile} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check('visitors_nationality_format', sql`${t.nationality} ~ '^[A-Z]{2}$'`),
    check('visitors_created_via', sql`${t.createdVia} IN ('self', 'staff')`),
  ],
);

/** Immutable snapshots of each profile version. Visits reference the version that was current when submitted. */
export const visitorProfileVersions = pgTable(
  'visitor_profile_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitorId: uuid('visitor_id')
      .notNull()
      .references(() => visitors.id),
    version: integer('version').notNull(),
    fullName: text('full_name').notNull(),
    documentType: documentTypeEnum('document_type').notNull(),
    documentNumber: text('document_number').notNull(),
    documentExpiryDate: date('document_expiry_date', { mode: 'string' }).notNull(),
    documentExpiryCalendar: calendarKindEnum('document_expiry_calendar').notNull(),
    documentExpiryOriginal: text('document_expiry_original').notNull(),
    nationality: text('nationality').notNull(),
    mobile: text('mobile').notNull(),
    changedFields: text('changed_fields').array().notNull().default(sql`'{}'::text[]`),
    changeReason: text('change_reason'),
    changedByType: actorTypeEnum('changed_by_type').notNull(),
    changedByUserId: uuid('changed_by_user_id').references(() => users.id),
    changedByVisitorId: uuid('changed_by_visitor_id').references(() => visitors.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('visitor_profile_versions_unique').on(t.visitorId, t.version)],
);

// ───────────────────────────── Villas & gates ─────────────────────────────

export const villas = pgTable(
  'villas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    label: text('label'),
    /** Contact for visit confirmations (E.164). */
    ownerName: text('owner_name'),
    ownerMobile: text('owner_mobile'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('villas_number_unique').on(t.number)],
);

export const gates = pgTable(
  'gates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Public, non-secret code printed in gate QR links. Can be regenerated to retire printed posters. */
    code: text('code').notNull(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    supportsEntry: boolean('supports_entry').notNull().default(true),
    supportsExit: boolean('supports_exit').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('gates_code_unique').on(t.code),
    check('gates_supports_action', sql`${t.supportsEntry} OR ${t.supportsExit}`),
    check('gates_code_format', sql`${t.code} ~ '^[A-Za-z0-9]{6,16}$'`),
  ],
);

// ───────────────────────────── Visits ─────────────────────────────

export const visits = pgTable(
  'visits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull(),
    visitorId: uuid('visitor_id')
      .notNull()
      .references(() => visitors.id),
    /** Profile snapshot current when the request was submitted. */
    profileVersionId: uuid('profile_version_id')
      .notNull()
      .references(() => visitorProfileVersions.id),
    villaId: uuid('villa_id')
      .notNull()
      .references(() => villas.id),
    reason: visitReasonEnum('reason').notNull(),
    reasonDetails: text('reason_details'),
    requestedEntryAt: ts('requested_entry_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    expectedExitAt: ts('expected_exit_at').notNull(),
    entryWindowStart: ts('entry_window_start'),
    entryWindowEnd: ts('entry_window_end'),
    requestedGateId: uuid('requested_gate_id').references(() => gates.id),
    status: visitStatusEnum('status').notNull().default('pending'),

    submittedAt: ts('submitted_at').notNull().defaultNow(),
    submittedByType: actorTypeEnum('submitted_by_type').notNull(),
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id),
    submissionChannel: clientKindEnum('submission_channel').notNull(),
    /** Idempotency key generated by the client; duplicate submissions return the original request. */
    clientRequestId: uuid('client_request_id').notNull(),

    decidedAt: ts('decided_at'),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    rejectionReason: text('rejection_reason'),

    cancelledAt: ts('cancelled_at'),
    cancelledByType: actorTypeEnum('cancelled_by_type'),
    cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id),
    cancelReason: text('cancel_reason'),

    expiredAt: ts('expired_at'),

    checkedInAt: ts('checked_in_at'),
    checkInGateId: uuid('check_in_gate_id').references(() => gates.id),
    checkInByUserId: uuid('check_in_by_user_id').references(() => users.id),
    checkedOutAt: ts('checked_out_at'),
    checkOutGateId: uuid('check_out_gate_id').references(() => gates.id),
    checkOutByUserId: uuid('check_out_by_user_id').references(() => users.id),

    overdueFlaggedAt: ts('overdue_flagged_at'),
    overstayMinutes: integer('overstay_minutes'),

    supersedesVisitId: uuid('supersedes_visit_id').references((): AnyPgColumn => visits.id),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('visits_reference_unique').on(t.reference),
    uniqueIndex('visits_client_request_id_unique').on(t.clientRequestId),
    uniqueIndex('visits_one_checked_in_per_visitor').on(t.visitorId).where(sql`${t.status} = 'checked_in'`),
    uniqueIndex('visits_supersedes_unique').on(t.supersedesVisitId).where(sql`${t.supersedesVisitId} IS NOT NULL`),
    index('visits_status_entry_idx').on(t.status, t.requestedEntryAt),
    index('visits_visitor_submitted_idx').on(t.visitorId, t.submittedAt),
    index('visits_villa_idx').on(t.villaId),
    index('visits_submitted_at_idx').on(t.submittedAt),
    index('visits_checked_in_at_idx').on(t.checkedInAt),
    index('visits_checked_out_at_idx').on(t.checkedOutAt),
    index('visits_check_in_gate_idx').on(t.checkInGateId),
    index('visits_check_out_gate_idx').on(t.checkOutGateId),
    check('visits_duration_range', sql`${t.durationMinutes} BETWEEN 15 AND 10080`),
    check('visits_expected_exit', sql`${t.expectedExitAt} = ${t.requestedEntryAt} + make_interval(mins => ${t.durationMinutes})`),
    check('visits_other_reason_details', sql`${t.reason} <> 'other' OR (${t.reasonDetails} IS NOT NULL AND length(btrim(${t.reasonDetails})) >= 3)`),
    check('visits_rejection_reason', sql`${t.status} <> 'rejected' OR (${t.rejectionReason} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`),
    check(
      'visits_approved_window',
      sql`${t.status} NOT IN ('approved', 'checked_in', 'completed', 'expired') OR (${t.entryWindowStart} IS NOT NULL AND ${t.entryWindowEnd} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`,
    ),
    check('visits_checked_in_fields', sql`${t.status} NOT IN ('checked_in', 'completed') OR (${t.checkedInAt} IS NOT NULL AND ${t.checkInGateId} IS NOT NULL)`),
    check('visits_completed_fields', sql`${t.status} <> 'completed' OR (${t.checkedOutAt} IS NOT NULL AND ${t.checkOutGateId} IS NOT NULL)`),
    check('visits_exit_after_entry', sql`${t.checkedOutAt} IS NULL OR ${t.checkedOutAt} >= ${t.checkedInAt}`),
    check('visits_submitter', sql`${t.submittedByType} <> 'user' OR ${t.submittedByUserId} IS NOT NULL`),
  ],
);

/** Immutable record of each administrator decision. */
export const visitDecisions = pgTable(
  'visit_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitId: uuid('visit_id')
      .notNull()
      .references(() => visits.id),
    decision: decisionEnum('decision').notNull(),
    decidedByUserId: uuid('decided_by_user_id')
      .notNull()
      .references(() => users.id),
    decidedAt: ts('decided_at').notNull(),
    reason: text('reason'),
    /** Profile version the administrator saw when deciding. */
    profileVersionId: uuid('profile_version_id')
      .notNull()
      .references(() => visitorProfileVersions.id),
    entryWindowStart: ts('entry_window_start'),
    entryWindowEnd: ts('entry_window_end'),
  },
  (t) => [
    uniqueIndex('visit_decisions_visit_unique').on(t.visitId),
    check('visit_decisions_reason', sql`${t.decision} <> 'rejected' OR ${t.reason} IS NOT NULL`),
  ],
);

/** QR credentials. Only a hash of the token is stored; the token is derived with an HMAC server secret. */
export const visitPasses = pgTable(
  'visit_passes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitId: uuid('visit_id')
      .notNull()
      .references(() => visits.id),
    nonce: text('nonce').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: passStatusEnum('status').notNull().default('active'),
    issuedAt: ts('issued_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokeReason: text('revoke_reason'),
    consumedAt: ts('consumed_at'),
  },
  (t) => [
    uniqueIndex('visit_passes_token_hash_unique').on(t.tokenHash),
    uniqueIndex('visit_passes_one_active').on(t.visitId).where(sql`${t.status} = 'active'`),
  ],
);

/** Physical entry/exit events recorded by staff. At most one entry and one exit per visit. */
export const gateEvents = pgTable(
  'gate_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitId: uuid('visit_id')
      .notNull()
      .references(() => visits.id),
    type: gateActionEnum('type').notNull(),
    gateId: uuid('gate_id')
      .notNull()
      .references(() => gates.id),
    recordedByUserId: uuid('recorded_by_user_id')
      .notNull()
      .references(() => users.id),
    recordedAt: ts('recorded_at').notNull(),
    method: gateEventMethodEnum('method').notNull(),
    passId: uuid('pass_id').references(() => visitPasses.id),
    notes: text('notes'),
  },
  (t) => [
    uniqueIndex('gate_events_visit_type_unique').on(t.visitId, t.type),
    index('gate_events_recorded_at_idx').on(t.recordedAt),
    index('gate_events_gate_idx').on(t.gateId, t.recordedAt),
  ],
);

// ───────────────────────────── Notifications ─────────────────────────────

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientUserId: uuid('recipient_user_id').references(() => users.id),
    recipientVisitorId: uuid('recipient_visitor_id').references(() => visitors.id),
    type: text('type').notNull(),
    /** Non-sensitive parameters only (reference, villa number). */
    params: jsonb('params').$type<Record<string, string>>().notNull().default({}),
    visitId: uuid('visit_id').references(() => visits.id),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_idx').on(t.recipientUserId, t.createdAt),
    index('notifications_visitor_idx').on(t.recipientVisitorId, t.createdAt),
    check('notifications_one_recipient', sql`(${t.recipientUserId} IS NULL) <> (${t.recipientVisitorId} IS NULL)`),
  ],
);

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull(),
    platform: text('platform').notNull(),
    userId: uuid('user_id').references(() => users.id),
    visitorId: uuid('visitor_id').references(() => visitors.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('push_tokens_token_unique').on(t.token),
    check('push_tokens_one_owner', sql`(${t.userId} IS NULL) <> (${t.visitorId} IS NULL)`),
  ],
);

// ───────────────────────────── Authentication ─────────────────────────────

export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentType: documentTypeEnum('document_type').notNull(),
    documentNumber: text('document_number').notNull(),
    mobile: text('mobile').notNull(),
    /** Set when the identity number matched an existing profile with the same mobile. */
    visitorId: uuid('visitor_id').references(() => visitors.id),
    codeHash: text('code_hash').notNull(),
    /** False when no SMS was sent (e.g. the identity is registered to a different mobile). Responses are identical either way. */
    delivered: boolean('delivered').notNull(),
    attempts: integer('attempts').notNull().default(0),
    locale: localeEnum('locale').notNull().default('ar'),
    ipHash: text('ip_hash'),
    expiresAt: ts('expires_at').notNull(),
    verifiedAt: ts('verified_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('otp_challenges_document_idx').on(t.documentNumber, t.createdAt), index('otp_challenges_expires_idx').on(t.expiresAt)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** SHA-256 of the opaque session token. The token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    kind: sessionKindEnum('kind').notNull(),
    userId: uuid('user_id').references(() => users.id),
    visitorId: uuid('visitor_id').references(() => visitors.id),
    otpChallengeId: uuid('otp_challenge_id').references(() => otpChallenges.id),
    client: clientKindEnum('client').notNull(),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    idleExpiresAt: ts('idle_expires_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_visitor_idx').on(t.visitorId),
    check(
      'sessions_subject',
      sql`(${t.kind} = 'staff' AND ${t.userId} IS NOT NULL AND ${t.visitorId} IS NULL)
        OR (${t.kind} = 'visitor' AND ${t.visitorId} IS NOT NULL AND ${t.userId} IS NULL)
        OR (${t.kind} = 'registrant' AND ${t.otpChallengeId} IS NOT NULL AND ${t.userId} IS NULL AND ${t.visitorId} IS NULL)`,
    ),
  ],
);

// ───────────────────────────── Arrival registrations (no OTP) ─────────────────────────────

export const arrivalStatusEnum = pgEnum('arrival_status', ['pending', 'approved', 'rejected']);

/**
 * A visitor's self-registration at arrival, made without a verification code. Nothing it contains is
 * trusted until an administrator compares it with the uploaded ID image and approves it; approval
 * creates or updates the visitor profile and an approved visit. The submitter only ever sees the
 * status of this request (through a random status token stored as a hash), never a profile.
 */
export const arrivalRegistrations = pgTable(
  'arrival_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull(),
    status: arrivalStatusEnum('status').notNull().default('pending'),
    statusTokenHash: text('status_token_hash').notNull(),
    documentType: documentTypeEnum('document_type').notNull(),
    documentNumber: text('document_number').notNull(),
    /** Optional for the visitor; the administrator completes name, nationality and expiry from the ID photo. */
    fullName: text('full_name'),
    nationality: text('nationality'),
    documentExpiryDate: date('document_expiry_date', { mode: 'string' }),
    documentExpiryCalendar: calendarKindEnum('document_expiry_calendar'),
    documentExpiryOriginal: text('document_expiry_original'),
    mobile: text('mobile').notNull(),
    villaNumber: text('villa_number').notNull(),
    reason: visitReasonEnum('reason').notNull(),
    reasonDetails: text('reason_details'),
    requestedEntryAt: ts('requested_entry_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    requestedGateId: uuid('requested_gate_id').references(() => gates.id),
    locale: localeEnum('locale').notNull().default('ar'),
    /** Photo of the ID / Iqama (JPEG, PNG or WebP). Removed by the maintenance sweep after the retention period. */
    idImage: bytea('id_image'),
    idImageType: text('id_image_type'),
    idImageRemovedAt: ts('id_image_removed_at'),
    ipHash: text('ip_hash'),
    createdAt: ts('created_at').notNull().defaultNow(),
    decidedAt: ts('decided_at'),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    rejectReason: text('reject_reason'),
    visitorId: uuid('visitor_id').references(() => visitors.id),
    visitId: uuid('visit_id').references(() => visits.id),
  },
  (t) => [
    uniqueIndex('arrival_registrations_reference_unique').on(t.reference),
    uniqueIndex('arrival_registrations_status_token_unique').on(t.statusTokenHash),
    index('arrival_registrations_status_idx').on(t.status, t.createdAt),
    index('arrival_registrations_document_idx').on(t.documentNumber),
    check('arrival_registrations_document_number_format', sql`${t.documentNumber} ~ '^[0-9]{10}$'`),
    check('arrival_registrations_mobile_e164', sql`${t.mobile} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check(
      'arrival_registrations_decision',
      sql`(${t.status} = 'pending' AND ${t.decidedAt} IS NULL) OR (${t.status} <> 'pending' AND ${t.decidedAt} IS NOT NULL)`,
    ),
    check('arrival_registrations_approved_links', sql`${t.status} <> 'approved' OR (${t.visitorId} IS NOT NULL AND ${t.visitId} IS NOT NULL)`),
  ],
);

// ───────────────────────────── Gate quick entries ─────────────────────────────

export const quickEntryStatusEnum = pgEnum('quick_entry_status', ['inside', 'exited']);
export const ownerResponseEnum = pgEnum('owner_response', ['confirmed', 'declined']);

/**
 * A visitor recorded at the gate by security: a photo of the ID / Iqama / passport and the villa.
 * Entry time is set automatically; exit is recorded with one tap. Identity details read from the
 * photo are optional. The villa owner can confirm or decline through a private link.
 */
export const quickEntries = pgTable(
  'quick_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: quickEntryStatusEnum('status').notNull().default('inside'),
    villaId: uuid('villa_id')
      .notNull()
      .references(() => villas.id),
    gateId: uuid('gate_id').references(() => gates.id),
    documentKind: text('document_kind'),
    documentNumber: text('document_number'),
    fullName: text('full_name'),
    nationality: text('nationality'),
    idImage: bytea('id_image'),
    idImageType: text('id_image_type'),
    idImageRemovedAt: ts('id_image_removed_at'),
    enteredAt: ts('entered_at').notNull(),
    enteredByUserId: uuid('entered_by_user_id')
      .notNull()
      .references(() => users.id),
    exitedAt: ts('exited_at'),
    exitedByUserId: uuid('exited_by_user_id').references(() => users.id),
    ownerTokenHash: text('owner_token_hash').notNull(),
    ownerResponse: ownerResponseEnum('owner_response'),
    ownerRespondedAt: ts('owner_responded_at'),
  },
  (t) => [
    index('quick_entries_inside_idx').on(t.status, t.enteredAt),
    index('quick_entries_villa_idx').on(t.villaId, t.enteredAt),
    index('quick_entries_document_idx').on(t.documentNumber),
    uniqueIndex('quick_entries_owner_token_unique').on(t.ownerTokenHash),
    check('quick_entries_document_kind', sql`${t.documentKind} IS NULL OR ${t.documentKind} IN ('national_id', 'iqama', 'passport')`),
    check('quick_entries_exit', sql`(${t.status} = 'inside' AND ${t.exitedAt} IS NULL) OR (${t.status} = 'exited' AND ${t.exitedAt} IS NOT NULL)`),
  ],
);

// ───────────────────────────── Audit, settings, rate limits ─────────────────────────────

/** Append-only. UPDATE and DELETE are blocked by a trigger (see migration 0001). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorVisitorId: uuid('actor_visitor_id').references(() => visitors.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    /** Never contains raw identity numbers or phone numbers (masked values only). */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ipHash: text('ip_hash'),
  },
  (t) => [
    index('audit_logs_occurred_at_idx').on(t.occurredAt),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_action_idx').on(t.action),
    index('audit_logs_actor_user_idx').on(t.actorUserId),
  ],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
});

export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: ts('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index('rate_limits_window_idx').on(t.windowStart)],
);

export type User = typeof users.$inferSelect;
export type Visitor = typeof visitors.$inferSelect;
export type VisitorProfileVersion = typeof visitorProfileVersions.$inferSelect;
export type Villa = typeof villas.$inferSelect;
export type Gate = typeof gates.$inferSelect;
export type Visit = typeof visits.$inferSelect;
export type VisitPass = typeof visitPasses.$inferSelect;
export type GateEvent = typeof gateEvents.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type OtpChallenge = typeof otpChallenges.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type ArrivalRegistration = typeof arrivalRegistrations.$inferSelect;
export type QuickEntry = typeof quickEntries.$inferSelect;
