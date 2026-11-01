# Evidence domain and documented-format integrations

Independent, portable JavaScript for both existing apps. Production modules use only Web APIs (`TextEncoder`, `URL`, `crypto.subtle`, `crypto.randomUUID`) and have no network, filesystem, storage, model, vendor SDK, or credential dependency. Node 24 and current browsers are supported. This is LOCAL implementation/fixture validation; it grants no product account or provider entitlement.

## App contract

```js
import {
  createLedger, ingestEvidence, reviewClaim, reviewMatch,
  buildGraph, buildTimeline, evidenceSummary, findConflicts,
  createCaptureManifest, verifyCaptureManifest, verifyLedger,
  importLedgerJSON,
} from './evidence-core.mjs';
import {
  importHunchlyCapture, exportCaseJSON, exportCSV, exportMarkdown,
  exportMaltegoCSV, exportFtM, exportGEXF, exportPROV,
  exportSTIX, exportEvidenceBundle,
} from './evidence-formats.mjs';

let ledger = createLedger({
  caseId: 'case-1', title: 'Case evidence',
  createdAt: '2026-11-01T12:00:00.000Z',
});
ledger = await ingestEvidence(ledger, {
  source: {
    id: 'source-record-1', label: 'Uploaded synthetic record',
    url: 'https://example.invalid/source', provider: 'upload',
    independence: 'unknown',
  },
  entities: [{ id: 'entity-1', type: 'Company', label: 'Synthetic company' }],
  observations: [{
    id: 'observation-1', entityId: 'entity-1', property: 'name',
    value: 'Synthetic company', eventTime: null,
    capturedAt: '2026-11-01T11:00:00.000Z',
  }],
  claims: [{
    id: 'claim-1', subjectId: 'entity-1', predicate: 'name',
    value: 'Synthetic company', evidenceIds: ['observation-1'],
  }],
}, { actor: 'current-authenticated-user-id', at: '2026-11-01T12:00:00.000Z' });
```

The returned state is plain JSON: `schema:'evidence-ledger/v1'`, `schemaVersion:1`, `caseId`, `title`, `createdAt`, and arrays `sources`, `entities`, `observations`, `claims`, `reviews`, `artifacts`, `audit`. Mutators return a new ledger and never modify the original; validation failure throws `EvidenceError` with a stable `code` and a bounded non-secret message. The caller must catch errors and retain its prior state.

The app must use its existing authenticated case authorization for persistence and server actions. These functions do not authenticate an actor string and are not a substitute for RLS, server permissions, safe storage, or optimistic concurrency. Persist the latest audit head separately as a checkpoint, and reject a stale state on the server before writing. An authenticated user saving two concurrent copies must not silently overwrite the newer revision.

Translate existing normalized source objects at the call boundary: existing source ID -> `source.id`, title -> `source.label`, canonical URL -> `source.url`, provider -> `source.provider`, exact normalized findings -> observations, and explicit extracted assertions -> claims. The importer does not fetch a URL or infer arbitrary entity types from names. Source IDs should identify a source record/version, not merely an entire provider. Entities require case-scoped stable IDs, not lower-cased names. Entity labels/identifiers are labels, not separately verified facts.

## Inputs and model semantics

- IDs: 1–160 ASCII letters/digits plus `. _ : -`, starting with a letter/digit. Entity types: `Person`, `Organization`, `Company`, `Domain`, `IPAddress`, `EmailAddress`, `URL`, `Document`, `Event`, `Account`, `Wallet`, `Location`, `File`, `Other`.
- Source fields: `id,label,url?,provider?,publisher?,independenceGroup?,independence?`. Independence is `unknown` by default, or an analyst-declared `independent` / `shared_origin` with an explicit group. Mirrors sharing an origin group do not become extra declared independent groups. The core does not verify independence or calculate identity probabilities.
- Observation fields: `id?,entityId,property,value,eventTime?,capturedAt?,artifactId?`. Values are bounded JSON scalars. Missing/null is not “no result”. Default IDs hash source ID, entity, property, value, event date and artifact reference. Capture time is excluded from identity so repeat retrieval does not inflate evidence counts. Provide explicit versioned source/observation IDs when a new capture is meaningful.
- Claim fields: `id?,subjectId,predicate,objectId? | value,evidenceIds,counterEvidenceIds?`. Exactly one object reference or literal value is required. All claims start `unreviewed`; an imported source cannot set acceptance status. Supporting and counterevidence IDs must exist and be distinct.
- Dates: `eventTime` accepts a strict ISO `YYYY-MM-DD` or a timestamp with explicit timezone. Stored event time is `{value:UTCISO,precision:'day'|'timestamp'}`. `capturedAt` is a separate zoned timestamp. Unknown event dates stay null. Timeline never substitutes capture, ingestion, case creation or retrieval time.
- Limits: JSON 4 MiB, per-import 1 MiB, 1,000 sources, 2,000 entities, 5,000 observations, 3,000 claims, 5,000 reviews, 200 artifacts, 10,000 audit entries; depth/item/string bounds also apply. Failures leave the prior state intact. No XML importer exists; XML input is rejected as JSON rather than parsed, so external entities are never resolved.

