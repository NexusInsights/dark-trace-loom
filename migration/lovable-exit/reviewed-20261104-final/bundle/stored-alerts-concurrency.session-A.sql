-- Root runs on one reviewed target SQL connection while session-B runs on another.
-- No permanent data write; proves the actual native advisory lease boundary.
BEGIN;
SET LOCAL statement_timeout='15s';
SELECT pg_backend_pid() AS session_a, pg_advisory_xact_lock(623711734,516164681);
SELECT pg_sleep(5);
ROLLBACK;
