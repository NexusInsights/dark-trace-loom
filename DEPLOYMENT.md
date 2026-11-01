# Cloudflare deployment

Production: https://dark-trace-loom.pages.dev

Verified deployment: https://251b65e3.dark-trace-loom.pages.dev

Deployment date: October 12, 2026.

Frontend hosting: Cloudflare Pages project `dark-trace-loom` on Travis's existing Cloudflare account. This is a direct upload deployment, not a Git-triggered CI integration. Source archive and original Lovable hosting remain intact.

Backend: existing Supabase/Lovable project `zisrsttmjeipkmllqubi`. No backend migration or data replacement was performed.

## Checks completed

- Live landing page renders in desktop and 390 × 844 mobile viewports; no horizontal overflow was observed in the mobile landing page.
- Live login route renders, and a deliberately invalid email/password attempt reaches Supabase and displays `Invalid login credentials`. Local password validation also displays its error and restores the submit button.
- Direct `/dashboard` navigation redirects an unauthenticated browser to `/auth`.
- Live signup navigation selects the CREATE ACCOUNT form.
- Root, auth, signup, dashboard, password-reset, auth-callback, and invitation routes return the SPA HTML from Cloudflare. Compiled JavaScript and CSS assets return HTTP 200. The deployed root references the current local build's generated asset names.
- Clicking the live Google button reaches Google's account chooser through the existing Lovable broker.
- `X-Content-Type-Options`, `X-Frame-Options`, and immutable asset cache headers are present.
- Production build, app TypeScript check, eight unit tests, and lint on the deployment changes pass. The archive-wide lint and remaining dependency audit findings are detailed in ANALYSIS.md.
- Compiled deployment output contains no `.env`, `.dev.vars`, or source maps.

## Authentication configuration

The existing published app is https://dark-trace-loom.lovable.app, Lovable editor project `ddb190d3-9e1f-408e-9b17-113c51f6576f`.

Its broker at `https://dark-trace-loom.lovable.app/~oauth/initiate` forwards to `oauth.lovable.app`. The Cloudflare callback initially failed with `redirect_uri is not allowed`. After the approved configuration change, it returns HTTP 302 to Google's authorization endpoint.

The user approved these four exact production URLs. They were saved under More → Cloud → Users → Auth settings → Advanced and verified in the persisted 14-entry allowlist:

- `https://dark-trace-loom.pages.dev/`
- `https://dark-trace-loom.pages.dev/auth/callback`
- `https://dark-trace-loom.pages.dev/dashboard`
- `https://dark-trace-loom.pages.dev/reset-password`

Configured `VITE_LOVABLE_OAUTH_BROKER_URL=https://dark-trace-loom.lovable.app/~oauth/initiate`, rebuilt, deployed, and verified the live Google button reaches Google's account chooser. The original authentication site URL and existing allowed URLs remain unchanged. A recoverable, Git-ignored environment backup was saved before editing.

Completed account sign-in, the provider callback's session creation, email confirmation/magic-link/password-reset delivery, authenticated investigation workflows, billing, and paid provider execution remain unverified. No account was selected or created during this verification.

The Lovable editor reports a workspace payment issue and a possible move to the Free plan after payment retries. This deployment retains the existing Lovable/Supabase backend and managed OAuth broker, so that dependency's billing status remains relevant. No payment settings were changed.

## Repeat deployment

Run from this project directory, using Node.js 22 or newer and the existing Cloudflare authentication:

```powershell
$ErrorActionPreference = 'Stop'
npm.cmd ci --ignore-scripts --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed' }
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed' }
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
npm.cmd run deploy
if ($LASTEXITCODE -ne 0) { throw 'Cloudflare deployment failed' }
npm.cmd run verify:deployment
if ($LASTEXITCODE -ne 0) { throw 'Live deployment verification failed' }
```

Only `dist` is uploaded. Environment values for this SPA are embedded during the build; keep server secrets out of all `VITE_*` variables. The source `.env` contains the original public Supabase configuration and the public Lovable broker URL; it is excluded from Git.

## Evidence

- `deployment-evidence/live-http.json`: live HTTP checks and current-build asset identity.
- `deployment-evidence/live-browser.json`: browser workflow results and remaining unverified paths.
- `deployment-evidence/live-landing.png` and `mobile-landing.png`: browser screenshots.
- `deployment-evidence/oauth-broker.json`: initial comparison of accepted Lovable and rejected Cloudflare callbacks.
- `deployment-evidence/oauth-broker-approved.json`: Cloudflare callback accepted after saving the allowlist.
- `deployment-evidence/oauth-allowlist-saved.png`: persisted authentication configuration.
- `deployment-evidence/live-google-authorization.png`: live Google button reaching Google's account chooser.
- `deployment-evidence/audit-baseline.json`, `audit-final.json`, and `audit-production.json`: dependency findings.
- `deployment-evidence/lint-baseline.txt`: archive-wide lint baseline.
- `deployment-evidence/analysis.json`: source archive SHA-256 and deployment metadata.
