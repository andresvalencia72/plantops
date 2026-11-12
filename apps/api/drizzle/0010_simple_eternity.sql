CREATE TABLE "incident_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"from_status" "incident_status" NOT NULL,
	"reason" text NOT NULL,
	"conclusion" text,
	"order_count" integer NOT NULL,
	"completed_count" integer NOT NULL,
	"cancelled_count" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_closure_once" UNIQUE("organization_id","incident_id"),
	CONSTRAINT "incident_closure_actor_retry" UNIQUE("organization_id","actor_membership_id","idempotency_key"),
	CONSTRAINT "incident_closure_consistency" CHECK (
    "incident_closures"."order_count" >= 0 AND "incident_closures"."completed_count" >= 0
      AND "incident_closures"."cancelled_count" >= 0
      AND "incident_closures"."completed_count" + "incident_closures"."cancelled_count" = "incident_closures"."order_count"
      AND length("incident_closures"."reason") BETWEEN 10 AND 1000
      AND (( "incident_closures"."order_count" = 0 AND "incident_closures"."from_status" = 'UNDER_REVIEW'
        AND "incident_closures"."conclusion" IS NULL)
      OR ("incident_closures"."order_count" > 0 AND "incident_closures"."from_status" = 'IN_PROGRESS'
        AND length("incident_closures"."conclusion") BETWEEN 20 AND 4000))
  )
);
--> statement-breakpoint
ALTER TABLE "incident_closures" ADD CONSTRAINT "incident_closures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_closures" ADD CONSTRAINT "incident_closure_incident_tenant_fk" FOREIGN KEY ("organization_id","incident_id") REFERENCES "public"."incidents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_closures" ADD CONSTRAINT "incident_closure_actor_tenant_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION incident_closures_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'incident_closures is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER incident_closures_reject_changes
BEFORE UPDATE OR DELETE ON incident_closures
FOR EACH ROW EXECUTE FUNCTION incident_closures_immutable();
