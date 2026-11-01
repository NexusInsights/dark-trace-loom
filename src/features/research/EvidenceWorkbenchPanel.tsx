import { useEffect, useMemo, useRef, useState } from 'react';
import { activeMatches, buildGraph, buildTimeline, createLedger, evidenceSummary, findConflicts, importLedgerJSON, ingestEvidence, parseEvidenceJSON, reviewClaim, reviewMatch, safeJSONStringify, verifyCaptureManifest, verifyLedger } from './evidence-core.mjs';
import { exportCaseJSON, exportCSV, exportEvidenceBundle, exportFtM, exportGEXF, exportMaltegoCSV, exportMarkdown, exportPROV, exportSTIX, importHunchlyCapture } from './evidence-formats.mjs';
import type { EvidenceConflict, EvidenceGraph, EvidenceLedger, EvidenceMatchReview, EvidenceTimeline, EvidenceVerification } from './evidence-types';

export type { EvidenceLedger } from './evidence-types';
export interface EvidenceWorkbenchProps {
  contextKey: string;
  contextLabel?: string;
  actor: string;
  loadLedger?: () => Promise<unknown | null>;
  saveLedger?: (ledger: EvidenceLedger) => Promise<void>;
  importSavedEvidence?: () => Promise<unknown[]>;
  lookupOrganization?: (lei: string) => Promise<unknown>;
  canExport?: boolean;
  canImportFiles?: boolean;
  disabled?: boolean;
  reason?: string;
}
type Operation = { generation: number; controller: AbortController };
type CloudState = 'unchecked' | 'loaded' | 'empty' | 'failed';
const inputClass = 'mt-1 w-full min-w-0 rounded border border-input bg-background px-3 py-2 text-sm disabled:opacity-50';
const buttonClass = 'rounded border border-border bg-background px-3 py-2 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50';
const boxClass = 'min-w-0 rounded-lg border border-border bg-card p-4 space-y-3';
const jsonLimit = 1024 * 1024;
const cloudLimit = 100000;
const bundleLimit = 32 * 1024 * 1024;
const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;
const hasEvidence = (ledger: EvidenceLedger) => ledger.observations.length > 0 || ledger.claims.length > 0;
const clone = (value: EvidenceLedger): EvidenceLedger => JSON.parse(JSON.stringify(value));
const ids = (text: string) => text.split(',').map(item => item.trim()).filter(Boolean);
const displayValue = (value: unknown) => value === null ? 'unknown' : String(value);
const safeMessage = (failure: unknown, fallback: string) => {
  const error = failure as { name?: string; code?: string; message?: string };
  if (error?.code === 'CANCELLED') return 'Pending work cancelled. An already-started server request may still finish; its late result will not enter this workbench.';
  if (error?.code === 'TIMEOUT') return 'This operation timed out. Current local evidence is retained.';
  if (error?.name === 'EvidenceError' && typeof error.message === 'string' && error.message.length <= 500) return error.message;
  return fallback;
};

function readFile(file: File, kind: 'text' | 'bytes', signal: AbortSignal, limit: number): Promise<string | ArrayBuffer> {
  if (file.size > limit) return Promise.reject(new Error('File is too large.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    const cleanup = () => signal.removeEventListener('abort', abort);
    reader.onload = () => { cleanup(); resolve(reader.result as string | ArrayBuffer); };
    reader.onerror = () => { cleanup(); reject(new Error('File could not be read.')); };
    reader.onabort = () => { cleanup(); reject(Object.assign(new Error('Cancelled'), { code: 'CANCELLED' })); };
    if (signal.aborted) { reject(Object.assign(new Error('Cancelled'), { code: 'CANCELLED' })); return; }
    signal.addEventListener('abort', abort, { once: true });
    if (kind === 'text') reader.readAsText(file); else reader.readAsArrayBuffer(file);
  });
}
function download(text: string, filename: string, mediaType: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mediaType }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.rel = 'noreferrer';
  document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
function syntheticInput() {
  return {
    source: { id: 'synthetic-source', label: 'Synthetic example — no real person', url: 'https://example.invalid/filing', independence: 'unknown' },
    entities: [{ id: 'synthetic-company', type: 'Company', label: 'Synthetic Company' }, { id: 'synthetic-owner', type: 'Organization', label: 'Synthetic Owner' }],
    observations: [{ id: 'synthetic-observation', entityId: 'synthetic-company', property: 'filing_statement', value: 'The synthetic owner is listed in this fixture.', eventTime: '2020-01-02', capturedAt: '2026-11-01T12:00:00Z' }],
    claims: [{ id: 'synthetic-claim', subjectId: 'synthetic-owner', predicate: 'owns', objectId: 'synthetic-company', evidenceIds: ['synthetic-observation'] }],
  };
}

/** Keyed internally as well as by the parent so old async work cannot cross a case/user boundary. */
export function EvidenceWorkbenchPanel(props: EvidenceWorkbenchProps) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(props.contextKey) || !props.actor?.trim() || props.actor.length > 160 || Array.from(props.actor).some(character => character.charCodeAt(0) <= 31)) return <section className={boxClass}><h2 className="text-lg font-semibold">Evidence workbench</h2><p role="alert">A valid signed-in user and investigation context are required.</p></section>;
  return <EvidenceWorkbench key={`${props.contextKey}|${props.actor}`} {...props} />;
}

