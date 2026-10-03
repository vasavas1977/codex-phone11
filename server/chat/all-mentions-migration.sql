-- One server-authoritative @all range per group/channel message. Apply only
-- after migration.sql and collaboration-migration.sql. The application never
-- runs schema changes automatically.
BEGIN;
CREATE TABLE IF NOT EXISTS phone11_chat_message_all_mentions (
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
COMMIT;
