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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, conversation_id, sender_id) REFERENCES phone11_chat_members(tenant_id, conversation_id, user_id),
  UNIQUE (tenant_id, conversation_id, sender_id, client_id)
);
CREATE INDEX IF NOT EXISTS phone11_chat_messages_history ON phone11_chat_messages(tenant_id, conversation_id, sequence DESC);
COMMIT;
