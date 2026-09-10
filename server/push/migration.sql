-- Add-only Phone11 push registry. Apply only to the approved owned-auth/PBX database.
-- No existing PBX objects, assignments, credentials or routes are modified.
BEGIN;
CREATE TABLE IF NOT EXISTS phone11_push_devices (
  session_id TEXT NOT NULL REFERENCES phone11_auth_session(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  extension_id INTEGER NOT NULL REFERENCES extensions(id),
  device_id VARCHAR(512) NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  bundle_id VARCHAR(512) NOT NULL,
  sandbox BOOLEAN NOT NULL DEFAULT FALSE,
  token_type TEXT NOT NULL CHECK (token_type IN ('voip', 'fcm', 'apns')),
  token TEXT NOT NULL CHECK (length(token) BETWEEN 1 AND 4096),
  token_hash CHAR(64) NOT NULL,
  sip_uri VARCHAR(512) NOT NULL,
  app_version VARCHAR(128),
  revision UUID NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_used TIMESTAMPTZ,
  PRIMARY KEY (user_id, tenant_id, extension_id, device_id, platform),
  UNIQUE (platform, bundle_id, sandbox, token_hash)
);
CREATE INDEX IF NOT EXISTS phone11_push_devices_session ON phone11_push_devices(session_id);
CREATE INDEX IF NOT EXISTS phone11_push_devices_target ON phone11_push_devices(sip_uri, tenant_id, extension_id);
COMMIT;
