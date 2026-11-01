# Intelligence Lab

The signed-in **Intelligence Lab** page at `/intelligence` integrates the seven
requested features into the existing application. The existing Tool Suite,
investigations, providers, sign-in flow and billing remain in place.

## Browser features

- **Browser fingerprint:** press Capture after selecting the consent box.
  FingerprintJS runs in the current browser; its identifier does not verify a
  person's identity. Importing the page does not initiate fingerprint collection.
- **Cookie tracking:** Enable creates a random first-party visitor ID under
  `insightnexus_visitor`, with a one-year maximum age, `SameSite=Lax` and `Secure`
  on HTTPS. The consent setting is stored locally. Remove deletes both the
  visitor cookie and its setting; removal remains available at the account limit.
- **TensorFlow outcome classifier:** upload or paste JSON with `featureNames`
  and 20–5,000 `samples`, each containing numeric `features` and a `label` of 0 or
  1. At least two samples per class are required. Training uses two 64-unit ReLU
  layers and a sigmoid output, with a stratified 20% held-out test set. Metrics
  include accuracy, precision, recall and the majority-class baseline. Features
  for prediction must follow the displayed feature order. The synthetic example
  is labeled explicitly and demonstrates execution, not persuasion efficacy.
  Dataset and model weights stay in the browser; changing the dataset or leaving
  the page disposes the model. Training can be cancelled.

Browser operations use the existing account plan and tool-permission controls.
The new page records operation counts, not the fingerprint or training dataset.

## Provider features and execution path

```
Signed-in page → authenticated Supabase intelligence-tools
  ├─ direct HTTPS → IPinfo / HIBP / approved official X API
  └─ authenticated browser worker → public X extraction / Tor onion browser
```

Supabase Edge functions cannot launch a local Chromium process or connect to
the user's computer's Tor proxy. Only browser-mode X and onion actions require
the external browser worker. HTTP providers execute through the portable
`supabase/functions/_shared/provider-http.mjs` module in Supabase, using that
project's existing secret store. Their keys are never forwarded to the browser
worker. Missing browser-worker configuration does not block a configured direct
HTTP action.

| Provider | Server configuration | Explicit allowance gate |
| --- | --- | --- |
| IPinfo | `IPINFO_TOKEN`; `IPINFO_API_MODE=legacy` (default), `lite` or `lookup` | `INTELLIGENCE_IPINFO_ALLOWANCE_VERIFIED=true` |
| HIBP email breaches | `HIBP_API_KEY`; optional `HIBP_USER_AGENT` | `MARKETPLACE_HIBP_FREE_ALLOWANCE_VERIFIED=true` |
| Official X API | `X_API_MODE=api`; `X_API_BEARER_TOKEN` | `X_INCLUDED_ACCESS_VERIFIED=true` |
| Public X browser extraction | `X_API_MODE=browser` (default); browser-worker configuration | Existing app authentication, permission and quota checks |
| Onion browser | Browser-worker configuration and a working Tor client in that runtime | Existing app authentication, permission and quota checks |

IPinfo `legacy` uses `ipinfo.io/{ip}/json`; `lite` and `lookup` use the
corresponding `api.ipinfo.io/{mode}/{ip}` endpoint. Select the mode that matches
the account. Lite returns country/continent and basic ASN coverage; it does not
invent city or coordinates. HIBP 404 is normalized to a successful no-match
result. The official X API mode is optional and requires separately verified
included account access; it is not assumed to be free.

All allowance flags require the literal value `true` after an operator verifies
the relevant account entitlement and approved allowance. A configured key,
subscription response or successful fixture is insufficient. Missing flags fail
closed before quota reservation or provider work. This change does not approve
paid provider use, purchase credit, enable overages or modify other marketplace
gates.

Deploy `supabase/functions/intelligence-tools` with its shared modules and the
scoped accounting migration. The hosted browser route needs an HTTPS origin in
`INTELLIGENCE_WORKER_URL` and the matching private `INTELLIGENCE_WORKER_TOKEN`
(at least 32 characters). Never prefix these values with `VITE_` or put them in
browser code. For an entirely local Supabase/worker setup only,
`INTELLIGENCE_ALLOW_LOOPBACK=true` permits HTTP loopback when `SUPABASE_URL` is
also loopback. A hosted Edge function cannot reach a user's local worker through
its own loopback address.

The Cloudflare Containers deployment package, account/billing gate, Linux image
validation, instance limits, secret setup and rollback instructions are in
[the Cloudflare worker README](../services/cloudflare/README.md). Its authenticated
`GET /health` is liveness only and does not start a container. `GET /ready` checks
real sandboxed Chromium and Tor bootstrap. During cold start the worker returns
HTTP 202 `WORKER_STARTING` with `Retry-After: 5`; the Edge adapter converts this
to HTTP 503 with the same retry information, releases the reservation and makes
no automatic retry. No lookup is dispatched by that starting response.

The standalone local Node worker remains available through
`npm run intelligence:worker` on default `127.0.0.1:43410`. Use Node 24,
`npm ci --ignore-scripts`, an installed Chrome/Chromium executable (or
`PUPPETEER_EXECUTABLE_PATH`) and a reachable `TOR_SOCKS_PROXY` for onion work.
Puppeteer Core does not download a browser. The hosted Cloudflare package
supplies a separate Chromium/Tor runtime; it does not use or replace the user's
local Tor service.

