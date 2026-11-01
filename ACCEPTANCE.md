# Current reconciliation evidence — November 1, 2026

Exact Lovable project ddb190d3-9e1f-408e-9b17-113c51f6576f; production Supabase zisrsttmjeipkmllqubi. The independent staging backend is preserved. Repository baseline 9546fc851c8f2605c9f4bfcedfdb9b990cfc6a86 is not a Git SHA for the later non-Git expansion. Canonical/prepared source identity and stopped writer coordination were confirmed before this isolated port. See docs/repairs/canonical-snapshot.json and WORK-STATE.json.

The reconciled application is committed and backed up at 70494d922cde4152d873bcc4b40a1bca49830e0d on codex/reconcile-insight-repairs-20261101. [Exact-source CI passed](https://github.com/NexusInsights/dark-trace-loom/actions/runs/41354979121) dependency restore, lint, type checking, the full aggregate test command and build. No merge/deployment occurred. See docs/repairs/BACKUP-RECEIPT.json.

The earlier matrix below is preserved as historical evidence. Its earlier public-provider passes are not new acceptance of this source. This continuation makes no live provider requests, adds no credentials, installs no software and changes no live policies/settings.

| Current module or boundary | Newly verified scope | Live/release status |
|---|---|---|
| Registry/templates/input mapping | Actual shared registry, legacy aliases, declared fields/defaults, nested/file/size validation; direct manual API still throws; automated adapter retains outcomes | Offline contract; no live provider acceptance |
| Manual osint-tools | Existing remotely verified session + bounded body retained; built-in action aliases now check canonical permissions before providers; malformed permissions fail closed | Synthetic auth/transport; deployed body equality unverified |
| Legacy osint-dispatch | 29 actual-source auth/permission/owned-case/user-writer/persistence/fetch/SSL checks pass | Synthetic SDK/transport; production function unverified |
| GitHub manual/dispatcher parity | 10 paired source executions pass; unavailable repos remain null/partial with reasons; verified empty remains [] | Fixtures only |
| Domain, wallet, redirects, search, local phone | Retained real source runs with deterministic provider fixtures; commercial HTTP IP adapter remains not_configured without egress | No new live acceptance; PDL/other paid providers not called |
| Image metadata/hash | Synthetic JPEG/PNG byte parsers, actual Sharp decoding/hash/provenance, bounds and private-destination guards; retained current strict Auth and bounded-body tests | Exact ImageScript/Deno remains unaccepted and setup not approved |
| Manual result saves | Status/DEMO rendering, verified caller/case, rejected writes remain unsaved; partial/demo can be labeled tool_results but cannot become automatic case artifacts | jsdom/SDK fixtures only; authenticated browser/RLS unverified |
| Pipelines and agents | Only success makes artifacts/entities; partial/demo/not_configured stay truthful; current run actor/case and tool permissions checked; errors and failed saves do not report complete | Actual engines with synthetic DB; not live persistence |
| Ownership migration | New additive restrictive policies tested in existing embedded PostgreSQL; reproduces permissive-OR foreign-case bypass before fix and blocks it after; preserves collaborator reads and standalone ownership | Not applied to either backend; actual live schema/policies require reviewed migration acceptance |
| Expanded research, intelligence, billing, monitors, providers | Current owner's code and tests retained; aggregate validation recorded when complete | Historical owner live results are not rerun acceptance here |

Final local validation: 1012 app tests in 81 files; worker36, Cloudflare packaging19, client15, intelligence SQL11, research107 (including11 reused SQL cases), monitors23 and ownership migration/rollback1 test executions passed, plus dispatcher29 and paired GitHub10 contract checks. Lint:0 errors/16 warnings; typecheck/build passed. Full evidence, source fingerprints, backup/CI receipts and next steps are recorded in docs/repairs. Historical archives preserve every stopped repair commit without implying those old trees are the current app.

---

# Historical acceptance record (preserved verbatim)

# Insight Nexus isolated verification
Exact project: [Lovable editor](https://lovable.dev/projects/ddb190d3-9e1f-408e-9b17-113c51f6576f).
Pinned remote source: `245601a82d43005454de65a32ffb793e7ef0f3f3`.
Supabase: `zisrsttmjeipkmllqubi`.

The Lovable connector verified identity and read 249 text source files at that exact ref. This is a reconstructed source snapshot, not a clone claiming the remote commit as local HEAD. Credentials (.env), binary assets, and lockfiles were excluded. Local snapshot commit: `f24ab9ed4b4e91e7de8217fb7650fa06f7b3c9c8`. Dependencies were copied read-only from the owner's existing node_modules after an offline install lacked cached metadata; no packages were installed into the owner checkout. Test runtime was Vitest 3.2.7 and Vite 5.4.21. Production build has no credentials in this snapshot and is an offline compilation artifact, not a ready deployment.

Owner conflict: task `01a12f60-d945-7be2-b888-642048787eda`, **Analyze and deploy with Cloudflare**, remained active at the final ownership check. Its source is at `C:/Users/gloss/OneDrive/Documents/ChatGPT/Insight Nexus/dark-trace-loom`. The containing Git repo is empty and the source folder is untracked, with later owner fixes already present. No original checkout, remote project code, live database, credentials, or deployed settings were changed. None of Osint, osintshadow, ShadowTrace-Pro, or ReconWeb-AI was substituted.

## Implemented slice
- Current manual Tool Suite registry is the execution authority. Pipelines call the same executeTool and runOsint implementations instead of osint-dispatch.
- Supported historical IDs map explicitly to current IDs; social_analyzer, email_validator and reverse_image remain unsupported, rather than being mapped to different tasks. Templates now contain supported IDs and open an editable input form before creation.
- Flat/shared inputs and per-tool inputs (canonical or historical keys) map to declared fields; required values, scalar types, length, select defaults/options are checked before provider execution.
- Tool and run statuses retain error, unknown_tool, not_configured, partial and demo. Mixed successful/incomplete runs are partial; only all-success runs complete. History displays individual outcomes/reasons. Empty pipelines cannot complete.
- Confirmed INSERTs determine artifact counts. Partial/error/unconfigured/demo results never become new case artifacts or linked entities. Explicit successful provider entities retain their previous linking path; errors are checked and counts reflect confirmed observations.
- All execution results retain provenance in tool_results, including error outcomes; persistence failures enter run history and prevent false completion. Last-run timestamp failure is a warning after a terminal run has already been saved.
- Missing PDL configuration remains not_configured. Failed username probes are unknown rather than confirmed absence. Rejected breach responses cannot become “no breaches.” SSL work in progress and opaque browser port responses remain partial.
- Demonstration output is explicitly labeled DEMO, and excluded from case evidence.

## Security review and source fixes
Pinned osint-tools had no application user authentication and only a request-header timeout, while osint-dispatch validated a user but had separate handlers/provider semantics. The isolated patch adds user-session validation before action execution and shares bounded fetching across the osint-tools handlers. Anonymous publishable keys alone cannot authenticate as users.

The shared helper now validates public IPv4/IPv6 destinations (including mapped IPv4 and expanded IPv6), filters DNS CNAMEs, rejects URL userinfo, validates every redirect, prevents credential-bearing cross-origin redirects, caps bodies, bounds the overall request including DNS/body read, and limits redirects. HTTPS is the default; the existing fixed ip-api.com HTTP exception remains explicitly limited to that host.

Residual limitations requiring release review: DNS checking does not pin the socket address, so generic URL fetches are not proven immune to DNS rebinding. Browser image fetches remain outside the server helper. Public-profile HTTP heuristics cannot establish that similarly named accounts are the same person. Old osint-dispatch remains a separately reachable function for other consumers and retains its original permission/persistence behavior. Server-side plan/permission/abuse enforcement across all gateways was not accepted in this slice. No new providers were enabled and no verify_jwt, RLS, live secrets or live security settings were changed.

## Validation evidence
- **95 tests passed in 7 files**: execution/input mapping, template registry, mixed/unknown/failed/unconfigured/demo states, database errors/counts, explicit entity persistence, editable UI inputs, UI reasons, authentication and fetch defenses, and actual edge-handler failure behavior. Fixtures are deterministic test data, not provider evidence.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json`: passed.
- `npm run build`: passed; existing CSS import-order and large-bundle warnings remain.
- `git diff --check`: passed.
- See evidence/test-results.txt, evidence/typecheck-results.txt, evidence/build-results.txt and evidence/free-provider-smoke.json.

The provider smoke script transpiles and runs the actual isolated osint-tools handler with its real hardened fetch helper. Only the local authentication exchange is replaced with a clearly labeled fixture, and no Supabase persistence is called. Actual free provider traffic is restricted to an explicit allowlist. **This verifies handler/provider data paths, not deployed authentication, production RLS, UI network behavior, or live persistence.**

## Module acceptance matrix
PASS public = actual isolated handler returned validated real provider data. PASS local = actual registry processing of deterministic benign local input. CONTRACT = deterministic behavior checks only, not live-provider acceptance. UNVERIFIED = no real execution in this slice. BLOCKED = observed failure/access requirement.

| Registry ID | Acceptance | Evidence or blocker |
|---|---|---|
| username-search | CONTRACT; live UNVERIFIED | Failed probes stay unknown/partial; HTTP-200 heuristics require further review |
| domain-intel | PASS fixture contract + public negative; full positive BLOCKED | Actual manual/pipeline source aggregation verified; example.invalid remains partial with zero artifacts. Production hosting stays not_configured without any geo request |
| email-header-analysis | PASS local | Benign header fixture; claimed authentication text parsed, signatures not verified |
| image-metadata | PASS byte/parser/manual/pipeline contract; live UNVERIFIED | Real synthetic JPEG/PNG bytes, zero GPS and invalid GPS partial/error paths tested with provenance and bounds. Browser CORS/remote fetch/live persistence remain unaccepted |
| timestamp-decoder | PASS local | 1700000000 produces expected Unix conversion |
| phone-lookup | PASS local metadata | Reserved synthetic +12025550142 correctly yields +1; country/timezones remain unknown when metadata cannot establish them; no provider query |
| ip-geolocation | BLOCKED; unavailable contract PASS | Actual adapter/manual/pipeline retain not_configured, zero provider requests and zero artifacts. No approved commercial HTTPS provider; HTTP exception removed |
| subdomain-enum | BLOCKED | example.com: handler HTTP 500, upstream crt.sh HTTP 502 |
| port-scanner | CONTRACT; network UNVERIFIED | Opaque browser responses remain unknown/partial; no real port probing |
| breach-lookup | CONTRACT; live UNVERIFIED | Provider rejection stays error; no personal breach query |
| url-reputation | BLOCKED; denial CONTRACT passes | Current URLhaus docs require Auth-Key; source omits it. Synthetic denial stayed error; no live request/key creation |
| reverse-image-hash | PASS bounded local decode/hash/manual/pipeline contract; production decoder/live UNVERIFIED | Real Sharp decode of synthetic JPEG/PNG, deterministic/reference hashes and rejected inputs verified. ImageScript runtime is substituted/unaccepted; legacy provenance stays partial |
| hash-identifier | PASS local | Known MD5-length fixture retains multiple candidate algorithms |
| jwt-decoder | PASS local | Synthetic fixture decoded; no claim of signature verification |
| encoder-toolkit | PASS local | hello => aGVsbG8= |
| ssl-inspector | CONTRACT; live UNVERIFIED | READY/grade and IN_PROGRESS status fixtures pass; no assessment started |
| dark-web-search | CONTRACT; live UNVERIFIED | HTTP denial/challenge/unknown pages now fail; recognized empty and positive fixtures pass; no hidden-service request |
| asn-lookup | PASS public | AS15169: HTTP 200, GOOGLE RDAP record and handle |
| wallet-lookup | CONTRACT; live UNVERIFIED | BTC conversion and genuine empty lists pass; HTTP 429/network/malformed subresults retain partial status and null transactions. No account query |
| whois-history | PASS public | example.com: HTTP 200, handle 2336799_DOMAIN_COM-VRSN |
| social-scrape | BLOCKED for this slice | External scraping/AI providers and possible paid usage need approval; no request |
| paste-search | CONTRACT; live UNVERIFIED | Denied/challenge/unknown pages now fail; explicit empty and positive markup fixtures pass |
| cve-lookup | PASS public | CVE-2021-44228: HTTP 200, matching ID, description, CVSS 10 |
| dns-query | PASS public | example.com: HTTP 200, actual seven-record-type Google DoH response |
| geo-reverse | CONTRACT; live UNVERIFIED | Provider error/missing resolved name now fails; positive fixture passes; no actual location/address lookup |
| wifi-bssid | CONTRACT; live not tested | Missing WiGLE fixture stays not_configured; no credential or location query |
| github-recon | CONTRACT; live UNVERIFIED | Manual repository/event failure preserves profile, partial status, source error and unavailable null lists. October 31 paired tests also verify legacy dispatcher repository failures and the user input alias; no person query |
| company-lookup | BLOCKED for this slice | Existing PDL; no paid usage authorized or tested |
| radio-lookup | PASS local | 144 MHz => VHF heuristic; authoritative allocation lookup not claimed |
| fingerprint-analyzer | PASS local | Benign UA => Chrome parsing |
| url-unshorten | PASS public | RDAP.org example.com resolves to registry HTTP 200, correctly reporting one redirect and two requests; bounded/incomplete-chain regressions pass |
| pdl-person-enrich | BLOCKED for this slice | Missing config behavior tested; no paid/person query |
| pdl-person-search | BLOCKED for this slice | Existing integration preserved; no paid/person query |

Total: **33 registry modules; 5 public passes, 8 local passes, 1 observed provider failure, 19 without full acceptance**. The owner's separate 43-marketplace report is not substituted for this pinned registry's acceptance; its reported results remain separately attributed.

Continuation coverage: **all seven reproduced defects are fixed in isolation; 15/15 synthetic cases now pass, and 138 regression tests pass**. Before-fix evidence is preserved. Synthetic transport/auth/decoder substitutions remain explicit and do not add live-provider passes. The public redirect retest now passes with the correct hop count. See ACCEPTANCE-FIXES.md and source fingerprints in the evidence. Original implementation/reconciliation commits are preserved; only the isolated source changed.

At preserved 52cb965, **183 tests passed in 10 files**, including 25 Domain Intelligence cases and 20 Image Metadata cases across manual/pipeline execution. Commercial hosting remains not_configured without egress; real RDAP 404/negative DNS for reserved example.invalid remain partial with zero artifacts. Actual synthetic image bytes preserve GPS 0,0 and retain invalid GPS as partial; errors, bounds and provenance are verified. See COMMERCIAL-IMAGE-ACCEPTANCE.md. Full positive composite, deployed browser/CORS, authentication/RLS and production persistence remain unaccepted. Preserved 3de1e33 evidence contains the earlier 160-test slice.

At preserved 7fc3ed2, **224 tests passed in 12 files**, including 33 image-hash cases and 8 actual React ToolRunner status/save cases. Real local Sharp decoding replaces the previous invented-pixel test adapter, but does not accept ImageScript runtime. The original decoder/hash code exists; it is now bounded/authenticated and returns versioned hashes/source provenance. Legacy results remain partial, and database-denial reasons survive. Local RLS enforcement is blocked by unavailable PostgreSQL/Docker runtime; a source-only standalone case-ownership policy gap needs applied-policy review. See HASH-LOCAL-ACCEPTANCE.md for exact remaining gates. Public/local acceptance totals above are not increased by decoder substitution or jsdom fixtures.

Latest independent ownership slice preserves 7fc3ed2: **239 tests pass in 13 files**, including 15 ownership regressions. Preserved manual/pipeline handlers reproduce the foreign-case row issue with a source-policy repository stub. Both current entry paths now require verified actor/case ownership; failed/incomplete lookups, unrelated users/cases and revocation fail closed with truthful counts/statuses. This is a caller mitigation, not applied SQL/RLS proof or a deployed policy fix. Exact ImageScript is unavailable in existing runtime/dependency inventories and remains unaccepted. See OWNERSHIP-ACCEPTANCE.md for the complete operation/environment/approval matrix. No new public/provider acceptance is claimed.

Owner reconciliation: task 01a12f60-d945-7be2-b888-642048787eda was active during capture and is idle at the final check. Its later Cloudflare source differs from Lovable commit 9a87096. Copied-source fixture replay showed partial/demo results becoming completed runs with case artifacts, and built-in DNS lacking an application auth check. No unauthorized live request was made. The owner separately reports 40/43 handlers and 22 live workflow passes; those were not rerun here. See RECONCILIATION.md and evidence/reconciliation-observations.json for compatibility risks and the selective plan.

Coordination was attempted but not sent. One retry using the supplied transcript evidence was also rejected: auto-review said the purported authorization was embedded in untrusted assistant/tool content rather than a trusted user message. Communication attempts are stopped; direct human authorization remains pending, and no workaround was used.

## Provider references
[Google public DNS JSON/DoH](https://developers.google.com/speed/public-dns/docs/doh) documents that HTTP success can still contain a DNS failure; the handler now checks both.
[Cloudflare DoH](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/) is the fixed public resolver used by the fetch guard.
[NVD API](https://nvd.nist.gov/developers/vulnerabilities), https://rdap.org/, and actual public response URLs are recorded in the smoke evidence.

[URLhaus API](https://urlhaus-api.abuse.ch/) currently requires an Auth-Key header. [REST Countries](https://restcountries.com/) currently documents a v5 bearer-key API; legacy v3.1 availability was not tested and no account/key migration was attempted.

[IP-API terms](https://ip-api.com/docs/legal) limit anonymous service to non-commercial purposes/environments. Full hosting acceptance needs approved commercial entitlement and HTTPS configuration or a reviewed lawful alternative; no actual geolocation request was made here.

## Commit-pinned gateway source review — no new runtime acceptance

Supplied read-only findings for remote commit **3ea92ce99a0dd571bc31c36e01e37aca23547c09** (exact Lovable project above). These line references belong to that remote revision, not the older reconstructed checkout. They were supplied in the delegation and were not independently re-fetched or executed here. No demonstrated exploit, runtime pass, deployment verification or new test result is claimed.

| Route / boundary | Commit-pinned static evidence | Acceptance consequence |
| --- | --- | --- |
| osint-dispatch authorization | supabase/functions/osint-dispatch/index.ts lines 238–250 verifies a user, then calls dispatch without a tool_permissions or case-ownership check in that entry block | User authentication alone does not establish permission for the requested tool/case. Direct-route authorization remains unaccepted |
| osint-dispatch persistence | Same file lines 258–266 writes through the service-role client and ignores the insert result before returning success | Forced persistence failure could be reported as success by this reviewed flow. Case authorization and truthful persistence/status handling need route-level acceptance; this is not a runtime reproduction |
| Manual marketplace-run permission | supabase/functions/osint-tools/index.ts line 3462 calls marketplacePermission; lines 3351–3360 enforce an explicitly false tool_permissions row | A manual backend permission gate exists in the supplied source. Its behavior is not promoted to runtime PASS, and the dispatcher must not be assumed to share it |

Comparison against all **six preserved local patches** found **no patch changing supabase/functions/osint-dispatch/index.ts**. The original pipeline patch changes the local pipeline to use registry/manual execution and checks persistence outcomes there; the ownership patch guards local manual saves/pipelines. Those existing changes already cover caller-side cases and must not be duplicated as new work. They do not establish permission/case checks or checked service-role persistence in the separately reachable dispatcher. None of the six patches adds the supplied remote marketplacePermission gate. That gate already exists remotely and should be reused/reconciled if later authorized, rather than recreated from this source review. No implementation is proposed or performed in this update.

### Proposed synthetic acceptance cases — specified only, NOT RUN

Use two synthetic authenticated non-admin actors A/B, cases owned respectively by A/B, no collaboration grant, a supported fixture tool ID mapped consistently across the routes, a provider call counter and a repository write ledger. Do not use a real provider, service credential, personal target or live record. The dispatcher fixture must explicitly model its elevated writer; ordinary client RLS denial must not be mistaken for a dispatcher ownership check.

| Case | Route and synthetic condition | Required truthful outcome | Current evidence |
| --- | --- | --- | --- |
| GW-DISABLED-M | Manual marketplace-run; A has an explicit allowed=false row for the requested fixture tool | Denied/error with the disabled-tool reason before provider execution or writes; never success/completed | Source gate identified above; NOT RUN |
| GW-DISABLED-D | osint-dispatch; identical actor/tool/false permission row | Same denial, zero provider calls and zero writes; no reliance on manual UI or marketplace-only checks | Entry-block gate absent in supplied review; NOT RUN |
| GW-FOREIGN-M | Manual marketplace-run; A supplies B's case without a grant | Reject unauthorized case association before any provider/case write; no silent foreign-to-standalone fallback | Manual case-ownership behavior not established by supplied permission lines; NOT RUN |
| GW-FOREIGN-D | osint-dispatch; A supplies B's case while the fixture writer can bypass RLS | Explicit case denial before dispatch/elevated write; zero foreign-case rows | Case check absent in supplied entry-block review; local caller guard is not equivalent; NOT RUN |
| GW-PERSIST-M | Manual marketplace-run; authorized A/owned case, synthetic provider success, forced result-insert failure | Expose persistence failure and zero saved rows; error, or explicitly partial if computation is retained; no plain success/completed or saved label | This route's persistence behavior is not established by supplied lines; reuse existing caller-denial fixtures where applicable; NOT RUN |
| GW-PERSIST-D | osint-dispatch; same authorized fixture with service-role insert returning an error | Check the insert result; retain the failure reason, zero saved rows/counts, and error/explicit partial rather than success/completed | Ignored insert result identified above; NOT RUN |

These are route-specific acceptance specifications, not six additional executed tests. Existing registry/provider totals and historical test counts are unchanged. Runtime/dependency acquisition and execution approvals remain pending; owner contact, code changes, integration, security-policy changes and deployment remain unauthorized. This documentation update does not retry any pending or denied action.

## October 26 offline response-contract continuation

Only the isolated checkout changed. `runOsint` now rejects empty objects/arrays; `executeTool` rejects array details and unknown explicit execution statuses and labels explicit demo results. The initial offline replay reproduced five failing assertions (10/15 passed); the final expanded replay passes **22/22 behavioral assertions**. These include characterization assertions that deliberately preserve four failed dispatcher acceptance criteria, so the passing harness is not gateway acceptance.

| Boundary | Newly executed evidence | Acceptance limit |
| --- | --- | --- |
| Actual registry/manual/pipeline source | Matching canonical osint-tools action/input mapping; legacy aliases; success/partial/not_configured/error; empty/array rejection; invalid nested input stops before invocation; SSL IN_PROGRESS remains partial | Supabase SDK/auth/transport/repositories are synthetic; no browser, live gateway or persistence acceptance |
| Actual executeTool source | Array details and unknown explicit status fail; explicit demo is labeled | Three canonical Vitest cases added, but Vitest/full historical suite was not rerun; equivalent actual-source assertions executed in Node VM |
| Preserved isolated osint-dispatch | Disabled permission, foreign case, forced insert error and SSL IN_PROGRESS each still return success; rejected auth stops provider/write; private URL stops transport; unsupported ID remains unknown_tool | Four desired acceptance criteria FAIL. Elevated writer is a fake in-memory repository, not RLS proof. No dispatcher code changed |
| Selected local owner marketplace helpers | False permission, permission-read failure and nested input deny before fake adapter; valid text mapping preserved | Extracted helpers only, with synthetic verified actor/config/adapters. Full HTTP auth/case/persistence workflow and remote 3ea92ce cases remain NOT RUN |
| Owner fetch helper versus isolated guard | Local owner helper admits https://127.0.0.1 to a fake transport once; isolated guard rejects it | Zero sockets. Local snapshot SHA256 8eab297d7e3dde36e372d56061c123c9cad9f8bdd71276d3405e57f8e2df3454; this does not establish later remote/deployed behavior |

Reproduce with existing Node dependencies: `node scripts/verify-offline-contracts.mjs`. Evidence: `evidence/offline-contracts-before.json`, `evidence/offline-contracts.json`, output log and hash-pinned extracted helper snapshot. App TypeScript, targeted lint on the three changed TypeScript files, harness syntax and diff whitespace checks passed; check logs are in `evidence/offline-typecheck.txt` and `evidence/offline-lint.txt`. Node 24.18.0, TypeScript 5.8.3 and Zod 3.25.76 were already present. No network/provider calls, credential use, dependency acquisition, deployment, owner contact or security-setting change occurred. Public/local module totals above are unchanged. Deno/ImageScript and PostgreSQL/Docker setup approvals remain pending; the Aegis-only approval does not authorize Insight setup.

## October 28 release correction evidence

New independent workspace checks: **32/32** captured-owner compatibility assertions and **29/29** actual isolated dispatcher/fetch assertions pass. See `RELEASE-PREPARATION-20261028.md`, `release-prep/20261028/captured-owner/verification.json` and `release-prep/20261028/dispatch-verification.json`. Owner throwing/file/PDL contracts are retained in the prepared candidate. The isolated dispatcher now enforces permission/owner checks before providers and before save, uses user/RLS persistence, reports save failures, keeps unfinished SSL partial and makes no unapproved IP-provider request. Applied SQL/RLS, collaborator write grants and live acceptance remain unverified.

The separate 22-check offline harness now uses existing workspace evidence only and pins legacy gateway characterization to f1143b5; its four expected failure observations describe that preserved baseline. No denied owner-checkout access, installation, live provider call, deployment or security-setting change occurred during this correction. A scoped three-file hash-read approval request was rejected; no retry followed. Current owner compatibility, automated partial/demo artifact handling and production rollback/target verification still block release. Module/public acceptance totals and historical full-suite counts are unchanged.

## October 31 independent GitHub route correction

New paired actual-handler tests found a remaining divergence: manual osint-tools preserved the profile on repository failure, while the separately reachable legacy dispatcher returned success/empty repositories or discarded the profile. Dispatcher also accepted malformed profiles and missed the manual `user` input key. The isolated dispatcher now preserves the profile, returns partial with a source error and `repos: null` for HTTP 429/503, network, invalid JSON and invalid-list responses; genuine empty/positive lists remain successful. Invalid profiles stop extra requests and the `user` alias is accepted. The current pipeline still uses the existing registry/manual path; no pipeline route was changed here.

`node scripts/verify-github-route-parity.mjs`: **10/10 new paired scenarios pass**, versus **3/10 before**. Both actual edge handlers and the actual fetch guard execute in Node VM with synthetic identity, SDK/persistence and transport. Response and saved statuses, preserved profiles, null versus empty lists, HTTP failure reasons and stopped requests are asserted. Source hashes and separate before/after results are under `evidence/github-route-parity-20261031/`. Targeted dispatcher lint passed. No previously exhausted suite was rerun, and no live provider, owner-checkout, credential, setup, policy or deployment operation occurred. Live module acceptance and existing release gates are unchanged.

## October 31 captured partial/demo artifact candidate

Independent captured-source preparation now prevents partial/demo outputs from becoming pipeline or agent case artifacts. It preserves step/run statuses, DEMO labels, confirmed insert counts and save failures, and updates the captured pipeline history/feedback handler. The original manual executeTool throwing and input/file contracts are retained through an automated-execution adapter. Active application and denied owner sources are unchanged.

**30/30 new engine/feedback scenarios pass** with the original captured helper, and **30/30 pass** with the prior response compatibility patch; the baseline passed 5/30 criteria. These are two dependency variants of the same 30 scenarios, not 60 distinct tests or additional live acceptance. Focused engine/helper TypeScript, helper lint, script syntax and patch application to captures pass. Exact scope, hashes and evidence: `release-prep/20261031/artifact-outcomes/README.md`. No old full suite was rerun. No owner access, provider traffic, credentials, installation, policy mutation or deployment occurred. Current-owner reconciliation, uncaptured agent UI consumers, full browser/build, applied policies and release/rollback gates remain unverified.

## November 1 upstream PR #3 static integration check

Read-only GitHub inspection confirms open draft [PR #3](https://github.com/NexusInsights/dark-trace-loom/pull/3) at **3a4bd4de5e531140fc827a8ea3106092bf748681** (base 3ea92ce), with **Source validation run 41254168955 successful**. No inspected core outcome/GitHub file is changed by that PR. The head still has unconditional completed/count behavior, unguarded agent artifact creation, missing outcome/execution helpers and old GitHub empty-on-failure semantics in both provider paths. The preserved 503b43b, 0b23727, cfb2165 and f1143b5 behaviors are missing from the inspected source; CI success does not promote them to integrated or live acceptance.

`package.json` and `src/test/setup.ts` overlap historical isolated work. Test setup is byte-identical; package content differs and needs selective reconciliation. Upstream config changes must also be preserved. Original owner/active writer could not be established (PR author tjksecurity alone is insufficient). See `UPSTREAM-RECONCILIATION-20261101.md` and its pinned source evidence. No source changed or executed, no test was rerun, no denied access was retried and no upstream mutation/deployment occurred. Historical fixture counts, preserved patches and module live-acceptance totals remain unchanged.

## Release blockers
1. Active source owner must reconcile this patch with the later local marketplace/security/PDL edits. Do not apply a full replacement to their live checkout.
2. Deployment/publication and any security-sensitive live settings or credentials require the user's approval; no such action was taken.
3. Deployed session authentication, RLS/case permissions, persistence and the actual manual/pipeline UI network workflow require a signed-in acceptance run after reconciliation.
4. crt.sh currently returned HTTP 502; retry with bounded frequency, retaining the error if still unavailable.
5. New/paid providers and remaining marketplace modules need separately approved provider access and module-specific acceptance criteria.

See CONTINUATION.md for the scheduled next-step record.
