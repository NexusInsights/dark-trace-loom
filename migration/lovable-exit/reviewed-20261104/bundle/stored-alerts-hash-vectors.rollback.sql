-- Generated from actual preserved Edge helper; controlled fixtures only.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL statement_timeout='15s';
DO $vectors$
BEGIN
 IF current_user<>'postgres' OR current_setting('app.lovable_exit_target_ref',true) IS DISTINCT FROM 'ocliymtdvtxfxczxgbjr' THEN RAISE EXCEPTION 'Owned target/postgres required'; END IF;
 IF public.stored_alert_notification_id('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,'2026-01-01T00:00:00+00:00'::timestamptz,'{"artifact_count":1,"sampled_evidence_ids":["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],"evidence_sample_truncated":false}')<>'c717bc47-36dc-532a-99bb-a5765735df58'::uuid THEN RAISE EXCEPTION 'Actual Edge SHA256 vector parity failed'; END IF;
 IF public.stored_alert_notification_id('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,'2026-01-01T00:00:00.123456+00:00'::timestamptz,'{"breach_count":2,"sampled_breach_names":["Quoted \" name","Back\\slash","Unicode 😀"],"sampled_evidence_ids":["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],"evidence_sample_truncated":true,"severity_coverage":"sampled_records_only"}')<>'19c43c24-dd49-5856-91bc-49629a65ff08'::uuid THEN RAISE EXCEPTION 'Actual Edge SHA256 vector parity failed'; END IF;
END
$vectors$;
SELECT 2 AS actual_edge_hash_vectors;
ROLLBACK;
