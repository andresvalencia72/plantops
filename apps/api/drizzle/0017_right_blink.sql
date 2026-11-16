CREATE TYPE "public"."work_order_location_basis" AS ENUM('PLANT_LOCAL', 'UTC_LEGACY', 'UNASSIGNED');--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "location_basis" "work_order_location_basis";--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "plant_id_snapshot" uuid;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "time_zone_snapshot" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_order_location_snapshot_consistency" CHECK (
    ("work_orders"."location_basis" IS NULL
      AND "work_orders"."plant_id_snapshot" IS NULL
      AND "work_orders"."time_zone_snapshot" IS NULL)
    OR ("work_orders"."location_basis" = 'PLANT_LOCAL'
      AND "work_orders"."plant_id_snapshot" IS NOT NULL
      AND "work_orders"."time_zone_snapshot" IS NOT NULL
      AND length("work_orders"."time_zone_snapshot") BETWEEN 3 AND 128)
    OR ("work_orders"."location_basis" = 'UTC_LEGACY'
      AND "work_orders"."plant_id_snapshot" IS NULL
      AND "work_orders"."time_zone_snapshot" IS NULL
      AND "work_orders"."scheduled_for" IS NOT NULL
      AND "work_orders"."maintenance_plan_id" IS NOT NULL)
    OR ("work_orders"."location_basis" = 'UNASSIGNED'
      AND "work_orders"."plant_id_snapshot" IS NULL
      AND "work_orders"."time_zone_snapshot" IS NULL
      AND "work_orders"."scheduled_for" IS NULL)
  );--> statement-breakpoint
-- Historical orders keep NULL provenance. Every new work order captures the
-- tenant-safe location from the database, never from client-supplied columns.
-- Lock the asset to serialize with an initial assignment or future transfer.
CREATE FUNCTION work_orders_capture_location_on_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  captured_plant uuid;
  captured_zone text;
BEGIN
  SELECT a.plant_id, p.time_zone INTO captured_plant, captured_zone
  FROM assets a
  LEFT JOIN plants p
    ON p.organization_id = a.organization_id AND p.id = a.plant_id
  WHERE a.organization_id = NEW.organization_id AND a.id = NEW.asset_id
  FOR SHARE OF a;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order asset is not in the organization'
      USING ERRCODE = '23503';
  END IF;
  IF captured_plant IS NOT NULL AND captured_zone IS NULL THEN
    RAISE EXCEPTION 'Linked plant has no IANA time zone'
      USING ERRCODE = '55000';
  END IF;

  -- Always overwrite caller-supplied snapshots. A privileged insert cannot
  -- pretend that an order belonged to a different plant or timezone.
  NEW.plant_id_snapshot := captured_plant;
  NEW.time_zone_snapshot := captured_zone;
  IF captured_plant IS NOT NULL THEN
    NEW.location_basis := 'PLANT_LOCAL';
  ELSIF NEW.scheduled_for IS NOT NULL THEN
    NEW.location_basis := 'UTC_LEGACY';
  ELSE
    NEW.location_basis := 'UNASSIGNED';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_orders_snapshot_from_asset_on_insert
BEFORE INSERT ON work_orders
FOR EACH ROW EXECUTE FUNCTION work_orders_capture_location_on_insert();
--> statement-breakpoint
CREATE FUNCTION work_orders_keep_location_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.location_basis IS DISTINCT FROM OLD.location_basis
    OR NEW.plant_id_snapshot IS DISTINCT FROM OLD.plant_id_snapshot
    OR NEW.time_zone_snapshot IS DISTINCT FROM OLD.time_zone_snapshot
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
    OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
    OR NEW.maintenance_plan_id IS DISTINCT FROM OLD.maintenance_plan_id
  THEN
    RAISE EXCEPTION 'Work order location and due-day context is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_orders_keep_location_snapshot_on_update
BEFORE UPDATE OF location_basis, plant_id_snapshot, time_zone_snapshot,
  organization_id, asset_id, scheduled_for, maintenance_plan_id ON work_orders
FOR EACH ROW EXECUTE FUNCTION work_orders_keep_location_snapshot();
