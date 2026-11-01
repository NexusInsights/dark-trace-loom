-- Metadata/counts only. Run through an administrative connection on source and
-- destination; save output privately. This does not export password hashes,
-- tokens, function bodies, private records or storage binaries.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = pg_catalog,public;
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
     OR NOT has_table_privilege(current_user, 'auth.users', 'SELECT') THEN
    RAISE EXCEPTION 'Unrestricted administrative access is required; an RLS user view is not a source audit';
  END IF;
END
$guard$;

SELECT current_database() AS database_name, current_user AS database_role,
       current_setting('server_version') AS postgres_version,
       pg_database_size(current_database()) AS database_bytes;
SELECT n.nspname AS schema_name, c.relname AS relation, c.relkind,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
       pg_get_userbyid(c.relowner) AS owner,
       md5(coalesce(c.relacl::text,'')) AS acl_digest
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
  AND c.relkind IN ('r','p','v','m','S')
ORDER BY schema_name, relation;
SELECT table_schema, table_name, ordinal_position, column_name, data_type,
       udt_schema, udt_name, is_nullable, is_identity,
       md5(coalesce(column_default,'')) AS default_digest
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog','information_schema')
ORDER BY table_schema, table_name, ordinal_position;
SELECT schemaname, tablename, policyname, permissive, roles, cmd,
       md5(coalesce(qual,'') || '|' || coalesce(with_check,'')) AS policy_expression_digest
FROM pg_policies ORDER BY schemaname, tablename, policyname;
SELECT n.nspname AS schema_name, p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer, pg_get_userbyid(p.proowner) AS owner,
       md5(pg_get_functiondef(p.oid)) AS function_definition_digest,
       md5(coalesce(p.proacl::text,'')) AS acl_digest
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','auth','storage') AND p.prokind IN ('f','p')
ORDER BY schema_name, function_name, arguments;
SELECT n.nspname AS schema_name, c.relname AS relation, t.tgname AS trigger_name,
       t.tgenabled, md5(pg_get_triggerdef(t.oid)) AS definition_digest
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE NOT t.tgisinternal AND n.nspname IN ('public','auth','storage')
ORDER BY schema_name, relation, trigger_name;
SELECT n.nspname AS schema_name, c.relname AS relation, k.conname, k.contype,
       k.convalidated, md5(pg_get_constraintdef(k.oid)) AS definition_digest
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','auth','storage') ORDER BY schema_name, relation, k.conname;
SELECT extname, extversion, n.nspname AS extension_schema
FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY extname;
SELECT pubname, schemaname, tablename FROM pg_publication_tables ORDER BY pubname, schemaname, tablename;
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles
WHERE rolname !~ '^pg_' ORDER BY rolname;
SELECT n.nspname AS schema_name, t.typname, e.enumsortorder, e.enumlabel
FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace
WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder;

SELECT count(*) AS auth_user_count,
       count(*) FILTER (WHERE encrypted_password IS NOT NULL AND encrypted_password<>'') AS users_with_password_hash,
       count(*) FILTER (WHERE email_confirmed_at IS NOT NULL) AS email_confirmed_count,
       md5(coalesce(string_agg(id::text,',' ORDER BY id::text),'')) AS auth_user_id_digest
FROM auth.users;
SELECT provider, count(*) AS identity_count FROM auth.identities GROUP BY provider ORDER BY provider;
SELECT b.id AS bucket_id, b.public, count(o.id) AS object_metadata_count,
       coalesce(sum(CASE WHEN (o.metadata->>'size') ~ '^[0-9]+$' THEN (o.metadata->>'size')::numeric ELSE 0 END),0) AS declared_bytes
FROM storage.buckets b LEFT JOIN storage.objects o ON o.bucket_id=b.id
GROUP BY b.id,b.public ORDER BY b.id;

DO $optional$
DECLARE item record;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR item IN EXECUTE 'SELECT jobid, schedule, active, md5(command) AS command_digest FROM cron.job ORDER BY jobid' LOOP
      RAISE NOTICE 'cron_metadata %', row_to_json(item);
    END LOOP;
  END IF;
  IF to_regclass('auth.mfa_factors') IS NOT NULL THEN
    FOR item IN EXECUTE 'SELECT factor_type, status, count(*) AS count FROM auth.mfa_factors GROUP BY factor_type,status ORDER BY factor_type,status' LOOP
      RAISE NOTICE 'mfa_metadata %', row_to_json(item);
    END LOOP;
  END IF;
END
$optional$;
COMMIT;
