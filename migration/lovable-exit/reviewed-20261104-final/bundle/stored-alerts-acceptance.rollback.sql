-- ROLLBACK-ONLY acceptance; run AFTER the reviewed function migration.
-- Execute as postgres on the acknowledged new target. No real user is created.
-- Use a DDL-capable SQL execution route for the temporary function/trigger.
-- The terminal ROLLBACK is mandatory; never convert this into a committing seed.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=pg_catalog;
SET LOCAL timezone='UTC';
DO $acceptance$
DECLARE
 owner_id uuid; other_id uuid; case_id uuid:=gen_random_uuid(); foreign_case uuid:=gen_random_uuid();
 subject_id uuid:=gen_random_uuid(); foreign_subject uuid:=gen_random_uuid();
 alert_ids uuid[]:='{}'; aid uuid; failed_alert uuid; foreign_alert uuid; result jsonb; checks integer:=0;
 baseline timestamptz:=clock_timestamp()-interval '1 day'; sample_time timestamptz; old_watermark timestamptz; notices_before bigint;
 kind text; passed boolean; breach_id uuid:=gen_random_uuid(); identifier_id uuid:=gen_random_uuid();
BEGIN
 IF current_user<>'postgres' OR current_setting('app.lovable_exit_target_ref',true) IS DISTINCT FROM 'ocliymtdvtxfxczxgbjr' OR current_setting('app.lovable_exit_target_confirmed',true) IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'New target/postgres acknowledgment required'; END IF;
 SELECT id INTO owner_id FROM auth.users WHERE is_anonymous=false AND role='authenticated' AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=clock_timestamp()) ORDER BY id LIMIT 1;
 SELECT id INTO other_id FROM auth.users WHERE is_anonymous=false AND role='authenticated' AND deleted_at IS NULL AND id<>owner_id ORDER BY id LIMIT 1;
 IF owner_id IS NULL OR other_id IS NULL OR EXISTS(SELECT 1 FROM public.alerts WHERE user_id IN(owner_id,other_id)) THEN RAISE EXCEPTION 'Acceptance requires two preserved users without existing alerts; do not delete/disable real alerts'; END IF;
 IF has_function_privilege('anon','public.run_stored_alert_checks(integer,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.run_stored_alert_checks(integer,uuid)','EXECUTE') OR has_function_privilege('service_role','public.run_stored_alert_checks(integer,uuid)','EXECUTE') OR has_function_privilege('anon','public.check_owned_stored_alerts()','EXECUTE') OR has_function_privilege('service_role','public.check_owned_stored_alerts()','EXECUTE') OR NOT has_function_privilege('authenticated','public.check_owned_stored_alerts()','EXECUTE') THEN RAISE EXCEPTION 'Privilege acceptance failed'; END IF;
 checks:=checks+1;
 IF public.stored_alert_utf16_length(U&'\+01F600')<>2 OR public.stored_alert_utf16_length('')<>0 THEN RAISE EXCEPTION 'UTF16 fidelity failed'; END IF; checks:=checks+1;

 INSERT INTO public.cases(id,title,owner_id) VALUES(case_id,'[rollback] stored-alert detector acceptance',owner_id),(foreign_case,'[rollback] foreign alert acceptance',other_id);
 INSERT INTO public.subjects(id,case_id,name,type) VALUES(subject_id,case_id,'Rollback subject','person'),(foreign_subject,foreign_case,'Foreign rollback subject','person');
 sample_time:=baseline+interval '1 hour';
 INSERT INTO public.artifacts(case_id,artifact_type,data,created_at) VALUES(case_id,'domain','example.test',sample_time),(case_id,'document','rollback-only',sample_time);
 -- Lower bound is exclusive and future created_at is excluded.
 INSERT INTO public.artifacts(case_id,artifact_type,data,created_at) VALUES(case_id,'domain','excluded-lower.test',baseline),(case_id,'domain','excluded-future.test',clock_timestamp()+interval '1 day');
 INSERT INTO public.events(case_id,event_type,description,created_at) VALUES(case_id,'fixture','rollback-only',sample_time);
 INSERT INTO public.tool_results(case_id,tool_name,result_data,created_at) VALUES(case_id,'fixture','{}',sample_time);
 INSERT INTO public.entities(case_id,entity_type,label,created_at) VALUES(case_id,'domain','example.test',sample_time);
 -- 'v' is a legitimate exact identifier; it must not be treated as trim space.
 INSERT INTO public.identity_entities(id,user_id,source_case_id,entity_type,entity_value) VALUES(identifier_id,owner_id,case_id,'username','v');
 INSERT INTO public.breach_records(id,user_id,identifier,breach_name,severity,created_at) VALUES(breach_id,owner_id,'v','Fixture breach','critical',sample_time),(gen_random_uuid(),other_id,'v','Foreign excluded breach','critical',sample_time);
 FOREACH kind IN ARRAY ARRAY['domain_registration','username_appearance','data_change','mention_monitoring','breach_detection'] LOOP
   aid:=gen_random_uuid();alert_ids:=array_append(alert_ids,aid);
   INSERT INTO public.alerts(id,user_id,subject_id,alert_type,frequency,created_at) VALUES(aid,owner_id,subject_id,kind,'realtime',baseline);
 END LOOP;
 -- Another owner's own alert cannot be processed by this owner's engine call.
 foreign_alert:=gen_random_uuid();
 INSERT INTO public.alerts(id,user_id,subject_id,alert_type,frequency,created_at) VALUES(foreign_alert,other_id,foreign_subject,'data_change','realtime',baseline);
 result:=public.run_stored_alert_checks(100,owner_id);
 IF result->>'checked'<>'5' OR result->>'triggered'<>'5' OR result->>'failed'<>'0' OR result->>'notifications_created'<>'5' OR (SELECT count(*) FROM public.alert_notifications WHERE alert_id=ANY(alert_ids))<>5 THEN RAISE EXCEPTION 'All five detector acceptance failed'; END IF;checks:=checks+1;
 IF EXISTS(SELECT 1 FROM public.alert_notifications WHERE alert_id=foreign_alert) OR (SELECT last_checked FROM public.alerts WHERE id=foreign_alert) IS NOT NULL THEN RAISE EXCEPTION 'Owner filter acceptance failed'; END IF;checks:=checks+1;
 IF (SELECT (metadata->>'artifact_count')::integer FROM public.alert_notifications WHERE alert_id=alert_ids[1])<>1
    OR (SELECT (metadata->>'result_count')::integer FROM public.alert_notifications WHERE alert_id=alert_ids[2])<>1
    OR (SELECT (metadata->>'artifacts')::integer FROM public.alert_notifications WHERE alert_id=alert_ids[3])<>2
    OR (SELECT (metadata->>'events')::integer FROM public.alert_notifications WHERE alert_id=alert_ids[3])<>1
    OR (SELECT (metadata->>'entity_count')::integer FROM public.alert_notifications WHERE alert_id=alert_ids[4])<>1
    OR (SELECT (metadata->>'breach_count')::integer FROM public.alert_notifications WHERE alert_id=alert_ids[5])<>1
    OR (SELECT severity FROM public.alert_notifications WHERE alert_id=alert_ids[5])<>'critical' THEN RAISE EXCEPTION 'Count/bounds/breach ownership acceptance failed'; END IF;checks:=checks+1;
 notices_before:=(SELECT count(*) FROM public.alert_notifications WHERE alert_id=ANY(alert_ids));
 result:=public.run_stored_alert_checks(100,owner_id);
 IF result->>'checked'<>'0' OR (SELECT count(*) FROM public.alert_notifications WHERE alert_id=ANY(alert_ids))<>notices_before THEN RAISE EXCEPTION 'Due-time retry dedupe failed'; END IF;checks:=checks+1;
 UPDATE public.alerts SET last_checked=NULL WHERE id=ANY(alert_ids);
 result:=public.run_stored_alert_checks(100,owner_id);
 IF result->>'checked'<>'5' OR result->>'notifications_created'<>'0' OR (SELECT count(*) FROM public.alert_notifications WHERE alert_id=ANY(alert_ids))<>notices_before THEN RAISE EXCEPTION 'Stable evidence retry dedupe failed'; END IF;checks:=checks+1;

 -- Foreign-case reference owned by caller fails with no notice/watermark.
 failed_alert:=gen_random_uuid();
 INSERT INTO public.alerts(id,user_id,subject_id,alert_type,frequency,created_at) VALUES(failed_alert,owner_id,foreign_subject,'data_change','realtime',baseline);
 result:=public.run_stored_alert_checks(100,owner_id);
 IF result->>'failed'<>'1' OR (SELECT last_checked FROM public.alerts WHERE id=failed_alert) IS NOT NULL OR EXISTS(SELECT 1 FROM public.alert_notifications WHERE alert_id=failed_alert) THEN RAISE EXCEPTION 'Case-access rejection failed'; END IF;checks:=checks+1;
 DELETE FROM public.alerts WHERE id=failed_alert;

 -- Exact JS trim semantics: vertical-tab-only identifier is invalid.
 INSERT INTO public.identity_entities(user_id,source_case_id,entity_type,entity_value) VALUES(owner_id,case_id,'username',chr(11));
 UPDATE public.alerts SET last_checked=NULL WHERE id=alert_ids[5];
 result:=public.run_stored_alert_checks(100,owner_id);
 IF result->>'failed'<>'1' OR (SELECT last_checked FROM public.alerts WHERE id=alert_ids[5]) IS NOT NULL THEN RAISE EXCEPTION 'Vertical-tab identifier rejection failed'; END IF;checks:=checks+1;
 DELETE FROM public.identity_entities WHERE source_case_id=case_id AND entity_value=chr(11);
 UPDATE public.alerts SET last_checked=clock_timestamp() WHERE id=alert_ids[5];

 -- Count all26, sample oldest25, and do not claim severity outside the sample.
 UPDATE public.breach_records SET severity='medium' WHERE id=breach_id;
 INSERT INTO public.breach_records(user_id,identifier,breach_name,severity,created_at)
 SELECT owner_id,'v','Fixture breach',CASE WHEN i=25 THEN 'critical' ELSE 'medium' END,sample_time+make_interval(secs=>i) FROM generate_series(1,25) i;
 UPDATE public.alerts SET last_checked=NULL WHERE id=alert_ids[5];
 result:=public.run_stored_alert_checks(100,owner_id);
 IF result->>'triggered'<>'1' OR NOT EXISTS(SELECT 1 FROM public.alert_notifications WHERE alert_id=alert_ids[5] AND metadata->>'breach_count'='26' AND metadata->>'evidence_sample_truncated'='true' AND metadata->>'severity_coverage'='sampled_records_only' AND jsonb_array_length(metadata->'sampled_evidence_ids')=25 AND severity='warning') THEN RAISE EXCEPTION 'Bounded sample/severity acceptance failed'; END IF;checks:=checks+1;
 -- Raw identifier count251 fails. The source uniqueness constraint is preserved;
 -- this random rollback case prefix makes each of the additional250 values unique.
 INSERT INTO public.identity_entities(user_id,source_case_id,entity_type,entity_value) SELECT owner_id,case_id,'username','rollback-'||case_id::text||'-'||i::text FROM generate_series(1,250) AS fixture(i);
 UPDATE public.alerts SET last_checked=NULL WHERE id=alert_ids[5];
 result:=public.run_stored_alert_checks(100,owner_id);
 IF result->>'failed'<>'1' OR (SELECT last_checked FROM public.alerts WHERE id=alert_ids[5]) IS NOT NULL THEN RAISE EXCEPTION 'Identifier raw-count bound acceptance failed'; END IF;checks:=checks+1;
 DELETE FROM public.identity_entities WHERE source_case_id=case_id AND id<>identifier_id;
 UPDATE public.alerts SET last_checked=clock_timestamp() WHERE id=alert_ids[5];

 -- Unsupported frequency with null watermark does not falsely advance.
 failed_alert:=gen_random_uuid();
 INSERT INTO public.alerts(id,user_id,subject_id,alert_type,frequency,created_at) VALUES(failed_alert,owner_id,subject_id,'data_change','invalid',baseline);
 result:=public.run_stored_alert_checks(100,owner_id);
 IF result->>'failed'<>'1' OR (SELECT last_checked FROM public.alerts WHERE id=failed_alert) IS NOT NULL THEN RAISE EXCEPTION 'Unsupported frequency rejection failed'; END IF;checks:=checks+1;
 DELETE FROM public.alerts WHERE id=failed_alert;

 -- The owned no-input wrapper rejects absent/anonymous role; then uses only owner.
 PERFORM set_config('request.jwt.claims','{}',true);
 passed:=false;
 BEGIN PERFORM public.check_owned_stored_alerts(); EXCEPTION WHEN insufficient_privilege THEN passed:=true; END;
 IF NOT passed THEN RAISE EXCEPTION 'No-identity wrapper rejection failed'; END IF;checks:=checks+1;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id::text,'role','anon')::text,true);
 passed:=false;
 BEGIN PERFORM public.check_owned_stored_alerts(); EXCEPTION WHEN insufficient_privilege THEN passed:=true; END;
 IF NOT passed THEN RAISE EXCEPTION 'Anonymous-role wrapper rejection failed'; END IF;checks:=checks+1;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id::text,'role','authenticated')::text,true);
 result:=public.check_owned_stored_alerts();
 IF result->>'scope'<>'authenticated_user' OR (SELECT last_checked FROM public.alerts WHERE id=foreign_alert) IS NOT NULL THEN RAISE EXCEPTION 'Owned wrapper filter failed'; END IF;checks:=checks+1;
 -- Banning is fixture-only and rolled back; no account call or email.
 UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour' WHERE id=owner_id;
 passed:=false;
 BEGIN PERFORM public.check_owned_stored_alerts(); EXCEPTION WHEN insufficient_privilege THEN passed:=true; END;
 IF NOT passed THEN RAISE EXCEPTION 'Banned user wrapper rejection failed'; END IF;checks:=checks+1;
 UPDATE auth.users SET banned_until=NULL WHERE id=owner_id;
 UPDATE auth.users SET is_anonymous=true WHERE id=owner_id;
 passed:=false;
 BEGIN PERFORM public.check_owned_stored_alerts(); EXCEPTION WHEN insufficient_privilege THEN passed:=true; END;
 IF NOT passed THEN RAISE EXCEPTION 'Anonymous Auth row rejection failed'; END IF;checks:=checks+1;
 UPDATE auth.users SET is_anonymous=false WHERE id=owner_id;

 CREATE TEMP TABLE stored_alert_acceptance_result(checks_passed integer) ON COMMIT DROP;
 INSERT INTO stored_alert_acceptance_result VALUES(checks);
