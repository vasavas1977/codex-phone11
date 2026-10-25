-- Source-only two-column prerequisite. No invocation, policy change or backfill.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
SET LOCAL search_path=pg_catalog;
LOCK TABLE public.phone11_cloud_recordings IN ACCESS EXCLUSIVE MODE;
DO $phone11_worker_columns$
DECLARE item record; actual record;
BEGIN
  IF current_database()<>'phone11ai' OR
     NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.phone11_cloud_recordings'::regclass AND relkind='r') THEN
    RAISE EXCEPTION 'WORKER_MIGRATION_TARGET_REFUSED';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('capture_stop_requested_at',1184,'TIMESTAMPTZ'),
    ('speaker_identity',3802,'JSONB')) v(name,type_oid,type_sql)
  LOOP
    SELECT a.atttypid,a.attnotnull,a.attgenerated,a.attidentity,d.oid AS default_oid
      INTO actual FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public.phone11_cloud_recordings'::regclass AND a.attname=item.name AND a.attnum>0 AND NOT a.attisdropped;
    IF FOUND THEN
      IF actual.atttypid<>item.type_oid OR actual.attnotnull OR actual.attgenerated<>'' OR actual.attidentity<>'' OR actual.default_oid IS NOT NULL THEN
        RAISE EXCEPTION 'WORKER_COLUMN_CONTRACT_REFUSED';
      END IF;
    ELSE
      EXECUTE format('ALTER TABLE public.phone11_cloud_recordings ADD COLUMN %I %s',item.name,item.type_sql);
    END IF;
  END LOOP;
END
$phone11_worker_columns$;
COMMIT;
