# Insight Nexus durable monitoring runtime

This service supplies continuing source polling, durable source history, meaningful change alerts and authorized polygon geofencing. It does not make unsupported catalog claims true. Public/provider coverage, account entitlements and historical availability remain explicit in each snapshot.

## Deployment

Use the already-installed Wrangler from the parent application checkout. Root config is `monitor-worker/wrangler.jsonc`; the namespace is a **SQLite Durable Object**, with class `MonitorStore` and binding `MONITOR_STORE`. No existing D1 database is reused or deleted. Add the app's existing public `SUPABASE_PUBLISHABLE_KEY` variable through the approved configuration path. Keep `APP_ORIGIN` exact and `MONITOR_ALLOWED_HOSTS` restricted to approved public page/feed hostnames. Deploy with the existing account authorization; do not upgrade a plan or refresh OAuth merely to deploy this service.

The Pages proxy may bind `MONITOR_WORKER` to the service `insight-nexus-monitors` and forward `/api/marketplace-monitor/*` to the Worker's matching `/v1/*` paths. The Worker main handler rejects all `/internal` requests. **SQLite Durable Object alarms are the authoritative scheduler**, avoiding the account's exhausted Cron Trigger quota. Successful job mutations arm the earliest due job, and alarm completion/failure rearms the next due/backoff time. Empty/paused queues disarm. The next alarm is read from actual storage; the last persisted completed tick establishes observed execution.

## API

User routes verify the Supabase session with the project's authentication server and scope every SQL read/write to its returned user ID. User JWTs are never stored. Creation/resume also verifies the current plan through the existing `check-subscription` function. List timestamps are Unix seconds; provider timestamps retain their source representation.

- `GET /v1/status`: configuration, scheduler receipt, provider/coverage limitations.
- `GET|POST /v1/jobs`: list/create jobs. Creation requires `{kind,label,params,interval_seconds,polling_authorized:true}`. Optional approved `paid_daily_budget` is 0–24; default 0 makes paid polling unavailable. Intervals are at least 300 seconds, or 3600 for licensed pollers.
- `GET|PATCH|DELETE /v1/jobs/:id`: read, pause/resume, or archive a job. Archiving preserves its history.
- `POST /v1/jobs/:id/check`: a real bounded check. This is not a simulated event and it does not prove that an automatic alarm has run.
- `GET /v1/jobs/:id/history`: latest 100 durable check records and changed/baseline source snapshots.
- `GET /v1/alerts`: latest 100 account alerts, optionally `?unread=true`.
- `POST /v1/alerts/:id/ack` with `{state:"received"|"read"}`: records actual client receipt/read acknowledgment. A stored alert is not labelled delivered. Email/SMS/provider delivery is not implemented or claimed.
- `GET|POST /v1/feeds`: create an authorized position feed with `{label,authorization_confirmed:true}`. The response's 256-bit token is shown once. Only its SHA-256 hash persists.
- `POST /v1/feeds/:id/positions` uses `Authorization: Feed <token>` and `{event_id,observed_at,latitude,longitude,accuracy_m}`. A source event is idempotent; a reused event ID with different data fails. Revocation stops ingestion.
- `GET|POST /v1/rules`: create polygons with `{feed_id,label,entity_label,polygon:[[longitude,latitude],...],authorization_confirmed:true,max_accuracy_m?:100}`. Three to 100 vertices are allowed. Self-intersecting and antimeridian polygons are rejected; boundaries count as inside. The first valid reported position establishes baseline; later enter/exit transitions create alerts.
- `DELETE /v1/feeds/:id` or `/v1/rules/:id`: revoke/disable without destroying history.

## Source pollers and gaps

`cve` accepts `{keyword}` or an exact `{cpe}` software/version identifier. It joins real NVD records with FIRST EPSS and CISA KEV by CVE ID. Exact CPE input establishes a supplied asset-version match; keywords do not. The first 100 records are bounded. CISA known-exploitation records are not a complete exploit database. Optional-source failures remain unknown; separately labelled last-verified components prevent an outage from appearing as a deleted score.

