-- Required extensions (trusted extensions: a database owner can create them on managed PostgreSQL).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'visitor', 'system');--> statement-breakpoint
CREATE TYPE "public"."calendar_kind" AS ENUM('gregorian', 'hijri');--> statement-breakpoint
CREATE TYPE "public"."client_kind" AS ENUM('web', 'mobile');--> statement-breakpoint
CREATE TYPE "public"."visit_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('national_id', 'iqama');--> statement-breakpoint
CREATE TYPE "public"."gate_action" AS ENUM('entry', 'exit');--> statement-breakpoint
CREATE TYPE "public"."gate_event_method" AS ENUM('qr', 'manual');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('ar', 'en');--> statement-breakpoint
CREATE TYPE "public"."pass_status" AS ENUM('active', 'revoked', 'consumed');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('staff', 'visitor', 'registrant');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'security');--> statement-breakpoint
CREATE TYPE "public"."visit_reason" AS ENUM('personal', 'delivery', 'maintenance', 'service_provider', 'other');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('pending', 'approved', 'rejected', 'checked_in', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"actor_visitor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_hash" text
);
--> statement-breakpoint
CREATE TABLE "gate_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"type" "gate_action" NOT NULL,
	"gate_id" uuid NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"method" "gate_event_method" NOT NULL,
	"pass_id" uuid,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"supports_entry" boolean DEFAULT true NOT NULL,
	"supports_exit" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gates_supports_action" CHECK ("gates"."supports_entry" OR "gates"."supports_exit"),
	CONSTRAINT "gates_code_format" CHECK ("gates"."code" ~ '^[A-Za-z0-9]{6,16}$')
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid,
	"recipient_visitor_id" uuid,
	"type" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visit_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_one_recipient" CHECK (("notifications"."recipient_user_id" IS NULL) <> ("notifications"."recipient_visitor_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_type" "document_type" NOT NULL,
	"document_number" text NOT NULL,
	"mobile" text NOT NULL,
	"visitor_id" uuid,
	"code_hash" text NOT NULL,
	"delivered" boolean NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locale" "locale" DEFAULT 'ar' NOT NULL,
	"ip_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"user_id" uuid,
	"visitor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_one_owner" CHECK (("push_tokens"."user_id" IS NULL) <> ("push_tokens"."visitor_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"kind" "session_kind" NOT NULL,
	"user_id" uuid,
	"visitor_id" uuid,
	"otp_challenge_id" uuid,
	"client" "client_kind" NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_subject" CHECK (("sessions"."kind" = 'staff' AND "sessions"."user_id" IS NOT NULL AND "sessions"."visitor_id" IS NULL)
        OR ("sessions"."kind" = 'visitor' AND "sessions"."visitor_id" IS NOT NULL AND "sessions"."user_id" IS NULL)
        OR ("sessions"."kind" = 'registrant' AND "sessions"."otp_challenge_id" IS NOT NULL AND "sessions"."user_id" IS NULL AND "sessions"."visitor_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"phone" text,
	"locale" "locale" DEFAULT 'ar' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_format" CHECK ("users"."username" ~ '^[a-z0-9._-]{3,64}$')
);
--> statement-breakpoint
CREATE TABLE "villas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"decision" "visit_decision" NOT NULL,
	"decided_by_user_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"reason" text,
	"profile_version_id" uuid NOT NULL,
	"entry_window_start" timestamp with time zone,
	"entry_window_end" timestamp with time zone,
	CONSTRAINT "visit_decisions_reason" CHECK ("visit_decisions"."decision" <> 'rejected' OR "visit_decisions"."reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "visit_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"nonce" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" "pass_status" DEFAULT 'active' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "visitor_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"full_name" text NOT NULL,
	"document_type" "document_type" NOT NULL,
	"document_number" text NOT NULL,
	"document_expiry_date" date NOT NULL,
	"document_expiry_calendar" "calendar_kind" NOT NULL,
	"document_expiry_original" text NOT NULL,
	"nationality" text NOT NULL,
	"mobile" text NOT NULL,
	"changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"change_reason" text,
	"changed_by_type" "actor_type" NOT NULL,
	"changed_by_user_id" uuid,
	"changed_by_visitor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"document_type" "document_type" NOT NULL,
	"document_number" text NOT NULL,
	"document_expiry_date" date NOT NULL,
	"document_expiry_calendar" "calendar_kind" DEFAULT 'gregorian' NOT NULL,
	"document_expiry_original" text NOT NULL,
	"nationality" text NOT NULL,
	"mobile" text NOT NULL,
	"locale" "locale" DEFAULT 'ar' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_via" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visitors_document_number_format" CHECK ("visitors"."document_number" ~ '^[0-9]{10}$'),
	CONSTRAINT "visitors_document_prefix" CHECK (("visitors"."document_type" = 'national_id' AND left("visitors"."document_number", 1) = '1') OR ("visitors"."document_type" = 'iqama' AND left("visitors"."document_number", 1) = '2')),
	CONSTRAINT "visitors_mobile_e164" CHECK ("visitors"."mobile" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "visitors_nationality_format" CHECK ("visitors"."nationality" ~ '^[A-Z]{2}$'),
	CONSTRAINT "visitors_created_via" CHECK ("visitors"."created_via" IN ('self', 'staff'))
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"visitor_id" uuid NOT NULL,
	"profile_version_id" uuid NOT NULL,
	"villa_id" uuid NOT NULL,
	"reason" "visit_reason" NOT NULL,
	"reason_details" text,
	"requested_entry_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"expected_exit_at" timestamp with time zone NOT NULL,
	"entry_window_start" timestamp with time zone,
	"entry_window_end" timestamp with time zone,
	"requested_gate_id" uuid,
	"status" "visit_status" DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by_type" "actor_type" NOT NULL,
	"submitted_by_user_id" uuid,
	"submission_channel" "client_kind" NOT NULL,
	"client_request_id" uuid NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"rejection_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_type" "actor_type",
	"cancelled_by_user_id" uuid,
	"cancel_reason" text,
	"expired_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"check_in_gate_id" uuid,
	"check_in_by_user_id" uuid,
	"checked_out_at" timestamp with time zone,
	"check_out_gate_id" uuid,
	"check_out_by_user_id" uuid,
	"overdue_flagged_at" timestamp with time zone,
	"overstay_minutes" integer,
	"supersedes_visit_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_duration_range" CHECK ("visits"."duration_minutes" BETWEEN 15 AND 10080),
	CONSTRAINT "visits_expected_exit" CHECK ("visits"."expected_exit_at" = "visits"."requested_entry_at" + make_interval(mins => "visits"."duration_minutes")),
	CONSTRAINT "visits_other_reason_details" CHECK ("visits"."reason" <> 'other' OR ("visits"."reason_details" IS NOT NULL AND length(btrim("visits"."reason_details")) >= 3)),
	CONSTRAINT "visits_rejection_reason" CHECK ("visits"."status" <> 'rejected' OR ("visits"."rejection_reason" IS NOT NULL AND "visits"."decided_at" IS NOT NULL)),
	CONSTRAINT "visits_approved_window" CHECK ("visits"."status" NOT IN ('approved', 'checked_in', 'completed', 'expired') OR ("visits"."entry_window_start" IS NOT NULL AND "visits"."entry_window_end" IS NOT NULL AND "visits"."decided_at" IS NOT NULL)),
	CONSTRAINT "visits_checked_in_fields" CHECK ("visits"."status" NOT IN ('checked_in', 'completed') OR ("visits"."checked_in_at" IS NOT NULL AND "visits"."check_in_gate_id" IS NOT NULL)),
	CONSTRAINT "visits_completed_fields" CHECK ("visits"."status" <> 'completed' OR ("visits"."checked_out_at" IS NOT NULL AND "visits"."check_out_gate_id" IS NOT NULL)),
	CONSTRAINT "visits_exit_after_entry" CHECK ("visits"."checked_out_at" IS NULL OR "visits"."checked_out_at" >= "visits"."checked_in_at"),
	CONSTRAINT "visits_submitter" CHECK ("visits"."submitted_by_type" <> 'user' OR "visits"."submitted_by_user_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_visitor_id_visitors_id_fk" FOREIGN KEY ("actor_visitor_id") REFERENCES "public"."visitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_gate_id_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."gates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_pass_id_visit_passes_id_fk" FOREIGN KEY ("pass_id") REFERENCES "public"."visit_passes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_visitor_id_visitors_id_fk" FOREIGN KEY ("recipient_visitor_id") REFERENCES "public"."visitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_otp_challenge_id_otp_challenges_id_fk" FOREIGN KEY ("otp_challenge_id") REFERENCES "public"."otp_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_decisions" ADD CONSTRAINT "visit_decisions_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_decisions" ADD CONSTRAINT "visit_decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_decisions" ADD CONSTRAINT "visit_decisions_profile_version_id_visitor_profile_versions_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."visitor_profile_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_passes" ADD CONSTRAINT "visit_passes_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_profile_versions" ADD CONSTRAINT "visitor_profile_versions_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_profile_versions" ADD CONSTRAINT "visitor_profile_versions_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_profile_versions" ADD CONSTRAINT "visitor_profile_versions_changed_by_visitor_id_visitors_id_fk" FOREIGN KEY ("changed_by_visitor_id") REFERENCES "public"."visitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_profile_version_id_visitor_profile_versions_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."visitor_profile_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_villa_id_villas_id_fk" FOREIGN KEY ("villa_id") REFERENCES "public"."villas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_requested_gate_id_gates_id_fk" FOREIGN KEY ("requested_gate_id") REFERENCES "public"."gates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_check_in_gate_id_gates_id_fk" FOREIGN KEY ("check_in_gate_id") REFERENCES "public"."gates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_check_in_by_user_id_users_id_fk" FOREIGN KEY ("check_in_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_check_out_gate_id_gates_id_fk" FOREIGN KEY ("check_out_gate_id") REFERENCES "public"."gates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_check_out_by_user_id_users_id_fk" FOREIGN KEY ("check_out_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_supersedes_visit_id_visits_id_fk" FOREIGN KEY ("supersedes_visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gate_events_visit_type_unique" ON "gate_events" USING btree ("visit_id","type");--> statement-breakpoint
CREATE INDEX "gate_events_recorded_at_idx" ON "gate_events" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "gate_events_gate_idx" ON "gate_events" USING btree ("gate_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gates_code_unique" ON "gates" USING btree ("code");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_visitor_idx" ON "notifications" USING btree ("recipient_visitor_id","created_at");--> statement-breakpoint
CREATE INDEX "otp_challenges_document_idx" ON "otp_challenges" USING btree ("document_number","created_at");--> statement-breakpoint
CREATE INDEX "otp_challenges_expires_idx" ON "otp_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_tokens_token_unique" ON "push_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_visitor_idx" ON "sessions" USING btree ("visitor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "villas_number_unique" ON "villas" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "visit_decisions_visit_unique" ON "visit_decisions" USING btree ("visit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visit_passes_token_hash_unique" ON "visit_passes" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "visit_passes_one_active" ON "visit_passes" USING btree ("visit_id") WHERE "visit_passes"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_profile_versions_unique" ON "visitor_profile_versions" USING btree ("visitor_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "visitors_document_number_unique" ON "visitors" USING btree ("document_number");--> statement-breakpoint
CREATE INDEX "visitors_mobile_idx" ON "visitors" USING btree ("mobile");--> statement-breakpoint
CREATE INDEX "visitors_nationality_idx" ON "visitors" USING btree ("nationality");--> statement-breakpoint
CREATE INDEX "visitors_full_name_trgm_idx" ON "visitors" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "visits_reference_unique" ON "visits" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_client_request_id_unique" ON "visits" USING btree ("client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_one_checked_in_per_visitor" ON "visits" USING btree ("visitor_id") WHERE "visits"."status" = 'checked_in';--> statement-breakpoint
CREATE UNIQUE INDEX "visits_supersedes_unique" ON "visits" USING btree ("supersedes_visit_id") WHERE "visits"."supersedes_visit_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "visits_status_entry_idx" ON "visits" USING btree ("status","requested_entry_at");--> statement-breakpoint
CREATE INDEX "visits_visitor_submitted_idx" ON "visits" USING btree ("visitor_id","submitted_at");--> statement-breakpoint
CREATE INDEX "visits_villa_idx" ON "visits" USING btree ("villa_id");--> statement-breakpoint
CREATE INDEX "visits_submitted_at_idx" ON "visits" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "visits_checked_in_at_idx" ON "visits" USING btree ("checked_in_at");--> statement-breakpoint
CREATE INDEX "visits_checked_out_at_idx" ON "visits" USING btree ("checked_out_at");--> statement-breakpoint
CREATE INDEX "visits_check_in_gate_idx" ON "visits" USING btree ("check_in_gate_id");--> statement-breakpoint
CREATE INDEX "visits_check_out_gate_idx" ON "visits" USING btree ("check_out_gate_id");