CREATE TYPE "public"."audit_action" AS ENUM('INCIDENT_REVIEW_STARTED');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"action" "audit_action" NOT NULL,
	"from_status" "incident_status" NOT NULL,
	"to_status" "incident_status" NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_actor_action_retry" UNIQUE("organization_id","actor_membership_id","action","idempotency_key"),
	CONSTRAINT "audit_event_review_transition" CHECK (
    "audit_events"."action" <> 'INCIDENT_REVIEW_STARTED'
    OR ("audit_events"."from_status" = 'REPORTED' AND "audit_events"."to_status" = 'UNDER_REVIEW')
  )
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_event_incident_same_org_fk" FOREIGN KEY ("organization_id","incident_id") REFERENCES "public"."incidents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_event_actor_same_org_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Application-level audit records must never be rewritten or removed.
CREATE FUNCTION audit_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_reject_changes
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
