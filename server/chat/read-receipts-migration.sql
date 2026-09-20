-- Explicit per-message visibility receipts. Apply after migration.sql and
-- collaboration-migration.sql. The app never runs migrations automatically.
BEGIN;
CREATE TABLE IF NOT EXISTS phone11_chat_read_receipts (
  tenant_id INTEGER NOT NULL,
  conversation_id UUID NOT NULL,
  message_id UUID NOT NULL,
  reader_id INTEGER NOT NULL REFERENCES users(id),
  read_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, conversation_id, message_id, reader_id),
  FOREIGN KEY (tenant_id, conversation_id, message_id)
    REFERENCES phone11_chat_messages(tenant_id, conversation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, conversation_id, reader_id)
    REFERENCES phone11_chat_members(tenant_id, conversation_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS phone11_chat_read_receipts_sender_lookup
  ON phone11_chat_read_receipts(tenant_id, conversation_id, message_id, read_at, reader_id);
COMMIT;