Repeated identical imports return the same data and do not reset reviews. Reusing an ID with different content fails explicitly. Preserve contradicting values as separate observations, then use `findConflicts(ledger)`; its findings can reflect disagreement or real change over time, so they are not automatic fraud flags.

## Review and exploration

```js
ledger = await reviewClaim(ledger, 'claim-1', {
  decision: 'accepted', // accepted | rejected | needs_review
  reason: 'Reviewed the cited synthetic filing',
  counterEvidenceIds: [], actor: currentUser.id,
});
ledger = await reviewMatch(ledger, {
  leftId: 'person-a', rightId: 'person-b',
  decision: 'accepted', // accepted | rejected | revoked
  reason: 'Specific supporting evidence reviewed by the investigator',
  evidenceIds: ['observation-a'], counterEvidenceIds: ['observation-b'],
  actor: currentUser.id,
});
```

Matches never destructively merge records, and identical names/aliases do not generate automatic matches. Acceptance requires cited evidence and a meaningful reason; `revoked` requires a currently accepted pair. `activeMatches` returns the latest accepted decisions. Reviews retain reasons, actor/time, evidence and counterevidence. Claim acceptance can be returned to `needs_review` or rejected without altering observations.

`buildGraph(ledger,{maxNodes=200,maxEdges=400,maxHops=2,seedIds?,includeEvidence=true,sourceIds?})` returns `{nodes,edges,totalNodes,totalEdges,omittedNodes,omittedEdges,truncated}`. Maximum bounds are 500 nodes, 1,000 edges and five hops. Nodes have `id,recordId,kind,type,label`; IDs are namespaced `entity:…`, `claim:…`, `observation:…`, `source:…`. Edges have `id,source,target,type,kind` and optional review/evidence references. It includes explicit `supported_by`, `countered_by` and `documented_by` edges. Relation direction is preserved; hop exploration treats adjacency as undirected purely for navigation. Omission counts are visible. With `includeEvidence:false`, only entity relations and active manually accepted identity edges are shown.

`buildTimeline(ledger,{limit=200})` returns dated entries, `undatedIds`, total/omitted counts and an explicit date semantics note. `evidenceSummary(ledger,claimId)` returns support/counterevidence and source declarations, without an accuracy score.

## Custody and integrity

`createCaptureManifest(files,{actor,capturedAt?,sourceUrl?})` accepts files `{path,bytes,mediaType?,sourceUrl?,capturedAt?}`; bytes are text, `Uint8Array` or `ArrayBuffer`. Safe relative paths only; maximum 100 files, 16 MiB each and 32 MiB total. It hashes the exact bytes, then hashes canonical manifest metadata. `verifyCaptureManifest(manifest,files,{expectedDigest?})` detects byte changes, changed manifest metadata, missing/extra files and checkpoint mismatch.

`attachCaptureManifest` stores metadata only, with an audit record. It verifies the manifest's digest, not absent original bytes. Observations may link `artifactId` to the attached manifest. `verifyLedger(ledger,{expectedHead?})` verifies audit chain, final snapshot, attached manifest digests and an optional separately retained head. `importLedgerJSON` performs strict validation and integrity checks before returning imported state.

SHA-256 chains detect alteration against retained checkpoints. An attacker able to replace both content and all digests can recalculate them. These are not trusted timestamping, digital signatures, proof that the website told the truth, proof of who captured it, court admissibility, or immutable storage. Original files must be retained and verified separately; server permissions and a protected checkpoint provide the independent boundary.

## Documented format integrations

