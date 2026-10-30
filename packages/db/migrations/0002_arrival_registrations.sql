CREATE TYPE "public"."arrival_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "arrival_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"status" "arrival_status" DEFAULT 'pending' NOT NULL,
	"status_token_hash" text NOT NULL,
	"document_type" "document_type" NOT NULL,
	"document_number" text NOT NULL,
	"full_name" text NOT NULL,
	"nationality" text NOT NULL,
	"document_expiry_date" date NOT NULL,
	"document_expiry_calendar" "calendar_kind" NOT NULL,
	"document_expiry_original" text NOT NULL,
	"mobile" text NOT NULL,
	"villa_number" text NOT NULL,
	"reason" "visit_reason" NOT NULL,
	"reason_details" text,
	"requested_entry_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"requested_gate_id" uuid,
	"locale" "locale" DEFAULT 'ar' NOT NULL,
	"id_image" "bytea",
	"id_image_type" text,
	"id_image_removed_at" timestamp with time zone,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"reject_reason" text,
	"visitor_id" uuid,
	"visit_id" uuid,
	CONSTRAINT "arrival_registrations_document_number_format" CHECK ("arrival_registrations"."document_number" ~ '^[0-9]{10}$'),
	CONSTRAINT "arrival_registrations_mobile_e164" CHECK ("arrival_registrations"."mobile" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "arrival_registrations_decision" CHECK (("arrival_registrations"."status" = 'pending' AND "arrival_registrations"."decided_at" IS NULL) OR ("arrival_registrations"."status" <> 'pending' AND "arrival_registrations"."decided_at" IS NOT NULL)),
	CONSTRAINT "arrival_registrations_approved_links" CHECK ("arrival_registrations"."status" <> 'approved' OR ("arrival_registrations"."visitor_id" IS NOT NULL AND "arrival_registrations"."visit_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "arrival_registrations" ADD CONSTRAINT "arrival_registrations_requested_gate_id_gates_id_fk" FOREIGN KEY ("requested_gate_id") REFERENCES "public"."gates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrival_registrations" ADD CONSTRAINT "arrival_registrations_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrival_registrations" ADD CONSTRAINT "arrival_registrations_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrival_registrations" ADD CONSTRAINT "arrival_registrations_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arrival_registrations_reference_unique" ON "arrival_registrations" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "arrival_registrations_status_token_unique" ON "arrival_registrations" USING btree ("status_token_hash");--> statement-breakpoint
CREATE INDEX "arrival_registrations_status_idx" ON "arrival_registrations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "arrival_registrations_document_idx" ON "arrival_registrations" USING btree ("document_number");