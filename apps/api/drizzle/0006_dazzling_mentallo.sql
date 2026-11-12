CREATE TYPE "public"."work_order_status" AS ENUM('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."work_order_audit_action" AS ENUM('WORK_ORDER_CREATED');--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"created_by_membership_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" "work_order_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_organization_id_id" UNIQUE("organization_id","id"),
	CONSTRAINT "work_order_actor_retry" UNIQUE("organization_id","created_by_membership_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "work_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"action" "work_order_audit_action" NOT NULL,
	"from_incident_status" "incident_status",
	"to_incident_status" "incident_status",
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_event_once" UNIQUE("organization_id","work_order_id","action"),
	CONSTRAINT "work_order_event_incident_transition" CHECK (
    ("work_order_events"."from_incident_status" IS NULL AND "work_order_events"."to_incident_status" IS NULL)
    OR ("work_order_events"."from_incident_status" IS NOT NULL
      AND "work_order_events"."to_incident_status" IS NOT NULL
      AND "work_order_events"."from_incident_status" = 'UNDER_REVIEW'
      AND "work_order_events"."to_incident_status" = 'IN_PROGRESS')
  )
);
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_asset_id" UNIQUE("organization_id","id","asset_id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_order_incident_asset_tenant_fk" FOREIGN KEY ("organization_id","incident_id","asset_id") REFERENCES "public"."incidents"("organization_id","id","asset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_order_asset_tenant_fk" FOREIGN KEY ("organization_id","asset_id") REFERENCES "public"."assets"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_order_creator_tenant_fk" FOREIGN KEY ("organization_id","created_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_event_order_tenant_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_event_actor_tenant_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_orders_organization_incident_idx" ON "work_orders" USING btree ("organization_id","incident_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- Append-only events: no updating or deleting created-order evidence.
CREATE FUNCTION work_order_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'work_order_events is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_order_events_reject_changes
BEFORE UPDATE OR DELETE ON work_order_events
FOR EACH ROW EXECUTE FUNCTION work_order_events_immutable();
