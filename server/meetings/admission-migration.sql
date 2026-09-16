-- DRAFT ONLY. Apply after a reviewed migration plan against the owned Phone11
-- PostgreSQL database. Never execute this file during application startup.
-- It is additive and deliberately separate from the legacy meeting draft.
BEGIN;

CREATE TABLE IF NOT EXISTS phone11_meeting_admission_rooms (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled', 'open', 'ended')),
  lobby_mode TEXT NOT NULL DEFAULT 'required' CHECK (lobby_mode IN ('disabled', 'required')),
  consent_policy_version VARCHAR(128) NOT NULL,
  meeting_notice_version VARCHAR(128) NOT NULL,
  revision UUID NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, tenant_id),
  CHECK ((state = 'ended') = (ended_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS phone11_meeting_admission_rooms_tenant
  ON phone11_meeting_admission_rooms(tenant_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS phone11_meeting_admission_members (
  meeting_id UUID NOT NULL,
  tenant_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  participant_id VARCHAR(96) NOT NULL CHECK (participant_id ~ '^[A-Za-z0-9_-]+$'),
  role TEXT NOT NULL CHECK (role IN ('host', 'cohost', 'member', 'guest')),
  grant_profile TEXT NOT NULL CHECK (grant_profile IN ('interactive', 'listener')),
  listen_language VARCHAR(2) NOT NULL CHECK (listen_language IN ('th', 'en', 'zh', 'ja', 'ko', 'fr', 'de', 'es')),
  lobby_state TEXT NOT NULL DEFAULT 'pending' CHECK (lobby_state IN ('pending', 'admitted', 'rejected')),
  revision UUID NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (meeting_id, user_id),
  UNIQUE (meeting_id, tenant_id, user_id),
  UNIQUE (meeting_id, participant_id),
  FOREIGN KEY (meeting_id, tenant_id)
    REFERENCES phone11_meeting_admission_rooms(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS phone11_meeting_admission_members_lookup
  ON phone11_meeting_admission_members(tenant_id, user_id, meeting_id)
  WHERE revoked_at IS NULL;

-- Each interpreter receipt is pinned to both the server-generated participant
-- identity and the meeting notice acknowledged by that participant. Recording
-- remains a separate consent/session contract.
CREATE TABLE IF NOT EXISTS phone11_meeting_consent_receipts (
  id UUID PRIMARY KEY,
  meeting_id UUID NOT NULL,
  tenant_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  participant_id VARCHAR(96) NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('live_interpretation')),
  policy_version VARCHAR(128) NOT NULL,
  meeting_notice_version VARCHAR(128) NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  announcement_acknowledged_at TIMESTAMPTZ NOT NULL,
  withdrawn_at TIMESTAMPTZ,
  receipt_revision UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (meeting_id, user_id, participant_id, purpose, policy_version, meeting_notice_version),
  FOREIGN KEY (meeting_id, tenant_id, user_id)
    REFERENCES phone11_meeting_admission_members(meeting_id, tenant_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS phone11_meeting_admission_operations (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL,
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  operation TEXT NOT NULL CHECK (operation IN ('create_room', 'open_room', 'admit_member', 'revoke_member', 'record_consent', 'end_room')),
  idempotency_key UUID NOT NULL,
  request_revision UUID,
  result_revision UUID,
  state TEXT NOT NULL CHECK (state IN ('accepted', 'rejected', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, actor_user_id, idempotency_key),
  FOREIGN KEY (meeting_id, tenant_id)
    REFERENCES phone11_meeting_admission_rooms(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS phone11_meeting_admission_audit (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL,
  participant_id VARCHAR(96),
  actor_user_id INTEGER REFERENCES users(id),
  operation_id UUID REFERENCES phone11_meeting_admission_operations(id),
  event_type TEXT NOT NULL,
  room_revision UUID,
  member_revision UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (meeting_id, tenant_id)
    REFERENCES phone11_meeting_admission_rooms(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS phone11_meeting_admission_audit_history
  ON phone11_meeting_admission_audit(tenant_id, meeting_id, occurred_at DESC);

COMMIT;
