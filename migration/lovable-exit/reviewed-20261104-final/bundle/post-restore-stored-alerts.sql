-- NEW owned target only. Initial-installation reference; existing functions are
-- rejected. Root installed the engine and reviewed correction on the owned target.
-- Faithful stored-record detector replacement; no external HTTP/provider calls.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=pg_catalog;
DO $guard$
BEGIN
  IF current_user <> 'postgres'
     OR current_setting('app.lovable_exit_target_confirmed',true) IS DISTINCT FROM 'true'
     OR current_setting('app.lovable_exit_target_ref',true) IS DISTINCT FROM 'ocliymtdvtxfxczxgbjr'
     OR current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'Independently verified owned target, postgres and UTF8 are required';
  END IF;
  IF to_regclass('insight_nexus_migration.runs') IS NULL THEN RAISE EXCEPTION 'Independent restored-target marker is absent'; END IF;
  IF NOT EXISTS(SELECT 1 FROM insight_nexus_migration.runs WHERE migration_id='InsightNexus_20261014_v1' AND target_ref='ocliymtdvtxfxczxgbjr' AND source_sha256='0c6e389b8cf4cad909fc98763b9e083d89e4d2c8e72c709fe867be3aa10fcb4b' AND selection_sha256='5d5a7c6e41ef0a7739f38c6e42cf0e0a2c738545441298daddef41e8d9bc5ce6') THEN RAISE EXCEPTION 'Independent archive/selection marker mismatch'; END IF;
  IF to_regprocedure('public.run_stored_alert_checks(integer,uuid)') IS NOT NULL
     OR to_regprocedure('public.stored_alert_notification_id(uuid,timestamp with time zone,text)') IS NOT NULL
     OR to_regprocedure('public.stored_alert_utf16_length(text)') IS NOT NULL
     OR to_regprocedure('public.check_owned_stored_alerts()') IS NOT NULL THEN
    RAISE EXCEPTION 'Existing scheduler functions require explicit definition review';
  END IF;
  IF to_regprocedure('public.can_access_case(uuid,uuid)') IS NULL
     OR to_regprocedure('pg_catalog.sha256(bytea)') IS NULL
     OR to_regclass('public.alerts') IS NULL OR to_regclass('public.alert_notifications') IS NULL
     OR to_regclass('public.subjects') IS NULL OR to_regclass('public.system_logs') IS NULL THEN
    RAISE EXCEPTION 'Restored application tables/access helper and native SHA256 are required';
  END IF;
END
$guard$;

CREATE FUNCTION public.stored_alert_utf16_length(p_value text)
RETURNS integer LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SECURITY INVOKER
SET search_path=pg_catalog
AS $fn$
  SELECT coalesce(sum(CASE WHEN ascii(c) > 65535 THEN 2 ELSE 1 END),0)::integer
  FROM unnest(string_to_array(p_value,NULL)) AS chars(c)
$fn$;

CREATE FUNCTION public.stored_alert_notification_id(p_alert_id uuid,p_baseline timestamptz,p_metadata_json text)
RETURNS uuid LANGUAGE plpgsql STABLE STRICT SECURITY INVOKER
SET search_path=pg_catalog SET timezone='UTC'
AS $fn$
DECLARE bytes bytea; hex text;
BEGIN
  -- The JSON text must preserve the exact field/array order of the Edge helper.
  -- PostgreSQL's UTC JSON timestamp representation is used by PostgREST too.
  PERFORM p_metadata_json::json;
  bytes:=sha256(convert_to('['||to_json(p_alert_id)::text||','||to_json(p_baseline)::text||','||p_metadata_json||']','UTF8'));
  bytes:=set_byte(bytes,6,(get_byte(bytes,6)&15)|80);
  bytes:=set_byte(bytes,8,(get_byte(bytes,8)&63)|128);
  hex:=encode(substr(bytes,1,16),'hex');
  RETURN (substr(hex,1,8)||'-'||substr(hex,9,4)||'-'||substr(hex,13,4)||'-'||substr(hex,17,4)||'-'||substr(hex,21,12))::uuid;
END
$fn$;

