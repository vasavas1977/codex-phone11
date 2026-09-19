-- Phone11 Team Chat collaboration increment. Apply after migration.sql, after
-- confirming this is the owned Phone11 auth database. The app never runs it.
BEGIN;

ALTER TABLE phone11_chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE phone11_chat_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE phone11_chat_messages ADD COLUMN IF NOT EXISTS forward_source_conversation_id UUID;
ALTER TABLE phone11_chat_messages ADD COLUMN IF NOT EXISTS forward_source_message_id UUID;
DO $$ BEGIN
  ALTER TABLE phone11_chat_messages ADD CONSTRAINT phone11_chat_messages_forward_source_pair_check
    CHECK ((forward_source_conversation_id IS NULL) = (forward_source_message_id IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Attachment-only messages have an empty caption. The service permits that
-- shape only after it has claimed at least one owned, ready attachment.
ALTER TABLE phone11_chat_messages DROP CONSTRAINT IF EXISTS phone11_chat_messages_content_check;
ALTER TABLE phone11_chat_messages ADD CONSTRAINT phone11_chat_messages_content_check
  CHECK (length(content) BETWEEN 0 AND 4000);
CREATE INDEX IF NOT EXISTS phone11_chat_messages_roots
  ON phone11_chat_messages(tenant_id, conversation_id, sequence DESC)
  WHERE parent_message_id IS NULL;

CREATE TABLE IF NOT EXISTS phone11_chat_reactions (
  tenant_id INTEGER NOT NULL,
  conversation_id UUID NOT NULL,
  message_id UUID NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  emoji VARCHAR(32) NOT NULL CHECK (length(emoji) BETWEEN 1 AND 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, conversation_id, message_id, user_id, emoji),
  FOREIGN KEY (tenant_id, conversation_id, message_id)
    REFERENCES phone11_chat_messages(tenant_id, conversation_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS phone11_chat_reactions_message
  ON phone11_chat_reactions(tenant_id, conversation_id, message_id, emoji, created_at);

-- Saves are personal. A saved message is never exposed through another
-- member's message result or notification.
CREATE TABLE IF NOT EXISTS phone11_chat_bookmarks (
  tenant_id INTEGER NOT NULL,
  conversation_id UUID NOT NULL,
  message_id UUID NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, conversation_id, message_id, user_id),
  FOREIGN KEY (tenant_id, conversation_id, message_id)
    REFERENCES phone11_chat_messages(tenant_id, conversation_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS phone11_chat_bookmarks_user
  ON phone11_chat_bookmarks(tenant_id, user_id, created_at DESC);

-- Pins deliberately belong to the conversation, rather than to a member.
CREATE TABLE IF NOT EXISTS phone11_chat_pins (
  tenant_id INTEGER NOT NULL,
  conversation_id UUID NOT NULL,
  message_id UUID NOT NULL,
  pinned_by INTEGER NOT NULL REFERENCES users(id),
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, conversation_id, message_id),
  FOREIGN KEY (tenant_id, conversation_id, message_id)
    REFERENCES phone11_chat_messages(tenant_id, conversation_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS phone11_chat_pins_conversation
  ON phone11_chat_pins(tenant_id, conversation_id, pinned_at DESC);

CREATE TABLE IF NOT EXISTS phone11_chat_notification_preferences (
  tenant_id INTEGER NOT NULL,
  conversation_id UUID NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  muted BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, conversation_id, user_id),
  FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES phone11_chat_conversations(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS phone11_chat_notification_preferences_user
  ON phone11_chat_notification_preferences(tenant_id, user_id, muted)
  WHERE muted;

-- Presence is an explicit, short-lived activity signal. It is not inferred
-- from a directory row, SIP registration, or a simulated presence engine.
CREATE TABLE IF NOT EXISTS phone11_chat_presence (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS phone11_chat_presence_fresh
  ON phone11_chat_presence(tenant_id, last_seen_at DESC);

-- Mentions retain an authenticated member id and a display range. The server
-- validates both at send time; text alone is deliberately never an identity.
CREATE TABLE IF NOT EXISTS phone11_chat_message_mentions (
  tenant_id INTEGER NOT NULL,
  conversation_id UUID NOT NULL,
  message_id UUID NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0 AND start_offset <= 4000),
  length INTEGER NOT NULL CHECK (length BETWEEN 2 AND 256),
  PRIMARY KEY (tenant_id, conversation_id, message_id, start_offset),
  FOREIGN KEY (tenant_id, conversation_id, message_id)
    REFERENCES phone11_chat_messages(tenant_id, conversation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, conversation_id, user_id)
    REFERENCES phone11_chat_members(tenant_id, conversation_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS phone11_chat_message_mentions_message
  ON phone11_chat_message_mentions(tenant_id, conversation_id, message_id, start_offset);
COMMIT;
