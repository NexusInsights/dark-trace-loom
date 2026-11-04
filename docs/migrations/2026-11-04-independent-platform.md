# Independent Insight Nexus migration â€” November 4, 2026

## Goal and authority

User request: "i want this entire project not lovable dependant and migrated. I want xero dependancy on lovable". This supersedes the prior frontend-only scope: complete independent hosting, source, runtime, data, authentication, storage and recovery are the target. It does not authorize charges, destructive source removal or bypassing denied access. No Lovable publication is needed.

## Verified starting state

- Current production application source: `7367316ba62a98224b9e2346467567da6c89028f`; documentation baseline `c1438f10f96e5d4f892340e514dcef87c49c7f00`.
- Production Pages: `eb26475f-1561-4e10-a0bb-56de43276a78`, https://dark-trace-loom.pages.dev. Previous rollback: `3138de43-8117-46ce-94f9-f0363baa8cfc`.
- Original Lovable project: `ddb190d3-9e1f-408e-9b17-113c51f6576f`; source backend `zisrsttmjeipkmllqubi`.
- Independently controlled destination: `ocliymtdvtxfxczxgbjr`, freshly listed through the user's Supabase connector. No new project or subscription created. Read-only SQL confirms 62 public tables, 2 users, 3 identities and 3 stored objects. Management listing shows 18 older Edge Functions.
- Destination administrator has a password and Google identity. Public Auth settings permit email login, while Google is disabled. Actual destination sign-in is pending; no credentials were read, changed or generated.
- Official export downloaded from the exact project storage bucket `database_export_04_11_26`. Snapshot time `2026-11-04T05:03:44Z`; ZIP CRC and complete custom/zstd archive decode passed. Database restore is not yet verified. Archive held privately at `D:/CodexData/InsightNexus-Migration/2026-11-04`.
- Export ZIP SHA-256 `b52b934c5a70c0cdf8eebb37caf8d58e2692a518caaadeb3ec854ad3311cad12`; inner backup SHA-256 `20922fa19c030c3a4f9efe0d506de6be4417e4d24e6e3ab4e12be03e52d5b4e8`.
- Snapshot contains 63 public data sections / 2,710 public records, 2 users and 3 identities. Its 4 storage objects include an older backup object; product binaries require separate comparison. Export predates the latest demo review/pipeline actions; it is not a current cutover snapshot.

## Risk and staged sequence

High risk: a backend switch changes session issuers and could hide uncopied records or break login. Preserve the source, destination and working frontend until acceptance.

1. Remove unused editor auth code and builder attribution, deny builder AI endpoints, and enforce source/build checks. Preserve independent provider behavior and explicit unavailable outcomes.
2. Prepare an immutable current-source migration candidate. Historical bundle is retained. The old bundle has 52 migrations/18 functions; current source has 55/20 and eight Pages routes. Add the missing structural intelligence execution type; prove candidate membership/freshness, not only self-consistency.
3. Inspect source export and target metadata. Compare table IDs/content and managed schema/permissions. Preserve newer target password/session/provider configuration; do not overwrite managed Auth tables from an older snapshot. Record target-only rows and unresolved conflicts.
4. Back up target affected rows and object definitions privately. Rehearse the exact additive schema/public-data delta and its rollback with synthetic data and existing approved PostgreSQL tooling. Never run full fresh-schema history or `--clean` on the populated target.
5. Review/apply only the bounded destination delta and security guards after checks pass. Record transaction result and row/ID/content digests. Deploy exact tested server sources with existing authorization semantics and preserve previous function bodies.
6. Update the isolated independent Pages preview with matching frontend/API configuration. Keep its monitor destination isolated. Verify real sign-in, original account roles/entitlement, private file access, current source-backed workflow, manual/pipeline parity, cross-user rejection and persistence.
7. Reconcile all source writes after the export during a controlled cutover window. Do not claim the frozen export includes later writes. Switch production only after this delta and authentication are verified. No paid/unconfigured provider is silently enabled.
8. Verify production's actual backend, API/session issuer, storage and monitor bindings, runtime requests and account workflows. Back up source/receipts to the existing repository. Retain the old source for rollback; source deletion or subscription cancellation is a separate final destructive/billing decision.

## Rollback

Before traffic switch, production remains on its verified original backend and deployment. A failed preview stays isolated. Each target database change must retain its before-state privately and have a tested inverse or transaction rollback; no unreviewed DROP/DELETE is permitted.

After traffic switch, preserve destination writes before any rollback. Restore the preceding Pages/functions/monitor bindings and exact immutable deployment only after reconciling those writes; simply pointing back can hide new records. Existing source is not paused/deleted as an independence test.

## Acceptance evidence

A frontend build, static scan, schema import, row count or health status alone is not completion. Record exact source/remote SHA, CI/build result, server versions, source/target content comparison, auth/RLS/private-storage checks, live workflow evidence, monitor ownership and rollback receipt. Private archives/records remain outside Git.

Current execution evidence is in sibling `insight-nexus-exit-20261104`; private exports/deltas are in the D: directory above. Historical original-platform acceptance remains in `ACCEPTANCE.md`.

## Additive destination schema preparation

The reviewed `20261031234500_intelligence_execution_gate.sql` creates the absent protected journal and two scoped admission RPCs. Fresh target metadata confirms all three objects absent. Existing PostgreSQL-engine tests cover quota, permission and settlement behavior. The operation is enclosed in one transaction with lock/statement limits and repeats the absence guard, targeting only the connector-selected owned project. Before commit, failure rolls back the whole addition. No existing customer row or Auth setting changes. If committed but not used, rollback requires proving the journal empty and removing only these new objects; after import, retain the journal and fix forward or restore its private before-state, never drop populated data.

The following research action extension has strict base-body/schema/ACL guards and an existing tested rollback; ownership policies are additive restrictive guards with existing tested rollback. Their publication and data imports will be recorded separately.