| Function | Output and verified scope |
|---|---|
| `importHunchlyCapture(ledger,json,{actor,deviceId,mhtmlBytes?,at?})` | `{ledger,capture,integration,warnings}`. Strict documented Data Forwarding JSON fields; namespaces device/case/page/hash. Hunchly's supplied hash is the **local MHTML** hash; only supplied matching MHTML bytes set `originalBytesVerified:true`. Forwarded HTML has its own separate hash. Captures stay undated because capture time is not an event date. JavaScript is never executed. Unknown fields/unsafe keys and oversized input fail. Offline fixture integration; no Hunchly account/application connection tested. |
| `exportCaseJSON` / `exportCSV` / `exportMarkdown` | Complete case JSON; observation/claim/review tables; readable source-linked report. JSON escapes HTML-significant characters; CSV quotes fields and prefixes formula-leading values. Render the report as escaped text/sanitized Markdown using the existing app renderer. Never inject source HTML into the DOM. |
| `exportMaltegoCSV` | `{entitiesCSV,linksCSV,mapping,warning,integration}`. Uses `maltego.Phrase` with stable case ID as Value, plus DisplayName and SemanticType properties; links refer to EntityID. This avoids standard Person name matching collapsing distinct records. Import with explicit tabular mapping. Conversion to vendor standard entity types is an intentional additional resolution step. No native .mtgx format or licensed-client acceptance is claimed. |
| `exportGEXF` | `{xml,truncated,omittedNodes,omittedEdges}`. Static directed GEXF 1.3 graph, encoded XML attributes, explicit limits. Sources/evidence are included by default. No XML/DTD/entity parsing occurs. |
| `exportFtM` | `{entities,ndjson,skipped,warning}`. Bounded Person/Organization/Company/Document/Event mapping and accepted `owns` -> Ownership relations with supported endpoints. Property arrays, source URLs and clear notes; no inventing a schema for IP or user-account records. Case JSON retains richer review/counterevidence semantics. Every skipped entity/claim is reported. |
| `exportPROV` | PROV-JSON document with entity/activity/agent, derivation/generation/association records and explicit audit digests; custom `case:` attributes preserve review and event-date distinctions. Follows the W3C **Member Submission**, not a W3C certification or recommendation claim. |
| `await exportSTIX(ledger,{generatedAt?})` | `{bundle,skipped,warning}`. STIX 2.1 observed-data plus supported IPv4/IPv6/domain/email/URL/file-hash SCOs only. Uses normative namespace/UUIDv5 contributing properties for SCO IDs and separate UUIDv4 SDO IDs. Requires actual precise event timestamp; unknown/date-only capture times are skipped. Each observation remains one source observation, not a fabricated aggregate count. Person/organization/identity claims are never fake SCOs. |
| `await exportEvidenceBundle(ledger,{actor,generatedAt?})` | Ten text files + exact-byte capture manifest, format warnings/skips and explicit `originalArtifactsIncluded:false`. Includes JSON, human report, CSV, Maltego tables, FtM, GEXF, PROV and STIX. The caller provides existing download/archive/persistence UI. No archive dependency is introduced. |

Hash validation and offline format round-trip/structural tests are implemented. Product-specific client acceptance remains unverified without an installed/licensed product. No claim is made that a restricted vendor account, third-party data license or automatic monitoring has been activated.

## Primary specifications and attribution

These modules are independently authored. Vendor names identify documented compatibility targets; no vendor proprietary code was copied. No endorsement is implied.

- Hunchly: [Data Forwarding schema](https://support.hunch.ly/article/67-2-hunchly-data-forwarding), [MHTML hashing limitations](https://support.hunch.ly/article/52-2-content-photo-and-attachment-hashing).
- Maltego: [tabular graph export and EntityID connectivity](https://docs.maltego.com/en/support/solutions/articles/15000010799-export-graph-to-table), [license](https://www.maltego.com/license-agreement/). The adapter does not grant Maltego/data-provider usage or resale rights.
- FollowTheMoney: [Person model](https://followthemoney.tech/explorer/schemata/Person/), [Ownership model](https://followthemoney.tech/explorer/schemata/Ownership/), [MIT project license](https://github.com/alephdata/followthemoney). The model is distinct from access to OCCRP hosted data.
- GEXF: [1.3 specification](https://gexf.net/1.3/).
- W3C: [PROV-JSON Member Submission](https://www.w3.org/submissions/prov-json/).
- OASIS: [STIX 2.1 specification](https://docs.oasis-open.org/cti/stix/v2.1/stix-v2.1.html).

## Verification commands

```text
node --check evidence-core.mjs
node --check evidence-formats.mjs
node --test evidence-core.test.mjs
```

Tests use synthetic names, reserved example domains, documentation IP ranges and local bytes. They make no provider/person request. The suite covers full import/review/export/reload, false merges, conflicts, duplicate inputs, shared source origins, review revocation/counterevidence, date precision, graph bounds, independent cryptographic checks, tamper detection, CSV formula injection, prototype/accessor/XML input rejection, import limits and Hunchly original-byte verification. App/UI integration, case authorization and persistence are separate root-owned acceptance checks.
