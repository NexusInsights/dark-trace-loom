-- Read-only validation. No records are repaired, deleted or reassigned.
-- Compare source/target output and investigate any difference before cutover.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';
DO $integrity$
DECLARE
  fk record; pair record; owner_col record; orphan_count bigint;
  join_clause text; nonnull_clause text; anynull_clause text; anynonnull_clause text;
  predicate text; target_user text := current_setting('app.lovable_exit_acceptance_user_id',true);
  result record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
     OR NOT has_table_privilege(current_user,'auth.users','SELECT') THEN
    RAISE EXCEPTION 'Administrative access required for complete integrity validation';
  END IF;
  FOR fk IN SELECT k.*, c.relname, n.nspname FROM pg_constraint k
    JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE k.contype='f' AND n.nspname IN ('public','auth','storage') ORDER BY n.nspname,c.relname,k.conname
  LOOP
    join_clause:=''; nonnull_clause:=''; anynull_clause:=''; anynonnull_clause:='';
    FOR pair IN SELECT ca.attname AS child_col, pa.attname AS parent_col
      FROM unnest(fk.conkey,fk.confkey) WITH ORDINALITY AS u(child_att,parent_att,position)
      JOIN pg_attribute ca ON ca.attrelid=fk.conrelid AND ca.attnum=u.child_att
      JOIN pg_attribute pa ON pa.attrelid=fk.confrelid AND pa.attnum=u.parent_att ORDER BY u.position
    LOOP
      join_clause:=join_clause || CASE WHEN join_clause='' THEN '' ELSE ' AND ' END || format('p.%I=c.%I',pair.parent_col,pair.child_col);
      nonnull_clause:=nonnull_clause || CASE WHEN nonnull_clause='' THEN '' ELSE ' AND ' END || format('c.%I IS NOT NULL',pair.child_col);
      anynull_clause:=anynull_clause || CASE WHEN anynull_clause='' THEN '' ELSE ' OR ' END || format('c.%I IS NULL',pair.child_col);
      anynonnull_clause:=anynonnull_clause || CASE WHEN anynonnull_clause='' THEN '' ELSE ' OR ' END || format('c.%I IS NOT NULL',pair.child_col);
    END LOOP;
    IF join_clause='' THEN RAISE EXCEPTION 'Empty FK mapping for %',fk.conname; END IF;
    predicate:=format('(%s) AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)',nonnull_clause,fk.confrelid::regclass,join_clause);
    IF fk.confmatchtype='f' THEN predicate:=format('(%s) OR ((%s) AND (%s))',predicate,anynull_clause,anynonnull_clause); END IF;
    EXECUTE format('SELECT count(*) FROM %s c WHERE %s',fk.conrelid::regclass,predicate) INTO orphan_count;
    RAISE NOTICE 'foreign_key %',json_build_object('schema',fk.nspname,'table',fk.relname,'constraint',fk.conname,'validated',fk.convalidated,'orphans',orphan_count);
    IF orphan_count<>0 THEN RAISE EXCEPTION 'Foreign-key orphan records found in %.% (%); no data changed',fk.nspname,fk.relname,fk.conname; END IF;
  END LOOP;
  -- Some ownership UUIDs lack an SQL FK in the source schema. Report baseline
  -- counts; preserve source values and investigate, do not silently repair them.
  FOR owner_col IN SELECT c.table_name,c.column_name FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.udt_name='uuid'
      AND c.column_name IN ('user_id','owner_id','author_id','created_by','invited_by','developer_id')
    ORDER BY c.table_name,c.column_name
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=c.%I)',owner_col.table_name,owner_col.column_name,owner_col.column_name) INTO orphan_count;
    RAISE NOTICE 'ownership_baseline %',json_build_object('table',owner_col.table_name,'column',owner_col.column_name,'missing_auth_users',orphan_count);
  END LOOP;
  SELECT count(*) AS profiles_without_auth_user FROM public.profiles p WHERE NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p.id) INTO result;
  RAISE NOTICE 'profile_ownership %',row_to_json(result);
  IF target_user IS NOT NULL AND target_user<>'' THEN
    IF target_user !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RAISE EXCEPTION 'Acceptance user ID must be a verified UUID'; END IF;
    FOR result IN SELECT s.plan,s.status,s.current_period_end,
      s.stripe_customer_id='admin_override_enterprise' AS enterprise_override,
      EXISTS(SELECT 1 FROM auth.users u WHERE u.id=s.user_id) AS auth_user_preserved,
      EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=s.user_id) AS profile_preserved,
      EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=s.user_id AND r.role='admin') AS admin_role_preserved,
      (SELECT count(*) FROM public.organization_members m WHERE m.user_id=s.user_id) AS organization_memberships,
      (SELECT count(*) FROM public.tool_permissions p WHERE p.user_id=s.user_id) AS tool_permission_records
      FROM public.subscriptions s WHERE s.user_id=target_user::uuid
    LOOP RAISE NOTICE 'acceptance_account %',row_to_json(result); END LOOP;
    IF NOT EXISTS(SELECT 1 FROM public.subscriptions s WHERE s.user_id=target_user::uuid AND s.plan='enterprise' AND s.status='active' AND s.current_period_end IS NULL AND s.stripe_customer_id='admin_override_enterprise') THEN
      RAISE EXCEPTION 'Approved no-expiry Enterprise override was not preserved for the acceptance user';
    END IF;
  END IF;
END
$integrity$;
COMMIT;
