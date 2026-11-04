-- Read-only checks; no objects/records are dropped. The operator must verify
-- the actual connection against the approved new-project dashboard first.
DO $preflight$
DECLARE
  target_ref text := current_setting('app.lovable_exit_target_ref', true);
BEGIN
  IF current_setting('app.lovable_exit_target_confirmed', true) IS DISTINCT FROM 'true'
     OR target_ref IS NULL OR target_ref !~ '^[a-z]{20}$'
     OR target_ref IN ('zisrsttmjeipkmllqubi', 'dbdkvrkmeowdydizrsmn') THEN
    RAISE EXCEPTION 'A verified NEW target project is required. Production source and existing TJK project are protected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'An administrative target database connection is required';
  END IF;
  IF to_regclass('auth.users') IS NULL OR to_regclass('storage.buckets') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    RAISE EXCEPTION 'Initialized compatible Supabase auth/storage/realtime services are required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')) THEN
    RAISE EXCEPTION 'Existing public application relations found; schema history may only run on a fresh empty target';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM storage.buckets)
     OR EXISTS (SELECT 1 FROM storage.objects) THEN
    RAISE EXCEPTION 'Existing target auth users or Storage data found; fresh schema reconstruction is blocked';
  END IF;
END
$preflight$;
