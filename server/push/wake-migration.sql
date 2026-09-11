-- Disabled wake candidate; explicit migration, never automatic startup DDL.
BEGIN;
CREATE TABLE IF NOT EXISTS phone11_wake_bindings (
  id UUID PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES phone11_auth_session(id) ON DELETE CASCADE,
  session_binding UUID NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  extension_id INTEGER NOT NULL REFERENCES extensions(id),
  device_id VARCHAR(512) NOT NULL,
  push_revision UUID NOT NULL,
  grant_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, extension_id)
);
CREATE INDEX IF NOT EXISTS phone11_wake_bindings_session ON phone11_wake_bindings(session_id);
CREATE TABLE IF NOT EXISTS phone11_wake_calls (
  id UUID PRIMARY KEY,
  binding_id UUID NOT NULL REFERENCES phone11_wake_bindings(id) ON DELETE CASCADE,
  sip_call_id VARCHAR(512) NOT NULL,
  sip_uri VARCHAR(512) NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','ready','cancelled','ended')),
  expires_at TIMESTAMPTZ NOT NULL,
  busy_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (binding_id, sip_call_id)
);
ALTER TABLE phone11_wake_calls ADD COLUMN IF NOT EXISTS busy_until TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS phone11_wake_calls_expiry ON phone11_wake_calls(expires_at);
CREATE TABLE IF NOT EXISTS phone11_wake_terminals (
  sip_uri VARCHAR(512) NOT NULL,
  sip_call_id VARCHAR(512) NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('cancelled','ended')),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (sip_uri,sip_call_id)
);
CREATE INDEX IF NOT EXISTS phone11_wake_terminals_expiry ON phone11_wake_terminals(expires_at);
-- Refreshing the provider token is not a new login. Transfer only the same
-- authenticated phone identity; removal or reassignment revokes the grant.
CREATE OR REPLACE FUNCTION phone11_wake_push_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.session_id=OLD.session_id AND NEW.user_id=OLD.user_id
    AND NEW.tenant_id=OLD.tenant_id AND NEW.extension_id=OLD.extension_id AND NEW.device_id=OLD.device_id
    AND NEW.platform=OLD.platform AND NEW.bundle_id=OLD.bundle_id AND NEW.sandbox=OLD.sandbox
    AND NEW.sip_uri=OLD.sip_uri AND NEW.token_type=OLD.token_type THEN
    UPDATE phone11_wake_bindings SET push_revision=NEW.revision WHERE push_revision=OLD.revision;
  ELSE
    DELETE FROM phone11_wake_bindings WHERE push_revision=OLD.revision;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS phone11_wake_push_lifecycle_trigger ON phone11_push_devices;
CREATE TRIGGER phone11_wake_push_lifecycle_trigger AFTER UPDATE OR DELETE ON phone11_push_devices
  FOR EACH ROW EXECUTE FUNCTION phone11_wake_push_lifecycle();
COMMIT;
