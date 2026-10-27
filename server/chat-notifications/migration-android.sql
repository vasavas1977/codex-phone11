-- Source candidate only. Requires the original ordinary notification migration.
-- Owner commissioning is required before applying; existing rows remain iOS.
BEGIN;
ALTER TABLE phone11_chat_notification_devices ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'ios';
ALTER TABLE phone11_chat_notification_devices DROP CONSTRAINT IF EXISTS phone11_chat_notification_devices_token_check;
DO $$ DECLARE old_constraint TEXT; BEGIN
 FOR old_constraint IN SELECT c.conname FROM pg_constraint c
  WHERE c.conrelid='phone11_chat_notification_devices'::regclass AND c.contype='u'
  AND (SELECT array_agg(a.attname::text ORDER BY u.ordinality) FROM unnest(c.conkey) WITH ORDINALITY u(attnum,ordinality)
   JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.attnum)=ARRAY['bundle_id','environment','token_hash']
 LOOP EXECUTE format('ALTER TABLE phone11_chat_notification_devices DROP CONSTRAINT %I',old_constraint); END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='phone11_chat_notification_devices'::regclass AND conname='phone11_chat_device_token_platform_check') THEN
  ALTER TABLE phone11_chat_notification_devices ADD CONSTRAINT phone11_chat_device_token_platform_check CHECK (
   (platform='ios' AND length(token) BETWEEN 32 AND 512 AND token ~ '^[0-9a-fA-F]+$') OR
   (platform='android' AND environment='production' AND length(token) BETWEEN 32 AND 4096 AND token ~ '^[A-Za-z0-9_:-]+$'));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='phone11_chat_notification_devices'::regclass AND conname='phone11_chat_device_provider_token_key') THEN
  ALTER TABLE phone11_chat_notification_devices ADD CONSTRAINT phone11_chat_device_provider_token_key UNIQUE(platform,bundle_id,environment,token_hash);
 END IF;
END $$;
COMMIT;
