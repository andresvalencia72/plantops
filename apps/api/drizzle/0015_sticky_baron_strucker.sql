CREATE TABLE "asset_plant_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"plant_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"transaction_id" bigint DEFAULT txid_current() NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_plant_assignment_once" UNIQUE("organization_id","asset_id"),
	CONSTRAINT "asset_plant_assignment_actor_retry" UNIQUE("organization_id","actor_membership_id","idempotency_key"),
	CONSTRAINT "asset_plant_assignment_reason_length" CHECK (
    length("asset_plant_assignments"."reason") BETWEEN 10 AND 1000
  )
);
--> statement-breakpoint
ALTER TABLE "asset_plant_assignments" ADD CONSTRAINT "asset_plant_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_plant_assignments" ADD CONSTRAINT "asset_plant_assignment_asset_tenant_fk" FOREIGN KEY ("organization_id","asset_id") REFERENCES "public"."assets"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_plant_assignments" ADD CONSTRAINT "asset_plant_assignment_plant_tenant_fk" FOREIGN KEY ("organization_id","plant_id") REFERENCES "public"."plants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_plant_assignments" ADD CONSTRAINT "asset_plant_assignment_actor_tenant_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- An asset can acquire its first plant only in the same transaction as
-- its immutable audit record. No transfers or unlinking in this release.
CREATE FUNCTION assets_require_initial_plant_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Asset tenant changes are forbidden'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.plant_id IS NOT DISTINCT FROM OLD.plant_id THEN
    RETURN NEW;
  END IF;
  IF OLD.plant_id IS NOT NULL OR NEW.plant_id IS NULL THEN
    RAISE EXCEPTION 'Asset plant reassignment requires a separate audited operation'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM maintenance_plans p
    WHERE p.organization_id = NEW.organization_id AND p.asset_id = NEW.id
  ) OR EXISTS (
    SELECT 1 FROM work_orders w
    WHERE w.organization_id = NEW.organization_id AND w.asset_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Historical work orders or maintenance plans prevent initial assignment'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM asset_plant_assignments e
    WHERE e.organization_id = NEW.organization_id
      AND e.asset_id = NEW.id
      AND e.plant_id = NEW.plant_id
      AND e.transaction_id = txid_current()
  ) THEN
    RAISE EXCEPTION 'Plant assignment requires same-transaction audit'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assets_guard_initial_plant_assignment
BEFORE UPDATE OF organization_id, plant_id ON assets
FOR EACH ROW EXECUTE FUNCTION assets_require_initial_plant_audit();
--> statement-breakpoint
CREATE FUNCTION asset_plant_assignment_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'asset_plant_assignments is append-only'
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_plant_assignment_reject_changes
BEFORE UPDATE OR DELETE ON asset_plant_assignments
FOR EACH ROW EXECUTE FUNCTION asset_plant_assignment_events_immutable();
