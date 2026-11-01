import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = resolve(root, 'docs/research/person-methods.md');
const text = await readFile(source, 'utf8');
const status = {
  1: ['partial', 'Explicit source/processing authorization is built; purpose and permissible-use decisions remain human responsibilities.'],
  2: ['partial', 'Original labels and identifiers are preserved. Automated multilingual variant generation is not implemented.'],
  3: ['planned', 'A full, versioned Unicode confusables implementation is not included.'],
  4: ['implemented', 'Evidence-backed manual match decisions, rejection and revocation; identities are never automatically merged.'],
  5: ['approval_required', 'An SEC connector is a documented candidate, not a connected data source.'],
  6: ['approval_required', 'Companies House account/API authorization is required before integration.'],
  7: ['manual', 'Use the official registry and import authorized source evidence. No SOSDirect automation is claimed.'],
  8: ['implemented', 'An authenticated, quota-controlled exact-LEI GLEIF lookup can import minimal legal-entity observations.'],
  9: ['manual', 'Issuer-specific licence verification is not inferred from names or other professional IDs.'],
  10: ['planned', 'No NPI query is connected; an NPI would not establish a licence.'],
  11: ['approval_required', 'Use approved issuer routes; automated FINRA/IAPD dataset access is not connected.'],
  12: ['approval_required', 'NMLS automation requires its own permitted access.'],
  13: ['approval_required', 'ORCID public-file and commercial API rights are separate; no API account is connected.'],
  14: ['planned', 'Crossref author-context automation is not connected.'],
  15: ['planned', 'ROR institution reconciliation is a documented candidate.'],
  16: ['planned', 'NSF/NIH project-role connectors are not connected.'],
  17: ['approval_required', 'Current USPTO account/API access must be approved.'],
  18: ['planned', 'VIAF normalization is not connected.'],
  19: ['planned', 'No sanctions matching or adverse-decision automation is implemented.'],
  20: ['planned', 'Jurisdiction-specific list ingestion is not connected.'],
  21: ['approval_required', 'SAM credentials and current dataset permissions are required.'],
  22: ['manual', 'An issuer match must be reviewed; no private identifier collection is enabled.'],
  23: ['manual', 'Use official decisions and authorized evidence imports.'],
  24: ['approval_required', 'PACER requires an approved account and retrieval budget; no paid fallback is enabled.'],
  25: ['partial', 'Source-linked court evidence and timelines exist. Automated disposition reconciliation is not implemented.'],
  26: ['approval_required', 'RECAP/CourtListener access and any paid retrieval remain separate approvals.'],
  27: ['manual', 'Agency request submission and fees are not automated.'],
  28: ['approval_required', 'Issuer or contracted verification is required; no education service scraping is enabled.'],
  29: ['planned', 'A credential issuer/trust/status verifier is not implemented.'],
  30: ['partial', 'Authorized page/RSS evidence capture is available. A captured biography remains a source assertion.'],
  31: ['existing', 'The existing application has OCR tools; this work does not install new model assets.'],
  32: ['partial', 'Existing document tools remain. No new Tika server or broad parser service is claimed.'],
  33: ['planned', 'Document-certificate/revocation verification is not implemented.'],
  34: ['partial', 'Event dates and capture time are distinct; unknown dates stay undated. Approximate interval reasoning is not implemented.'],
  35: ['implemented', 'Typed observations/claims retain source evidence, counterevidence and review history; PROV export is available.'],
  36: ['partial', 'SHA-256 manifests, Hunchly MHTML verification and auditable captures are built; a WARC recorder is not included.'],
  37: ['implemented', 'The existing durable monitor supports approved source baselines, meaningful differences, stale/failed coverage and opt-in scheduling.'],
  38: ['implemented', 'Review/correction history, reversible matches, integrity tests and portable evidence bundles are built.'],
};
function cells(line) {
  const result = []; let value = ''; let code = false; let escaped = false;
  for (const char of line.trim().slice(1, -1)) {
    if (escaped) { value += char; escaped = false; continue; }
    if (char === '\\') { escaped = true; value += char; continue; }
    if (char === '`') code = !code;
    if (char === '|' && !code) { result.push(value.trim()); value = ''; } else value += char;
  }
  result.push(value.trim()); return result;
}
const methods = []; let category = '';
for (const line of text.split(/\r?\n/)) {
  if (/^## /.test(line)) category = line.slice(3).trim();
  if (!/^\|\s*(?:\*\*)?\d+\.\s+P[012]/.test(line)) continue;
  const row = cells(line); const match = /^(\d+)\.\s+(P[012])\s+(?:[—-]\s+)?(.+?)(?:\.\s+|$)(.*)$/.exec(row[0].replaceAll('**', ''));
  if (!match || row.length !== 3) throw new Error('Unexpected method research table shape. Review the source before generation.');
  const id = Number(match[1]); const state = status[id];
  if (!state) throw new Error(`Missing implementation assessment for method ${id}.`);
  methods.push({ id, priority: match[2], title: match[3].trim(), category, method: match[4], automation: row[1], acceptance: row[2], implementation: state[0], implementationNote: state[1] });
}
if (methods.length !== 38 || new Set(methods.map(row => row.id)).size !== 38 || methods.some((row, index) => row.id !== index + 1)) throw new Error('The complete reviewed 38-method inventory was not parsed.');
const data = { asOf: '2026-11-01', scope: 'Public professional/legal-entity evidence and authorized record verification; no real-person search was performed for this research.', methods };
await mkdir(resolve(root, 'src/features/research'), { recursive: true });
await writeFile(resolve(root, 'src/features/research/methods-catalog.mjs'), `// Generated from the reviewed primary-source report by scripts/build-research-catalog.mjs.\nexport const researchCatalog = ${JSON.stringify(data, null, 2)};\n`, 'utf8');
await mkdir(resolve(root, 'public/research-resources'), { recursive: true });
for (const file of ['person-methods.md', 'platforms.md']) await copyFile(resolve(root, `docs/research/${file}`), resolve(root, `public/research-resources/${file}`));
console.log('Generated the complete 38-method catalog and two source-backed research downloads.');
