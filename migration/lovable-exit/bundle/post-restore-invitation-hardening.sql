-- PREPARED FOR ROOT REVIEW ONLY. Not executed.
-- Run only on the approved NEW target after authoritative data restoration.
-- Original invitation rows, token values, admin flow and Edge route are retained.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog,public;
DO $reviewed_hardening$
DECLARE
  target_ref text:=current_setting('app.lovable_exit_target_ref',true);
  source_policy record;
  baseline_count bigint; baseline_digest text;
  after_count bigint; after_digest text;
BEGIN
  IF current_setting('app.lovable_exit_target_confirmed',true) IS DISTINCT FROM 'true'
     OR target_ref IS NULL OR target_ref !~ '^[a-z]{20}$'
     OR target_ref IN ('zisrsttmjeipkmllqubi','dbdkvrkmeowdydizrsmn') THEN
    RAISE EXCEPTION 'Only the independently verified NEW migration target may be hardened';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Reviewed administrative target access is required';
  END IF;
  IF to_regclass('public.organization_invitations') IS NULL
     OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.organization_invitations'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'Expected invitations table with RLS is missing';
  END IF;
  SELECT count(*),md5(coalesce(string_agg(to_jsonb(i)::text,',' ORDER BY i.id),''))
    INTO baseline_count,baseline_digest FROM public.organization_invitations i;
  SELECT p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid) AS expression,
    ARRAY(SELECT r.rolname::text FROM pg_roles r WHERE r.oid=ANY(p.polroles) ORDER BY r.rolname)::text[] AS roles
    INTO source_policy FROM pg_policy p
    WHERE p.polrelid='public.organization_invitations'::regclass AND p.polname='Public can lookup by token';
  IF FOUND THEN
    IF source_policy.polcmd<>'r' OR NOT source_policy.polpermissive
       OR source_policy.expression IS DISTINCT FROM 'true'
       OR source_policy.roles IS DISTINCT FROM ARRAY['anon','authenticated']::text[] THEN
      RAISE EXCEPTION 'Invitation policy differs from the audited source definition; no unreviewed policy change is permitted';
    END IF;
    EXECUTE 'DROP POLICY "Public can lookup by token" ON public.organization_invitations';
  END IF;
  EXECUTE 'REVOKE SELECT ON public.organization_invitations FROM anon';
  IF has_table_privilege('anon','public.organization_invitations','SELECT') THEN
    RAISE EXCEPTION 'Anonymous SELECT is still inherited through another grant; review grant drift before continuing';
  END IF;
  IF NOT has_table_privilege('service_role','public.organization_invitations','SELECT')
     OR NOT has_table_privilege('authenticated','public.organization_invitations','SELECT') THEN
    RAISE EXCEPTION 'Required Edge/admin invitation read privileges were not preserved';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.organization_invitations'::regclass
    AND p.polname='Org admins view invitations' AND p.polcmd='r'
    AND pg_get_expr(p.polqual,p.polrelid)='is_org_admin(auth.uid(), organization_id)') THEN
    RAISE EXCEPTION 'Expected org-admin invitation SELECT policy requires review';
  END IF;
  SELECT count(*),md5(coalesce(string_agg(to_jsonb(i)::text,',' ORDER BY i.id),''))
    INTO after_count,after_digest FROM public.organization_invitations i;
  IF after_count<>baseline_count OR after_digest IS DISTINCT FROM baseline_digest THEN
    RAISE EXCEPTION 'Invitation data changed during policy hardening';
  END IF;
  RAISE NOTICE 'Invitation policy hardening prepared transaction passed: anonymous SELECT denied, expected admin/Edge read preserved, % rows retained',after_count;
END
$reviewed_hardening$;
COMMIT;
