-- DRAFT ONLY. Apply before deploying the channel-meeting router through the
-- reviewed Phone11 PostgreSQL migration process. This provisions no meeting,
-- grants no start permission, and sends no provider or push notification.
BEGIN;

ALTER TABLE phone11_chat_members
  ADD COLUMN IF NOT EXISTS can_start_meeting BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS phone11_channel_meetings (
  meeting_id UUID PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  channel_id UUID NOT NULL,
  created_by INTEGER NOT NULL,
  request_id UUID NOT NULL,
  selection_fingerprint CHAR(64) NOT NULL
    CHECK (selection_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp() + INTERVAL '2 hours',
  UNIQUE (tenant_id, created_by, request_id),
  UNIQUE (meeting_id, tenant_id, channel_id),
  FOREIGN KEY (meeting_id, tenant_id)
    REFERENCES phone11_plain_video_admission_rooms(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, channel_id)
    REFERENCES phone11_chat_conversations(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '2 hours')
);
CREATE INDEX IF NOT EXISTS phone11_channel_meetings_channel
  ON phone11_channel_meetings(tenant_id, channel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS phone11_channel_meeting_invitations (
  id UUID PRIMARY KEY,
  meeting_id UUID NOT NULL,
  tenant_id INTEGER NOT NULL,
  channel_id UUID NOT NULL,
  recipient_id INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'unread' CHECK (state IN ('unread', 'read')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  read_at TIMESTAMPTZ,
  UNIQUE (meeting_id, recipient_id),
  CHECK ((state = 'read') = (read_at IS NOT NULL)),
  FOREIGN KEY (meeting_id, tenant_id, channel_id)
    REFERENCES phone11_channel_meetings(meeting_id, tenant_id, channel_id) ON DELETE RESTRICT,
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (meeting_id, tenant_id, recipient_id)
    REFERENCES phone11_plain_video_admission_members(meeting_id, tenant_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS phone11_channel_meeting_invitations_recipient
  ON phone11_channel_meeting_invitations(tenant_id, recipient_id, created_at DESC);

-- Membership removal and token confirmation serialize on the chat-member row.
-- Once removal obtains the row, revoke the corresponding local admission and
-- change its revision before the channel membership disappears. Existing
-- provider eviction remains a separate lifecycle and is not claimed here.
CREATE OR REPLACE FUNCTION phone11_channel_meeting_revoke_removed_member()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE phone11_plain_video_admission_members admission
     SET revoked_at = COALESCE(admission.revoked_at, clock_timestamp()),
         revision = gen_random_uuid()
    FROM phone11_channel_meetings source
   WHERE source.meeting_id = admission.meeting_id
     AND source.tenant_id = admission.tenant_id
     AND source.tenant_id = OLD.tenant_id
     AND source.channel_id = OLD.conversation_id
     AND admission.user_id = OLD.user_id
     AND admission.revoked_at IS NULL;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS phone11_channel_meeting_member_removal
  ON phone11_chat_members;
CREATE TRIGGER phone11_channel_meeting_member_removal
BEFORE DELETE ON phone11_chat_members
FOR EACH ROW EXECUTE FUNCTION phone11_channel_meeting_revoke_removed_member();

COMMIT;
