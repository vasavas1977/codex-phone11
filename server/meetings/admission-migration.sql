-- DRAFT ONLY. Apply after a reviewed migration plan against the owned Phone11
-- PostgreSQL database. Never execute this file during application startup.
-- It is additive and deliberately separate from the legacy meeting draft.
-- Preflight the existing tenant_memberships primary key and all named tables
-- before applying; IF NOT EXISTS does not repair an incompatible schema.
BEGIN;

CREATE TABLE IF NOT EXISTS phone11_meeting_admission_rooms (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
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
  UNIQUE (meeting_id, tenant_id, user_id, participant_id),
  UNIQUE (meeting_id, participant_id),
  FOREIGN KEY (meeting_id, tenant_id)
    REFERENCES phone11_meeting_admission_rooms(id, tenant_id),
  FOREIGN KEY (user_id, tenant_id)
    REFERENCES tenant_memberships(user_id, tenant_id)
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
  participant_id VARCHAR(96) NOT NULL CHECK (participant_id ~ '^[A-Za-z0-9_-]+$'),
  purpose TEXT NOT NULL CHECK (purpose IN ('live_interpretation')),
  policy_version VARCHAR(128) NOT NULL,
  meeting_notice_version VARCHAR(128) NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  announcement_acknowledged_at TIMESTAMPTZ NOT NULL,
  withdrawn_at TIMESTAMPTZ,
  receipt_revision UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (meeting_id, user_id, participant_id, purpose, policy_version, meeting_notice_version),
  CHECK (announcement_acknowledged_at >= accepted_at),
  FOREIGN KEY (meeting_id, tenant_id, user_id, participant_id)
    REFERENCES phone11_meeting_admission_members(meeting_id, tenant_id, user_id, participant_id)
);

-- This ledger intentionally stores no token. A future issuer must create a
-- lease and token together after comparing all three revisions, then expire it
-- no later than the five-minute Connect11 grant. Connect11 v1 still needs an
-- eviction contract to end a previously minted token immediately.
CREATE TABLE IF NOT EXISTS phone11_meeting_admission_leases (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  meeting_id UUID NOT NULL,
  user_id INTEGER NOT NULL,
  participant_id VARCHAR(96) NOT NULL CHECK (participant_id ~ '^[A-Za-z0-9_-]+$'),
  room_revision UUID NOT NULL,
  member_revision UUID NOT NULL,
  receipt_revision UUID NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('issued', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '5 minutes'),
  FOREIGN KEY (meeting_id, tenant_id, user_id, participant_id)
    REFERENCES phone11_meeting_admission_members(meeting_id, tenant_id, user_id, participant_id)
);
CREATE INDEX IF NOT EXISTS phone11_meeting_admission_leases_active
  ON phone11_meeting_admission_leases(tenant_id, meeting_id, user_id, expires_at)
  WHERE state = 'issued';

CREATE TABLE IF NOT EXISTS phone11_meeting_admission_operations (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  meeting_id UUID NOT NULL,
  actor_user_id INTEGER NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create_room', 'open_room', 'admit_member', 'revoke_member', 'record_consent', 'end_room')),
  idempotency_key UUID NOT NULL,
  request_revision UUID,
  result_revision UUID,
  state TEXT NOT NULL CHECK (state IN ('accepted', 'rejected', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, tenant_id, meeting_id),
  UNIQUE (tenant_id, actor_user_id, idempotency_key),
  FOREIGN KEY (meeting_id, tenant_id)
    REFERENCES phone11_meeting_admission_rooms(id, tenant_id),
  FOREIGN KEY (actor_user_id, tenant_id)
    REFERENCES tenant_memberships(user_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS phone11_meeting_admission_audit (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  meeting_id UUID NOT NULL,
  participant_id VARCHAR(96),
  participant_user_id INTEGER,
  actor_user_id INTEGER,
  operation_id UUID,
  event_type TEXT NOT NULL,
  room_revision UUID,
  member_revision UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((participant_id IS NULL) = (participant_user_id IS NULL)),
  FOREIGN KEY (meeting_id, tenant_id)
    REFERENCES phone11_meeting_admission_rooms(id, tenant_id),
  FOREIGN KEY (meeting_id, tenant_id, participant_user_id, participant_id)
    REFERENCES phone11_meeting_admission_members(meeting_id, tenant_id, user_id, participant_id),
  FOREIGN KEY (actor_user_id, tenant_id)
    REFERENCES tenant_memberships(user_id, tenant_id),
  FOREIGN KEY (operation_id, tenant_id, meeting_id)
    REFERENCES phone11_meeting_admission_operations(id, tenant_id, meeting_id)
);
CREATE INDEX IF NOT EXISTS phone11_meeting_admission_audit_history
  ON phone11_meeting_admission_audit(tenant_id, meeting_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION phone11_meeting_admission_touch_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision = OLD.revision THEN
    RAISE EXCEPTION 'meeting admission revision must change on update';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS phone11_meeting_admission_room_revision ON phone11_meeting_admission_rooms;
CREATE TRIGGER phone11_meeting_admission_room_revision
BEFORE UPDATE ON phone11_meeting_admission_rooms
FOR EACH ROW EXECUTE FUNCTION phone11_meeting_admission_touch_revision();
DROP TRIGGER IF EXISTS phone11_meeting_admission_member_revision ON phone11_meeting_admission_members;
CREATE TRIGGER phone11_meeting_admission_member_revision
BEFORE UPDATE ON phone11_meeting_admission_members
FOR EACH ROW EXECUTE FUNCTION phone11_meeting_admission_touch_revision();

CREATE OR REPLACE FUNCTION phone11_meeting_admission_audit_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'meeting admission audit is append-only';
END;
$$;
DROP TRIGGER IF EXISTS phone11_meeting_admission_audit_immutable ON phone11_meeting_admission_audit;
CREATE TRIGGER phone11_meeting_admission_audit_immutable
BEFORE UPDATE OR DELETE ON phone11_meeting_admission_audit
FOR EACH ROW EXECUTE FUNCTION phone11_meeting_admission_audit_immutable();

COMMIT;
