-- NEW owned target only; activate AFTER rollback acceptance and ACL review.
-- No HTTP, pg_net, credentials, source job overwrite or provider invocation.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
SET LOCAL search_path=pg_catalog;
DO $guard$
BEGIN
 IF current_user<>'postgres' OR current_setting('app.lovable_exit_target_confirmed',true) IS DISTINCT FROM 'true' OR current_setting('app.lovable_exit_target_ref',true) IS DISTINCT FROM 'ocliymtdvtxfxczxgbjr' THEN RAISE EXCEPTION 'Owned target/postgres acknowledgment required'; END IF;
 IF to_regclass('insight_nexus_migration.runs') IS NULL THEN RAISE EXCEPTION 'Independent target marker absent'; END IF;
 IF NOT EXISTS(SELECT 1 FROM insight_nexus_migration.runs WHERE migration_id='InsightNexus_20261014_v1' AND target_ref='ocliymtdvtxfxczxgbjr' AND source_sha256='0c6e389b8cf4cad909fc98763b9e083d89e4d2c8e72c709fe867be3aa10fcb4b' AND selection_sha256='5d5a7c6e41ef0a7739f38c6e42cf0e0a2c738545441298daddef41e8d9bc5ce6') THEN RAISE EXCEPTION 'Independent restored-target marker mismatch'; END IF;
 IF to_regprocedure('public.run_stored_alert_checks(integer,uuid)') IS NULL OR has_function_privilege('authenticated','public.run_stored_alert_checks(integer,uuid)','EXECUTE') OR has_function_privilege('service_role','public.run_stored_alert_checks(integer,uuid)','EXECUTE') OR (SELECT prosecdef FROM pg_proc WHERE oid='public.run_stored_alert_checks(integer,uuid)'::regprocedure) THEN RAISE EXCEPTION 'Reviewed postgres-only native engine required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pg_cron') THEN RAISE EXCEPTION 'Platform pg_cron unavailable'; END IF;
END
$guard$;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
DO $schedule$
DECLARE job_id bigint;
BEGIN
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname IN('check-alerts-every-5-min','check-stored-alerts-every-5-min') OR command LIKE '%run_stored_alert_checks%') THEN RAISE EXCEPTION 'Existing alert job requires review; no overwrite or duplicate'; END IF;
 job_id:=cron.schedule('check-stored-alerts-every-5-min','*/5 * * * *',$command$BEGIN;SET LOCAL statement_timeout='55s';SET LOCAL lock_timeout='5s';SELECT public.run_stored_alert_checks(100,NULL);COMMIT;$command$);
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobid=job_id AND jobname='check-stored-alerts-every-5-min' AND username='postgres' AND database=current_database() AND schedule='*/5 * * * *' AND active=true) THEN RAISE EXCEPTION 'Cron ownership/schedule postcondition failed'; END IF;
END
$schedule$;
COMMIT;
-- Observe actual job runs and a real stored-record change/notice/read afterward.
