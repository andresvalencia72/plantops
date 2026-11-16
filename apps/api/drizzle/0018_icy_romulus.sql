CREATE TABLE "asset_plant_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"from_plant_id" uuid NOT NULL,
	"to_plant_id" uuid NOT NULL,
	"from_time_zone" text NOT NULL,
	"to_time_zone" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"expected_version" integer NOT NULL,
	"version" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"transaction_id" bigint DEFAULT txid_current() NOT NULL,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_plant_transfer_version_once" UNIQUE("organization_id","asset_id","version"),
	CONSTRAINT "asset_plant_transfer_actor_retry" UNIQUE("organization_id","actor_membership_id","idempotency_key"),
	CONSTRAINT "asset_plant_transfer_validity" CHECK (
    "asset_plant_transfers"."from_plant_id" <> "asset_plant_transfers"."to_plant_id"
    AND "asset_plant_transfers"."expected_version" >= 0
    AND "asset_plant_transfers"."version" = "asset_plant_transfers"."expected_version" + 1
    AND "asset_plant_transfers"."version" <= 2147483647
    AND length("asset_plant_transfers"."from_time_zone") BETWEEN 3 AND 128
    AND length("asset_plant_transfers"."to_time_zone") BETWEEN 3 AND 128
    AND length("asset_plant_transfers"."reason") BETWEEN 10 AND 1000
  )
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "plant_transfer_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "last_plant_transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_plant_transfers" ADD CONSTRAINT "asset_plant_transfers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_plant_transfers" ADD CONSTRAINT "asset_plant_transfer_asset_tenant_fk" FOREIGN KEY ("organization_id","asset_id") REFERENCES "public"."assets"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_plant_transfers" ADD CONSTRAINT "asset_plant_transfer_from_tenant_fk" FOREIGN KEY ("organization_id","from_plant_id") REFERENCES "public"."plants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_plant_transfers" ADD CONSTRAINT "asset_plant_transfer_to_tenant_fk" FOREIGN KEY ("organization_id","to_plant_id") REFERENCES "public"."plants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_plant_transfers" ADD CONSTRAINT "asset_plant_transfer_actor_tenant_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- One verified movement per transaction. Initial assignment keeps version 0.
-- Replaces the 0015 function without altering historical migration files.
CREATE OR REPLACE FUNCTION assets_require_initial_plant_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  movement asset_plant_transfers%ROWTYPE;
  old_zone text;
  next_zone text;
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Asset tenant changes are forbidden' USING ERRCODE = '55000';
  END IF;
  IF NEW.plant_id IS NOT DISTINCT FROM OLD.plant_id THEN
    IF NEW.plant_transfer_version IS DISTINCT FROM OLD.plant_transfer_version
      OR NEW.last_plant_transfer_id IS DISTINCT FROM OLD.last_plant_transfer_id THEN
      RAISE EXCEPTION 'Asset transfer version requires a real movement'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.plant_id IS NULL OR NOT NEW.active THEN
    RAISE EXCEPTION 'Asset unassignment or inactive transfer is forbidden'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM maintenance_plans p
    WHERE p.organization_id = NEW.organization_id AND p.asset_id = NEW.id
  ) OR EXISTS (
    SELECT 1 FROM work_orders w
    WHERE w.organization_id = NEW.organization_id AND w.asset_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Any past or present plan/work order blocks plant transfer'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.plant_id IS NULL THEN
    IF NEW.plant_transfer_version IS DISTINCT FROM OLD.plant_transfer_version
      OR NEW.last_plant_transfer_id IS DISTINCT FROM OLD.last_plant_transfer_id
      OR NOT EXISTS (
        SELECT 1 FROM asset_plant_assignments e
        WHERE e.organization_id = NEW.organization_id
          AND e.asset_id = NEW.id AND e.plant_id = NEW.plant_id
          AND e.transaction_id = txid_current()
      ) THEN
      RAISE EXCEPTION 'Initial assignment requires same-transaction audit'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM incidents i
    WHERE i.organization_id = NEW.organization_id AND i.asset_id = NEW.id
      AND i.status <> 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'Open incidents block plant transfers' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM asset_plant_assignments first_assignment
    WHERE first_assignment.organization_id = NEW.organization_id
      AND first_assignment.asset_id = NEW.id
      AND first_assignment.plant_id = OLD.plant_id
  ) AND OLD.plant_transfer_version = 0 THEN
    RAISE EXCEPTION 'Unknown initial location requires reconciliation'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO movement FROM asset_plant_transfers t
  WHERE t.organization_id = NEW.organization_id
    AND t.asset_id = NEW.id
    AND t.from_plant_id = OLD.plant_id
    AND t.to_plant_id = NEW.plant_id
    AND t.expected_version = OLD.plant_transfer_version
    AND t.version = OLD.plant_transfer_version + 1
    AND t.transaction_id = txid_current()
  LIMIT 1;
  IF NOT FOUND OR NEW.plant_transfer_version IS DISTINCT FROM movement.version
    OR NEW.last_plant_transfer_id IS DISTINCT FROM movement.id THEN
    RAISE EXCEPTION 'Plant transfer requires a versioned same-transaction audit'
      USING ERRCODE = '55000';
  END IF;

  SELECT time_zone INTO old_zone FROM plants
  WHERE organization_id = NEW.organization_id AND id = OLD.plant_id;
  SELECT time_zone INTO next_zone FROM plants
  WHERE organization_id = NEW.organization_id AND id = NEW.plant_id;
  IF old_zone IS DISTINCT FROM movement.from_time_zone
    OR next_zone IS DISTINCT FROM movement.to_time_zone THEN
    RAISE EXCEPTION 'Transfer location and IANA zones do not match catalog'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Ensure an audit INSERT cannot be committed without the real asset update.
