CREATE TABLE "work_order_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"from_status" "work_order_status" NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_cancellation_once" UNIQUE("organization_id","work_order_id"),
	CONSTRAINT "work_order_cancellation_actor_retry" UNIQUE("organization_id","actor_membership_id","idempotency_key"),
	CONSTRAINT "work_order_cancellation_valid" CHECK (
    "work_order_cancellations"."from_status" IN ('PENDING','ASSIGNED','IN_PROGRESS')
    AND length("work_order_cancellations"."reason") BETWEEN 10 AND 1000
  )
);
--> statement-breakpoint
ALTER TABLE "work_order_cancellations" ADD CONSTRAINT "work_order_cancellations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_cancellations" ADD CONSTRAINT "work_order_cancellation_order_tenant_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_cancellations" ADD CONSTRAINT "work_order_cancellation_actor_tenant_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION work_order_cancellations_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'work_order_cancellations is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_order_cancellations_reject_changes
BEFORE UPDATE OR DELETE ON work_order_cancellations
FOR EACH ROW EXECUTE FUNCTION work_order_cancellations_immutable();
