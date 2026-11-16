-- Immutable identity/evidence from creation. Legitimate assignment and
-- execution transitions remain available while the order is nonterminal.
CREATE FUNCTION work_orders_protect_core_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.created_by_membership_id IS DISTINCT FROM OLD.created_by_membership_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Original work order identity and evidence are immutable'
      USING ERRCODE = '55000';
  END IF;

  -- A terminal order is a closed historical fact; a later SQL mutation
  -- must not reassign its technician or rewrite its assignment version.
  IF OLD.status IN ('COMPLETED', 'CANCELLED')
    AND (
      NEW.responsible_membership_id IS DISTINCT FROM OLD.responsible_membership_id
      OR NEW.assignment_version IS DISTINCT FROM OLD.assignment_version
    )
  THEN
    RAISE EXCEPTION 'Terminal work order assignment is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_orders_protect_core_metadata_on_update
BEFORE UPDATE OF kind, created_by_membership_id, idempotency_key,
  request_hash, title, description, created_at,
  responsible_membership_id, assignment_version ON work_orders
FOR EACH ROW EXECUTE FUNCTION work_orders_protect_core_metadata();
--> statement-breakpoint
-- Row-lock permission for the runtime role is scoped to UPDATE(id).
-- Reject any actual ID change, including attempts on orphan rows.
CREATE FUNCTION plantops_protect_lock_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Row-lock identity cannot be changed'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER memberships_protect_lock_identity
BEFORE UPDATE OF id ON memberships
FOR EACH ROW EXECUTE FUNCTION plantops_protect_lock_identity();
--> statement-breakpoint
CREATE TRIGGER plants_protect_lock_identity
BEFORE UPDATE OF id ON plants
FOR EACH ROW EXECUTE FUNCTION plantops_protect_lock_identity();
