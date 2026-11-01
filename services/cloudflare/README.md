# InsightNexus intelligence worker on Cloudflare

This package prepares the existing browser worker for Cloudflare Containers. It retains real Node.js, Chromium, Puppeteer, the stealth plugin, a loopback Tor client, and the scoped SOCKS gate. IPinfo, HIBP and optional official X API requests remain in the authenticated Supabase Edge function; their provider keys are not passed into this container.

## Current release gate

The connected Cloudflare account rejected `wrangler containers list` because Containers requires Workers Paid. No plan upgrade, container deployment or live Cloudflare browser/Tor verification has been performed. This preparation does not authorize a purchase. Review and approve the paid plan/resource charges before running a deployment command.

The configuration uses the supported `default` scheduling policy with a **platform-enforced `max_instances: 1`**, one fixed Durable Object ID, `standard-1` resources and a five-minute inactivity timeout. It controls the process through the current Durable Object Container API. Wrangler 4.156 rejects `max_instances` under the `durable_object` scheduling policy, so that policy is deliberately not used here.

Cloudflare's listed Workers Paid base is $5/month. Containers also meter provisioned memory/disk, active CPU, egress, Workers/Durable Objects and applicable logs. Before monthly included allowances, the selected 4 GiB/8 GB instance is approximately $0.038 per running hour for memory/disk plus up to $0.036 per hour at full half-vCPU use. Sleep-to-zero and a one-instance cap do not create a spending cap. Recheck the [current pricing](https://developers.cloudflare.com/containers/platform/pricing/) and the account's allowance/billing state before activation.

## Request and readiness contract

Every endpoint requires the existing `Authorization: Bearer <INTELLIGENCE_WORKER_TOKEN>` server credential. Authentication occurs before acquiring a Durable Object or starting billable compute. The same token is checked again by the container and the existing internal Node worker. No token value belongs in this repository, a Docker build argument, a public client variable or logs.

| Endpoint | Result |
| --- | --- |
| `GET /health` on the public Worker | Authenticated front-door liveness only. It never starts or polls a container and reports `containerState: "not_checked"`. |
| `GET /ready` | Starts or queries the single container once. HTTP 200 requires a successful sandboxed Chromium document render and authenticated Tor control `PROGRESS=100`. |
| `POST /intelligence` | Accepts the existing `{action,input}` shape for `profile` or `onion`. Invalid inputs and HTTP-provider actions are rejected before container admission. When ready, forwards to the existing Node worker. |

During cold start, `/ready` and `/intelligence` return HTTP **202**, `Retry-After: 5`, and `{ok:false,error:{code:"WORKER_STARTING",message:"...",retryAfter:5}}`. A 202 never dispatches the intelligence operation. A caller may retry the unchanged request within its own bounded deadline; do not silently interpret 202 as a successful lookup or continuously poll readiness. The Edge adapter must preserve this starting condition/retry information instead of inventing an intelligence result. Actual browser operations have a separate 90-second upstream bound.

The image exits on failed Tor/browser startup. Startup readiness has a 120-second deadline, and the Durable Object stops advertising startup after 150 seconds. An unexpected container exit causes a 60-second restart cooldown. Health polling is not used to keep the paid instance running.

## Local source checks

Use Node 24. Dependencies and Wrangler 4.156.0 are pinned in this package and its lockfile.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run check:bundle
```

`check:bundle` intentionally uses `--dry-run --containers-rollout=none`: it validates the Worker bundle/configuration without attempting an image build or any deployment. It does not verify the container image. A normal image dry run still requires a Docker engine. Do not start Docker Desktop or build large images on the low-space C: drive for this task.

The separate `Intelligence container preparation` GitHub Actions workflow builds a Linux/amd64 image and executes its smoke test without Cloudflare credentials, publishing an image, or changing billing. The smoke test checks Tor configuration, real sandboxed Chromium rendering, and the actual Puppeteer + stealth + scoped SOCKS document path against a synthetic upstream. It explicitly does **not** establish live Tor-network access.

## Image behavior

The Docker image uses Node 24, Debian Chromium plus its sandbox package, and Tor's maintained signed package repository. Its entrypoint uses `tini` to manage children. It preserves the Chromium sandbox; no `--no-sandbox` flag is added. The local CI Docker run grants the `SYS_ADMIN` capability documented by Puppeteer. A live Cloudflare launch must still prove that its runtime supports the same sandboxed execution.

The supervisor HTTP listener uses port 43410; the existing authenticated Node worker uses only loopback port 43411. Tor SOCKS/control ports 9050/9051 are loopback-only. The control cookie is read only inside the container and is never returned or logged. The browser probe uses an isolated temporary profile and a data URL, then removes its own profile.

`enableInternet: true` is required for Tor's raw TCP relay connections. No Cloudflare HTTP/HTTPS interception is configured for Tor transport. Chromium onion requests still go through the per-operation scoped SOCKS gate, so browser background hostnames and IP-form destinations are denied before any connection to the Tor upstream. Tor is configured as a client, not a relay.

Disk is ephemeral. Tor bootstrap and directory download occur again after a fresh start. No investigation records, models, provider keys, browser sessions or Tor control credentials are persisted into the image. [Container networking](https://developers.cloudflare.com/containers/configuration/outbound-traffic/), [runtime lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/), [Tor installation](https://support.torproject.org/little-t-tor/getting-started/installing/).

## Deployment after the billing gate is approved

Use the existing approved Cloudflare account and an authorized secure secret interface. Set only `INTELLIGENCE_WORKER_TOKEN` as a Worker secret; the container receives that token and fixed browser/Tor settings. Do not copy IPinfo, HIBP or X provider credentials into Cloudflare.

When a Docker-compatible build engine is available in the authorized environment, `npm run deploy` builds and pushes the configured image and deploys the wrapper. This can incur the approved account/resource charges. The activation check must prove unauthenticated rejection, authenticated health, readiness through a cold start, actual public X behavior, a real approved onion response, and regression protection of the scoped SOCKS route. A running process or uploaded bundle alone does not complete activation.

For an image built by an authorized CI runner, avoid a local Docker build by first pushing that image to the **Cloudflare managed registry** with the documented `wrangler containers push` or `wrangler containers build --push` command. Obtain its actual registry digest, then prepare a deployment manifest:

```text
npm run prepare:prebuilt -- registry.cloudflare.com/ACCOUNT_ID/IMAGE@sha256:ACTUAL_DIGEST
npx wrangler deploy --config .wrangler/deploy-prebuilt.json
```

The helper requires this configured account's digest-pinned Cloudflare URI, preserves the instance cap, and backs up any earlier generated manifest. It prepares configuration only; it never deploys. GHCR is **not** a directly supported image source. Cloudflare documents direct external sources as Docker Hub, Amazon ECR and Google Artifact Registry for the default policy; other registries must be copied to the Cloudflare managed registry. An authorized CI upload needs a securely configured deployment credential and billing approval; the validation workflow supplied here has neither. [Image-management documentation](https://developers.cloudflare.com/containers/guides/image-management/).

After successful activation, set the existing Supabase Edge `INTELLIGENCE_WORKER_URL` to the verified HTTPS Worker URL and configure the matching token through the approved secret interface. Retain the application's existing user authentication and database controls. Rollback consists of restoring the prior Worker version/image and prior Edge worker route through their supported deployment controls; do not delete an image needed by a rollback.