`threat_feed` accepts `{feed:"cisa_kev"|"feodo",keyword?:...}`. It does not claim 100 feeds, STIX conversion, confidence scores or false-positive suppression. `telegram` accepts an explicit public `https://t.me/s/channel` preview; private content, group member indexing and older messages outside returned pages are not obtained. `rss`/`page` require an exact authorized hostname and never follow redirects. Pages supply server-returned text/resource URLs, not execution of JavaScript. `social_account` monitors exact GitHub, GitLab, DEV, Hacker News or Keybase public account records. Shared handles are not ownership evidence.

`adsb` accepts `{latitude,longitude,radius_nm}` and stores actual ADSB.lol regional aircraft observations, with ODbL attribution. History starts at activation; worldwide pre-existing flight history and independent ownership records are not supplied. Retrieval-time/processing-time metadata does not create false movement alerts.

`dark_web` and other supported social platforms require an explicitly approved server bridge. It is **not configured by default** and no existing provider keys are extracted. Set `MONITOR_BRIDGE_URL` to this project's `/functions/v1/osint-tools` endpoint and use a newly approved `MONITOR_BRIDGE_SECRET` shared only with that backend. The backend must implement `action:"monitor-poll"`, validate the shared secret, check the stored owner/plan/provider authorization, bound its query, and return a sourced result. Request parameters include `job_id`, `owner_user_id`, `kind`, `inputs`, `attempt_key`, `polling_authorized:true` and the approved daily allowance. Private-person/credential searches are rejected; organizational domain exposure is the supported scope. No licensed cron request runs without both the bridge and an explicit allowance.

## Reliability and verification

Jobs are leased, revision-guarded and committed atomically with history/alerts. Pausing or archiving supersedes in-flight checks. The first poll stores a baseline without claiming a change. Hashes ignore retrieval timestamps and normalize record ordering. Failures preserve the last verified snapshot, back off up to one day, and create a service-failure alert after three consecutive failures. Allowance exhaustion defers until the next UTC day and is not represented as a provider negative finding. Poll intervals are minimums; the bounded queue can delay checks. Snapshots/requests, job counts, feed counts, polygon complexity and per-tick polling are capped. History is preserved; a production retention/storage-budget policy remains necessary for high-volume long-term monitoring.

Run isolated tests with `node --test monitor-worker/test/*.test.mjs` from the parent checkout. Tests use SQLite plus explicit fixtures, never deployed users or fake production positions. Wrangler `--dry-run` confirms bundling, not live alarm/provider delivery. Live acceptance still requires a real baseline, a source change, a later scheduler receipt, the resulting durable alert, and an actual client acknowledgment.

## Source snapshots and coverage interface

The research workbench's `MonitorCoveragePanel` uses these same jobs and alarms. It does not create another scheduler. `GET /v1/jobs` and individual job reads now include `coverage` with distinct `found`, `no_match`, `unsupported`, `blocked`, `rate_limited`, `failed`, `stale`, `config_required`, and `never_checked` states. The last attempt and last successful source check are separate. Staleness means the last successful receipt is older than two intervals, with a minimum 15-minute threshold; a recent failure remains visible even if the retained evidence is also stale. Partial contributing-source coverage remains explicit.

Existing baseline/changed/unchanged/failed database states remain compatible. New failure metadata is stored as a receipt in the existing check row, never as replacement source evidence; older failure rows without that metadata remain `failed` with unknown HTTP status. History exposes `failure_receipt` separately from successful `snapshot` data. No schema migration is required. Provider 401/403/429 statuses remain distinguishable; configuration gates do not pretend to be upstream responses.

`GET /v1/jobs/:id/history?limit=20` returns a bounded window (1–100), the latest retained verified snapshot even when it is outside that window, and the comparison policy. The workbench recomputes SHA-256 against each displayed receipt, shows actual earlier/later data and normalized field changes, and preserves failed check receipts. Hash verification establishes consistency with the stored receipt, not the truth of the source. Arrays and object keys are sorted for comparison; retrieval time is excluded. Page text is retained, so rotating banners are not automatically ignored. CVE comparison uses the recorded retained optional-source components and their provenance timestamps.

Per-job `budget` exposes the approved licensed-provider allowance, UTC-day usage and remaining allowance. This is not the provider's account-wide remaining quota or a hosting spending cap. The workbench's public page/RSS creation sets the licensed-provider allowance to zero, requires explicit recurring-poll authorization, and accepts only the currently configured exact hostnames. The server continues to enforce plan/access, source, owner and allowance checks. Neither this interface nor a failed attempt broadens the allowlist or enables a licensed bridge.
