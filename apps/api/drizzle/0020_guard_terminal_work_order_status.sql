-- Terminal work orders are permanent facts, independent of whether an asset
-- has since moved. Never permit SQL or a later API to reopen or swap them.
-- Keep idempotent/no-op writes and non-status updates unchanged.
CREATE FUNCTION work_orders_prevent_terminal_reopen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('COMPLETED', 'CANCELLED')
    AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Terminal work order status cannot be changed'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_orders_terminal_status_is_final
BEFORE UPDATE OF status ON work_orders
FOR EACH ROW EXECUTE FUNCTION work_orders_prevent_terminal_reopen();