END
$acceptance$;

-- Force notification+watermark rollback in the real engine, not a mocked writer.
CREATE FUNCTION pg_temp.fail_alert_watermark()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN IF NEW.id::text=TG_ARGV[0] THEN RAISE EXCEPTION 'controlled rollback fixture'; END IF;RETURN NEW;END
$fn$;
DO $rollback_case$
DECLARE owner_id uuid; subject_id uuid; aid uuid:=gen_random_uuid(); result jsonb;
BEGIN
 SELECT c.owner_id,s.id INTO owner_id,subject_id FROM public.subjects s JOIN public.cases c ON c.id=s.case_id WHERE c.title='[rollback] stored-alert detector acceptance';
 INSERT INTO public.alerts(id,user_id,subject_id,alert_type,frequency,created_at) VALUES(aid,owner_id,subject_id,'data_change','realtime',clock_timestamp()-interval '1 day');
 EXECUTE format('CREATE TRIGGER zzz_migration_acceptance_fail BEFORE UPDATE ON public.alerts FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_alert_watermark(%L)',aid::text);
 result:=public.run_stored_alert_checks(100,owner_id);
 IF result->>'failed'<>'1' OR EXISTS(SELECT 1 FROM public.alert_notifications WHERE alert_id=aid) OR (SELECT last_checked FROM public.alerts WHERE id=aid) IS NOT NULL THEN RAISE EXCEPTION 'Atomic rollback acceptance failed'; END IF;
 DROP TRIGGER zzz_migration_acceptance_fail ON public.alerts;
 UPDATE stored_alert_acceptance_result SET checks_passed=checks_passed+1;
END
$rollback_case$;
SELECT checks_passed, true AS rollback_only, 'Controlled SQL fixtures only; not real Auth, cron timing or user delivery proof' AS scope FROM stored_alert_acceptance_result;
ROLLBACK;
