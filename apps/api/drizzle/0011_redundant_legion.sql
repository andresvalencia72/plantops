CREATE TYPE "public"."work_order_kind" AS ENUM('CORRECTIVE', 'PREVENTIVE');--> statement-breakpoint
ALTER TABLE "work_orders" ALTER COLUMN "incident_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "kind" "work_order_kind" DEFAULT 'CORRECTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_order_kind_incident_consistency" CHECK (
    ("work_orders"."kind" = 'CORRECTIVE' AND "work_orders"."incident_id" IS NOT NULL)
    OR ("work_orders"."kind" = 'PREVENTIVE' AND "work_orders"."incident_id" IS NULL)
  );