# Original platform workflow and evidence repair

Current user request: review the entire original site and make discovery/results evidence-based, without presenting generated usernames as findings. Prior live-repair and deployment intent remains relevant. No new credentials, paid providers, installations, access changes, migration or personal investigation is authorized by this implementation.

## Identity and current release status

- Original full platform observed live at https://dark-trace-loom.lovable.app/dashboard, with Tool Suite, Marketplace, Agents, Pipelines, Personas and graphs.
- Public original-site editor badge points to `lovp_5fb8eexjna99erp4exs56xbgyc`; historical authorized project is `ddb190d3-9e1f-408e-9b17-113c51f6576f`. Current connector reads for both return internal errors, not a verified new identity mapping. The in-app editor route requires sign-in; no existing exact-project Edge tab was available. No denied backend route was retried.
- Appropriate repository: https://github.com/NexusInsights/dark-trace-loom. Remote main was verified at `9546fc851c8f2605c9f4bfcedfdb9b990cfc6a86` at the beginning of this repair.
- This isolated worktree started from repaired source/documentation `6e8a6f70cf917840068a62b163440aba0efe6572`, branch `codex/original-evidence-workflow-20261104`. It preserves the later research/person workspace and retained safety repairs; it does not wholesale replace them with old main.
- Last completed Cloudflare production release remains `a2e6328b-b45a-47b5-9a34-d9d11d2fc114`, application source `750ec469`, at https://dark-trace-loom.pages.dev. This workflow repair is **not yet deployed** at this checkpoint.
- Compatible release target is the existing Cloudflare app with both frontend assets and the updated `/api/profile-search` Pages Function. Restoring the original full navigation there keeps the person workspace separately named. This must not be described as updating the original Lovable URL.
- Preserve production backend `zisrsttmjeipkmllqubi` and independent staging `ocliymtdvtxfxczxgbjr`; no rebind or migration is part of this repair. The ready export notification alone does not verify bucket objects or backend compatibility.

## Implemented boundaries under integration

1. Restore original full routes/navigation and original case/report contracts; keep person/research sections and compatible bookmarks.
2. Exact source accounts carry stable IDs, source URLs and retrieval timestamps. Exact profile URL seeds and explicit provider-reported outbound account links replace invented handles; one-hop follow-up uses only existing fixed-host providers with bounds.
3. Inputs remain leads. Matching handles, generated candidates, generic text extraction and provider enrichment suggestions cannot automatically become person identity findings.
4. Analyst-supported associations require a retained fresh lookup and explicit review with a source and explanation. These remain analyst assessments, not independent identity verification.
5. Later rejection/unreviewing revokes current findings and derived graphs/scores/reports. Historical records are preserved. Deleted/foreign personas and stale score provenance are being checked before release.
6. Legacy identity expansion has no data provider. Its client entry point now refuses to run it; its source handler returns truthful `not_configured` without invented writes. This does not claim the repaired Supabase handler has been deployed.
7. Original discovery UI removes generation actions, separates source observations/reviews, and keeps old guesses visibly excluded from findings. Report and graph consumers retain evidence classifications and limitations.

## Evidence so far, not aggregate or deployed acceptance

- Original live navigation: `evidence/original-live-navigation-before.json`, 24 menu destinations observed read-only. This does not establish that their tool actions work. Private contents/counts omitted.
- Routes/navigation: 59 focused synthetic tests passed.
- Profile API/client/registry: 93 focused synthetic tests passed; no auth/database live acceptance implied.
- Core identity admission: 32 focused synthetic tests passed before additional owned-persona/stale-score/dashboard integration changes. Initial 17 cases reproduced 11 failures.
- Legacy expansion guard: 20 focused synthetic tests passed.
- Root discovery/review UI: 25 focused synthetic tests passed before the final stable-account rename review adjustment; rerun during integration.
- Graph/correlation and report provenance tests are separately recorded; platform/timeline and derived-cluster/dashboard integration are still being finalized. Do not sum overlapping suite counts as unique total coverage.
- Two bounded real public seed API reads returned GitHub mascot `github:583231` and DEV organization `dev:3`; see `evidence/public-profile-benign-live-20261104.json`. Neither returned a supported outbound link. This is real retrieval evidence, not live person association, authenticated app persistence or live link-following acceptance. Final stricter validation was subsequently fixture-tested.

## Integrated validation checkpoint

All product writers have released their files. Final suite components passed: app 1,328/1,328 in 103 files; worker36, Cloudflare19, client15, SQL11, research117, monitors23 and ownership1; dispatcher37 and GitHub parity10. The initial `npm test` stopped at a research DKIM vendored-copy guard because Git converted checkout files to CRLF. The corrected guard accepts only the CRLF/LF checkout transformation, retains raw installed SDK hash validation, and rejects eight kinds of real drift. The full research suite was rerun and passed117/117. Remaining suites were executed independently and passed. Final full lint and TypeScript exit0. Final Discovery navigation fixtures passed3/3 after adding its explicit next-step link; subsequent Identity Review changes were button/empty-state wording only.

Raw logs and fresh production configuration read are preserved in sibling `insight-nexus-original-release-20261104`. The guarded source receipt will bind this work to the final clean commit before build. These results are synthetic/offline coverage, except for the separately described two benign public API retrievals and original navigation reads.

## Remaining release work

Run the production build with unchanged approved public backend bindings. Preserve rollback, commit/back up to the appropriate non-production branch, verify exact-SHA CI, then use only the established authorized release route. Verify the actual authenticated source-observation/review workflow with a clearly labelled benign fixture and retain failures truthfully. Do not infer production function equality, applied RLS, private export integrity, or complete provider acceptance from source tests.

Previous backend permission/RLS/safe-fetch/persistence and exact Deno/ImageScript acceptance gates remain separate; no denied route, credential scope or installer may be used as a workaround.
