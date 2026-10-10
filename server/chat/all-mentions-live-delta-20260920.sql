-- Guarded production delta for Phone11 @all message metadata. Run only through
-- the reviewed migration operator after revalidating the live catalog.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(
  hashtextextended('phone11-chat-all-mentions-live-delta-20260920', 0)
);

DO $phone11_preflight$
BEGIN
  IF current_user <> 'phone11ai' THEN
    RAISE EXCEPTION 'phone11_schema_owner_mismatch';
  END IF;
  IF current_schema() IS DISTINCT FROM 'public'
     OR NOT has_schema_privilege(current_user, 'public', 'USAGE')
     OR NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'phone11_schema_context_mismatch';
  END IF;
  IF to_regclass('public.phone11_chat_messages') IS NULL THEN
    RAISE EXCEPTION 'phone11_missing_prerequisite_relation';
  END IF;
  IF to_regclass('public.phone11_chat_message_all_mentions') IS NOT NULL THEN
    RAISE EXCEPTION 'phone11_target_already_exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'phone11_chat_messages'
      AND (relation.relkind NOT IN ('r', 'p')
        OR pg_get_userbyid(relation.relowner) <> current_user
        OR relation.relrowsecurity OR relation.relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM information_schema.table_privileges
    WHERE table_schema = 'public' AND table_name = 'phone11_chat_messages'
      AND grantee <> current_user
  ) THEN
    RAISE EXCEPTION 'phone11_prerequisite_relation_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.phone11_chat_messages'::regclass
      AND contype = 'u' AND convalidated
      AND pg_get_constraintdef(oid, true) = 'UNIQUE (tenant_id, conversation_id, id)'
  ) THEN
    RAISE EXCEPTION 'phone11_prerequisite_key_mismatch';
  END IF;
  IF NOT (
    SELECT COUNT(*) = 3 FROM pg_attribute
    WHERE attrelid = 'public.phone11_chat_messages'::regclass
      AND attnum > 0 AND NOT attisdropped
      AND (attname, format_type(atttypid, atttypmod)) IN (
        ('id', 'uuid'), ('tenant_id', 'integer'), ('conversation_id', 'uuid')
      )
  ) THEN
    RAISE EXCEPTION 'phone11_prerequisite_column_mismatch';
  END IF;
END
$phone11_preflight$;

CREATE TABLE phone11_chat_message_all_mentions (
  tenant_id INTEGER NOT NULL,
  conversation_id UUID NOT NULL,
  message_id UUID NOT NULL,
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0 AND start_offset <= 3996),
  length INTEGER NOT NULL CHECK (length = 4),
  PRIMARY KEY (tenant_id, conversation_id, message_id),
  FOREIGN KEY (tenant_id, conversation_id, message_id)
    REFERENCES phone11_chat_messages(tenant_id, conversation_id, id)
    ON DELETE CASCADE
);

DO $phone11_verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.phone11_chat_message_all_mentions'::regclass
      AND NOT convalidated
  ) OR EXISTS (
    SELECT 1 FROM pg_index
    WHERE indrelid = 'public.phone11_chat_message_all_mentions'::regclass
      AND (NOT indisvalid OR NOT indisready)
  ) THEN
    RAISE EXCEPTION 'phone11_target_validation_failed';
  END IF;
END
$phone11_verify$;