function EvidenceWorkbench({ contextKey, contextLabel, actor, loadLedger, saveLedger, importSavedEvidence, lookupOrganization, canExport = false, canImportFiles = false, disabled = false, reason }: EvidenceWorkbenchProps) {
  const [ledger, setLedger] = useState<EvidenceLedger>(() => createLedger({ caseId: contextKey, title: contextLabel?.slice(0, 500) || 'Investigation evidence' }));
  const ledgerRef = useRef(ledger);
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false); const [cloudState, setCloudState] = useState<CloudState>('unchecked');
  const [replaceConsent, setReplaceConsent] = useState(false); const [saveConsent, setSaveConsent] = useState(false);
  const [replaceImportConsent, setReplaceImportConsent] = useState(false);
  const [inputText, setInputText] = useState(''); const [mode, setMode] = useState('source');
  const [jsonFile, setJsonFile] = useState<File | null>(null); const [mhtmlFile, setMhtmlFile] = useState<File | null>(null); const [deviceId, setDeviceId] = useState('local-device');
  const [lei, setLei] = useState('');
  const [claimId, setClaimId] = useState(''); const [claimDecision, setClaimDecision] = useState('needs_review'); const [claimReason, setClaimReason] = useState(''); const [claimCounter, setClaimCounter] = useState('');
  const [leftId, setLeftId] = useState(''); const [rightId, setRightId] = useState(''); const [matchDecision, setMatchDecision] = useState('accepted'); const [matchReason, setMatchReason] = useState(''); const [matchEvidence, setMatchEvidence] = useState(''); const [matchCounter, setMatchCounter] = useState('');
  const [maxNodes, setMaxNodes] = useState(30); const [graphSeed, setGraphSeed] = useState(''); const [includeEvidence, setIncludeEvidence] = useState(true); const [selectedEdge, setSelectedEdge] = useState('');
  const [exportFormat, setExportFormat] = useState('json');
  const [verificationText, setVerificationText] = useState(''); const [verificationFile, setVerificationFile] = useState<File | null>(null); const [originalFiles, setOriginalFiles] = useState<File[]>([]); const [expectedDigest, setExpectedDigest] = useState(''); const [verification, setVerification] = useState<EvidenceVerification | null>(null);
  const active = useRef<Operation | null>(null); const generation = useRef(0); const mounted = useRef(true);
  const saveAvailable = Boolean(saveLedger);
  const previousPermission = useRef({ canExport, canImportFiles, saveAvailable });
  const fileInput = useRef<HTMLInputElement>(null); const originalInput = useRef<HTMLInputElement>(null); const verifyInput = useRef<HTMLInputElement>(null);
  const frozen = disabled || Boolean(busy);
  useEffect(() => { const lifecycle = { mounted, generation, active }; lifecycle.mounted.current = true; return () => { lifecycle.mounted.current = false; lifecycle.generation.current++; lifecycle.active.current?.controller.abort(); lifecycle.active.current = null; }; }, []);
  useEffect(() => {
    const previous = previousPermission.current;
    const revoked = disabled || (previous.canExport && !canExport) || (previous.canImportFiles && !canImportFiles) || (previous.saveAvailable && !saveAvailable);
    previousPermission.current = { canExport, canImportFiles, saveAvailable };
    if (revoked) { const hadPending = Boolean(active.current); generation.current++; active.current?.controller.abort(); active.current = null; setBusy(''); if (hadPending) setNotice('Permissions changed; pending results were discarded. An already-started callback may still finish on the server.'); }
  }, [disabled, canExport, canImportFiles, saveAvailable]);
  const commit = (next: EvidenceLedger) => { ledgerRef.current = next; setLedger(next); setDirty(true); setSaveConsent(false); };
  const isCurrent = (operation: Operation) => mounted.current && active.current === operation && generation.current === operation.generation && !operation.controller.signal.aborted;
  const cancel = () => { generation.current++; active.current?.controller.abort(); active.current = null; setBusy(''); setNotice('Pending results discarded. An already-started callback may still finish on the server.'); };
  async function run<T>(name: string, work: (signal: AbortSignal) => Promise<T>, success: (result: T) => void, fallback: string, failure?: () => void) {
    if (disabled || active.current) return;
    const operation = { generation: ++generation.current, controller: new AbortController() }; active.current = operation;
    setBusy(name); setError(''); setNotice('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    try {
      const interrupted = new Promise<never>((_, reject) => {
        abortListener = () => reject(Object.assign(new Error('Cancelled'), { code: 'CANCELLED' }));
        operation.controller.signal.addEventListener('abort', abortListener, { once: true });
        timer = setTimeout(() => reject(Object.assign(new Error('Timed out'), { code: 'TIMEOUT' })), 65000);
      });
      const result = await Promise.race([work(operation.controller.signal), interrupted]);
      if (isCurrent(operation)) success(result);
    } catch (failureValue) {
      if (isCurrent(operation)) { failure?.(); setError(safeMessage(failureValue, fallback)); }
    } finally {
      if (timer) clearTimeout(timer);
      if (abortListener) operation.controller.signal.removeEventListener('abort', abortListener);
      if (active.current === operation) { active.current = null; if (mounted.current) setBusy(''); }
    }
  }

  const graph: EvidenceGraph = useMemo(() => buildGraph(ledger, { maxNodes, maxEdges: 150, maxHops: 2, includeEvidence, ...(graphSeed && ledger.entities.some(row => row.id === graphSeed) ? { seedIds: [graphSeed] } : {}) }), [ledger, maxNodes, includeEvidence, graphSeed]);
  const timeline: EvidenceTimeline = useMemo(() => buildTimeline(ledger, { limit: 100 }), [ledger]);
  const conflicts: EvidenceConflict[] = useMemo(() => findConflicts(ledger), [ledger]);
  const matches: EvidenceMatchReview[] = useMemo(() => activeMatches(ledger), [ledger]);
  const selectedClaim = ledger.claims.find(row => row.id === claimId);
  const summary = selectedClaim ? evidenceSummary(ledger, claimId) : null;
  useEffect(() => { if (!ledger.claims.some(row => row.id === claimId)) setClaimId(ledger.claims[0]?.id || ''); }, [ledger, claimId]);
  useEffect(() => { if (graphSeed && !ledger.entities.some(row => row.id === graphSeed)) setGraphSeed(''); }, [ledger, graphSeed]);
  const selectedCounterEvidence = selectedClaim?.counterEvidenceIds.join(', ') || '';
  useEffect(() => { setClaimCounter(selectedCounterEvidence); setClaimReason(''); }, [claimId, selectedCounterEvidence]);
  useEffect(() => { if (!graph.edges.some(row => row.id === selectedEdge)) setSelectedEdge(''); }, [graph, selectedEdge]);
  const selectedRelationship = graph.edges.find(row => row.id === selectedEdge);
  const edgeObservationIds = selectedRelationship ? [...new Set([...(selectedRelationship.evidenceIds || []), ...(selectedRelationship.counterEvidenceIds || []), ...[selectedRelationship.source, selectedRelationship.target].filter((id: string) => id.startsWith('observation:')).map((id: string) => id.slice(12))])] : [];
  const positions = useMemo(() => new Map<string, { x: number; y: number }>(graph.nodes.map((node, index) => { const angle = index * Math.PI * 2 / Math.max(graph.nodes.length, 1) - Math.PI / 2; return [node.id, { x: 320 + Math.cos(angle) * 245, y: 205 + Math.sin(angle) * 150 }]; })), [graph]);
  const cloudBytes = byteLength(JSON.stringify(ledger));

  function loadCloud() {
    if (!loadLedger || (dirty && !replaceConsent)) return;
    void run('Loading saved evidence', async () => {
      const raw = await loadLedger();
      if (raw === null) return null;
      const loaded = await importLedgerJSON(raw);
      if (loaded.caseId !== contextKey) throw new Error('Context mismatch');
      return loaded;
    }, loaded => {
      if (loaded) { ledgerRef.current = loaded; setLedger(loaded); setDirty(false); setCloudState('loaded'); setNotice('Saved ledger loaded and digest checked for this context.'); }
      else { setCloudState('empty'); setNotice('No saved ledger exists for this context. Current local evidence is retained.'); }
      setReplaceConsent(false); setSaveConsent(false);
    }, 'Saved evidence could not be loaded or did not match this context. Saving is blocked until a successful load.', () => setCloudState('failed'));
  }
  function saveCloud() {
    if (!saveLedger || !loadLedger || !['loaded', 'empty'].includes(cloudState) || !saveConsent || cloudBytes > cloudLimit || !hasEvidence(ledger)) return;
    void run('Saving evidence', async () => { if (!(await verifyLedger(ledgerRef.current)).ok) throw new Error('Digest mismatch'); await saveLedger(clone(ledgerRef.current)); }, () => { setDirty(false); setSaveConsent(false); setCloudState('loaded'); setNotice('Evidence save confirmed by the scoped application callback.'); }, 'Save could not be confirmed. Local evidence is retained. Reload saved state before another save.', () => setCloudState('failed'));
  }
  function importJSON(fromFile: boolean) {
    if (fromFile && (!canImportFiles || !jsonFile)) return;
    if (mode === 'ledger' && hasEvidence(ledger) && !replaceImportConsent) return;
    void run('Importing evidence', async signal => {
      const text = fromFile ? await readFile(jsonFile!, 'text', signal, jsonLimit) as string : inputText;
      if (byteLength(text) > jsonLimit) throw new Error('Input exceeds one MiB');
      if (mode === 'ledger') { const loaded = await importLedgerJSON(text); if (loaded.caseId !== contextKey) throw new Error('Context mismatch'); return { ledger: loaded, message: 'Ledger imported and digest checked. Its context matches this workbench.' }; }
      if (mode === 'hunchly') {
        if (mhtmlFile && !canImportFiles) throw new Error('File uploads are not available');
        const mhtmlBytes = mhtmlFile ? await readFile(mhtmlFile, 'bytes', signal, 16 * 1024 * 1024) : undefined;
        const result = await importHunchlyCapture(ledgerRef.current, text, { actor, deviceId, mhtmlBytes });
        return { ledger: result.ledger, message: `Hunchly format imported offline. Original MHTML: ${result.capture.originalBytesVerified ? 'hash matched the supplied bytes' : 'not supplied; declared hash is unverified'}. Capture time is not an event date. No vendor connection was tested.` };
      }
      const normalized = parseEvidenceJSON(text, { maxBytes: jsonLimit });
      return { ledger: await ingestEvidence(ledgerRef.current, normalized, { actor }), message: 'Source evidence imported. Assertions remain separate from reviewed findings.' };
    }, result => { commit(result.ledger); setNotice(result.message); setInputText(''); setJsonFile(null); setMhtmlFile(null); setReplaceImportConsent(false); if (fileInput.current) fileInput.current.value = ''; if (originalInput.current) originalInput.current.value = ''; }, 'Import failed. Check the selected format, size, references and case context. Existing evidence is unchanged.');
  }
  function importSelectedSaved() {
    if (!importSavedEvidence) return;
    void run('Importing selected saved evidence', async () => {
      const inputs = await importSavedEvidence();
      if (!Array.isArray(inputs) || inputs.length > 100) throw new Error('Source batch limit');
      let next = ledgerRef.current;
      for (const input of inputs) next = await ingestEvidence(next, input, { actor });
      return { ledger: next, count: inputs.length };
    }, result => { commit(result.ledger); setNotice(`${result.count} selected source record(s) imported. No unrelated contacts were requested.`); }, 'Selected saved evidence could not be imported. Existing evidence is unchanged.');
  }
  function lookup() {
    const normalized = lei.trim().toUpperCase();
    if (!lookupOrganization || !/^[A-Z0-9]{20}$/.test(normalized)) return;
    void run('Looking up public organization', async () => ingestEvidence(ledgerRef.current, await lookupOrganization(normalized), { actor }), next => { commit(next); setNotice('Public organization result imported with its source. Review the source assertions before accepting claims.'); }, 'Public organization lookup is unavailable or returned invalid evidence. Nothing was added.');
  }
  function reviewSelectedClaim() {
    if (!claimId) return;
    void run('Recording claim review', async () => reviewClaim(ledgerRef.current, claimId, { actor, decision: claimDecision, reason: claimReason, counterEvidenceIds: ids(claimCounter) }), next => { commit(next); setClaimReason(''); setNotice('Claim review recorded with reason, evidence and audit history.'); }, 'Claim review failed. Check its reason and evidence references.');
  }
  function recordMatch() {
    void run('Recording identity review', async () => reviewMatch(ledgerRef.current, { actor, leftId, rightId, decision: matchDecision, reason: matchReason, evidenceIds: ids(matchEvidence), counterEvidenceIds: ids(matchCounter) }), next => { commit(next); setMatchReason(''); setNotice('Manual identity decision recorded. Original entities and observations were preserved.'); }, 'Identity review failed. Choose compatible entities, a reason and existing evidence IDs.');
  }
  function exportSelected() {
    if (!canExport) return;
    void run('Preparing export', async () => {
      if (!(await verifyLedger(ledgerRef.current)).ok) throw new Error('Integrity check failed');
      const current = ledgerRef.current;
      switch (exportFormat) {
        case 'markdown': return { text: exportMarkdown(current), name: 'report.md', type: 'text/markdown', message: 'Source-linked report prepared.' };
        case 'csv': return { text: exportCSV(current), name: 'evidence.csv', type: 'text/csv', message: 'CSV values are quoted and formula-prefixed values are neutralized.' };
        case 'maltego-entities': case 'maltego-links': { const result = exportMaltegoCSV(current); return { text: exportFormat === 'maltego-entities' ? result.entitiesCSV : result.linksCSV, name: `${exportFormat}.csv`, type: 'text/csv', message: result.warning }; }
        case 'gexf': { const result = exportGEXF(current); return { text: result.xml, name: 'graph.gexf', type: 'application/xml', message: result.truncated ? `Graph export is bounded: ${result.omittedNodes} nodes and ${result.omittedEdges} edges omitted.` : 'Directed graph exported with evidence references.' }; }
        case 'ftm': { const result = exportFtM(current); return { text: result.ndjson, name: 'followthemoney.ndjson', type: 'application/x-ndjson', message: `${result.skipped.length} record(s) outside the bounded mapping were omitted. ${result.warning}` }; }
        case 'prov': return { text: safeJSONStringify(exportPROV(current)), name: 'provenance.json', type: 'application/json', message: 'PROV-JSON Member Submission projection prepared, including audit and derivation records.' };
        case 'stix': { const result = await exportSTIX(current); return { text: safeJSONStringify(result.bundle), name: 'stix.json', type: 'application/stix+json', message: `${result.skipped.length} observation(s) omitted. ${result.warning}` }; }
        case 'bundle': { const result = await exportEvidenceBundle(current, { actor }); return { text: safeJSONStringify({ schema: 'evidence-file-bundle/v1', manifest: result.manifest, files: result.files }), name: 'bundle.json', type: 'application/json', message: `Ten-file bundle container prepared. Manifest digest: ${result.manifest.digest}. Preserve the digest separately. Original captured files are not included.` }; }
        default: return { text: exportCaseJSON(current), name: 'case.json', type: 'application/json', message: 'Case JSON includes observations, reviews, metadata and digests; original artifact bytes are not included.' };
      }
    }, result => { download(result.text, `${contextKey.replace(/[^a-z0-9_-]/gi, '_')}-${result.name}`, result.type); setNotice(result.message); }, 'Export could not be prepared. Existing evidence is retained.');
  }
  function verifyFiles(fromFile: boolean) {
    if (fromFile && (!canImportFiles || !verificationFile)) return;
    void run('Verifying bundle or manifest', async signal => {
      const raw = fromFile ? await readFile(verificationFile!, 'text', signal, bundleLimit) as string : verificationText;
      const parsed: unknown = parseEvidenceJSON(raw, { maxBytes: bundleLimit, maxString: 16 * 1024 * 1024, maxNodes: 120000 });
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid bundle or manifest');
      const container = parsed as Record<string, unknown>;
      const checkpoint = expectedDigest.trim() || null;
      if (container.schema === 'evidence-file-bundle/v1') {
        if (Object.keys(container).some(key => !['schema', 'manifest', 'files'].includes(key)) || !Array.isArray(container.files) || container.files.some((file: unknown) => !file || typeof file !== 'object' || typeof (file as Record<string, unknown>).bytes !== 'string')) throw new Error('Invalid bundle container');
        return verifyCaptureManifest(container.manifest, container.files, { expectedDigest: checkpoint });
      }
      if (!canImportFiles && originalFiles.length) throw new Error('Uploads unavailable');
      if (originalFiles.length > 100 || originalFiles.reduce((sum, file) => sum + file.size, 0) > bundleLimit || originalFiles.some(file => file.size > 16 * 1024 * 1024)) throw new Error('Original file limit');
      const files = [];
      for (const file of originalFiles) files.push({ path: file.webkitRelativePath || file.name, bytes: await readFile(file, 'bytes', signal, 16 * 1024 * 1024) });
      return verifyCaptureManifest(parsed, files, { expectedDigest: checkpoint });
    }, result => { setVerification(result); setNotice(result.ok ? 'Selected bytes and manifest are consistent. Source authenticity is not established.' : 'Verification failed: changed, missing or unexpected content or checkpoint mismatch was detected.'); }, 'Verification failed to run. Check the format, sizes, file paths and optional SHA-256 checkpoint.');
  }

  return <section aria-labelledby="evidence-workbench-title" className="min-w-0 space-y-5">
    <header className="space-y-2"><h2 id="evidence-workbench-title" className="text-xl font-semibold">Evidence workbench</h2><p className="text-sm text-muted-foreground">Context: <span className="break-all">{contextLabel || contextKey}</span>. Local memory until you explicitly save. Source assertions, hypotheses and reviewed findings remain distinct.</p>
      <p className="text-sm" aria-label="Evidence counts">Sources: {ledger.sources.length} · Observations: {ledger.observations.length} · Claims: {ledger.claims.length} · Pending claims: {ledger.claims.filter(row => ['unreviewed', 'needs_review'].includes(row.status)).length} · Potential conflicts: {conflicts.length}</p>
      <p className="text-xs text-muted-foreground">No automatic identity merge, probability score, contact lookup or background collection. Source independence is declared by an analyst, not verified by a count.</p>
    </header>
    {disabled && <p role="alert" className="rounded border p-3 text-sm">{reason || 'Workbench actions are unavailable until account and usage checks succeed.'}</p>}
    {error && <p role="alert" className="break-words rounded border border-destructive p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="break-words rounded border p-3 text-sm">{notice}</p>}
    {busy && <div className="flex flex-wrap items-center gap-3 text-sm" role="status"><span>{busy}…</span>{busy !== 'Saving evidence' && <button type="button" className={buttonClass} onClick={cancel}>Cancel pending work</button>}</div>}

    <div className={boxClass}><h3 className="font-semibold">Context storage</h3><p className="text-sm text-muted-foreground">Cloud actions use this app's scoped callbacks. Load successfully before saving to avoid overwriting an unknown saved state. No password, private email or other panel input is collected here.</p>
      <p className="text-xs">Cloud state: {cloudState}. Local changes: {dirty ? 'unsaved' : 'none'}. Ledger size: {cloudBytes.toLocaleString()} / {cloudLimit.toLocaleString()} bytes for cloud storage.</p>
      {dirty && loadLedger && <label className="flex gap-2 text-sm"><input type="checkbox" checked={replaceConsent} disabled={frozen} onChange={event => setReplaceConsent(event.target.checked)} />Allow a successfully loaded saved ledger to replace my current local evidence.</label>}
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={frozen || !loadLedger || (dirty && !replaceConsent)} onClick={loadCloud}>Load saved ledger</button>
        {saveLedger && <button type="button" className={buttonClass} disabled={frozen || !loadLedger || !['loaded', 'empty'].includes(cloudState) || !saveConsent || cloudBytes > cloudLimit || !hasEvidence(ledger)} onClick={saveCloud}>Save reviewed evidence to cloud</button>}</div>
      {saveLedger && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={saveConsent} disabled={frozen} onChange={event => setSaveConsent(event.target.checked)} />I reviewed the evidence for cloud storage and excluded passwords, API keys and private email content.</label>}
      {!saveLedger && <p className="text-xs text-muted-foreground">Cloud saving is unavailable for this plan or context. Local inspection remains available.</p>}
      {saveLedger && !loadLedger && <p className="text-xs text-muted-foreground">Saving is disabled because a scoped cloud-load callback is unavailable.</p>}
      {cloudBytes > cloudLimit && <p className="text-xs text-destructive">This ledger exceeds the cloud limit. Keep it locally and use an authorized local export.</p>}
    </div>

    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <div className={boxClass}><h3 className="font-semibold">Import existing evidence</h3><p className="text-sm text-muted-foreground">Paste a normalized source record or this context's exported ledger. Hunchly JSON is an offline format import; no licensed vendor connection is claimed. Maximum JSON input: 1 MiB.</p>
        <label className="block text-sm">Evidence input format<select aria-label="Evidence input format" className={inputClass} value={mode} disabled={frozen} onChange={event => { setMode(event.target.value); setMhtmlFile(null); setReplaceImportConsent(false); }}><option value="source">Normalized source + observations + claims</option><option value="ledger">Exported ledger for this context</option><option value="hunchly">Hunchly Data Forwarding JSON</option></select></label>
        {mode === 'ledger' && hasEvidence(ledger) && <label className="flex gap-2 text-sm"><input type="checkbox" checked={replaceImportConsent} disabled={frozen} onChange={event => setReplaceImportConsent(event.target.checked)} />Replace my current local ledger with this imported ledger. Existing local observations will be replaced.</label>}
        <label className="block text-sm">Evidence JSON<textarea aria-label="Evidence JSON" rows={7} className={`${inputClass} font-mono text-xs`} value={inputText} disabled={frozen} maxLength={jsonLimit} onChange={event => setInputText(event.target.value)} /></label>
        <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={frozen || !inputText.trim() || (mode === 'ledger' && hasEvidence(ledger) && !replaceImportConsent)} onClick={() => importJSON(false)}>Import pasted evidence</button><button type="button" className={buttonClass} disabled={frozen} onClick={() => { setMode('source'); setInputText(JSON.stringify(syntheticInput(), null, 2)); }}>Fill synthetic example</button></div>
        <label className="block text-sm">Evidence JSON file<input ref={fileInput} aria-label="Evidence JSON file" type="file" accept=".json,application/json" disabled={frozen || !canImportFiles} className="mt-1 block w-full min-w-0 text-xs" onChange={event => { setError(''); const file = event.target.files?.[0] || null; if (file && file.size > jsonLimit) { setJsonFile(null); setError('Evidence JSON files must be no larger than 1 MiB.'); } else setJsonFile(file); }} /></label>
        <button type="button" className={buttonClass} disabled={frozen || !canImportFiles || !jsonFile || (mode === 'ledger' && hasEvidence(ledger) && !replaceImportConsent)} onClick={() => importJSON(true)}>Import selected JSON file</button>
        {!canImportFiles && <p className="text-xs text-muted-foreground">Your plan does not include artifact file uploads here. Typed local inspection remains available.</p>}
        {mode === 'hunchly' && <div className="space-y-2"><label className="block text-sm">Hunchly device namespace<input aria-label="Hunchly device namespace" className={inputClass} value={deviceId} maxLength={48} disabled={frozen} onChange={event => setDeviceId(event.target.value)} /></label><label className="block text-sm">Original MHTML file (optional, 16 MiB maximum)<input ref={originalInput} aria-label="Original MHTML file" type="file" accept=".mhtml,.mht,multipart/related" disabled={frozen || !canImportFiles} className="mt-1 block w-full min-w-0 text-xs" onChange={event => { const file = event.target.files?.[0] || null; if (file && file.size > 16 * 1024 * 1024) { setError('Original MHTML exceeds 16 MiB.'); setMhtmlFile(null); } else setMhtmlFile(file); }} /></label><p className="text-xs">Without original MHTML bytes, its supplied hash remains unverified. Imported scripts are never rendered or executed.</p></div>}
        {importSavedEvidence && <button type="button" className={buttonClass} disabled={frozen} onClick={importSelectedSaved}>Import selected saved evidence</button>}
      </div>
      <div className={boxClass}><h3 className="font-semibold">Public organization source</h3><p className="text-sm text-muted-foreground">Look up one exact LEI through the app's configured public organization connector. The returned business fields enter this ledger with their source. No contact or person search runs.</p><label className="block text-sm">Legal Entity Identifier (LEI)<input aria-label="Legal Entity Identifier (LEI)" className={`${inputClass} font-mono`} value={lei} maxLength={20} disabled={frozen || !lookupOrganization} onChange={event => setLei(event.target.value)} /></label><button type="button" className={buttonClass} disabled={frozen || !lookupOrganization || !/^[A-Z0-9]{20}$/i.test(lei.trim())} onClick={lookup}>Look up and import organization</button>{!lookupOrganization && <p className="text-xs text-muted-foreground">A public organization connector is unavailable in this context.</p>}
        <h3 className="pt-3 font-semibold">Sources and citations</h3><ul className="max-h-64 space-y-2 overflow-auto text-sm">{ledger.sources.slice(0, 100).map(source => <li key={source.id} className="break-words rounded border p-2"><p className="font-medium">{source.label}</p><p className="break-all text-xs">ID: {source.id}. Origin: {source.independenceGroup || 'unknown'}; {source.independence}.</p>{source.url && <a href={source.url} target="_blank" rel="noreferrer" className="break-all underline">Open cited source</a>}</li>)}</ul>{ledger.sources.length > 100 && <p className="text-xs">Showing the first 100 sources; authorized JSON export retains all records.</p>}
      </div>
    </div>

    <div className={boxClass}><h3 className="font-semibold">Observation register</h3><p className="text-xs text-muted-foreground">These are source assertions. Use the IDs below for supporting or counterevidence references. Conflicting statements are retained; null or empty values are unknown.</p><ObservationCards ledger={ledger} observationIds={ledger.observations.slice(0, 100).map(row => row.id)} />{ledger.observations.length > 100 && <p className="text-xs">First 100 observations shown; local exports retain the complete ledger.</p>}{conflicts.length > 0 && <details><summary className="cursor-pointer text-sm">Inspect {conflicts.length} potential conflict(s)</summary><ul className="space-y-1 text-xs">{conflicts.slice(0, 100).map(conflict => <li className="break-words" key={`${conflict.entityId}:${conflict.property}`}>{conflict.entityId} / {conflict.property}: {conflict.observations.map(row => `${row.id} = ${displayValue(row.value)}`).join(' · ')}. This can also reflect change over time.</li>)}</ul></details>}</div>

    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <div className={boxClass}><h3 className="font-semibold">Review a claim</h3><label className="block text-sm">Claim<select aria-label="Claim" className={inputClass} value={claimId} disabled={frozen || !ledger.claims.length} onChange={event => setClaimId(event.target.value)}><option value="">Choose claim</option>{ledger.claims.map(claim => <option key={claim.id} value={claim.id}>{claim.id}: {claim.predicate} ({claim.status})</option>)}</select></label>
        {selectedClaim && <p className="break-words text-sm">{selectedClaim.subjectId} → {selectedClaim.predicate} → {selectedClaim.objectId || displayValue(selectedClaim.value)}. Status: <strong>{selectedClaim.status}</strong>. Supports: {selectedClaim.evidenceIds.join(', ')}.</p>}
        {summary && <p className="text-xs">Supporting sources: {summary.sourceCount}. Declared independent origin groups: {summary.declaredIndependentGroups.length}. Unknown source independence: {summary.unknownSources.length}. These are not confidence probabilities.</p>}
        <label className="block text-sm">Claim decision<select aria-label="Claim decision" className={inputClass} value={claimDecision} disabled={frozen} onChange={event => setClaimDecision(event.target.value)}><option value="needs_review">Needs review</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select></label><label className="block text-sm">Claim review reason<textarea aria-label="Claim review reason" className={inputClass} rows={2} value={claimReason} maxLength={2000} disabled={frozen} onChange={event => setClaimReason(event.target.value)} /></label><label className="block text-sm">Claim counterevidence IDs (comma-separated)<input aria-label="Claim counterevidence IDs" className={inputClass} value={claimCounter} disabled={frozen} maxLength={20000} onChange={event => setClaimCounter(event.target.value)} /></label><button type="button" className={buttonClass} disabled={frozen || !claimId || claimReason.trim().length < 3} onClick={reviewSelectedClaim}>Record claim review</button>
      </div>
      <div className={boxClass}><h3 className="font-semibold">Manual identity hypothesis</h3><p className="text-xs text-muted-foreground">A reviewed link keeps both original entities intact. Matching names alone never create a link automatically. Cite evidence and counterevidence; revoke an accepted decision when it no longer holds.</p><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><label className="block text-sm">Left entity<select aria-label="Left entity" className={inputClass} value={leftId} disabled={frozen} onChange={event => setLeftId(event.target.value)}><option value="">Choose entity</option>{ledger.entities.map(row => <option key={row.id} value={row.id}>{row.label} ({row.id})</option>)}</select></label><label className="block text-sm">Right entity<select aria-label="Right entity" className={inputClass} value={rightId} disabled={frozen} onChange={event => setRightId(event.target.value)}><option value="">Choose entity</option>{ledger.entities.map(row => <option key={row.id} value={row.id}>{row.label} ({row.id})</option>)}</select></label></div><label className="block text-sm">Identity decision<select aria-label="Identity decision" className={inputClass} value={matchDecision} disabled={frozen} onChange={event => setMatchDecision(event.target.value)}><option value="accepted">Accept reviewed link</option><option value="rejected">Reject hypothesis</option><option value="revoked">Revoke accepted link</option></select></label><label className="block text-sm">Identity review reason<textarea aria-label="Identity review reason" className={inputClass} value={matchReason} maxLength={2000} rows={2} disabled={frozen} onChange={event => setMatchReason(event.target.value)} /></label><label className="block text-sm">Identity supporting evidence IDs<input aria-label="Identity supporting evidence IDs" className={inputClass} value={matchEvidence} maxLength={20000} disabled={frozen} onChange={event => setMatchEvidence(event.target.value)} /></label><label className="block text-sm">Identity counterevidence IDs<input aria-label="Identity counterevidence IDs" className={inputClass} value={matchCounter} maxLength={20000} disabled={frozen} onChange={event => setMatchCounter(event.target.value)} /></label><button type="button" className={buttonClass} disabled={frozen || !leftId || !rightId || leftId === rightId || matchReason.trim().length < 3 || (matchDecision === 'accepted' && !ids(matchEvidence).length)} onClick={recordMatch}>Record identity decision</button><p className="text-sm" aria-label="Active identity links">Active reviewed identity links: {matches.length}</p><ul className="space-y-1 text-xs">{matches.map(match => <li key={match.id} className="break-words">{match.leftId} ↔ {match.rightId} <button type="button" className="underline" disabled={frozen} onClick={() => { setLeftId(match.leftId); setRightId(match.rightId); setMatchDecision('revoked'); setMatchReason(''); setMatchEvidence(''); setMatchCounter(match.counterEvidenceIds.join(', ')); }}>Choose for revocation</button></li>)}</ul>
      </div>
    </div>

    <div className={boxClass}><h3 className="font-semibold">Evidence graph</h3><div className="flex flex-wrap items-end gap-3"><label className="text-sm">Graph node limit<select aria-label="Graph node limit" className={inputClass} value={maxNodes} onChange={event => setMaxNodes(Number(event.target.value))}><option value={20}>20</option><option value={30}>30</option><option value={50}>50</option><option value={100}>100</option></select></label><label className="min-w-0 text-sm">Explore from entity<select aria-label="Explore from entity" className={inputClass} value={graphSeed} onChange={event => setGraphSeed(event.target.value)}><option value="">All bounded entities</option>{ledger.entities.map(row => <option key={row.id} value={row.id}>{row.id}</option>)}</select></label><label className="flex gap-2 py-2 text-sm"><input type="checkbox" checked={includeEvidence} onChange={event => setIncludeEvidence(event.target.checked)} />Show evidence and sources</label></div><p className="text-xs">Showing {graph.nodes.length} / {graph.totalNodes} nodes and {graph.edges.length} / {graph.totalEdges} directed edges. {graph.truncated ? 'Some records are omitted by the display bounds.' : 'No records omitted by these display bounds.'} Click an edge or use the relationship selector to inspect citations.</p>
      <svg role="img" aria-label="Bounded evidence relationship graph" viewBox="0 0 640 410" className="w-full rounded border bg-background"><title>Directed source and hypothesis graph</title><defs><marker id={`evidence-arrow-${contextKey.replace(/[^a-z0-9]/gi, '')}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="currentColor" /></marker></defs>{graph.edges.map(edge => { const start = positions.get(edge.source); const end = positions.get(edge.target); if (!start || !end) return null; return <g key={edge.id} role="button" tabIndex={0} aria-label={`Inspect graph edge ${edge.type} ${edge.id}`} onClick={() => setSelectedEdge(edge.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedEdge(edge.id); } }} className="cursor-pointer"><title>{edge.type}: {edge.source} → {edge.target}</title><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="transparent" strokeWidth={16} /><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={selectedEdge === edge.id ? '#f59e0b' : edge.type === 'countered_by' ? '#ef4444' : '#64748b'} strokeWidth={selectedEdge === edge.id ? 3 : 1.5} markerEnd={`url(#evidence-arrow-${contextKey.replace(/[^a-z0-9]/gi, '')})`} /></g>; })}{graph.nodes.map(node => { const point = positions.get(node.id); return <g key={node.id}><title>{node.label} ({node.id})</title><circle cx={point.x} cy={point.y} r={node.kind === 'entity' ? 7 : 5} fill={node.kind === 'source' ? '#a78bfa' : node.kind === 'claim' ? '#f59e0b' : node.kind === 'observation' ? '#38bdf8' : '#34d399'} /><text x={point.x} y={point.y - 12} fontSize={9} textAnchor="middle" fill="currentColor">{node.label.slice(0, 24)}</text></g>; })}</svg>
      <label className="block text-sm">Graph relationship<select aria-label="Graph relationship" className={inputClass} value={selectedEdge} onChange={event => setSelectedEdge(event.target.value)}><option value="">Choose a directed edge</option>{graph.edges.map(edge => <option key={edge.id} value={edge.id}>{edge.type}: {edge.source} → {edge.target}</option>)}</select></label>{selectedRelationship && <div role="region" aria-label="Selected edge evidence" className="space-y-2 rounded border p-3"><p className="break-words text-sm">{selectedRelationship.type}: {selectedRelationship.source} → {selectedRelationship.target}. Review: {selectedRelationship.reviewStatus || 'source/evidence structure'}.</p><ObservationCards ledger={ledger} observationIds={edgeObservationIds} />{edgeObservationIds.length === 0 && <p className="text-xs">This edge has no directly attached observation IDs. Inspect its linked source/claim record.</p>}</div>}
    </div>

    <div className={boxClass}><h3 className="font-semibold">Event timeline</h3><p className="text-sm text-muted-foreground">Event dates only. {timeline.undatedIds.length} observation(s) are undated; capture/retrieval time is never substituted. {timeline.omitted > 0 && `${timeline.omitted} dated entries omitted by the 100-entry display limit.`}</p><ol className="max-h-80 space-y-2 overflow-auto text-sm">{timeline.entries.map(entry => <li className="break-words rounded border p-2" key={entry.id}><strong>{entry.eventTime.precision === 'day' ? entry.eventTime.value.slice(0, 10) : entry.eventTime.value}</strong> ({entry.eventTime.precision}) · {entry.entity.label} / {entry.property}: {displayValue(entry.value)}<p className="text-xs">Observation {entry.id}; captured {entry.capturedAt}; source {entry.source.label}.</p></li>)}</ol></div>

    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <div className={boxClass}><h3 className="font-semibold">Exports and custody</h3><p className="text-sm text-muted-foreground">Export permission follows the app's plan. The bundle is one JSON container with ten text files and a manifest; it does not include original captured bytes. Keep the digest separately.</p><label className="block text-sm">Export format<select aria-label="Export format" className={inputClass} value={exportFormat} disabled={frozen || !canExport} onChange={event => setExportFormat(event.target.value)}><option value="json">Complete case JSON</option><option value="markdown">Human-readable report</option><option value="csv">Evidence CSV</option><option value="maltego-entities">Maltego entities CSV</option><option value="maltego-links">Maltego links CSV</option><option value="gexf">Directed GEXF graph</option><option value="ftm">FollowTheMoney NDJSON</option><option value="prov">PROV-JSON provenance</option><option value="stix">STIX 2.1 cyber observed-data</option><option value="bundle">Ten-file bundle + manifest</option></select></label><button type="button" className={buttonClass} disabled={frozen || !canExport || !hasEvidence(ledger)} onClick={exportSelected}>Download selected export</button>{!canExport && !frozen && <p className="text-xs text-muted-foreground">Your plan does not include report/evidence exports here.</p>}<p className="break-all text-xs">Current audit head: {ledger.audit.at(-1)?.digest || 'none; no evidence changes yet'}.</p><details><summary className="cursor-pointer text-sm">Audit and review history ({ledger.audit.length} changes)</summary><ol className="max-h-48 overflow-auto text-xs">{ledger.audit.slice(-100).map(entry => <li key={entry.id} className="break-words border-b py-2">{entry.at} · {entry.actor} · {entry.action}{entry.details.decision ? ` · ${entry.details.decision}` : ''}</li>)}</ol><ul className="max-h-48 overflow-auto text-xs">{ledger.reviews.slice(-100).map(review => <li key={review.id} className="break-words border-b py-2">{review.kind} {review.decision} · {review.actor} · {review.at}. Reason: {review.reason}. Evidence: {review.evidenceIds.join(', ') || 'none'}. Counterevidence: {review.counterEvidenceIds.join(', ') || 'none'}.</li>)}</ul></details><p className="text-xs">Digests detect changes against retained checkpoints. They do not prove source truth, identity, capture authenticity or legal admissibility. Format validation is offline; no vendor acceptance is claimed.</p></div>
      <div className={boxClass}><h3 className="font-semibold">Verify exported bytes</h3><p className="text-sm text-muted-foreground">Paste a bundle JSON container, or select a bundle/manifest file. A standalone manifest also needs its original files. This does not import findings or overwrite the ledger.</p><label className="block text-sm">Bundle or manifest JSON<textarea aria-label="Bundle or manifest JSON" className={`${inputClass} font-mono text-xs`} rows={4} maxLength={bundleLimit} disabled={frozen} value={verificationText} onChange={event => { setVerificationText(event.target.value); setVerification(null); }} /></label><label className="block text-sm">Expected manifest digest (optional)<input aria-label="Expected manifest digest" className={`${inputClass} font-mono text-xs`} value={expectedDigest} maxLength={64} disabled={frozen} onChange={event => { setExpectedDigest(event.target.value); setVerification(null); }} /></label><button type="button" className={buttonClass} disabled={frozen || !verificationText.trim()} onClick={() => verifyFiles(false)}>Verify pasted bundle</button><label className="block text-sm">Bundle or manifest file<input ref={verifyInput} aria-label="Bundle or manifest file" type="file" accept=".json,application/json" disabled={frozen || !canImportFiles} className="mt-1 block w-full min-w-0 text-xs" onChange={event => { setVerification(null); const file = event.target.files?.[0] || null; if (file && file.size > bundleLimit) { setError('Bundle containers must be no larger than 32 MiB.'); setVerificationFile(null); } else setVerificationFile(file); }} /></label><label className="block text-sm">Original files for a standalone manifest<input aria-label="Original files for manifest" type="file" multiple disabled={frozen || !canImportFiles} className="mt-1 block w-full min-w-0 text-xs" onChange={event => { setOriginalFiles(Array.from(event.target.files || [])); setVerification(null); }} /></label><button type="button" className={buttonClass} disabled={frozen || !canImportFiles || !verificationFile} onClick={() => verifyFiles(true)}>Verify selected files</button>{!canImportFiles && <p className="text-xs text-muted-foreground">File selection follows your plan's artifact-upload permission.</p>}{verification && <div aria-label="Verification result" className="space-y-1 break-words rounded border p-3 text-sm"><strong>{verification.ok ? 'Byte integrity checks passed' : 'Tampering or incomplete file set detected'}</strong><p>Manifest digest: {verification.manifestDigestValid ? 'consistent' : 'mismatch'}. External checkpoint: {verification.checkpointMatches === null ? 'not supplied' : verification.checkpointMatches ? 'matched' : 'mismatch'}.</p><p>Missing: {verification.missing.length}; unexpected: {verification.unexpected.length}; changed files: {verification.files.filter(file => !file.ok && file.reason === 'content_mismatch').length}.</p><p>Source authenticity: not established.</p></div>}</div>
    </div>
  </section>;
}

function ObservationCards({ ledger, observationIds }: { ledger: EvidenceLedger; observationIds: string[] }) {
  return <ul className="max-h-80 space-y-2 overflow-auto text-sm">{observationIds.map(ref => { const observation = ledger.observations.find(row => row.id === ref); if (!observation) return null; const source = ledger.sources.find(row => row.id === observation.sourceId); const entity = ledger.entities.find(row => row.id === observation.entityId); return <li key={ref} className="min-w-0 space-y-1 break-words rounded border p-3"><p className="font-medium">{entity?.label || observation.entityId} / {observation.property}</p><p>{displayValue(observation.value).slice(0, 300)}{displayValue(observation.value).length > 300 ? '…' : ''}</p><p className="break-all text-xs">ID: {ref} · Source: {source?.label} ({observation.sourceId}) · Event: {observation.eventTime ? `${observation.eventTime.value} (${observation.eventTime.precision})` : 'unknown'} · Captured: {observation.capturedAt}</p>{source?.url && <a href={source.url} target="_blank" rel="noreferrer" className="underline">Open observation citation</a>}{displayValue(observation.value).length > 300 && <details><summary className="cursor-pointer text-xs">Full source assertion</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs">{displayValue(observation.value)}</pre></details>}</li>; })}</ul>;
}
export default EvidenceWorkbenchPanel;
