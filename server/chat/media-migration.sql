-- Protected Team Chat media. Apply after server/chat/migration.sql. The
-- application never applies this source migration itself.
BEGIN;

-- Attachment reads follow the message's existing soft-delete policy.
ALTER TABLE phone11_chat_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS phone11_chat_attachments (
  id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  conversation_id UUID NOT NULL,
  uploaded_by INTEGER NOT NULL,
  client_id UUID NOT NULL,
  -- A same-tenant forward deliberately creates a new authorized attachment
  -- row that references immutable bytes already stored under this key.
  storage_key TEXT NOT NULL CHECK (length(storage_key) BETWEEN 1 AND 512),
  filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 128),
  mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 100),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL CHECK (state IN ('ready', 'attached')),
  message_id UUID,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  attached_at TIMESTAMPTZ,
  FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES phone11_chat_conversations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, conversation_id, uploaded_by)
    REFERENCES phone11_chat_members(tenant_id, conversation_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, conversation_id, message_id)
    REFERENCES phone11_chat_messages(tenant_id, conversation_id, id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, conversation_id, uploaded_by, client_id),
  CHECK (
    (state = 'ready' AND message_id IS NULL AND expires_at IS NOT NULL AND attached_at IS NULL)
    OR
    (state = 'attached' AND message_id IS NOT NULL AND expires_at IS NULL AND attached_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS phone11_chat_attachments_message
  ON phone11_chat_attachments(tenant_id, conversation_id, message_id)
  WHERE state = 'attached';
CREATE INDEX IF NOT EXISTS phone11_chat_attachments_expiry
  ON phone11_chat_attachments(expires_at)
  WHERE state = 'ready';

COMMIT;
