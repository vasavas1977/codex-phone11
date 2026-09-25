-- DRAFT ONLY. Apply through the reviewed Phone11 PostgreSQL migration process
-- after channel-meeting-migration.sql. This grants no host permission and
-- creates no room, invitation, provider session, or push notification.
BEGIN;

ALTER TABLE phone11_channel_meetings
  ADD COLUMN IF NOT EXISTS origin_kind TEXT NOT NULL DEFAULT 'channel';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.phone11_channel_meetings'::regclass
    AND conname='phone11_channel_meetings_origin_kind_check') THEN
    ALTER TABLE phone11_channel_meetings ADD CONSTRAINT phone11_channel_meetings_origin_kind_check
      CHECK (origin_kind IN ('channel', 'direct'));
  END IF;
END $$;

-- Blocking a direct contact is a durable local denial for both participants.
-- The chat block writer already serializes the pair with the same advisory
-- lock used by direct meeting start and token confirmation. Provider eviction
-- remains a separate workflow; this trigger does not claim disconnection.
CREATE OR REPLACE FUNCTION phone11_direct_meeting_revoke_blocked_pair()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE phone11_plain_video_admission_members admission
     SET revoked_at = COALESCE(admission.revoked_at, clock_timestamp()),
         revision = gen_random_uuid()
    FROM phone11_channel_meetings source
    JOIN phone11_channel_meeting_invitations invitation
      ON invitation.meeting_id=source.meeting_id
     AND invitation.tenant_id=source.tenant_id
     AND invitation.channel_id=source.channel_id
   WHERE source.origin_kind='direct'
     AND source.tenant_id=NEW.tenant_id
     AND ((source.created_by=NEW.blocker_id AND invitation.recipient_id=NEW.blocked_id)
       OR (source.created_by=NEW.blocked_id AND invitation.recipient_id=NEW.blocker_id))
     AND admission.meeting_id=source.meeting_id
     AND admission.tenant_id=source.tenant_id
     AND admission.revoked_at IS NULL;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS phone11_direct_meeting_block_pair ON phone11_chat_blocks;
CREATE TRIGGER phone11_direct_meeting_block_pair
AFTER INSERT ON phone11_chat_blocks
FOR EACH ROW EXECUTE FUNCTION phone11_direct_meeting_revoke_blocked_pair();

COMMIT;
