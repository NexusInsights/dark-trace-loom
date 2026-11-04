# Insight Nexus

A React/TypeScript intelligence workspace with source-backed account observations, explicit association review, cases, reports, research tools and monitoring.

Repository: https://github.com/NexusInsights/dark-trace-loom

Live application: https://dark-trace-loom.pages.dev/dashboard

## Run and build

Use Node 24 and the committed npm lockfile. On a fresh development environment, restore the locked dependencies with `npm ci --ignore-scripts --no-fund`. Set the public backend URL/key in a private `.env.local`; never put a server credential in a `VITE_` variable. See `.env.example` for configuration names.

```sh
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

The build checks production inputs and compiled output for builder endpoints, SDKs and session-broker hooks. Backend control and billing independence require separate live verification; passing this scan is not proof of completed data migration.

## Hosting and backend ownership

Cloudflare Pages hosts the app and its same-origin API routes. Code, tests, build and release artifacts are maintained in this repository without a Lovable editor/build/publish requirement. Supabase provides database, authentication, storage, Realtime and Edge Functions; direct ownership of the selected Supabase project is required for complete independence.

Production currently uses the retained source backend `zisrsttmjeipkmllqubi`. Independently owned migration destination `ocliymtdvtxfxczxgbjr` exists, but a production switch requires current data reconciliation and successful authenticated acceptance. Do not confuse a preview or a healthy database status with completed migration.

Current work and rollback: [migration plan](docs/migrations/2026-11-04-independent-platform.md). Prior verified release: [release record](docs/repairs/ORIGINAL-PLATFORM-RELEASE-20261104.json). Coverage and limits: [acceptance matrix](ACCEPTANCE.md).

## Release

Review an exact Git revision, run the checks above, preserve the prior deployment/configuration and back up the revision. Build for the explicitly selected backend and package the current `functions/` alongside the frontend. Use the existing Cloudflare account and project; verify asset hashes, API authorization, sign-in, persistence and error handling on the immutable deployment before switching traffic.

Do not replay migration history on a populated database. The existing migration destination already contains imported users and application records; use reviewed, guarded changes and preserve newer destination authentication settings. Keep database archives and private records outside this repository.
