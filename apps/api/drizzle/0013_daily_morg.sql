CREATE TYPE "public"."maintenance_plan_event_action" AS ENUM('PAUSED', 'RESUMED', 'SCHEDULE_CHANGED');--> statement-breakpoint
CREATE TABLE "maintenance_plan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"action" "maintenance_plan_event_action" NOT NULL,
	"reason" text NOT NULL,
	"from_version" integer NOT NULL,
	"to_version" integer NOT NULL,
	"from_active" boolean NOT NULL,
	"to_active" boolean NOT NULL,
	"from_interval_days" integer NOT NULL,
	"to_interval_days" integer NOT NULL,
	"from_next_due_on" date NOT NULL,
	"to_next_due_on" date NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_plan_event_version_once" UNIQUE("organization_id","plan_id","to_version"),
	CONSTRAINT "maintenance_plan_event_actor_retry" UNIQUE("organization_id","actor_membership_id","idempotency_key"),
	CONSTRAINT "maintenance_plan_event_version_transition" CHECK (
    "maintenance_plan_events"."from_version" >= 0 AND "maintenance_plan_events"."to_version" = "maintenance_plan_events"."from_version" + 1
  ),
	CONSTRAINT "maintenance_plan_event_reason_length" CHECK (
    length("maintenance_plan_events"."reason") BETWEEN 10 AND 1000
  ),
	CONSTRAINT "maintenance_plan_event_action_consistency" CHECK (
    ("maintenance_plan_events"."action" = 'PAUSED' AND "maintenance_plan_events"."from_active" = true
      AND "maintenance_plan_events"."to_active" = false
      AND "maintenance_plan_events"."from_interval_days" = "maintenance_plan_events"."to_interval_days"
      AND "maintenance_plan_events"."from_next_due_on" = "maintenance_plan_events"."to_next_due_on")
    OR ("maintenance_plan_events"."action" = 'RESUMED' AND "maintenance_plan_events"."from_active" = false
      AND "maintenance_plan_events"."to_active" = true
      AND "maintenance_plan_events"."from_interval_days" = "maintenance_plan_events"."to_interval_days"
      AND "maintenance_plan_events"."from_next_due_on" = "maintenance_plan_events"."to_next_due_on")
    OR ("maintenance_plan_events"."action" = 'SCHEDULE_CHANGED'
      AND "maintenance_plan_events"."from_active" = false AND "maintenance_plan_events"."to_active" = false
      AND ("maintenance_plan_events"."from_interval_days" <> "maintenance_plan_events"."to_interval_days"
        OR "maintenance_plan_events"."from_next_due_on" <> "maintenance_plan_events"."to_next_due_on"))
  )
);
--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "maintenance_plan_events" ADD CONSTRAINT "maintenance_plan_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plan_organization_id_id" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "maintenance_plan_events" ADD CONSTRAINT "maintenance_plan_event_plan_tenant_fk" FOREIGN KEY ("organization_id","plan_id") REFERENCES "public"."maintenance_plans"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plan_events" ADD CONSTRAINT "maintenance_plan_event_actor_tenant_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_plan_event_history_idx" ON "maintenance_plan_events" USING btree ("organization_id","plan_id","to_version");--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plan_version_valid" CHECK ("maintenance_plans"."version" >= 0);--> statement-breakpoint
-- Change history must never be rewritten by application SQL.
CREATE FUNCTION maintenance_plan_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'maintenance_plan_events is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER maintenance_plan_events_reject_changes
BEFORE UPDATE OR DELETE ON maintenance_plan_events
FOR EACH ROW EXECUTE FUNCTION maintenance_plan_events_immutable();
