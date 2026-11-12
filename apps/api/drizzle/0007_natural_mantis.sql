CREATE TYPE "public"."work_order_assignment_action" AS ENUM('ASSIGNED', 'REASSIGNED');--> statement-breakpoint
CREATE TABLE "work_order_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"from_membership_id" uuid,
	"to_membership_id" uuid NOT NULL,
	"action" "work_order_assignment_action" NOT NULL,
	"version" integer NOT NULL,
	"reason" text,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_assignment_version_once" UNIQUE("organization_id","work_order_id","version"),
	CONSTRAINT "work_order_assignment_actor_retry" UNIQUE("organization_id","actor_membership_id","idempotency_key"),
	CONSTRAINT "work_order_assignment_transition" CHECK ((
    ("work_order_assignments"."action" = 'ASSIGNED' AND "work_order_assignments"."from_membership_id" IS NULL
      AND "work_order_assignments"."version" = 1)
    OR ("work_order_assignments"."action" = 'REASSIGNED' AND "work_order_assignments"."from_membership_id" IS NOT NULL
      AND "work_order_assignments"."version" >= 2)
  ) AND "work_order_assignments"."from_membership_id" IS DISTINCT FROM "work_order_assignments"."to_membership_id"),
	CONSTRAINT "work_order_assignment_reason_length" CHECK (
    "work_order_assignments"."reason" IS NULL OR length("work_order_assignments"."reason") BETWEEN 3 AND 500
  )
);
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "responsible_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "assignment_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignment_order_tenant_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignment_actor_tenant_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignment_from_tenant_fk" FOREIGN KEY ("organization_id","from_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignment_to_tenant_fk" FOREIGN KEY ("organization_id","to_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_order_assignments_history_idx" ON "work_order_assignments" USING btree ("organization_id","work_order_id","version");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_order_responsible_tenant_fk" FOREIGN KEY ("organization_id","responsible_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_order_assignee_state" CHECK (
    ("work_orders"."status" = 'PENDING' AND "work_orders"."responsible_membership_id" IS NULL
      AND "work_orders"."assignment_version" = 0)
    OR ("work_orders"."status" = 'ASSIGNED' AND "work_orders"."responsible_membership_id" IS NOT NULL
      AND "work_orders"."assignment_version" >= 1)
    OR ("work_orders"."status" NOT IN ('PENDING', 'ASSIGNED')
      AND "work_orders"."assignment_version" >= 0)
  );--> statement-breakpoint
-- UC-05 assignment history is immutable, independently of order status.
CREATE FUNCTION work_order_assignments_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'work_order_assignments is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_order_assignments_reject_changes
BEFORE UPDATE OR DELETE ON work_order_assignments
FOR EACH ROW EXECUTE FUNCTION work_order_assignments_immutable();
