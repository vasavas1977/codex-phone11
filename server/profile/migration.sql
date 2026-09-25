-- Workspace-scoped profile preferences. Apply through the reviewed Phone11
-- database migration process; the application never applies this source file.
BEGIN;

CREATE TABLE IF NOT EXISTS phone11_workspace_profile_status (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  manual_availability TEXT NULL CHECK (manual_availability IN (
    'available', 'away', 'busy', 'out_of_office', 'dnd'
  )),
  manual_availability_expires_at TIMESTAMPTZ NULL,
  status_text VARCHAR(280) NULL CHECK (length(status_text) BETWEEN 1 AND 280),
  status_expires_at TIMESTAMPTZ NULL,
  work_location TEXT NULL CHECK (work_location IN ('office', 'remote')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id),
  CHECK (
    (manual_availability IS NULL AND manual_availability_expires_at IS NULL)
    OR (manual_availability IS NOT NULL AND manual_availability IN ('available', 'away', 'out_of_office') AND manual_availability_expires_at IS NULL)
    OR (manual_availability IS NOT NULL AND manual_availability IN ('busy', 'dnd') AND manual_availability_expires_at IS NOT NULL)
  ),
  CHECK ((status_text IS NOT NULL) OR status_expires_at IS NULL)
);

CREATE INDEX IF NOT EXISTS phone11_workspace_profile_status_visible
  ON phone11_workspace_profile_status(tenant_id, user_id, updated_at DESC);

-- Workspace administrators explicitly commission profile status per tenant.
-- An absent setting row is disabled, including on older databases that already
-- contain profile rows. Applying this migration never exposes saved statuses.
CREATE TABLE IF NOT EXISTS phone11_workspace_profile_status_settings (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

COMMIT;
