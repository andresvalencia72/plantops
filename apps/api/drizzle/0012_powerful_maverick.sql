CREATE TABLE "maintenance_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"created_by_membership_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"interval_days" integer NOT NULL,
	"next_due_on" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_plan_organization_id_id_asset" UNIQUE("organization_id","id","asset_id"),
	CONSTRAINT "maintenance_plan_actor_retry" UNIQUE("organization_id","created_by_membership_id","idempotency_key"),
	CONSTRAINT "maintenance_plan_interval_days_valid" CHECK (
    "maintenance_plans"."interval_days" BETWEEN 1 AND 365
  ),
	CONSTRAINT "maintenance_plan_title_length" CHECK (
    length("maintenance_plans"."title") BETWEEN 3 AND 160
  ),
	CONSTRAINT "maintenance_plan_description_length" CHECK (
    length("maintenance_plans"."description") BETWEEN 10 AND 4000
  )
);
--> statement-breakpoint
ALTER TABLE "work_orders" DROP CONSTRAINT "work_order_kind_incident_consistency";--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "maintenance_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "scheduled_for" date;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plan_asset_tenant_fk" FOREIGN KEY ("organization_id","asset_id") REFERENCES "public"."assets"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plan_creator_tenant_fk" FOREIGN KEY ("organization_id","created_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_order_maintenance_plan_asset_tenant_fk" FOREIGN KEY ("organization_id","maintenance_plan_id","asset_id") REFERENCES "public"."maintenance_plans"("organization_id","id","asset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_order_plan_due_once" UNIQUE("organization_id","maintenance_plan_id","scheduled_for");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_order_kind_incident_consistency" CHECK (
    ("work_orders"."kind" = 'CORRECTIVE' AND "work_orders"."incident_id" IS NOT NULL
      AND "work_orders"."maintenance_plan_id" IS NULL AND "work_orders"."scheduled_for" IS NULL)
    OR ("work_orders"."kind" = 'PREVENTIVE' AND "work_orders"."incident_id" IS NULL
      AND (("work_orders"."maintenance_plan_id" IS NULL AND "work_orders"."scheduled_for" IS NULL)
        OR ("work_orders"."maintenance_plan_id" IS NOT NULL AND "work_orders"."scheduled_for" IS NOT NULL)))
  );