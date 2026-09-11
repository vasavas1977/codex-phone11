-- Separate ordinary APNs registry/outbox. Source candidate only; never apply as part
-- of the earlier VoIP rollout. Requires owned auth and chat migrations first.
BEGIN;
CREATE TABLE IF NOT EXISTS phone11_chat_notification_devices (
 id UUID PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES phone11_auth_session(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id),
 tenant_id INTEGER NOT NULL REFERENCES tenants(id),
 device_id UUID NOT NULL,
 token TEXT NOT NULL CHECK (length(token) BETWEEN 32 AND 512 AND token ~ '^[0-9a-fA-F]+$'),
 token_hash CHAR(64) NOT NULL,
 bundle_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK (environment IN ('production','sandbox')),
 revision UUID NOT NULL,
 registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(user_id,tenant_id,device_id),
 UNIQUE(bundle_id,environment,token_hash)
);
CREATE INDEX IF NOT EXISTS phone11_chat_notification_devices_session ON phone11_chat_notification_devices(session_id);
CREATE TABLE IF NOT EXISTS phone11_chat_notification_outbox (
 id UUID PRIMARY KEY,
 device_id UUID NOT NULL REFERENCES phone11_chat_notification_devices(id) ON DELETE CASCADE,
 device_revision UUID NOT NULL,
 message_id UUID NOT NULL REFERENCES phone11_chat_messages(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()+INTERVAL '10 minutes',
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','attempted','accepted','unavailable')),
 attempted_at TIMESTAMPTZ,
 UNIQUE(device_id,message_id)
);
CREATE INDEX IF NOT EXISTS phone11_chat_notification_pending ON phone11_chat_notification_outbox(created_at) WHERE state='pending';
COMMIT;
