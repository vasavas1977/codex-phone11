-- Read-only catalog fingerprint query for phone11-profile-dnd-rollout.py.
-- It returns schema metadata only; never profile rows or customer content.
WITH target_tables AS (
  SELECT namespace.nspname AS schema_name,
         relation.relname AS table_name,
         pg_get_userbyid(relation.relowner) AS owner,
         relation.relkind,
         relation.relpersistence,
         relation.relrowsecurity AS row_security,
         relation.relforcerowsecurity AS force_row_security,
         COALESCE(grants.entries, '[]'::jsonb) AS grants
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
               'grantor', CASE WHEN acl.grantor = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantor) END,
               'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
               'privilege', acl.privilege_type,
               'grantable', acl.is_grantable
             ) ORDER BY acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable) AS entries
        FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
    ) grants ON TRUE
   WHERE namespace.nspname = 'public'
     AND relation.relname IN (
       'phone11_workspace_profile_status',
       'phone11_workspace_profile_status_settings'
     )
), catalog_rows AS (
  SELECT 'table'::text AS object_kind,
         jsonb_build_object(
           'schema', schema_name,
           'name', table_name,
           'owner', owner,
           'relkind', relkind,
           'persistence', relpersistence,
           'row_security', row_security,
           'force_row_security', force_row_security,
           'grants', grants
         ) AS object
    FROM target_tables
  UNION ALL
  SELECT 'column', jsonb_build_object(
           'schema', namespace.nspname,
           'table', relation.relname,
           'ordinal', attribute.attnum,
           'name', attribute.attname,
           'type', format_type(attribute.atttypid, attribute.atttypmod),
           'not_null', attribute.attnotnull,
           'default', pg_get_expr(default_value.adbin, default_value.adrelid)
         )
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_value
      ON default_value.adrelid = relation.oid AND default_value.adnum = attribute.attnum
   WHERE namespace.nspname = 'public'
     AND relation.relname IN (
       'phone11_workspace_profile_status',
       'phone11_workspace_profile_status_settings'
     )
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
  UNION ALL
  SELECT 'constraint', jsonb_build_object(
           'schema', namespace.nspname,
           'table', relation.relname,
           'name', constraint_row.conname,
           'type', constraint_row.contype,
           'definition', pg_get_constraintdef(constraint_row.oid, TRUE),
           'validated', constraint_row.convalidated
         )
    FROM pg_constraint constraint_row
    JOIN pg_class relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relname IN (
       'phone11_workspace_profile_status',
       'phone11_workspace_profile_status_settings'
     )
  UNION ALL
  SELECT 'index', jsonb_build_object(
           'schema', namespace.nspname,
           'table', relation.relname,
           'name', index_relation.relname,
           'definition', pg_get_indexdef(index_row.indexrelid),
           'valid', index_row.indisvalid,
           'primary', index_row.indisprimary
         )
    FROM pg_index index_row
    JOIN pg_class relation ON relation.oid = index_row.indrelid
    JOIN pg_class index_relation ON index_relation.oid = index_row.indexrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relname IN (
       'phone11_workspace_profile_status',
       'phone11_workspace_profile_status_settings'
     )
)
SELECT object_kind, object
  FROM catalog_rows
 ORDER BY object_kind, object;
