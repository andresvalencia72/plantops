-- In the previous schema a privileged INSERT could create an asset with
-- plant_id already filled, bypassing the immutable first-assignment log.
-- New assets must start unassigned; their first plant is set via the
-- already-audited UPDATE path in migration 0015. Existing rows untouched.
CREATE FUNCTION assets_reject_prelinked_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plant_id IS NOT NULL THEN
    RAISE EXCEPTION 'New assets must start without a plant; use audited assignment'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assets_require_unassigned_on_insert
BEFORE INSERT ON assets
FOR EACH ROW EXECUTE FUNCTION assets_reject_prelinked_insert();
