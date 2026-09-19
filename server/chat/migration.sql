-- Apply only after confirming this is the same PostgreSQL database as owned auth.
-- Requires existing users, tenants, user_extensions and extensions. No access is granted here.
BEGIN;
CREATE TABLE IF NOT EXISTS phone11_chat_conversations (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'group', 'channel')),
  name VARCHAR(100) NOT NULL,
  direct_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, direct_key)
);
CREATE TABLE IF NOT EXISTS phone11_chat_members (
  tenant_id INTEGER NOT NULL,
  conversation_id UUID NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  last_read_sequence BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, conversation_id, user_id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES phone11_chat_conversations(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS phone11_chat_members_user ON phone11_chat_members(user_id, tenant_id);
CREATE TABLE IF NOT EXISTS phone11_chat_messages (
  id UUID PRIMARY KEY,
  sequence BIGSERIAL UNIQUE NOT NULL,
  tenant_id INTEGER NOT NULL,
  conversation_id UUID NOT NULL,
  sender_id INTEGER NOT NULL,
  client_id UUID NOT NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  parent_message_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, conversation_id, sender_id) REFERENCES phone11_chat_members(tenant_id, conversation_id, user_id),
  -- A reply can only point at a message in this exact tenant and conversation.
  -- Keep the relation nullable so a future authorized delete can leave a safe
  -- standalone reply instead of cascading away unrelated saved messages.
  CONSTRAINT phone11_chat_messages_tenant_conversation_id_key UNIQUE (tenant_id, conversation_id, id),
  CONSTRAINT phone11_chat_messages_parent_same_conversation_fkey FOREIGN KEY (tenant_id, conversation_id, parent_message_id)
    REFERENCES phone11_chat_messages(tenant_id, conversation_id, id)
    ON DELETE SET NULL (parent_message_id),
  UNIQUE (tenant_id, conversation_id, sender_id, client_id)
);
CREATE INDEX IF NOT EXISTS phone11_chat_messages_history ON phone11_chat_messages(tenant_id, conversation_id, sequence DESC);
-- Existing deployments may already have the initial chat table. These additive
-- statements are deliberately kept here for review and are never auto-run by
-- the application. The FK validates existing rows before it can be installed.
ALTER TABLE phone11_chat_messages ADD COLUMN IF NOT EXISTS parent_message_id UUID;
DO $$ BEGIN
  ALTER TABLE phone11_chat_messages ADD CONSTRAINT phone11_chat_messages_tenant_conversation_id_key
    UNIQUE (tenant_id, conversation_id, id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE phone11_chat_messages ADD CONSTRAINT phone11_chat_messages_parent_same_conversation_fkey
    FOREIGN KEY (tenant_id, conversation_id, parent_message_id)
    REFERENCES phone11_chat_messages(tenant_id, conversation_id, id)
    ON DELETE SET NULL (parent_message_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS phone11_chat_messages_replies ON phone11_chat_messages(tenant_id, conversation_id, parent_message_id, sequence DESC)
  WHERE parent_message_id IS NOT NULL;
-- Safety policy is append-only for reports and soft-state for blocks. It never
-- deletes conversations, memberships, messages, or notification history.
CREATE TABLE IF NOT EXISTS phone11_chat_blocks (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  blocker_id INTEGER NOT NULL REFERENCES users(id),
  blocked_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS phone11_chat_blocks_blocked ON phone11_chat_blocks(tenant_id, blocked_id, blocker_id);
CREATE TABLE IF NOT EXISTS phone11_chat_reports (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  conversation_id UUID NOT NULL,
  message_id UUID,
  target_key TEXT NOT NULL CHECK (length(target_key) BETWEEN 1 AND 64),
  category TEXT NOT NULL CHECK (category IN ('harassment', 'spam', 'safety', 'other')),
  comment TEXT CHECK (comment IS NULL OR length(comment) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES phone11_chat_conversations(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, conversation_id, message_id)
    REFERENCES phone11_chat_messages(tenant_id, conversation_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, reporter_id, conversation_id, target_key, category),
  CHECK ((message_id IS NULL AND target_key = 'conversation') OR (message_id IS NOT NULL AND target_key = 'message:' || message_id::text))
);
CREATE INDEX IF NOT EXISTS phone11_chat_reports_review ON phone11_chat_reports(tenant_id, created_at DESC);
COMMIT;