IPinfo looks up the explicit public IP submitted by the user, rather than
silently returning the backend server's location. X extraction is restricted to
public X profile URLs/usernames. Onion retrieval accepts valid v3 onion URLs;
returned HTML is shown as escaped text, never executed in the page.
The worker uses a temporary SOCKS gate restricted to the submitted onion
hostname and standard web ports. Chromium background requests and attempts to
reach other hosts are blocked before the operator's Tor proxy. Browser
navigation may upgrade HTTP to HTTPS only on that same onion hostname; it may
not redirect to a different host. The gate and browser are closed after each
operation.

## Operator-only provider diagnostic

`supabase/functions/intelligence-provider-status` is a separate operator endpoint,
with no product UI route. It accepts POST with at most 4 KiB of JSON and only the
optional boolean `checkHibpSubscription`. Authentication compares SHA-256 digests
of the supplied Bearer credential and the project's existing server-side
`SUPABASE_SERVICE_ROLE_KEY`, using a fixed-length comparison before reading
configuration or performing any provider work. Ordinary user JWTs and public
keys do not authorize it. Its per-function `verify_jwt=false` setting delegates
this specific authentication check to the handler; it does not make the handler
public.

POST `{}` returns presence booleans, normalized provider modes, configured
allowance-flag assertions and execution-runtime metadata. It returns neither
secret values nor the browser-worker URL and makes no network request. A nested
configuration snapshot is explicitly metadata-only; it does not prove valid
credentials, entitlement, connectivity or readiness.

POST `{"checkHibpSubscription":true}` additionally makes one read-only request to
HIBP's fixed `/api/v3/subscription/status` endpoint using the existing stored
HIBP key. It returns only the subscription name, expiry, RPM, check timestamp
and fixed provider/scope fields, or a sanitized error/status/retry delay. Unknown
body fields are rejected. It never queries an email, calls another provider,
retries, reserves user quota, writes account data or approves an allowance flag;
`allowanceVerifiedByCheck` remains false. All responses use `Cache-Control:
no-store`, with no public CORS route. Invoke it only from a trusted backend
facility that can supply the existing service credential without exporting it
into chat, browser code or a public client.

## Deployment state recorded November 1, 2026

The production backend bound to the published `dark-trace-loom.lovable.app`
application is `zisrsttmjeipkmllqubi`. The exact
`20261031234500_intelligence_execution_gate.sql` migration was applied and its
matching version/name/source explicitly registered after live schema verification.
Both RPC bodies/access controls and journal RLS were independently checked; no
provider request or customer-data lookup was part of that migration verification.
Do not reapply the migration or bind the app to a different namesake project.

At this recorded checkpoint, the new Edge functions and feature frontend have
not been deployed/published, and Cloudflare browser/Tor activation has not been
completed. The Cloudflare account requires a paid-plan eligibility/billing gate;
no purchase is implied by the preparation files. Existing HIBP key presence has
been observed without revealing its value, but subscription status and approved
provider allowance remain unverified. IPinfo/X configuration and the new worker
route/allowance flags have not been activated. Update this dated state only from
actual deployment and workflow evidence; passing source tests does not establish
production activation.

## Authentication and usage

The Edge handler verifies the signed-in JWT with Supabase Auth before admitting
an action. The scoped database RPC checks `intelligence-lab` and the specific
`intelligence-ipinfo`, `intelligence-breach`, `intelligence-profile` or
`intelligence-onion` administrator permission. It preserves the existing free
limit of five tools per UTC day and the existing recognized paid plans.

An advisory transaction lock and a private reservation journal prevent concurrent
new provider actions from bypassing that limit. Successful requests update the
existing `usage_metrics`; failures release their reservation. Interrupted pending
reservations expire from the admission count after two minutes. The journal
stores user, action, state and timestamps, without the lookup target or result.
Existing tool accounting is unchanged.

Missing deployment/configuration, failed authentication, exhausted quota, provider
rate limits and lookup failures have separate visible errors. No provider call is
made when authentication, configuration or permission checks fail.

## Verification

Run:

```text
npm run test
npm run test:intelligence-worker
npm run test:intelligence-client
npm run test:intelligence-sql
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

The Edge-adapter tests inject isolated Auth, database-RPC, HTTP provider and worker responses;
the operator-status tests verify service authentication, request bounds, safe
metadata, a single explicit account request and sanitized error handling;
the UI tests exercise consent, cookie removal, app API invocation, quota errors,
training orchestration and prediction. These tests make no live personal lookups.
Real-provider and deployed Edge/database verification require the configured
deployment and an authorized real request. A build or a passing fixture test
does not establish that those live services work.

The SQL suite applies the exact new migration, its owning prerequisite table
DDL, and the existing role/updated-at helpers to an in-memory PostgreSQL engine
provided by pinned `@electric-sql/pglite` 0.5.14 (Apache-2.0). It exercises actual
function execution and database role ACLs for admission, five-request free
limits, pending reservation release/expiry, active/expired subscriptions,
administrator denials, idempotent accounting and cross-user settlement denial.
Only the Supabase auth schema/claim interface is a local test fixture; it does
not verify real JWT issuance or a deployed Supabase project.

PGlite has one exclusive database connection. The real advisory-lock function
executes, but this suite does not establish lock contention behavior across
independent PostgreSQL connections. It does not alter or replace lock functions,
and no test connects to the remote application database. Primary `npm test`
includes this SQL suite so the existing CI workflow runs it.

Explicit HTTP onion URLs keep their requested protocol and port in the isolated browser; Chromium's opportunistic HTTPS upgrade is disabled for these Tor jobs. A server-directed upgrade to HTTPS on the same onion hostname remains allowed, while other origins and HTTPS-to-HTTP downgrades are blocked. The final installed-Chrome test fetched the official Tor Project onion through the existing local Tor SOCKS service; this verifies that route at the test time, not future onion availability.
