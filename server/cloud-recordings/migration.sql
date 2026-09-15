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
CREATE TABLE IF NOT EXISTS phone11_recording_wake_links (
 wake_uuid UUID PRIMARY KEY, binding_id UUID NOT NULL,
 tenant_id INTEGER NOT NULL REFERENCES tenants(id), extension_id INTEGER NOT NULL REFERENCES extensions(id),
 sip_call_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,extension_id,sip_call_id)
);
COMMIT;
