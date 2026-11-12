CREATE TYPE "public"."work_order_execution_action" AS ENUM('STARTED', 'COMPLETED');--> statement-breakpoint
CREATE TABLE "work_order_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"action" "work_order_execution_action" NOT NULL,
	"from_status" "work_order_status" NOT NULL,
	"to_status" "work_order_status" NOT NULL,
	"result" text,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_execution_once" UNIQUE("organization_id","work_order_id","action"),
	CONSTRAINT "work_order_execution_actor_retry" UNIQUE("organization_id","actor_membership_id","idempotency_key"),
	CONSTRAINT "work_order_execution_transition" CHECK ((
    ("work_order_executions"."action" = 'STARTED' AND "work_order_executions"."from_status" = 'ASSIGNED'
      AND "work_order_executions"."to_status" = 'IN_PROGRESS' AND "work_order_executions"."result" IS NULL)
    OR ("work_order_executions"."action" = 'COMPLETED' AND "work_order_executions"."from_status" = 'IN_PROGRESS'
      AND "work_order_executions"."to_status" = 'COMPLETED'
      AND length("work_order_executions"."result") BETWEEN 10 AND 4000)
  ))
);
--> statement-breakpoint
ALTER TABLE "work_order_executions" ADD CONSTRAINT "work_order_executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_executions" ADD CONSTRAINT "work_order_execution_order_tenant_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_executions" ADD CONSTRAINT "work_order_execution_actor_tenant_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Historical execution events cannot be rewritten after an order is finished.
CREATE FUNCTION work_order_executions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'work_order_executions is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_order_executions_reject_changes
BEFORE UPDATE OR DELETE ON work_order_executions
FOR EACH ROW EXECUTE FUNCTION work_order_executions_immutable();
