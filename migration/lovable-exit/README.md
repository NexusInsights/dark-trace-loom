# Lovable exit preparation

This directory prepares local migration/security artifacts and a reproducible source snapshot; its tools do not connect to or restore a database. The parent separately created approved owned Free target `ocliymtdvtxfxczxgbjr`, restored authoritative schema and completed baseline plus guarded delta import. Parent-reported fidelity covers 1,829 real records, 64 counted public/Auth tables and 555 copied fields, including original IDs and password hashes; a fresh source comparison had zero drift. Original source `zisrsttmjeipkmllqubi` and existing TJK project `dbdkvrkmeowdydizrsmn` remain protected. Credential, authentication and live cutover acceptance are separate from import evidence.

The parent caught source drift beyond the original 1,619-row export and reconciled the 12 changed tables. All three private product report objects, totaling 23,067 bytes across three private buckets, are now restored with byte-identical target downloads and original ownership/ID/timestamp metadata. A fourth backup-only source object is the privately preserved database archive. Recheck subsequent source writes before cutover; no continuous replication is claimed.

The accompanying [exit audit](../../deployment-evidence/LOVABLE-EXIT-AUDIT.md) records what is known locally and which authoritative exports/settings still need administrative access. The inventory is not an assertion of the live database's completeness.

## Rebuild and verify the source bundle

Run from the application directory with the existing Node runtime:

```powershell
$ErrorActionPreference = 'Stop'
node migration/lovable-exit/build-bundle.mjs
if ($LASTEXITCODE -ne 0) { throw 'Migration bundle preparation failed' }
node migration/lovable-exit/verify-bundle.mjs
if ($LASTEXITCODE -ne 0) { throw 'Migration bundle integrity check failed' }
node migration/lovable-exit/build-deployment-manifest.mjs
if ($LASTEXITCODE -ne 0) { throw 'Deployment dependency manifest failed' }
node migration/lovable-exit/verify-bundle.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Migration bundle regression checks failed' }
node migration/lovable-exit/compare-counts.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Count-evidence regression checks failed' }
```

The builder copies all 52 migrations byte for byte, records their chronological order, snapshots server sources/config/types, and writes SHA-256 hashes. It checks table names against generated types and verifies the ID column assumption used for the count query. The verifier rejects changed bytes, unsafe paths, duplicate or unlisted files, absent guards and wrong ordering. Unknown stale files fail verification; they are not automatically deleted.

The refreshed source snapshot includes the native alert migration and rollback/lease/hash acceptance files. The deployment manifest resolves all 18 Edge functions, shared helpers, AI/monitor Workers and 5 Pages routes, including the current AI redirect fix and shared atomic alert handler. It records names/hashes without secret values and describes the gateway's actual direct stored-key matching. All 18 functions are active; latest checkout/portal revisions reject actual missing/invalid sessions with 401. Source corrections such as the atomic alert handler need their own publication/acceptance. Rebuild both manifests after further changes; bundled configuration remains a reference, not runtime readiness proof.

