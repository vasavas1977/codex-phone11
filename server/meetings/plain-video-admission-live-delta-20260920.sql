-- Fail-closed live delta for Phone11 plain-video admission state.
-- Run only through the reviewed guarded operator. The operator owns the outer
-- transaction and exact catalog pins; this file never repairs partial objects.

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(
  hashtextextended('phone11-plain-video-admission-live-delta-20260920', 0)
);

DO $phone11_plain_video_preflight$
DECLARE
  required_relation TEXT;
  required_relations CONSTANT TEXT[] := ARRAY[
    'users', 'tenants', 'tenant_memberships', 'phone11_auth_identity'
  ];
BEGIN
  IF current_user <> 'phone11ai'
     OR current_schema() IS DISTINCT FROM 'public'
     OR NOT has_schema_privilege(current_user, 'public', 'USAGE')
     OR NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'phone11_plain_video_schema_context_mismatch';
  END IF;

  FOREACH required_relation IN ARRAY required_relations LOOP
    IF to_regclass('public.' || required_relation) IS NULL THEN
      RAISE EXCEPTION 'phone11_plain_video_missing_prerequisite';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND (
        relation.relname LIKE 'phone11_plain_video_%'
        OR relation.relname LIKE 'phone11_meeting%'
      )
  ) OR EXISTS (
    SELECT 1 FROM pg_proc routine
    JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND (
        routine.proname LIKE 'phone11_plain_video_%'
        OR routine.proname LIKE 'phone11_meeting%'
      )
  ) OR EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE NOT tgisinternal
      AND (
        tgname LIKE 'phone11_plain_video_%'
        OR tgname LIKE 'phone11_meeting%'
      )
  ) THEN
    RAISE EXCEPTION 'phone11_plain_video_target_already_exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = ANY(required_relations)
      AND (
        relation.relkind NOT IN ('r', 'p')
        OR pg_get_userbyid(relation.relowner) <> current_user
        OR relation.relrowsecurity
        OR relation.relforcerowsecurity
      )
  ) OR EXISTS (
    SELECT 1 FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = ANY(required_relations)
      AND grantee <> current_user
  ) THEN
    RAISE EXCEPTION 'phone11_plain_video_prerequisite_policy_mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass AND contype = 'p'
      AND convalidated AND pg_get_constraintdef(oid, true) = 'PRIMARY KEY (id)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tenants'::regclass AND contype = 'p'
      AND convalidated AND pg_get_constraintdef(oid, true) = 'PRIMARY KEY (id)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tenant_memberships'::regclass AND contype = 'p'
      AND convalidated
      AND pg_get_constraintdef(oid, true) = 'PRIMARY KEY (user_id, tenant_id)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.phone11_auth_identity'::regclass AND contype = 'p'
      AND convalidated AND pg_get_constraintdef(oid, true) = 'PRIMARY KEY (auth_user_id)'
  ) THEN
    RAISE EXCEPTION 'phone11_plain_video_prerequisite_key_mismatch';
  END IF;
END
$phone11_plain_video_preflight$;

CREATE TABLE phone11_plain_video_admission_rooms (
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
CREATE INDEX phone11_plain_video_admission_rooms_tenant
  ON phone11_plain_video_admission_rooms(tenant_id, state, created_at DESC);

CREATE TABLE phone11_plain_video_admission_members (
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
CREATE INDEX phone11_plain_video_admission_members_lookup
  ON phone11_plain_video_admission_members(tenant_id, user_id, meeting_id)
  WHERE revoked_at IS NULL;

CREATE TABLE phone11_plain_video_admission_leases (
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
CREATE INDEX phone11_plain_video_admission_leases_pending
  ON phone11_plain_video_admission_leases(tenant_id, meeting_id, user_id, expires_at)
  WHERE state = 'pending';

CREATE TABLE phone11_plain_video_eviction_operations (
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
CREATE INDEX phone11_plain_video_eviction_operations_pending
  ON phone11_plain_video_eviction_operations(tenant_id, meeting_id, user_id, created_at)
  WHERE state = 'pending';

CREATE FUNCTION phone11_plain_video_admission_touch_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision = OLD.revision THEN
    RAISE EXCEPTION 'plain-video admission revision must change on update';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER phone11_plain_video_admission_room_revision
BEFORE UPDATE ON phone11_plain_video_admission_rooms
FOR EACH ROW EXECUTE FUNCTION phone11_plain_video_admission_touch_revision();
CREATE TRIGGER phone11_plain_video_admission_member_revision
BEFORE UPDATE ON phone11_plain_video_admission_members
FOR EACH ROW EXECUTE FUNCTION phone11_plain_video_admission_touch_revision();

DO $phone11_plain_video_verify$
DECLARE
  target_relations CONSTANT TEXT[] := ARRAY[
    'phone11_plain_video_admission_rooms',
    'phone11_plain_video_admission_members',
    'phone11_plain_video_admission_leases',
    'phone11_plain_video_eviction_operations'
  ];
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = ANY(ARRAY[
      'public.phone11_plain_video_admission_rooms'::regclass,
      'public.phone11_plain_video_admission_members'::regclass,
      'public.phone11_plain_video_admission_leases'::regclass,
      'public.phone11_plain_video_eviction_operations'::regclass
    ]) AND NOT convalidated
  ) OR EXISTS (
    SELECT 1 FROM pg_index
    WHERE indrelid = ANY(ARRAY[
      'public.phone11_plain_video_admission_rooms'::regclass,
      'public.phone11_plain_video_admission_members'::regclass,
      'public.phone11_plain_video_admission_leases'::regclass,
      'public.phone11_plain_video_eviction_operations'::regclass
    ]) AND (NOT indisvalid OR NOT indisready)
  ) OR EXISTS (
    SELECT 1 FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = ANY(target_relations)
      AND (
        pg_get_userbyid(relation.relowner) <> current_user
        OR relation.relrowsecurity OR relation.relforcerowsecurity
      )
  ) OR EXISTS (
    SELECT 1 FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = ANY(target_relations)
      AND grantee <> current_user
  ) THEN
    RAISE EXCEPTION 'phone11_plain_video_target_validation_failed';
  END IF;
END
$phone11_plain_video_verify$;
