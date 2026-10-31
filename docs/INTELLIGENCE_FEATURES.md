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
Signed-in page → Supabase intelligence-tools → authenticated Node worker
  → IPinfo / HIBP / public X browser extraction / Tor onion browser
```

Supabase Edge functions cannot launch a local Chromium process or connect to
the user's computer's Tor proxy. The checked-in Node worker is therefore a
required execution service for provider tools. It is an actual service, not an
index-search substitute for onion retrieval. Its authenticated `/health` route
reports liveness only; it does not establish provider readiness.

1. Run Node.js 24 or a version supported by the pinned Puppeteer dependency.
   Install with `npm ci --ignore-scripts`; Puppeteer Core does not download a
   browser. Use an installed compatible Chrome/Chromium executable.
2. Configure the worker's environment through the deployment's approved secret
   manager. Keep `INTELLIGENCE_WORKER_TOKEN` private and at least 32 characters.
   Start the worker with `npm run intelligence:worker`.
3. Put the worker behind HTTPS in a hosted deployment. Its default listener is
   `127.0.0.1:43410`; configure bind host/port only as needed for that deployment.
4. Apply `supabase/migrations/20261031234500_intelligence_execution_gate.sql`,
   then deploy `supabase/functions/intelligence-tools`. The Edge function needs
   the worker's HTTPS origin in `INTELLIGENCE_WORKER_URL` and the matching
   `INTELLIGENCE_WORKER_TOKEN`, both server-side secrets. Never prefix either
   with `VITE_` or put them in browser code.
   HIBP additionally retains the existing
   `MARKETPLACE_HIBP_FREE_ALLOWANCE_VERIFIED=true` gate. IPinfo requires
   `INTELLIGENCE_IPINFO_ALLOWANCE_VERIFIED=true` after the operator independently
   verifies included account access. Missing flags fail closed before quota
   reservation or any worker/provider request; a configured key is insufficient.
5. For an entirely local Supabase/worker setup only,
   `INTELLIGENCE_ALLOW_LOOPBACK=true` permits an HTTP loopback worker origin.
   The adapter also checks that `SUPABASE_URL` is loopback. A hosted Edge function
   cannot use a loopback address to reach a worker on a user's computer.

The worker requires provider configuration: `IPINFO_TOKEN` for IPinfo,
`HIBP_API_KEY` for breach lookups (with optional `HIBP_USER_AGENT`),
`PUPPETEER_EXECUTABLE_PATH` if a compatible installed browser is not detected,
and `TOR_SOCKS_PROXY` for onion browsing. Use a reachable SOCKS5 listener such as
the operator's existing Tor service. This change does not install or replace Tor.
A key's presence alone does not establish authorized included usage. The new
Edge adapter preserves the existing HIBP allowance flag and adds the explicit
IPinfo allowance flag; other marketplace gates remain unchanged.

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
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

The Edge-adapter tests inject isolated Auth, database-RPC and worker responses;
the UI tests exercise consent, cookie removal, app API invocation, quota errors,
training orchestration and prediction. These tests make no live personal lookups.
Real-provider and deployed Edge/database verification require the configured
deployment and an authorized real request. A build or a passing fixture test
does not establish that those live services work.

Explicit HTTP onion URLs keep their requested protocol and port in the isolated browser; Chromium's opportunistic HTTPS upgrade is disabled for these Tor jobs. A server-directed upgrade to HTTPS on the same onion hostname remains allowed, while other origins and HTTPS-to-HTTP downgrades are blocked. The final installed-Chrome test fetched the official Tor Project onion through the existing local Tor SOCKS service; this verifies that route at the test time, not future onion availability.
