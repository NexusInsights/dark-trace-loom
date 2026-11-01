# Evidence workbench integration

`EvidenceWorkbenchPanel.tsx` is portable React/Tailwind and imports only the adjacent evidence core/format modules. It has no Supabase, authentication, model, credential, provider-network or UI-library import. Its ledger stays in component memory until an explicit scoped save callback succeeds.

```tsx
<EvidenceWorkbenchPanel
  key={`${contextKey}:${user.id}`}
  contextKey={contextKey}
  contextLabel={selectedInvestigationName}
  actor={user.id}
  disabled={authOrPlanOrUsageVerificationFailed}
  reason={unavailableReason}
  canExport={permissions.canExportReports}
  canImportFiles={permissions.canUploadArtifacts}
  loadLedger={loadSelectedOwnedContextLedger}
  saveLedger={permissions.canSaveInvestigations ? saveSelectedOwnedContextLedger : undefined}
  importSavedEvidence={importSelectedOwnedPersonaEvidence}
  lookupOrganization={lookupExactPublicLEI}
/>
```

The parent owns real authorization, selected-record ownership, plan/usage checks, case storage and the public organization connector. Callback contracts:

- `contextKey:string` is a stable case-scoped ID, e.g. `research-default` or `persona:<uuid>`. IDs accept letters/digits, `. _ : -`, with 160 characters maximum. `actor` is the authenticated user ID. The component also keys its internal state on context+actor, discards pending results on unmount/context change and checks a loaded/imported ledger's case ID before replacement.
- `loadLedger?:()=>Promise<unknown|null>` returns a ledger object/JSON or null for this exact owned context. It runs only on the Load button. A failed load leaves local evidence intact and blocks cloud save until a successful retry. Existing local changes require explicit replacement consent before loading a saved ledger.
- `saveLedger?:(ledger)=>Promise<void>` runs only with a supplied callback, a successful prior load, an explicit reviewed-data checkbox and a ledger no larger than 100,000 UTF-8 bytes. Omit the callback when the current plan cannot save investigations. The parent must recheck ownership and current saved state; a UI guard cannot provide database authorization or concurrency control. An uncertain save blocks another save until a fresh load.
- `importSavedEvidence?:()=>Promise<normalizedIngestInput[]>` returns only selected, owned source records translated to the core contract. It is an explicit button, limited to 100 inputs and atomic in local UI state on failure. Do not include unrelated contacts, password inputs, private EML bodies, browser fingerprints or other panels' private inputs.
- `lookupOrganization?:(lei:string)=>Promise<normalizedIngestInput>` receives one normalized 20-character LEI and returns the selected public business fields with a source. The successful result is actually ingested, not only displayed. No person/contact search is performed by the component. The parent chooses and verifies the real licensed/public provider route.
- `canExport?:boolean=false` gates every file download. `canImportFiles?:boolean=false` gates JSON/MHTML/bundle/original-file selection and processing. Typed local JSON inspection stays available unless globally disabled. Revoked permissions invalidate pending results. `disabled?:boolean=false` and `reason?:string` let the parent fail closed on account/plan/usage errors.

Callbacks have no AbortSignal in the assigned contract. FileReader work aborts on cancel; generation guards discard late callback results. The UI explicitly states that already-started server callbacks may still finish. Save has no misleading Cancel button. Callback implementations should impose their own timeouts/authorization and avoid paid retries.

Full-ledger JSON import replaces local state only after explicit replacement consent and a matching context/digest check. Normalized sources append observations and preserve conflicts. Claim review requires a reason, with counterevidence IDs. Manual identity decisions require compatible existing entities; accepted links require evidence and can be revoked. Originals are never merged away. The graph has click/keyboard-selectable edges and an accessible relationship selector; the timeline never substitutes retrieval time for missing event dates.

Exports include case JSON, readable Markdown, safe CSV, Maltego identity-preserving tables, bounded GEXF, FtM, PROV-JSON, appropriate STIX cyber observations and a ten-file bundle. The bundle is a single `evidence-file-bundle/v1` JSON container with `manifest` and text `files`, so it downloads without an archive dependency or multiple-download prompts. It omits original captured bytes, clearly labeled. The verifier accepts the downloaded container or a standalone manifest plus files, detects altered/missing/extra bytes and can check a separately retained digest.

The Hunchly importer reads documented Data Forwarding JSON and optionally verifies supplied original MHTML bytes. Forwarded HTML and original MHTML have distinct hashes. Capture content is never inserted as HTML or executed. Import status explicitly says offline format integration and does not claim vendor account/client acceptance.

Verification: `EvidenceWorkbenchPanel.test.tsx` exercises source import/review/counterevidence/edge citations, match acceptance/revocation, failed-load overwrite prevention, scoped explicit save, context changes, permission revocation/cancelled late results, full-ledger replacement, saved-source/organization callbacks, actual FileReader JSON/MHTML import, downloaded bundle tampering, cloud size limits and hostile JSON/error isolation. The adjacent `evidence-core.test.mjs` must run via `node --test`, not Vitest. See `EVIDENCE_API.md` for the domain and file-format details.

Actual installed-Chrome component QA uses isolated synthetic callbacks only, with desktop/mobile screenshots and a real bundle download/file reupload. Its harness and evidence are outside the app at `D:\CodexProjects\osint-expansion-20261101\evidence`. This validates the rendered component workflow, not production authentication, cloud persistence or the real organization provider. Those remain parent integration checks.
