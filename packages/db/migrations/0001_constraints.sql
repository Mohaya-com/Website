-- Constraints and triggers that the Drizzle schema DSL cannot express.

-- A visitor cannot have two open (pending / approved / inside) visits whose time ranges overlap.
-- Enforced by the database so that concurrent submissions cannot slip past application checks.
ALTER TABLE "visits" ADD CONSTRAINT "visits_no_overlap"
  EXCLUDE USING gist (
    "visitor_id" WITH =,
    tstzrange("requested_entry_at", "expected_exit_at", '[)') WITH &&
  ) WHERE ("status" IN ('pending', 'approved', 'checked_in'));
--> statement-breakpoint

-- Audit records are append-only: block UPDATE, DELETE and TRUNCATE.
CREATE OR REPLACE FUNCTION audit_logs_block_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_logs_immutable"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
--> statement-breakpoint
CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_changes();
--> statement-breakpoint

-- Profile versions and decisions are immutable history as well.
CREATE TRIGGER "visitor_profile_versions_immutable"
  BEFORE UPDATE OR DELETE ON "visitor_profile_versions"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
--> statement-breakpoint
CREATE TRIGGER "visit_decisions_immutable"
  BEFORE UPDATE OR DELETE ON "visit_decisions"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
--> statement-breakpoint

-- Gate events can never be rewritten once recorded.
CREATE TRIGGER "gate_events_immutable"
  BEFORE UPDATE OR DELETE ON "gate_events"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
--> statement-breakpoint

-- Partial index used by the occupancy and overdue queries.
CREATE INDEX IF NOT EXISTS "visits_inside_idx" ON "visits" ("expected_exit_at") WHERE "status" = 'checked_in';
--> statement-breakpoint

-- Speeds up the unread-notification badge query.
CREATE INDEX IF NOT EXISTS "notifications_unread_user_idx" ON "notifications" ("recipient_user_id") WHERE "read_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_unread_visitor_idx" ON "notifications" ("recipient_visitor_id") WHERE "read_at" IS NULL;
