-- DRAFT ONLY. Apply through the reviewed Phone11 PostgreSQL migration process;
-- never execute this file during application startup. This is intentionally
-- separate from admission-migration.sql: plain video has no consent receipt,
-- language, interpreter, worker, or transcript lifecycle.
--
-- Preflight the canonical users, tenants, tenant_memberships, and
-- phone11_auth_identity schemas first. The resolver requires a single active
-- Phone11 identity (disabled_at IS NULL) for every admitted participant.
BEGIN;

CREATE TABLE IF NOT EXISTS phone11_plain_video_admission_rooms (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  state TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (state IN ('scheduled', 'open', 'ended')),
  revision UUID NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, tenant_id),
  CHECK ((state = 'ended') = (ended_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS phone11_plain_video_admission_rooms_tenant
  ON phone11_plain_video_admission_rooms(tenant_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS phone11_plain_video_admission_members (
  meeting_id UUID NOT NULL,
  tenant_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  participant_id VARCHAR(96) NOT NULL
    CHECK (participant_id ~ '^[A-Za-z0-9_-]{1,96}$'),
  grant_profile TEXT NOT NULL
    CHECK (grant_profile IN ('interactive', 'listener')),
  lobby_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (lobby_state IN ('pending', 'admitted', 'rejected')),
  revision UUID NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (meeting_id, user_id),
  UNIQUE (meeting_id, tenant_id, user_id),
  UNIQUE (meeting_id, tenant_id, user_id, participant_id),
  UNIQUE (meeting_id, participant_id),
  FOREIGN KEY (meeting_id, tenant_id)
    REFERENCES phone11_plain_video_admission_rooms(id, tenant_id),
  FOREIGN KEY (user_id, tenant_id)
    REFERENCES tenant_memberships(user_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS phone11_plain_video_admission_members_lookup
  ON phone11_plain_video_admission_members(tenant_id, user_id, meeting_id)
  WHERE revoked_at IS NULL;

-- A lease stores only the durable lifecycle revisions that authorized one
-- server-side issuance attempt. It never stores a media token. The issuer
-- rechecks both revisions and the active admission predicates after Connect11
-- responds, before it returns any token to the Phone11 client.
CREATE TABLE IF NOT EXISTS phone11_plain_video_admission_leases (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  meeting_id UUID NOT NULL,
  user_id INTEGER NOT NULL,
  participant_id VARCHAR(96) NOT NULL
    CHECK (participant_id ~ '^[A-Za-z0-9_-]{1,96}$'),
  room_revision UUID NOT NULL,
  member_revision UUID NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'issued', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '5 minutes'),
  CHECK (state <> 'revoked' OR revoked_at IS NOT NULL),
  FOREIGN KEY (meeting_id, tenant_id, user_id, participant_id)
    REFERENCES phone11_plain_video_admission_members(
      meeting_id, tenant_id, user_id, participant_id
    )
);
CREATE INDEX IF NOT EXISTS phone11_plain_video_admission_leases_pending
  ON phone11_plain_video_admission_leases(tenant_id, meeting_id, user_id, expires_at)
  WHERE state = 'pending';

-- A removal revokes the local member before any external request. `pending`
-- means only that local denial is durable; it is not evidence that Connect11
-- removed an already connected participant. Only `completed` is an observed
-- provider acknowledgement. This table intentionally stores no media token.
CREATE TABLE IF NOT EXISTS phone11_plain_video_eviction_operations (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  meeting_id UUID NOT NULL,
  user_id INTEGER NOT NULL,
  participant_id VARCHAR(96) NOT NULL
    CHECK (participant_id ~ '^[A-Za-z0-9_-]{1,96}$'),
  idempotency_key VARCHAR(128) NOT NULL
    CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'failed')),
  provider_eviction_id UUID,
  revoke_token_ts BIGINT,
  provider_created_at TIMESTAMPTZ,
  provider_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, user_id, idempotency_key),
  CHECK ((state = 'completed') = (provider_completed_at IS NOT NULL)),
  FOREIGN KEY (meeting_id, tenant_id, user_id, participant_id)
    REFERENCES phone11_plain_video_admission_members(
      meeting_id, tenant_id, user_id, participant_id
    )
);
CREATE INDEX IF NOT EXISTS phone11_plain_video_eviction_operations_pending
  ON phone11_plain_video_eviction_operations(tenant_id, meeting_id, user_id, created_at)
  WHERE state = 'pending';

CREATE OR REPLACE FUNCTION phone11_plain_video_admission_touch_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision = OLD.revision THEN
    RAISE EXCEPTION 'plain-video admission revision must change on update';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS phone11_plain_video_admission_room_revision
  ON phone11_plain_video_admission_rooms;
CREATE TRIGGER phone11_plain_video_admission_room_revision
BEFORE UPDATE ON phone11_plain_video_admission_rooms
FOR EACH ROW EXECUTE FUNCTION phone11_plain_video_admission_touch_revision();
DROP TRIGGER IF EXISTS phone11_plain_video_admission_member_revision
  ON phone11_plain_video_admission_members;
CREATE TRIGGER phone11_plain_video_admission_member_revision
BEFORE UPDATE ON phone11_plain_video_admission_members
FOR EACH ROW EXECUTE FUNCTION phone11_plain_video_admission_touch_revision();

COMMIT;
