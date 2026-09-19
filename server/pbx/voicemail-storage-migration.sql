-- Phone11 voicemail inbox and private media metadata.
--
-- Apply through the reviewed backup/clone migration procedure.  This file is
-- deliberately never run at application startup.  FreeSWITCH must be
-- configured separately to upload each completed WAV to POST
-- /api/recordings/voicemail with the configured integration secret.
BEGIN;

CREATE TABLE IF NOT EXISTS voicemail_messages (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  extension_id INTEGER NOT NULL REFERENCES extensions(id),
  message_uuid TEXT NOT NULL,
  caller_number TEXT NOT NULL DEFAULT '',
  caller_name TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  storage_path TEXT NOT NULL,
  storage_size_bytes INTEGER NOT NULL CHECK (storage_size_bytes > 0),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, message_uuid),
  UNIQUE (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS phone11_voicemail_inbox
  ON voicemail_messages (tenant_id, extension_id, status, created_at DESC);

-- Guard against a cross-tenant extension reference even when integer IDs are
-- valid globally.  The trigger remains data-only and does not grant access.
CREATE OR REPLACE FUNCTION phone11_voicemail_extension_tenant_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM extensions e
    WHERE e.id = NEW.extension_id
      AND e.tenant_id = NEW.tenant_id
      AND e.status = 'active'
      AND e.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Voicemail extension is not active in this tenant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phone11_voicemail_extension_tenant_guard
  ON voicemail_messages;
CREATE TRIGGER phone11_voicemail_extension_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, extension_id ON voicemail_messages
  FOR EACH ROW EXECUTE FUNCTION phone11_voicemail_extension_tenant_guard();

COMMIT;
