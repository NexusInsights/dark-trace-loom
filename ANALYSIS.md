> Historical October 12 archive record. This describes an older release, including a removed OAuth broker. For current runtime and migration status, read [README](README.md) and the [independent-platform migration plan](docs/migrations/2026-11-04-independent-platform.md).

# Insight Nexus archive analysis

Source: `C:/Users/gloss/Downloads/dark-trace-loom.zip`, preserved unchanged.

The supplied app is a React 18 / TypeScript / Vite SPA with shadcn-ui, Tailwind, React Query, and React Router. It includes investigation/case management, evidence upload/export, entity graphs, identity/persona correlation, organizations, training, reports, and billing. Its existing backend is Supabase project `zisrsttmjeipkmllqubi`; the archive includes database migrations and 18 Edge Functions. Cloudflare Pages hosts the compiled frontend. Database, authentication, storage, and Edge Functions remain on the existing Supabase/Lovable backend.

## Changes for deployment

- Repaired the out-of-sync npm lockfile and applied compatible dependency security updates.
- Added pinned Wrangler tooling, Cloudflare configuration, a deployment command, and response security headers.
- Corrected CSS font import ordering so Vite processes the font import correctly.
- Added production build validation for the Supabase URL and frontend key; privileged keys are rejected.
- Preserved Lovable OAuth on Lovable hosts, added an explicit external broker setting, and prevented Cloudflare users from following a missing `/~oauth/initiate` route. The deployed Cloudflare app now uses the existing published Lovable broker for Google authorization.
- Improved session restoration, login/logout audit error handling, and OAuth session-setting error handling.
- Corrected the landing page's signup-link destination to select the signup form.
- Excluded environment files and Wrangler state from Git. Only compiled `dist` assets are uploaded.

## Validation and limitations

- Production build and application TypeScript check pass.
- Seven meaningful OAuth configuration regression cases pass, alongside the archive's single placeholder test. The placeholder test does not demonstrate app functionality.
- Lint passes on files changed for deployment, with one existing React Fast Refresh warning. The archive-wide baseline has 130 errors and 13 warnings; it is not a clean lint baseline.
- Dependency audit: reduced from 38 findings to 16 (8 moderate, 6 high, 2 critical). Remaining critical findings concern Vitest/Tinypool development tooling. The production dependency tree separately reports 9 findings; this includes build-time peer packages and should not be interpreted as proof that each package is present in browser assets. Remaining fixes require framework/tooling migrations and need their own compatibility work.
- The main JavaScript asset remains about 1.9 MB uncompressed / 520 KB compressed. Route-based code splitting is a performance opportunity.
- Public Supabase auth settings respond successfully; email authentication is enabled. Anonymous schema-only probes confirm the app's `cases`, `subjects`, and `personas` tables exist. These probes do not verify authorized CRUD or row isolation.
- Direct Supabase Google OAuth returns `400 Unsupported provider: missing OAuth secret`, despite the public settings advertising Google. The deployed app uses Lovable's managed broker instead. Clicking the live Cloudflare Google button reaches Google's account chooser. A completed account sign-in and return to the app remain unverified.
- The connected Supabase administrative tool denies access to this project. The Lovable connector can locate the existing project but refuses SQL inspection because its connection lacks `projects:write`. Deployed policies, function secrets, paid-provider configuration, and backend changes cannot be confirmed through those API connections.
- After the user's explicit approval, all four exact Cloudflare redirect URLs were saved in the Lovable authentication allowlist. The persisted list increased from 10 to 14 entries. A subsequent Cloudflare callback probe returned HTTP 302 to Google's authorization endpoint, and the live button reached Google's account chooser. The original site URL and existing allowed URLs were preserved.
- Valid-account sign-in, email delivery, billing, investigation creation, paid OSINT tools, and background jobs require authenticated end-to-end verification. No real accounts were created, no email was sent, and no paid tool execution was triggered for this deployment.
- The Lovable workspace displays a payment issue banner and says it will move to the Free plan when payment retries end unless resolved. The app still depends on that workspace's backend and OAuth broker; no payment settings were changed.
- Source landing-page claims about investigation volume, provider count, SLA, military-grade security, and evidence/legal readiness are inherited marketing copy, not verified deployment results.

## Backend findings requiring attention

1. **High: invitation records are not restricted by token in the supplied RLS policy.** Migration `20260527011341_74f80d73-eb21-41a5-81ec-607e87cea74a.sql` grants anonymous SELECT and defines `Public can lookup by token` with `USING (true)`. This allows broad reads if deployed as written; a client-side token filter is not an access boundary. The table contains invitation emails and acceptance tokens. Remove broad anonymous table access and use a narrowly validated token lookup that returns only required invitation metadata. The deployed policy and whether it currently exposes records have not been established; no invitation content was retrieved.

2. **High: supplied alert runner lacks caller authorization.** `supabase/config.toml` disables JWT verification for `check-alerts`, and `supabase/functions/check-alerts/index.ts` starts a service-role alert cycle without verifying a caller or scheduler secret. If deployed as written without an outer control, an anonymous caller could trigger global alert processing. Add a verified scheduler credential or enforce the intended authenticated caller role. The live alert cycle was deliberately not invoked.

These are findings in the supplied backend source. No backend policy or function remediation has been applied as part of this frontend hosting deployment.
