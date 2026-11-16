-- Conservative extension: allow an asset with COMPLETED or CANCELLED
-- orders ONLY if every order has a trusted immutable plant-local snapshot.
-- All plans, open orders, untrusted legacy orders and open incidents still
-- block. No backfill, no changes to historical rows or existing migrations.
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

  -- First association remains stricter: never attach an asset that
  -- already has plans or orders with unknown original plant context.
  IF OLD.plant_id IS NULL AND (
    EXISTS (
      SELECT 1 FROM maintenance_plans p
      WHERE p.organization_id = NEW.organization_id AND p.asset_id = NEW.id
    ) OR EXISTS (
      SELECT 1 FROM work_orders w
      WHERE w.organization_id = NEW.organization_id AND w.asset_id = NEW.id
    )
  ) THEN
    RAISE EXCEPTION 'Existing plans/orders prevent initial assignment'
      USING ERRCODE = '55000';
  END IF;

  -- An existing plan always blocks a move, including paused ones.
  -- A closed order is safe only when its original plant and zone were
  -- captured and made immutable by migration 0017.
  IF OLD.plant_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM maintenance_plans p
      WHERE p.organization_id = NEW.organization_id AND p.asset_id = NEW.id
    ) OR EXISTS (
      SELECT 1 FROM work_orders w
      WHERE w.organization_id = NEW.organization_id AND w.asset_id = NEW.id
        AND (
          w.status NOT IN ('COMPLETED', 'CANCELLED')
          OR w.location_basis IS DISTINCT FROM 'PLANT_LOCAL'
          OR w.plant_id_snapshot IS NULL OR w.time_zone_snapshot IS NULL
        )
    )
  ) THEN
    RAISE EXCEPTION 'Open work, plans or unknown order locations block transfer'
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
