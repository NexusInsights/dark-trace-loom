-- Run while session-A holds its lease. PIDs must be different; busy must be true.
BEGIN;
SET LOCAL statement_timeout='10s';
SELECT pg_backend_pid() AS session_b, public.run_stored_alert_checks(100,NULL)->>'busy' AS concurrent_engine_busy;
ROLLBACK;
