-- Phone11 voicemail inbox and private media metadata.
--
-- Apply through the reviewed backup/clone migration procedure.  This file is
-- deliberately never run at application startup. The table is expected to be
-- absent before this migration. Do not backfill owner_user_id from a current
-- extension assignee if an earlier candidate table exists; quarantine those
-- rows and resolve their original owners from deposit-time evidence first.
-- FreeSWITCH must be
-- configured separately to upload each completed WAV to POST
-- /api/recordings/voicemail with the configured integration secret.
BEGIN;

-- This epoch changes on owner/tenant reassignment and every voicemail toggle.
-- A pre-record admission cannot survive reassignment or disable/re-enable.
ALTER TABLE extensions
  ADD COLUMN IF NOT EXISTS voicemail_owner_epoch UUID NOT NULL DEFAULT gen_random_uuid();

CREATE OR REPLACE FUNCTION phone11_voicemail_owner_epoch_rotate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.user_id IS DISTINCT FROM NEW.user_id OR
     OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR
     OLD.voicemail_enabled IS DISTINCT FROM NEW.voicemail_enabled THEN
    NEW.voicemail_owner_epoch := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phone11_voicemail_owner_epoch_rotate ON extensions;
CREATE TRIGGER phone11_voicemail_owner_epoch_rotate
  BEFORE UPDATE OF user_id, tenant_id, voicemail_enabled ON extensions
  FOR EACH ROW EXECUTE FUNCTION phone11_voicemail_owner_epoch_rotate();

CREATE TABLE IF NOT EXISTS voicemail_deposit_admissions (
  message_uuid TEXT PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  extension_id INTEGER NOT NULL REFERENCES extensions(id),
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  owner_epoch UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS phone11_voicemail_admissions_tenant
  ON voicemail_deposit_admissions (tenant_id, extension_id, created_at DESC);

CREATE TABLE IF NOT EXISTS voicemail_messages (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  extension_id INTEGER NOT NULL REFERENCES extensions(id),
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  owner_epoch UUID NOT NULL,
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
  ON voicemail_messages (tenant_id, owner_user_id, status, created_at DESC);

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
      AND e.user_id = NEW.owner_user_id
      AND e.voicemail_owner_epoch = NEW.owner_epoch
      AND e.voicemail_enabled = true
      AND EXISTS (
        SELECT 1 FROM user_extensions ue
        JOIN tenant_memberships tm
          ON tm.user_id = ue.user_id AND tm.tenant_id = e.tenant_id AND tm.status = 'active'
        WHERE ue.extension_id = e.id AND ue.user_id = NEW.owner_user_id
      )
    FOR SHARE OF e
  ) THEN
    RAISE EXCEPTION 'Voicemail extension is not active in this tenant';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM voicemail_deposit_admissions a
    WHERE a.message_uuid = NEW.message_uuid
      AND a.tenant_id = NEW.tenant_id
      AND a.extension_id = NEW.extension_id
      AND a.owner_user_id = NEW.owner_user_id
      AND a.owner_epoch = NEW.owner_epoch
  ) THEN
    RAISE EXCEPTION 'Voicemail deposit admission is missing or mismatched';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phone11_voicemail_extension_tenant_guard
  ON voicemail_messages;
CREATE TRIGGER phone11_voicemail_extension_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, extension_id, owner_user_id, owner_epoch, message_uuid ON voicemail_messages
  FOR EACH ROW EXECUTE FUNCTION phone11_voicemail_extension_tenant_guard();

COMMIT;
