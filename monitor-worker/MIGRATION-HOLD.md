# Durable monitor migration hold

This is a prepared, offline-tested control for the existing monitoring service. It has not been deployed or activated. No live job count, backup, owner mapping or provider acceptance is established by its fixtures.

## Control and guarantees

Only the Worker's deployment configuration controls the hold. There is no HTTP/RPC admin endpoint, new credential or additional access grant.

- `MONITOR_MIGRATION_HOLD=true` latches a hold in the existing Durable Object's SQLite database.
- Exact `MONITOR_MIGRATION_HOLD=false` releases it deliberately.
- Missing, null or empty configuration preserves the persisted state. Other nonempty values fail closed by latching a hold.
- Each change increments a persisted generation. Repeated identical state does not increment it. An operation from an earlier generation cannot write after hold followed by release.
- The additive `monitor_runtime_control` table is created and seeded only on first introduction. Missing or malformed control data in an existing table fails closed; it is not silently reset to active.

Every API/position operation and scheduler run captures the current active generation. The SQLite facade checks that generation and hold state synchronously inside the same transaction as each statement or batch. Success, error/backoff and lease-cleanup writes are covered. Each outbound fetch also checks the fence immediately before dispatch and after its response arrives. This blocks subsequent contributing-source requests when a hold arrives during a response body.

A hold does not rewrite job `enabled` states, revisions, snapshots, history, feed hashes, rules, alerts, receipts or scheduler ticks. A claim or incomplete scheduler tick written before the hold remains intact. Existing leases can delay resumption until their normal expiry. The Worker name, namespace, class and singleton `idFromName("scheduler")` are unchanged.

API requests during a known hold return HTTP 503 with `migration_hold`, `configured:false` and a paused scheduler state. An interrupted old generation or unverified control state returns 503 with current scheduler state unknown. Responses warn that a pre-hold request may already have committed an earlier write: verify outcomes before retrying. CORS preflights remain side-effect-free.

Held alarms return without polling, writing a completed tick or recording a provider failure/backoff. Alarm state is rechecked around asynchronous alarm reads/writes. A failed alarm deletion is explicitly unverified; a held alarm handler resolves that failure instead of throwing into a platform retry. Initialization failures likewise resolve to controlled 503s and blocked alarm handlers rather than a repeatedly rejected constructor. No claim is made about independent platform failures or callbacks originating from older code.

## Limits that remain real

An already-dispatched network request cannot be unsent. A pre-hold commit remains durable. The fence prevents later writes by instrumented operations; it does not reverse earlier effects.

The first rollout cannot retroactively instrument old in-flight code. The release owner must reconcile/drain the preceding deployed version and verify the new hold before relying on it. These Node SQLite/controlled-promise tests exercise the actual production class and code, but do not prove Cloudflare's live rollout or drain behavior.

No source/backend configuration, scheduler settings or production data was changed while preparing this patch. The existing production Worker still needs an authorized, reviewed rollout. A frontend without its monitor binding does not stop the separately running production Worker.

## Safe application and verification

1. Preserve the actual Worker version/configuration and storage recovery point. Verify original owner UUIDs, all seven application tables, job enabled states, feed hashes and alarm state through an authorized read route. This patch deliberately adds no export/admin backdoor. Database exports from Supabase do not include this Durable Object's state.
2. Review and deploy the instrumented Worker to the **same** `insight-nexus-monitors` service, `MonitorStore` class, namespace and singleton. Set the hold explicitly for migration; do not create another namespace or change the existing `v1` class migration.
3. Verify the actual hold response, alarm disarm evidence and absence of new source requests after the preceding version is drained. Do not infer an empty queue from HTTP 503 or a missing alarm. Preserve earlier in-flight outcomes.
4. While held, verify the independent backend's original user UUIDs, entitlement and tool-permission data. Rebind only the reviewed authentication URL/public key and any same-service frontend binding. Public monitoring does not require a service-role key. Leave the unconfigured licensed bridge and its credentials untouched.
5. Deliberately release with exact `false` only after identity/persistence acceptance. Verify retained history/ownership and the next actual scheduled receipt. Do not label the fixture test count as live alarm/provider acceptance.

## Rollback

Keep the control table and hold enabled during diagnosis. Revert only to a version that honors this hold, with the same namespace and singleton. Rolling back to uninstrumented code can bypass the persisted hold and resume polling.

Restore the previous backend/public configuration only after preserving and reconciling any destination writes and owner mapping. Do not drop the control table or clear jobs to roll back. A storage restore must use a verified recovery point and preserve post-cutover writes; a code version rollback alone does not restore data.

## Offline validation

`node --test monitor-worker/test/*.test.mjs`: 40 passed (23 existing plus 17 new), no provider calls. New tests cover latched state, invalid/missing configuration, held APIs and position feeds, all seven nonempty application tables preserved, delayed source success/failure/body reads, stale generations after release, alarm-read/write races, deletion failure, transaction rollback and the actual Worker class's startup/error behavior.

The test-only Node 24 loader handles the existing SQL import as text; it does not replace production functions. The source also bundles in memory with the already installed esbuild dependency. Neither check uploads a Worker.
