-- Explicit reviewed migration only. Never run during startup.
BEGIN;
CREATE TABLE IF NOT EXISTS phone11_recording_policies (
 tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id),
 mode TEXT NOT NULL DEFAULT 'off' CHECK(mode IN ('off','manual','automatic')),
 ai_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 retention_days INTEGER NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 365),
 updated_by INTEGER NOT NULL REFERENCES users(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS phone11_cloud_recordings (
 call_uuid VARCHAR(128) PRIMARY KEY,
 tenant_id INTEGER NOT NULL REFERENCES tenants(id),
 extension_id INTEGER NOT NULL REFERENCES extensions(id),
 native_history_id TEXT,
 number TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
 started_at TIMESTAMPTZ NOT NULL,
 ended_at TIMESTAMPTZ,
 recording_status TEXT NOT NULL DEFAULT 'off' CHECK(recording_status IN ('off','pending','recording','ready','failed')),
 summary_status TEXT NOT NULL DEFAULT 'off' CHECK(summary_status IN ('off','queued','processing','ready','failed')),
 storage_key TEXT,
 capture_token UUID,
 manual_actor_user_id INTEGER REFERENCES users(id),
 capture_pending_until TIMESTAMPTZ,
 capture_stop_requested_at TIMESTAMPTZ,
 capture_stopped_at TIMESTAMPTZ,
 capture_cleaned_at TIMESTAMPTZ,
 capture_upload_lease_until TIMESTAMPTZ,
 capture_upload_lease_token UUID,
 expires_at TIMESTAMPTZ NOT NULL,
 transcript TEXT,
 summary JSONB,
 -- Capture evidence only; never contact names, caller IDs, or Gemini labels.
 speaker_identity JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK(ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS phone11_cloud_recordings_owner ON phone11_cloud_recordings(tenant_id,extension_id,started_at DESC);
CREATE TABLE IF NOT EXISTS phone11_recording_jobs (
 call_uuid VARCHAR(128) PRIMARY KEY REFERENCES phone11_cloud_recordings(call_uuid) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','ready','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 lease_token UUID,
 lease_until TIMESTAMPTZ,
 worker_id TEXT,
 failure_code TEXT,
 CHECK((state='processing') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS phone11_recording_routes (
 channel_uuid UUID PRIMARY KEY,
 tenant_id INTEGER NOT NULL REFERENCES tenants(id),
 extension_id INTEGER NOT NULL REFERENCES extensions(id),
 sip_call_id TEXT,
 direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
 number TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE phone11_cloud_recordings ADD COLUMN IF NOT EXISTS purge_token UUID;
ALTER TABLE phone11_cloud_recordings ADD COLUMN IF NOT EXISTS purge_until TIMESTAMPTZ;
ALTER TABLE phone11_cloud_recordings ADD COLUMN IF NOT EXISTS capture_stop_requested_at TIMESTAMPTZ;
ALTER TABLE phone11_cloud_recordings ADD COLUMN IF NOT EXISTS speaker_identity JSONB;
CREATE TABLE IF NOT EXISTS phone11_recording_wake_links (
 wake_uuid UUID PRIMARY KEY, binding_id UUID NOT NULL,
 tenant_id INTEGER NOT NULL REFERENCES tenants(id), extension_id INTEGER NOT NULL REFERENCES extensions(id),
 sip_call_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,extension_id,sip_call_id)
);

-- The referenced IDs are globally valid on their own, so ordinary foreign keys
-- cannot prove that they describe the same workspace.  These guards are
-- additive: existing historical rows are left intact, while every new or
-- re-paired recording identity is checked at the database boundary.
CREATE OR REPLACE FUNCTION phone11_recording_policy_actor_tenant_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships tm
    WHERE tm.user_id = NEW.updated_by
      AND tm.tenant_id = NEW.tenant_id
      AND tm.status = 'active'
      AND tm.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'recording policy actor must be an active tenant owner or admin'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION phone11_recording_tenant_pair_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM extensions e
    WHERE e.id = NEW.extension_id
      AND e.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'recording extension must belong to the recording tenant'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'phone11_cloud_recordings' THEN
    IF NEW.manual_actor_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM user_extensions ue
      JOIN tenant_memberships tm
        ON tm.user_id = ue.user_id
       AND tm.tenant_id = NEW.tenant_id
       AND tm.status = 'active'
      WHERE ue.extension_id = NEW.extension_id
        AND ue.user_id = NEW.manual_actor_user_id
    ) THEN
      RAISE EXCEPTION 'recording capture actor must be actively assigned in the recording tenant'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM phone11_recording_routes rr
      WHERE rr.channel_uuid::text = NEW.call_uuid
        AND (rr.tenant_id, rr.extension_id) IS DISTINCT FROM (NEW.tenant_id, NEW.extension_id)
    ) THEN
      RAISE EXCEPTION 'recording route must match the cloud recording tenant and extension'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'phone11_recording_routes' THEN
    IF EXISTS (
      SELECT 1 FROM phone11_cloud_recordings r
      WHERE r.call_uuid = NEW.channel_uuid::text
        AND (r.tenant_id, r.extension_id) IS DISTINCT FROM (NEW.tenant_id, NEW.extension_id)
    ) THEN
      RAISE EXCEPTION 'recording route must match the cloud recording tenant and extension'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'phone11_recording_wake_links' THEN
    -- Wake links intentionally outlive transient wake bindings; enforce the
    -- pair only while the referenced binding is still retained.
    IF EXISTS (
      SELECT 1 FROM phone11_wake_bindings wb
      WHERE wb.id = NEW.binding_id
    ) AND NOT EXISTS (
      SELECT 1 FROM phone11_wake_bindings wb
      WHERE wb.id = NEW.binding_id
        AND wb.tenant_id = NEW.tenant_id
        AND wb.extension_id = NEW.extension_id
    ) THEN
      RAISE EXCEPTION 'recording wake link must match its wake binding tenant and extension'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION phone11_recording_extension_tenant_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id AND (
    EXISTS (SELECT 1 FROM phone11_cloud_recordings r WHERE r.extension_id = OLD.id)
    OR EXISTS (SELECT 1 FROM phone11_recording_routes rr WHERE rr.extension_id = OLD.id)
    OR EXISTS (SELECT 1 FROM phone11_recording_wake_links w WHERE w.extension_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'recording extension tenant is immutable while recording identities exist'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION phone11_recording_wake_binding_tenant_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.tenant_id, NEW.extension_id) IS DISTINCT FROM (OLD.tenant_id, OLD.extension_id)
    AND EXISTS (SELECT 1 FROM phone11_recording_wake_links w WHERE w.binding_id = OLD.id) THEN
    RAISE EXCEPTION 'wake binding tenant and extension are immutable while recording links exist'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phone11_recording_policy_actor_tenant_guard
  ON phone11_recording_policies;
CREATE TRIGGER phone11_recording_policy_actor_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, updated_by ON phone11_recording_policies
  FOR EACH ROW EXECUTE FUNCTION phone11_recording_policy_actor_tenant_guard();

DROP TRIGGER IF EXISTS phone11_cloud_recording_tenant_pair_guard
  ON phone11_cloud_recordings;
CREATE TRIGGER phone11_cloud_recording_tenant_pair_guard
  BEFORE INSERT OR UPDATE OF tenant_id, extension_id, manual_actor_user_id ON phone11_cloud_recordings
  FOR EACH ROW EXECUTE FUNCTION phone11_recording_tenant_pair_guard();

DROP TRIGGER IF EXISTS phone11_recording_route_tenant_pair_guard
  ON phone11_recording_routes;
CREATE TRIGGER phone11_recording_route_tenant_pair_guard
  BEFORE INSERT OR UPDATE OF tenant_id, extension_id ON phone11_recording_routes
  FOR EACH ROW EXECUTE FUNCTION phone11_recording_tenant_pair_guard();

DROP TRIGGER IF EXISTS phone11_recording_wake_link_tenant_pair_guard
  ON phone11_recording_wake_links;
CREATE TRIGGER phone11_recording_wake_link_tenant_pair_guard
  BEFORE INSERT OR UPDATE OF binding_id, tenant_id, extension_id ON phone11_recording_wake_links
  FOR EACH ROW EXECUTE FUNCTION phone11_recording_tenant_pair_guard();

DROP TRIGGER IF EXISTS phone11_recording_extension_tenant_immutable ON extensions;
CREATE TRIGGER phone11_recording_extension_tenant_immutable
  BEFORE UPDATE OF tenant_id ON extensions
  FOR EACH ROW EXECUTE FUNCTION phone11_recording_extension_tenant_immutable();

DO $$
BEGIN
  IF to_regclass('phone11_wake_bindings') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS phone11_recording_wake_binding_tenant_immutable ON phone11_wake_bindings';
    EXECUTE 'CREATE TRIGGER phone11_recording_wake_binding_tenant_immutable
      BEFORE UPDATE OF tenant_id, extension_id ON phone11_wake_bindings
      FOR EACH ROW EXECUTE FUNCTION phone11_recording_wake_binding_tenant_immutable()';
  END IF;
END;
$$;
COMMIT;