The independent [preview frontend](https://lovable-exit.dark-trace-loom.pages.dev) uses the owned backend and an isolated monitor worker. The parent verified its new backend reference, no Lovable runtime hosts, mobile 390-pixel layout and live API missing/invalid-session rejection. Production intentionally still uses the original backend. Provider secrets, owned Google client, Stripe account selection and secure SMTP credential save remain pending; no email or valid-session AI inference has been proved.

## Obtain the authoritative source backup

In the source Lovable project, open **More → Cloud → Overview → Advanced settings → Export project data → Export data → Database → Export → Start export**. Download the completed archive from its Cloud storage/export link. Storage binaries and provider secrets require separate transfer. The documented export includes account password hashes; preserve this backup privately. [Official export instructions](https://docs.lovable.dev/features/advanced-settings).

Keep archives, their object listings, private records, credentials and storage filenames outside the repository and OneDrive. Use an operator-approved local directory. This preparation does not create or configure one. Do not put passwords in command arguments, terminal output or Git. Destination connection credentials belong in a securely provisioned PostgreSQL service/password file or an approved credential interface.

If `pg_restore` is already installed, this read-only helper saves the archive hash and object listing:

```powershell
& ./migration/lovable-exit/inspect-backup.ps1 -BackupPath '<private archive path>' -OutputDirectory '<approved private directory>'
if ($LASTEXITCODE -ne 0) { throw 'Backup inspection failed' }
```

No PostgreSQL clients or Supabase CLI were initially found on PATH. The parent subsequently verified a portable `pg_restore` 18.6/OpenSSL/zstd build; supply its approved executable with optional `-PgRestorePath` if it is not on PATH. Lovable's custom archive uses zstd; `--list` alone cannot prove its data can be decompressed. Test a reviewed restore on the new destination before cutover. Never add `--clean` as a conflict workaround. [Official destination restore guidance](https://docs.lovable.dev/tips-tricks/external-deployment-hosting).

## Review the import, then execute on the new target

1. Freeze a source snapshot/cutover window and record the archive SHA-256, export time and last write time. The source remains running until independent destination acceptance passes. Do not pause or remove it to prove independence.
2. Verify that the selected organization/project creates no new charges, that source database/storage/traffic fit its limits, and that the actual destination is new and empty. Inspect the connected project URL, dashboard reference and database service configuration together. Custom SQL marker values are a guard, not independent proof of connection identity.
3. Run `source-audit.sql` on the source through unrestricted administrative access, or obtain equivalent metadata from the archive/source administrator. Compare actual schemas, objects, functions, grants, RLS, enum values, triggers, extensions, publications, schedules and migrations with the local bundle. Include all drift; the 62 local table names are not an allowlist for losing other records.
4. Review the archive table of contents and create an explicit restore-object list. An initialized Supabase target already owns managed `auth`, `storage`, extensions and roles. Preserve compatible source data/customizations without replacing destination-managed infrastructure blindly. Select schema reconstruction from **either** reviewed authoritative schema restoration **or** the local history plus reconciled drift; do not restore both unreviewed.
5. If local history is chosen, execute `bundle/schema-replay.sql` only before importing production data. It requires an administrative role, initialized services, no public application relations, no auth users/buckets/objects, `app.lovable_exit_target_confirmed='true'`, and a verified new `app.lovable_exit_target_ref`. All schema changes are in a single transaction. The history contains real DROP/DELETE statements; replay after import is prohibited.
6. Import reviewed records, original primary keys, complete auth identities/password hashes, exact timestamps and necessary sequence state. Keep all marketplace listings, installed-tool rows, permissions, subscriptions, organization IDs/memberships and evidence provenance. Do not seed sample accounts, mock listings or replacement IDs. Storage bucket seed rows created by local history must be reconciled with actual bucket records before data restore.
7. Restore with `ON_ERROR_STOP`/exit-code checks and a transaction. Account-creation, timestamp-update and artifact audit triggers must not fabricate new profiles/audit events or rewrite imported timestamps. Use the reviewed administrative restore's trigger-suppression method and restore its normal state at transaction completion. Do not leave replication mode or triggers disabled. Validate every FK afterward rather than assuming suppressed triggers checked constraints. [Supabase restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
8. Transfer each storage binary under the original bucket/path with metadata/ownership/access preserved through supported Storage APIs or reviewed import reconciliation. Compare total object counts, byte lengths and SHA-256 hashes in a private manifest; download the destination file to verify content. Database metadata without the corresponding binary is incomplete. Keep all private buckets private, including the source's export bucket.
9. Redeploy each actual server function with its handler authorization, reviewed JWT setting, import map/deno config and secrets. Recreate required jobs/webhooks once, using new URLs; do not run duplicate source/target scheduled jobs. Re-enable the exact Realtime publications. Restore SMTP/auth provider settings separately. Enter provider secrets securely and keep unknown included-access flags false.
10. Point a separate test frontend and Cloudflare authentication configuration at the new backend. Preserve Durable Object storage and original user IDs so jobs and alerts retain owners. Update bridge URLs/credentials and external webhook destinations deliberately. Complete the acceptance checks below, then switch production configuration. The source is retained for rollback; destructive Cloud removal requires a separate, explicit final action after acceptance.

This is a reviewable sequence, not an executable universal restore script. Archive schema versions, managed-object conflicts and unknown source drift require the actual authoritative export. Nothing here authorizes overwriting existing TJK data.

The parent reviewed/applied `post-restore-invitation-hardening.sql` and `post-restore-invitation-rpc.sql` to the approved target before importing production data. The first removes the audited unconditional lookup policy/anonymous SELECT and preserves org-admin listing; the second provides one locked SECURITY INVOKER invitation/member/state operation. Parent live checks confirm anonymous/user EXECUTE=false, service_role=true and SECURITY DEFINER=false. These files guard target identity; do not replay them blindly. The revised acceptance handler fails explicitly if the RPC is absent. The authoritative schema-only decode matches all required fields/constraints.

The acceptance handler passed 34 isolated Auth/RPC contracts, shared Auth/WiGLE/image 28, signed webhook/ownership/replay 26, subscription/period checks 28, checkout/portal Auth/price/redirect checks 59, atomic-alert Edge boundary checks 26 and invitation sender checks 23 (224 across seven files). The full current app passed 567 tests in 43 files, app typechecking and strict static server types for all four billing handlers plus check-alerts against pinned Stripe 18.5/installed Supabase declarations. Live workflows, database rollback and actual provider ownership remain separate acceptance. No live Stripe session, purchase or email was created by these tests.

The optional nonsecret `RESEND_FROM_EMAIL` supports the independently verified sender domain; invalid values fail before invitation insertion or provider work. An absent setting preserves the original sender. See [invitation sender configuration](INVITATION-SENDER.md). The final source bundle contains 100 hash-listed files and was reproduced twice, SHA-256 `fb2ce45be4796d68877e9b77f34f5518cf9dc8e8c6f3688b36759101f90eb3b2`. The matching dependency manifest SHA-256 is `025bc71841fb684ad687ab212720606ac58abaa4501c86354db38ff7fdcdc59b`; it includes `RESEND_FROM_EMAIL` and all shared Auth closures. These digests identify the source freeze, not remote publication.

[Stored-alert scheduler preparation](STORED-ALERTS-SCHEDULER.md) documents the same five actual stored-record detectors, shared manual/cron engine, postgres-only global execution and authenticated owner wrapper. Root installed the engine/wrapper and guarded breach-column correction. Actual full corrected rollback fixtures, ACL checks, distinct-session lease contention and two original-Edge/native-SQL hash vectors passed, with no fixture records/Auth changes remaining. The target-only five-minute pg_cron job is activated. Actual scheduled execution, updated Edge publication and one autonomous user-visible notification still require live acceptance. The retained timestamp-watermark/late-commit limits are explicit. No scheduler secret or external provider call is required.

The signature fixtures use the actual Stripe SDK in an isolated local test package. On a clean checkout, install only these pinned open-source fixture dependencies before running the tests; this performs no Stripe account call or paid execution:

```powershell
npm ci --prefix migration/lovable-exit/test-sdk --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Pinned signature fixture setup failed' }
npm test -- --run src/test/acceptInviteAtomic.test.ts src/test/legacyLookupAuthentication.test.ts src/test/stripeWebhookVerification.test.ts src/test/subscriptionVerification.test.ts src/test/billingSessionAuth.test.ts src/test/checkAlerts.test.ts src/test/inviteSender.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Handler boundary regressions failed' }
node migration/lovable-exit/check-billing-functions.mjs
if ($LASTEXITCODE -ne 0) { throw 'Pinned Stripe handler types failed' }
```

## Administrative comparisons and acceptance

Use the same frozen source snapshot for every baseline. `source-audit.sql`, `bundle/row-counts-and-id-digests.sql` and `integrity-check.sql` are read only and require a database role that bypasses RLS. An app session or CSV of the current user's visible rows cannot replace them. The SQL files are prepared but have not been run against any database.

Produce source and target CSVs with the exact count-query columns using `psql --csv --quiet --no-psqlrc --no-password --set ON_ERROR_STOP=1` and a privately configured service connection, then compare them:

```powershell
node migration/lovable-exit/compare-counts.mjs '<private source counts.csv>' '<private target counts.csv>'
if ($LASTEXITCODE -ne 0) { throw 'Row-count or preserved-ID acceptance failed' }
```

The count query checks the 62 known public tables plus `auth.users` and `auth.identities`. Any actual source table drift needs additional baseline coverage. Equal counts and ID digests do not prove equal record values. Verify private sample records, exported payload fidelity, policy behavior, file bytes and provider responses independently.

`integrity-check.sql` evaluates every actual public/auth/storage FK, including composite and MATCH FULL keys. It reports ownership UUIDs that lack database FKs without silently repairing them. Set `app.lovable_exit_acceptance_user_id` to the independently verified original Travis user UUID to check the preserved no-expiry Enterprise subscription (`plan='enterprise'`, `status='active'`, `stripe_customer_id='admin_override_enterprise'`, `current_period_end IS NULL`). It reports existing admin/membership/tool-permission records without granting new roles.

Before production switch, independently verify:

- Same Travis UUID, account/profile, approved Enterprise override, installed tools and permissions; no Stripe purchase or customer replacement.
- All real users and organization memberships; original TJK case/entity/record/evidence/report IDs and ownership links; complete marketplace catalog and installed tools.
- Existing-password login for the source account that actually has a password, supported Google OAuth/recovery for the original Google-only Travis account, and confirmation/reset/magic-link flows. Travis's imported password is empty; do not claim password login without an independently completed recovery/configuration. New signing keys require reauthentication; do not clone old session secrets. [Supabase Auth migration guidance](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects).
- Admin restrictions, ordinary-user RLS isolation, collaborator/org access, API-key authentication and forbidden-action rejection.
- Private upload/download and signed-link behavior, original file contents and evidence hashes; Realtime changes reach the live UI.
- Real preserved PDL/WiGLE/breach and all public marketplace routes; gated routes remain explicitly blocked without verified access. Preserve current PDL entitlement limitations rather than inventing contacts.
- Autonomous monitor jobs remain owned and scheduled, one real source change yields an in-app alert, failure alerts remain truthful, and duplicate source/target checks are absent.
- Static source/built bundles/runtime network traffic contain no active Lovable OAuth/helper/gateway/backend path. Disabled or unavailable AI features are disclosed; no paid substitute is enabled.
- Every new record/upload/provider request after cutover uses the owned destination, with enough retained source evidence for rollback.

Only these observed postconditions establish an exit. Local hash checks, successful builds, migrations, health responses or imported row counts alone do not.
