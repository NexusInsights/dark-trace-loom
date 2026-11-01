-- Root-reviewed NEW target only, after source schema/data restoration.
-- Prepared only; not executed against any database.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog,public;
DO $target_guard$
DECLARE target_ref text:=current_setting('app.lovable_exit_target_ref',true);
BEGIN
  IF current_setting('app.lovable_exit_target_confirmed',true) IS DISTINCT FROM 'true'
     OR target_ref IS NULL OR target_ref !~ '^[a-z]{20}$'
     OR target_ref IN ('zisrsttmjeipkmllqubi','dbdkvrkmeowdydizrsmn') THEN
    RAISE EXCEPTION 'Only the independently verified NEW migration target may receive this RPC';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
     OR to_regclass('public.organization_invitations') IS NULL
     OR to_regclass('public.organization_members') IS NULL THEN
    RAISE EXCEPTION 'Reviewed administrative access and restored invitation/member tables are required';
  END IF;
  IF to_regprocedure('public.accept_organization_invitation(text,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'An existing invitation RPC requires explicit definition review; it will not be replaced automatically';
  END IF;
  IF NOT has_table_privilege('service_role','public.organization_invitations','SELECT')
     OR NOT has_table_privilege('service_role','public.organization_invitations','UPDATE')
     OR NOT has_table_privilege('service_role','public.organization_members','SELECT')
     OR NOT has_table_privilege('service_role','public.organization_members','INSERT') THEN
    RAISE EXCEPTION 'Existing service-role table privileges are insufficient; do not grant anonymous/user access as a workaround';
  END IF;
END
$target_guard$;

CREATE FUNCTION public.accept_organization_invitation(p_token text,p_user_id uuid,p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog,public
SET lock_timeout = '3s'
AS $function$
DECLARE
  invitation public.organization_invitations%ROWTYPE;
  membership public.organization_members%ROWTYPE;
  was_member boolean;
  inserted_count bigint;
  accepted_id uuid;
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  IF p_token IS NULL OR length(p_token)<8 OR length(p_token)>128 OR p_token ~ '\s'
     OR p_user_id IS NULL OR p_email IS NULL OR length(p_email)>254 OR position('@' IN p_email)<2 THEN
    RETURN jsonb_build_object('error','invalid_body');
  END IF;
  SELECT * INTO invitation FROM public.organization_invitations WHERE token=p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF lower(invitation.email)<>lower(p_email) THEN RETURN jsonb_build_object('error','email_mismatch'); END IF;
  SELECT * INTO membership FROM public.organization_members
    WHERE organization_id=invitation.organization_id AND user_id=p_user_id FOR UPDATE;
  was_member:=FOUND;
  IF invitation.accepted_at IS NOT NULL THEN
    IF NOT was_member THEN RETURN jsonb_build_object('error','already_accepted'); END IF;
    RETURN jsonb_build_object('status','success','org_id',invitation.organization_id,'role',membership.role,'idempotent',true,'already_member',true);
  END IF;
  IF invitation.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('error','expired'); END IF;
  -- Existing members keep their established privileges; an old invite cannot
  -- demote an owner/admin or silently upgrade another member's current role.
  INSERT INTO public.organization_members(organization_id,user_id,role,invited_by)
    VALUES(invitation.organization_id,p_user_id,invitation.role,invitation.invited_by)
    ON CONFLICT(organization_id,user_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  SELECT * INTO membership FROM public.organization_members
    WHERE organization_id=invitation.organization_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Membership operation was not confirmed'; END IF;
  UPDATE public.organization_invitations SET accepted_at=clock_timestamp()
    WHERE id=invitation.id AND accepted_at IS NULL RETURNING id INTO accepted_id;
  IF accepted_id IS NULL THEN RAISE EXCEPTION 'Invitation state update was not confirmed'; END IF;
  RETURN jsonb_build_object('status','success','org_id',invitation.organization_id,'role',membership.role,'idempotent',false,'already_member',inserted_count=0);
END
$function$;

REVOKE ALL ON FUNCTION public.accept_organization_invitation(text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(text,uuid,text) TO service_role;
DO $grant_postconditions$
BEGIN
  IF has_function_privilege('anon','public.accept_organization_invitation(text,uuid,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.accept_organization_invitation(text,uuid,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.accept_organization_invitation(text,uuid,text)','EXECUTE')
     OR EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.accept_organization_invitation(text,uuid,text)'::regprocedure AND prosecdef) THEN
    RAISE EXCEPTION 'Expected service-role-only SECURITY INVOKER RPC permissions were not established';
  END IF;
END
$grant_postconditions$;
COMMIT;