CREATE FUNCTION asset_plant_transfer_finalize_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM assets a
    WHERE a.organization_id = NEW.organization_id
      AND a.id = NEW.asset_id
      AND a.plant_id = NEW.to_plant_id
      AND a.plant_transfer_version = NEW.version
      AND a.last_plant_transfer_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Unapplied asset transfer event cannot be committed'
      USING ERRCODE = '55000';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER asset_plant_transfer_requires_asset_update
AFTER INSERT ON asset_plant_transfers DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION asset_plant_transfer_finalize_check();
--> statement-breakpoint
CREATE FUNCTION asset_plant_transfer_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Asset plant transfer history is append-only'
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_plant_transfer_no_mutation
BEFORE UPDATE OR DELETE ON asset_plant_transfers
FOR EACH ROW EXECUTE FUNCTION asset_plant_transfer_immutable();
--> statement-breakpoint
-- Prevent privileged INSERTs from manufacturing a synthetic transfer version.
CREATE OR REPLACE FUNCTION assets_reject_prelinked_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plant_id IS NOT NULL
    OR NEW.plant_transfer_version <> 0
    OR NEW.last_plant_transfer_id IS NOT NULL THEN
    RAISE EXCEPTION 'New assets require an audited initial location and zero transfers'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Lock-scoped validation of the author for database-level writes as well.
CREATE FUNCTION asset_plant_transfer_check_author() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = NEW.organization_id
      AND m.id = NEW.actor_membership_id
      AND m.role = 'SUPERVISOR' AND m.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Only an active supervisor can author a plant transfer'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_plant_transfer_author_required
BEFORE INSERT ON asset_plant_transfers
FOR EACH ROW EXECUTE FUNCTION asset_plant_transfer_check_author();
--> statement-breakpoint
DROP TRIGGER assets_guard_initial_plant_assignment ON assets;
--> statement-breakpoint
CREATE TRIGGER assets_guard_initial_plant_assignment
BEFORE UPDATE OF organization_id, plant_id,
  plant_transfer_version, last_plant_transfer_id ON assets
FOR EACH ROW EXECUTE FUNCTION assets_require_initial_plant_audit();
