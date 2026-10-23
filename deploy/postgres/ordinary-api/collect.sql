-- Fixed metadata only. No environment, password, role settings, function bodies or customer rows.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
SET LOCAL idle_in_transaction_session_timeout='30s';
SET LOCAL search_path=pg_catalog,pg_temp;
WITH tables AS (
 SELECT c.oid,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('audit_logs','call_events','call_legs','call_queues','call_records','did_numbers','emergency_addresses','extensions','ivr_actions','ivr_menus','organizations','phone11_auth_account','phone11_auth_identity','phone11_auth_rate_limit','phone11_auth_session','phone11_auth_user','phone11_auth_verification','phone11_channel_meeting_invitations','phone11_channel_meetings','phone11_chat_attachments','phone11_chat_blocks','phone11_chat_bookmarks','phone11_chat_conversations','phone11_chat_members','phone11_chat_message_all_mentions','phone11_chat_message_mentions','phone11_chat_messages','phone11_chat_notification_devices','phone11_chat_notification_outbox','phone11_chat_notification_preferences','phone11_chat_pins','phone11_chat_presence','phone11_chat_presence_sessions','phone11_chat_reactions','phone11_chat_read_receipts','phone11_chat_reports','phone11_cloud_recordings','phone11_conference_members','phone11_conference_operations','phone11_conference_rooms','phone11_meeting_admission_members','phone11_meeting_admission_rooms','phone11_meeting_consent_receipts','phone11_meeting_members','phone11_meeting_rooms','phone11_plain_video_admission_leases','phone11_plain_video_admission_members','phone11_plain_video_admission_rooms','phone11_plain_video_eviction_operations','phone11_profile_photo_deletions','phone11_push_devices','phone11_recording_jobs','phone11_recording_policies','phone11_recording_routes','phone11_recording_wake_links','phone11_wake_bindings','phone11_wake_calls','phone11_wake_terminals','phone11_workspace_invitation_events','phone11_workspace_invitations','phone11_workspace_profile_photos','phone11_workspace_profile_status','phone11_workspace_profile_status_settings','phone_numbers','queue_agents','queue_stats','ring_group_members','ring_groups','sip_accounts','sites','subscriber','tenant_memberships','tenant_settings','tenants','time_condition_rules','time_conditions','user_extensions','users','voicemail_deposit_admissions','voicemail_messages') AND c.relkind IN ('r','p')
), metadata AS (
 SELECT t.relname,jsonb_build_object('kind',t.relkind,'owner',t.owner,'rls',t.relrowsecurity,'forceRls',t.relforcerowsecurity,
 'columns',(SELECT jsonb_agg(a.attname::text ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped),
 'sequences',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',s.relname,'column',a.attname,
 'owned',EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=s.oid AND d.refobjid=t.oid AND d.refobjsubid=a.attnum AND d.deptype IN ('a','i')),
 'defaultBound',a.attidentity<>'' OR pg_get_expr(ad.adbin,ad.adrelid)=format('nextval(%L::regclass)',s.oid::regclass::text)) ORDER BY a.attnum)
 FROM pg_attribute a JOIN pg_class s ON s.oid=pg_get_serial_sequence(format('public.%I',t.relname),a.attname)::regclass AND s.relkind='S'
 LEFT JOIN pg_attrdef ad ON ad.adrelid=t.oid AND ad.adnum=a.attnum
 WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb)) AS value FROM tables t
)
SELECT jsonb_build_object('schema','PHONE11_ORDINARY_DB_CATALOG_V1','observedAt',clock_timestamp(),
 'database',current_database(),'serverVersion',current_setting('server_version_num'),'bootstrapRole',session_user,
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'auditPolicyHash',(SELECT encode(sha256(convert_to(COALESCE(string_agg(p.polname||':'||COALESCE(pg_get_expr(p.polqual,p.polrelid),'')||':'||COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),'')||':'||p.polroles::text||':'||p.polcmd::text||':'||p.polpermissive::text,E'\n' ORDER BY p.polname),''),'UTF8')),'hex') FROM pg_policy p WHERE p.polrelid='public.audit_logs'::regclass),
 'tables',(SELECT jsonb_object_agg(relname,value) FROM metadata));
ROLLBACK;
