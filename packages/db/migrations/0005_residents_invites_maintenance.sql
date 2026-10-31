ALTER TYPE "public"."quick_entry_status" ADD VALUE 'expected';--> statement-breakpoint
ALTER TYPE "public"."quick_entry_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."session_kind" ADD VALUE 'resident';--> statement-breakpoint
CREATE TABLE "maintenance_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"villa_id" uuid NOT NULL,
	"resident_id" uuid,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid,
	CONSTRAINT "maintenance_status" CHECK ("maintenance_requests"."status" IN ('open', 'in_progress', 'done', 'cancelled')),
	CONSTRAINT "maintenance_category" CHECK ("maintenance_requests"."category" IN ('plumbing', 'electrical', 'ac', 'carpentry', 'cleaning', 'other'))
);
--> statement-breakpoint
CREATE TABLE "residents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"villa_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text,
	"mobile" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"locale" "locale" DEFAULT 'ar' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	CONSTRAINT "residents_status" CHECK ("residents"."status" IN ('pending', 'active', 'rejected', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "quick_entries" DROP CONSTRAINT "quick_entries_exit";--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_subject";--> statement-breakpoint
ALTER TABLE "quick_entries" ALTER COLUMN "entered_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quick_entries" ALTER COLUMN "entered_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quick_entries" ADD COLUMN "expected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quick_entries" ADD COLUMN "visitor_mobile" text;--> statement-breakpoint
ALTER TABLE "quick_entries" ADD COLUMN "invited_by_resident_id" uuid;--> statement-breakpoint
ALTER TABLE "quick_entries" ADD COLUMN "invite_token_hash" text;--> statement-breakpoint
ALTER TABLE "quick_entries" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "resident_id" uuid;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_villa_id_villas_id_fk" FOREIGN KEY ("villa_id") REFERENCES "public"."villas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residents" ADD CONSTRAINT "residents_villa_id_villas_id_fk" FOREIGN KEY ("villa_id") REFERENCES "public"."villas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residents" ADD CONSTRAINT "residents_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_reference_unique" ON "maintenance_requests" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "maintenance_status_idx" ON "maintenance_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "maintenance_villa_idx" ON "maintenance_requests" USING btree ("villa_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "residents_villa_unique" ON "residents" USING btree ("villa_id");--> statement-breakpoint
CREATE INDEX "residents_status_idx" ON "residents" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "quick_entries" ADD CONSTRAINT "quick_entries_invited_by_resident_id_residents_id_fk" FOREIGN KEY ("invited_by_resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quick_entries_invite_token_unique" ON "quick_entries" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE INDEX "quick_entries_expected_idx" ON "quick_entries" USING btree ("villa_id","expected_at");--> statement-breakpoint
ALTER TABLE "quick_entries" ADD CONSTRAINT "quick_entries_lifecycle" CHECK (("quick_entries"."status"::text = 'expected' AND "quick_entries"."entered_at" IS NULL AND "quick_entries"."exited_at" IS NULL AND "quick_entries"."expected_at" IS NOT NULL)
        OR ("quick_entries"."status"::text = 'inside' AND "quick_entries"."entered_at" IS NOT NULL AND "quick_entries"."exited_at" IS NULL)
        OR ("quick_entries"."status"::text = 'exited' AND "quick_entries"."entered_at" IS NOT NULL AND "quick_entries"."exited_at" IS NOT NULL)
        OR ("quick_entries"."status"::text = 'cancelled' AND "quick_entries"."entered_at" IS NULL));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_subject" CHECK (("sessions"."kind"::text = 'staff' AND "sessions"."user_id" IS NOT NULL AND "sessions"."visitor_id" IS NULL AND "sessions"."resident_id" IS NULL)
        OR ("sessions"."kind"::text = 'visitor' AND "sessions"."visitor_id" IS NOT NULL AND "sessions"."user_id" IS NULL AND "sessions"."resident_id" IS NULL)
        OR ("sessions"."kind"::text = 'registrant' AND "sessions"."otp_challenge_id" IS NOT NULL AND "sessions"."user_id" IS NULL AND "sessions"."visitor_id" IS NULL AND "sessions"."resident_id" IS NULL)
        OR ("sessions"."kind"::text = 'resident' AND "sessions"."resident_id" IS NOT NULL AND "sessions"."user_id" IS NULL AND "sessions"."visitor_id" IS NULL));