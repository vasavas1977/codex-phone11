-- Minimal live delta for Phone11 session presence and explicit read receipts.
--
-- This artifact is intentionally narrower than the historical chat migrations.
-- It must run only through the guarded migration operator after the exact live
-- database and catalog fingerprints have been revalidated. It never repairs or
-- replaces an existing object: drift and partial prior application fail closed.

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(
  hashtextextended('phone11-chat-presence-receipts-live-delta-20260920', 0)
);

DO $phone11_preflight$
DECLARE
  required_relation TEXT;
  required_relations CONSTANT TEXT[] := ARRAY[
    'users',
    'tenants',
    'tenant_memberships',
    'user_extensions',
    'extensions',
    'phone11_chat_conversations',
    'phone11_chat_members',
    'phone11_chat_messages',
    'phone11_chat_blocks',
    'phone11_chat_presence'
  ];
BEGIN
  IF current_user <> 'phone11ai' THEN
    RAISE EXCEPTION 'phone11_schema_owner_mismatch';
  END IF;
  IF current_schema() IS DISTINCT FROM 'public'
     OR NOT has_schema_privilege(current_user, 'public', 'USAGE')
     OR NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'phone11_schema_context_mismatch';
  END IF;

  FOREACH required_relation IN ARRAY required_relations LOOP
    IF to_regclass('public.' || required_relation) IS NULL THEN
      RAISE EXCEPTION 'phone11_missing_prerequisite_relation';
    END IF;
  END LOOP;

  IF to_regclass('public.phone11_chat_presence_sessions') IS NOT NULL
     OR to_regclass('public.phone11_chat_read_receipts') IS NOT NULL
     OR to_regclass('public.phone11_chat_presence_sessions_fresh') IS NOT NULL
     OR to_regclass('public.phone11_chat_read_receipts_sender_lookup') IS NOT NULL THEN
    RAISE EXCEPTION 'phone11_target_already_exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = ANY(required_relations)
      AND (
        relation.relkind NOT IN ('r', 'p')
        OR pg_get_userbyid(relation.relowner) <> current_user
        OR relation.relrowsecurity
        OR relation.relforcerowsecurity
      )
  ) THEN
    RAISE EXCEPTION 'phone11_prerequisite_relation_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = ANY(required_relations)
      AND grantee <> current_user
  ) THEN
    RAISE EXCEPTION 'phone11_prerequisite_grant_mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND contype = 'p'
      AND convalidated
      AND pg_get_constraintdef(oid, true) = 'PRIMARY KEY (id)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tenants'::regclass
      AND contype = 'p'
      AND convalidated
      AND pg_get_constraintdef(oid, true) = 'PRIMARY KEY (id)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.phone11_chat_messages'::regclass
      AND contype = 'u'
      AND convalidated
      AND pg_get_constraintdef(oid, true) =
        'UNIQUE (tenant_id, conversation_id, id)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.phone11_chat_members'::regclass
      AND contype = 'p'
      AND convalidated
      AND pg_get_constraintdef(oid, true) =
        'PRIMARY KEY (tenant_id, conversation_id, user_id)'
  ) THEN
    RAISE EXCEPTION 'phone11_prerequisite_key_mismatch';
  END IF;

  IF NOT (
    SELECT COUNT(*) = 9
    FROM pg_attribute
    WHERE attrelid = 'public.phone11_chat_messages'::regclass
      AND attnum > 0
      AND NOT attisdropped
      AND (attname, format_type(atttypid, atttypmod)) IN (
        ('id', 'uuid'),
        ('tenant_id', 'integer'),
        ('conversation_id', 'uuid'),
        ('sender_id', 'integer'),
        ('parent_message_id', 'uuid'),
        ('deleted_at', 'timestamp with time zone'),
        ('sequence', 'bigint'),
        ('client_id', 'uuid'),
        ('content', 'text')
      )
  ) OR NOT (
    SELECT COUNT(*) = 3
    FROM pg_attribute
    WHERE attrelid = 'public.phone11_chat_members'::regclass
      AND attnum > 0
      AND NOT attisdropped
      AND (attname, format_type(atttypid, atttypmod)) IN (
        ('tenant_id', 'integer'),
        ('conversation_id', 'uuid'),
        ('user_id', 'integer')
      )
  ) THEN
    RAISE EXCEPTION 'phone11_prerequisite_column_mismatch';
  END IF;
END
$phone11_preflight$;

CREATE TABLE phone11_chat_presence_sessions (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  session_id UUID NOT NULL,
  generation UUID NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence >= 0),
  status TEXT NOT NULL CHECK (
    status IN ('available', 'away', 'on_call', 'in_meeting')
  ),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id, session_id)
);
CREATE INDEX phone11_chat_presence_sessions_fresh
  ON phone11_chat_presence_sessions(
    tenant_id,
    user_id,
    lease_expires_at DESC
  );

CREATE TABLE phone11_chat_read_receipts (
  tenant_id INTEGER NOT NULL,
  conversation_id UUID NOT NULL,
  message_id UUID NOT NULL,
  reader_id INTEGER NOT NULL REFERENCES users(id),
  read_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, conversation_id, message_id, reader_id),
  FOREIGN KEY (tenant_id, conversation_id, message_id)
    REFERENCES phone11_chat_messages(tenant_id, conversation_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, conversation_id, reader_id)
    REFERENCES phone11_chat_members(tenant_id, conversation_id, user_id)
    ON DELETE CASCADE
);
CREATE INDEX phone11_chat_read_receipts_sender_lookup
  ON phone11_chat_read_receipts(
    tenant_id,
    conversation_id,
    message_id,
    read_at,
    reader_id
  );

DO $phone11_verify$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid IN (
      'public.phone11_chat_presence_sessions'::regclass,
      'public.phone11_chat_read_receipts'::regclass
    )
      AND NOT constraint_record.convalidated
  ) OR EXISTS (
    SELECT 1
    FROM pg_index index_record
    WHERE index_record.indrelid IN (
      'public.phone11_chat_presence_sessions'::regclass,
      'public.phone11_chat_read_receipts'::regclass
    )
      AND (NOT index_record.indisvalid OR NOT index_record.indisready)
  ) THEN
    RAISE EXCEPTION 'phone11_target_validation_failed';
  END IF;
END
$phone11_verify$;
