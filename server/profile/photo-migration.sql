-- Private, tenant-scoped Phone11 profile photo metadata. Apply through the
-- reviewed Phone11 migration process; the application never applies this file.
BEGIN;

CREATE TABLE IF NOT EXISTS phone11_workspace_profile_photos (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  version UUID NOT NULL,
  storage_key TEXT NOT NULL CHECK (length(storage_key) BETWEEN 1 AND 512),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id),
  UNIQUE (tenant_id, user_id, version)
);

CREATE INDEX IF NOT EXISTS phone11_workspace_profile_photos_version
  ON phone11_workspace_profile_photos(tenant_id, user_id, version);

-- Physical deletion follows metadata replacement/removal. Keeping cleanup in a
-- durable queue prevents a transient filesystem failure from silently retaining
-- personal bytes forever.
CREATE TABLE IF NOT EXISTS phone11_profile_photo_deletions (
  storage_key TEXT PRIMARY KEY CHECK (length(storage_key) BETWEEN 1 AND 512),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS phone11_profile_photo_deletions_due
  ON phone11_profile_photo_deletions(queued_at, attempts);

COMMIT;
