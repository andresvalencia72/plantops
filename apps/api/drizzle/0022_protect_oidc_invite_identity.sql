-- An OIDC account is immutable evidence of a verified provider subject.
-- The identity-only role holds UPDATE(id) solely to acquire FOR UPDATE locks.
CREATE FUNCTION oidc_account_protect_original_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.linked_at IS DISTINCT FROM OLD.linked_at THEN
    RAISE EXCEPTION 'OIDC account original identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER oidc_account_original_identity_guard
BEFORE UPDATE ON oidc_accounts
FOR EACH ROW EXECUTE FUNCTION oidc_account_protect_original_identity();
--> statement-breakpoint
-- Operators revoke/replace invitations instead of editing their authority.
-- A consumed or revoked invitation cannot be made pending a second time.
CREATE FUNCTION invitations_protect_original_authority() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.email IS DISTINCT FROM OLD.email
    OR NEW.role IS DISTINCT FROM OLD.role
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'Original invitation authority is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF (NEW.consumed_at IS NULL) <> (NEW.consumed_by_user_id IS NULL) THEN
    RAISE EXCEPTION 'Invitation consumption requires timestamp and user together'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.consumed_at IS NOT NULL AND NEW.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'An invitation cannot be both consumed and revoked'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.consumed_at IS NOT NULL AND (
    NEW.consumed_at IS DISTINCT FROM OLD.consumed_at
    OR NEW.consumed_by_user_id IS DISTINCT FROM OLD.consumed_by_user_id
    OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
  ) THEN
    RAISE EXCEPTION 'Consumed invitation cannot be rewritten'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.revoked_at IS NOT NULL
    AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'Revoked invitation cannot be revived'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
    AND (OLD.revoked_at IS NOT NULL OR OLD.expires_at <= transaction_timestamp()) THEN
    RAISE EXCEPTION 'Expired or revoked invitation cannot be consumed'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invitations_original_authority_guard
BEFORE UPDATE ON invitations
FOR EACH ROW EXECUTE FUNCTION invitations_protect_original_authority();