CREATE FUNCTION public.run_stored_alert_checks(p_limit integer DEFAULT 100,p_owner uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog SET timezone='UTC' SET lock_timeout='3s'
AS $fn$
DECLARE
  a public.alerts%ROWTYPE; subject public.subjects%ROWTYPE;
  run_at timestamptz:=clock_timestamp(); baseline timestamptz;
  checked integer:=0; triggered integer:=0; failed integer:=0; notices integer:=0;
  examined integer:=0; wrote integer; more boolean:=false; elapsed boolean:=false;
  failure_code text; failures jsonb:='[]'; summary jsonb;
  count_a bigint; count_b bigint; ids_a uuid[]; ids_b uuid[]; names text[];
  identifiers text[]; invalid_identifiers boolean; identifier_count bigint;
  critical boolean; meta_json text; title text; message text; severity text; notice_id uuid;
  trim_chars text:=E' \t\n\r\f'||chr(11)||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'postgres execution only'; END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'Batch limit must be between 1 and 100'; END IF;
  IF NOT pg_try_advisory_xact_lock(623711734,516164681) THEN
    RETURN jsonb_build_object('checked',0,'triggered',0,'failed',0,'notifications_created',0,'has_more',true,'examined',0,'skipped',0,'remaining_in_batch',0,'failures','[]'::jsonb,'scope','postgres_scheduler','busy',true,'coverage','Changes in existing stored case records only; no external source polling.');
  END IF;

  FOR a IN
    SELECT al.* FROM public.alerts AS al
    WHERE al.enabled AND (p_owner IS NULL OR al.user_id=p_owner) AND
      (al.last_checked IS NULL OR
       (al.frequency='realtime' AND al.last_checked<=run_at-interval '5 minutes') OR
       (al.frequency='hourly' AND al.last_checked<=run_at-interval '1 hour') OR
       (al.frequency='daily' AND al.last_checked<=run_at-interval '1 day') OR
       (al.frequency='weekly' AND al.last_checked<=run_at-interval '7 days'))
    ORDER BY al.last_checked ASC NULLS FIRST,al.id ASC
    LIMIT p_limit FOR UPDATE SKIP LOCKED
  LOOP
    IF clock_timestamp()-run_at>interval '45 seconds' THEN elapsed:=true; EXIT; END IF;
    examined:=examined+1;
    BEGIN
      failure_code:='invalid_alert_record';
      IF NOT isfinite(a.created_at) OR (a.last_checked IS NOT NULL AND NOT isfinite(a.last_checked))
         OR a.created_at>run_at+interval '5 minutes' OR a.last_checked>run_at+interval '5 minutes' THEN RAISE EXCEPTION 'Invalid alert timestamp'; END IF;
      failure_code:='invalid_alert_frequency';
      IF a.frequency NOT IN ('realtime','hourly','daily','weekly') THEN RAISE EXCEPTION 'Invalid alert frequency'; END IF;
      failure_code:='subject_unavailable_or_not_authorized';
      SELECT s.* INTO subject FROM public.subjects AS s WHERE s.id=a.subject_id;
      IF NOT FOUND OR public.stored_alert_utf16_length(subject.name)>1000 THEN RAISE EXCEPTION 'Subject unavailable'; END IF;
      failure_code:='subject_case_access_not_verified';
      IF public.can_access_case(a.user_id,subject.case_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Case access unavailable'; END IF;

      baseline:=coalesce(a.last_checked,a.created_at);
      count_a:=0;count_b:=0;ids_a:='{}';ids_b:='{}';names:='{}';critical:=false;
      meta_json:=NULL;title:=NULL;message:=NULL;severity:='info';

      CASE a.alert_type
      WHEN 'domain_registration' THEN
        failure_code:='source_query_failed_artifacts';
        WITH matched AS MATERIALIZED (SELECT id,created_at FROM public.artifacts WHERE case_id=subject.case_id AND artifact_type='domain' AND created_at>baseline AND created_at<=run_at), sampled AS (SELECT id FROM matched ORDER BY created_at,id LIMIT 25)
        SELECT (SELECT count(*) FROM matched),coalesce((SELECT array_agg(id ORDER BY id::text COLLATE "C") FROM sampled),'{}'::uuid[]) INTO count_a,ids_a;
        IF count_a>0 THEN
          title:='New domain activity for "'||subject.name||'"';
          message:=count_a||' new stored domain artifact(s) detected since the last check. This does not query new domain registrations.';
          severity:='warning';
          meta_json:='{"artifact_count":'||count_a||',"sampled_evidence_ids":'||array_to_json(ids_a)::text||',"evidence_sample_truncated":'||(count_a>cardinality(ids_a))::text||'}';
        END IF;
      WHEN 'username_appearance' THEN
        failure_code:='source_query_failed_tool_results';
        WITH matched AS MATERIALIZED (SELECT id,created_at FROM public.tool_results WHERE case_id=subject.case_id AND created_at>baseline AND created_at<=run_at), sampled AS (SELECT id FROM matched ORDER BY created_at,id LIMIT 25)
        SELECT (SELECT count(*) FROM matched),coalesce((SELECT array_agg(id ORDER BY id::text COLLATE "C") FROM sampled),'{}'::uuid[]) INTO count_a,ids_a;
        IF count_a>0 THEN
          title:='New stored tool results for "'||subject.name||'"';
          message:=count_a||' new case tool result(s) were stored. A tool result alone does not verify a username match.';
          meta_json:='{"result_count":'||count_a||',"sampled_evidence_ids":'||array_to_json(ids_a)::text||',"evidence_sample_truncated":'||(count_a>cardinality(ids_a))::text||'}';
        END IF;
      WHEN 'data_change' THEN
        failure_code:='source_query_failed_artifacts';
        WITH matched AS MATERIALIZED (SELECT id,created_at FROM public.artifacts WHERE case_id=subject.case_id AND created_at>baseline AND created_at<=run_at), sampled AS (SELECT id FROM matched ORDER BY created_at,id LIMIT 25)
        SELECT (SELECT count(*) FROM matched),coalesce((SELECT array_agg(id ORDER BY id::text COLLATE "C") FROM sampled),'{}'::uuid[]) INTO count_a,ids_a;
        failure_code:='source_query_failed_events';
        WITH matched AS MATERIALIZED (SELECT id,created_at FROM public.events WHERE case_id=subject.case_id AND created_at>baseline AND created_at<=run_at), sampled AS (SELECT id FROM matched ORDER BY created_at,id LIMIT 25)
        SELECT (SELECT count(*) FROM matched),coalesce((SELECT array_agg(id ORDER BY id::text COLLATE "C") FROM sampled),'{}'::uuid[]) INTO count_b,ids_b;
        IF count_a+count_b>0 THEN
          title:='Stored case changes for "'||subject.name||'"';
          message:=(count_a+count_b)||' new stored records: '||count_a||' artifacts and '||count_b||' events.';
          severity:=CASE WHEN count_a+count_b>5 THEN 'warning' ELSE 'info' END;
          meta_json:='{"artifacts":'||count_a||',"events":'||count_b||',"sampled_evidence_ids":'||array_to_json(ids_a||ids_b)::text||',"evidence_sample_truncated":'||(count_a+count_b>cardinality(ids_a)+cardinality(ids_b))::text||'}';
        END IF;
      WHEN 'mention_monitoring' THEN
        failure_code:='source_query_failed_entities';
        WITH matched AS MATERIALIZED (SELECT id,created_at FROM public.entities WHERE case_id=subject.case_id AND created_at>baseline AND created_at<=run_at), sampled AS (SELECT id FROM matched ORDER BY created_at,id LIMIT 25)
        SELECT (SELECT count(*) FROM matched),coalesce((SELECT array_agg(id ORDER BY id::text COLLATE "C") FROM sampled),'{}'::uuid[]) INTO count_a,ids_a;
        IF count_a>0 THEN
          title:='New stored entity references for "'||subject.name||'"';
          message:=count_a||' new case entity record(s) were stored. This does not search external mentions.';
          meta_json:='{"entity_count":'||count_a||',"sampled_evidence_ids":'||array_to_json(ids_a)::text||',"evidence_sample_truncated":'||(count_a>cardinality(ids_a))::text||'}';
        END IF;
      WHEN 'breach_detection' THEN
        failure_code:='source_query_failed_identity_entities';
        SELECT count(*),coalesce(bool_or(btrim(ie.entity_value,trim_chars)='' OR public.stored_alert_utf16_length(ie.entity_value)>512),false),
               coalesce(array_agg(DISTINCT ie.entity_value COLLATE "C"),'{}'::text[])
        INTO identifier_count,invalid_identifiers,identifiers
        FROM public.identity_entities AS ie WHERE ie.source_case_id=subject.case_id AND ie.entity_type IN ('email','username','phone','domain');
        failure_code:='breach_identifiers_unbounded_or_invalid';
        IF identifier_count>250 OR invalid_identifiers THEN RAISE EXCEPTION 'Invalid identifier collection'; END IF;
        IF cardinality(identifiers)>0 THEN
          failure_code:='source_query_failed_breach_records';
          WITH matched AS MATERIALIZED (
            SELECT br.id,br.breach_name,br.breach_source,br.severity,br.created_at FROM public.breach_records AS br WHERE br.user_id=a.user_id AND br.identifier=ANY(identifiers) AND br.created_at>baseline AND br.created_at<=run_at
          ), sampled AS (
            SELECT m.id,m.breach_name,m.breach_source,m.severity,row_number() OVER(ORDER BY m.created_at,m.id) AS ordinal FROM matched AS m ORDER BY m.created_at,m.id LIMIT 25
          ), candidates AS (
            SELECT coalesce(nullif(s.breach_name,''),s.breach_source) AS name,s.ordinal FROM sampled AS s
          ), named AS (
            SELECT c.name COLLATE "C" AS name,min(c.ordinal) AS ordinal FROM candidates AS c WHERE c.name IS NOT NULL AND public.stored_alert_utf16_length(c.name)<=250 GROUP BY c.name COLLATE "C"
          )
          SELECT (SELECT count(*) FROM matched),coalesce((SELECT array_agg(s.id ORDER BY s.id::text COLLATE "C") FROM sampled AS s),'{}'::uuid[]),
                 coalesce((SELECT bool_or(s.severity='critical') FROM sampled AS s),false),
                 coalesce((SELECT array_agg(n.name ORDER BY n.ordinal) FROM named AS n),'{}'::text[])
          INTO count_a,ids_a,critical,names;
          IF count_a>0 THEN
            title:='New stored breach records for "'||subject.name||'"';
            message:=count_a||' new previously collected breach record(s) were stored. No breach provider was queried by this check.';
            severity:=CASE WHEN critical THEN 'critical' ELSE 'warning' END;
            meta_json:='{"breach_count":'||count_a||',"sampled_breach_names":'||array_to_json(names)::text||',"sampled_evidence_ids":'||array_to_json(ids_a)::text||',"evidence_sample_truncated":'||(count_a>cardinality(ids_a))::text||',"severity_coverage":"sampled_records_only"}';
          END IF;
        END IF;
      ELSE
        failure_code:='unsupported_alert_type';RAISE EXCEPTION 'Unsupported alert type';
      END CASE;

      IF meta_json IS NOT NULL THEN
        failure_code:='notification_write_failed';
        notice_id:=public.stored_alert_notification_id(a.id,baseline,meta_json);
        INSERT INTO public.alert_notifications(id,alert_id,user_id,title,message,severity,metadata)
        VALUES(notice_id,a.id,a.user_id,title,message,severity,meta_json::jsonb||jsonb_build_object('coverage','Changes in existing stored case records only; no external source polling.'))
        ON CONFLICT(id) DO NOTHING;
        GET DIAGNOSTICS wrote=ROW_COUNT;
      ELSE wrote:=0;
      END IF;
      failure_code:='alert_watermark_write_failed_or_conflicted';
      UPDATE public.alerts SET last_checked=run_at,last_triggered=CASE WHEN meta_json IS NOT NULL THEN run_at ELSE last_triggered END
      WHERE id=a.id AND user_id=a.user_id AND enabled AND last_checked IS NOT DISTINCT FROM a.last_checked;
      IF NOT FOUND THEN RAISE EXCEPTION 'Watermark write failed'; END IF;
      checked:=checked+1;notices:=notices+wrote;
      IF meta_json IS NOT NULL THEN triggered:=triggered+1; END IF;
    EXCEPTION WHEN OTHERS THEN
      -- This subtransaction rolls back BOTH the notification and watermark.
      -- No raw SQLERRM, identifiers, subjects or provider credentials are logged.
      failed:=failed+1;
      failures:=failures||jsonb_build_array(jsonb_build_object('code',failure_code,'count',1));
    END;
  END LOOP;

  SELECT EXISTS(SELECT 1 FROM public.alerts WHERE enabled AND (p_owner IS NULL OR user_id=p_owner) AND
    (last_checked IS NULL OR
     (frequency='realtime' AND last_checked<=run_at-interval '5 minutes') OR
     (frequency='hourly' AND last_checked<=run_at-interval '1 hour') OR
     (frequency='daily' AND last_checked<=run_at-interval '1 day') OR
     (frequency='weekly' AND last_checked<=run_at-interval '7 days'))) INTO more;
  SELECT coalesce(jsonb_agg(jsonb_build_object('code',code,'count',total) ORDER BY code),'[]'::jsonb)
    INTO failures FROM (SELECT value->>'code' code,count(*) total FROM jsonb_array_elements(failures) GROUP BY value->>'code') grouped;
  summary:=jsonb_build_object('checked',checked,'triggered',triggered,'failed',failed,'notifications_created',notices,'examined',examined,'skipped',0,'remaining_in_batch',CASE WHEN elapsed THEN greatest(p_limit-examined,0) ELSE 0 END,'has_more',more,'time_budget_exhausted',elapsed,'failures',failures,'scope',CASE WHEN p_owner IS NULL THEN 'postgres_scheduler' ELSE 'authenticated_user' END,'coverage','Changes in stored case records only; no external source polling or delivery proof.');
  IF examined>0 OR failed>0 OR more THEN
    INSERT INTO public.system_logs(user_id,action,details,level)
    VALUES(p_owner,CASE WHEN p_owner IS NULL THEN 'stored_alerts_cron_check' ELSE 'stored_alerts_manual_check' END,summary,CASE WHEN failed>0 THEN 'warning' ELSE 'info' END);
  END IF;
  RETURN summary;
END
$fn$;


-- No actor/owner input. PostgREST validates the token; auth.uid()/role are
-- evaluated before entering the postgres-only engine with an explicit owner.
CREATE FUNCTION public.check_owned_stored_alerts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET timezone='UTC'
AS $fn$
DECLARE caller uuid:=auth.uid(); result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR caller IS NULL
     OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=caller AND is_anonymous=false AND deleted_at IS NULL AND role='authenticated' AND (banned_until IS NULL OR banned_until<=clock_timestamp())) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Verified nonanonymous user required';
  END IF;
  result:=public.run_stored_alert_checks(100,caller);
  RETURN result||jsonb_build_object('scope','authenticated_user','coverage','Changes in stored case records only; this endpoint does not poll external sources or prove notification delivery.');
END
$fn$;
REVOKE ALL ON FUNCTION public.check_owned_stored_alerts() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.check_owned_stored_alerts() TO authenticated;

REVOKE ALL ON FUNCTION public.stored_alert_utf16_length(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.stored_alert_notification_id(uuid,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.run_stored_alert_checks(integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.stored_alert_utf16_length(text) TO postgres;
GRANT EXECUTE ON FUNCTION public.stored_alert_notification_id(uuid,timestamptz,text) TO postgres;
GRANT EXECUTE ON FUNCTION public.run_stored_alert_checks(integer,uuid) TO postgres;
DO $postconditions$
BEGIN
  IF has_function_privilege('anon','public.run_stored_alert_checks(integer,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.run_stored_alert_checks(integer,uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.run_stored_alert_checks(integer,uuid)','EXECUTE')
     OR NOT has_function_privilege('postgres','public.run_stored_alert_checks(integer,uuid)','EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid='public.run_stored_alert_checks(integer,uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'Native scheduler permission postcondition failed';
  END IF;
  IF has_function_privilege('anon','public.check_owned_stored_alerts()','EXECUTE') OR has_function_privilege('service_role','public.check_owned_stored_alerts()','EXECUTE') OR NOT has_function_privilege('authenticated','public.check_owned_stored_alerts()','EXECUTE') OR NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.check_owned_stored_alerts()'::regprocedure) THEN RAISE EXCEPTION 'Owned alert wrapper privilege postcondition failed'; END IF;
END
$postconditions$;
COMMIT;
