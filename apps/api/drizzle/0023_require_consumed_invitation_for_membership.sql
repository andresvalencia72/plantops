-- Under a separate SQL identity login, a membership must have an existing,
-- consumed, operator-provisioned invitation for the SAME user/tenant/role.
-- Deferred check permits the OIDC resolver's insert-then-consume transaction.
-- The schema owner/migrator is exempt for trusted administrative bootstrap.
CREATE FUNCTION memberships_require_consumed_invitation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_name text;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO owner_name
  FROM pg_class c WHERE c.oid = 'public.memberships'::regclass;
  IF current_user = owner_name THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM invitations i
    WHERE i.organization_id = NEW.organization_id
      AND i.consumed_by_user_id = NEW.user_id
      AND i.role = NEW.role
      AND i.consumed_at IS NOT NULL
      AND i.revoked_at IS NULL
      AND i.created_at <= i.consumed_at
      AND i.consumed_at < i.expires_at
  ) THEN
    RAISE EXCEPTION 'Membership requires matching consumed operator invitation'
      USING ERRCODE = '55000';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER memberships_insert_requires_consumed_invitation
AFTER INSERT ON memberships
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION memberships_require_consumed_invitation();
