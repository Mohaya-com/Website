CREATE TYPE "public"."owner_response" AS ENUM('confirmed', 'declined');--> statement-breakpoint
CREATE TYPE "public"."quick_entry_status" AS ENUM('inside', 'exited');--> statement-breakpoint
CREATE TABLE "quick_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "quick_entry_status" DEFAULT 'inside' NOT NULL,
	"villa_id" uuid NOT NULL,
	"gate_id" uuid,
	"document_kind" text,
	"document_number" text,
	"full_name" text,
	"nationality" text,
	"id_image" "bytea",
	"id_image_type" text,
	"id_image_removed_at" timestamp with time zone,
	"entered_at" timestamp with time zone NOT NULL,
	"entered_by_user_id" uuid NOT NULL,
	"exited_at" timestamp with time zone,
	"exited_by_user_id" uuid,
	"owner_token_hash" text NOT NULL,
	"owner_response" "owner_response",
	"owner_responded_at" timestamp with time zone,
	CONSTRAINT "quick_entries_document_kind" CHECK ("quick_entries"."document_kind" IS NULL OR "quick_entries"."document_kind" IN ('national_id', 'iqama', 'passport')),
	CONSTRAINT "quick_entries_exit" CHECK (("quick_entries"."status" = 'inside' AND "quick_entries"."exited_at" IS NULL) OR ("quick_entries"."status" = 'exited' AND "quick_entries"."exited_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "villas" ADD COLUMN "owner_name" text;--> statement-breakpoint
ALTER TABLE "villas" ADD COLUMN "owner_mobile" text;--> statement-breakpoint
ALTER TABLE "quick_entries" ADD CONSTRAINT "quick_entries_villa_id_villas_id_fk" FOREIGN KEY ("villa_id") REFERENCES "public"."villas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_entries" ADD CONSTRAINT "quick_entries_gate_id_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."gates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_entries" ADD CONSTRAINT "quick_entries_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_entries" ADD CONSTRAINT "quick_entries_exited_by_user_id_users_id_fk" FOREIGN KEY ("exited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quick_entries_inside_idx" ON "quick_entries" USING btree ("status","entered_at");--> statement-breakpoint
CREATE INDEX "quick_entries_villa_idx" ON "quick_entries" USING btree ("villa_id","entered_at");--> statement-breakpoint
CREATE INDEX "quick_entries_document_idx" ON "quick_entries" USING btree ("document_number");--> statement-breakpoint
CREATE UNIQUE INDEX "quick_entries_owner_token_unique" ON "quick_entries" USING btree ("owner_token_hash");