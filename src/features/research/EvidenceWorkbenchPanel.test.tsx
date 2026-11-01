import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { EvidenceWorkbenchPanel } from './EvidenceWorkbenchPanel';
import { createLedger, ingestEvidence } from './evidence-core.mjs';

const at = '2026-11-01T12:00:00.000Z';
const base = { contextKey: 'research-default', contextLabel: 'Selected investigation', actor: 'synthetic-user' };
const normalized = () => ({
  source: { id: 'source-a', label: 'Synthetic source only', url: 'https://example.invalid/record' },
  entities: [{ id: 'person-a', type: 'Person', label: 'Same Display Name' }, { id: 'person-b', type: 'Person', label: 'Same Display Name' }, { id: 'company-a', type: 'Company', label: 'Synthetic Company' }],
  observations: [{ id: 'obs-a', entityId: 'person-a', property: 'employer', value: 'Synthetic Alpha', eventTime: '2020-01-02', capturedAt: at }, { id: 'obs-b', entityId: 'person-b', property: 'identifier', value: 'Synthetic distinct record B', capturedAt: at }, { id: 'obs-c', entityId: 'person-a', property: 'employer', value: 'Synthetic Beta', eventTime: '2019-01-01', capturedAt: at }],
  claims: [{ id: 'claim-a', subjectId: 'person-a', predicate: 'associated_with', objectId: 'company-a', evidenceIds: ['obs-a'] }],
});
let originalCrypto: PropertyDescriptor | undefined;
beforeAll(() => { originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto'); Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }); });
afterAll(() => { if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function importTyped(input = normalized()) {
  fireEvent.change(screen.getByLabelText('Evidence JSON'), { target: { value: JSON.stringify(input) } });
  fireEvent.click(screen.getByRole('button', { name: 'Import pasted evidence' }));
  await screen.findByText('Source evidence imported. Assertions remain separate from reviewed findings.');
}
const counts = () => screen.getByLabelText('Evidence counts');
function readBlob(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Blob read failed')); reader.readAsText(blob); }); }

describe('portable evidence workbench', () => {
  it('distinguishes an actual export-plan denial from a transient disabled or busy operation', async () => {
    let finishLookup!: (input: unknown) => void;
    const lookup = vi.fn(() => new Promise(resolve => { finishLookup = resolve; }));
    const view = render(<EvidenceWorkbenchPanel {...base} disabled lookupOrganization={lookup} />);
    expect(screen.queryByText('Your plan does not include report/evidence exports here.')).not.toBeInTheDocument();
    view.rerender(<EvidenceWorkbenchPanel {...base} lookupOrganization={lookup} />);
    expect(screen.getByText('Your plan does not include report/evidence exports here.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Legal Entity Identifier (LEI)'), { target: { value: 'ABCDEFGHIJKLMNOPQRST' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up and import organization' }));
    await waitFor(() => expect(lookup).toHaveBeenCalledOnce());
    expect(screen.queryByText('Your plan does not include report/evidence exports here.')).not.toBeInTheDocument();
    await act(async () => { finishLookup(normalized()); });
    await screen.findByText(/Public organization result imported/);
    expect(screen.getByText('Your plan does not include report/evidence exports here.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download selected export' })).toBeDisabled();
  });

  it('imports real normalized records, preserves conflicts, records reason/counterevidence and inspects graph citations', async () => {
    render(<EvidenceWorkbenchPanel {...base} />);
    await importTyped();
    expect(counts()).toHaveTextContent('Sources: 1'); expect(counts()).toHaveTextContent('Observations: 3'); expect(counts()).toHaveTextContent('Potential conflicts: 1');
    expect(screen.getByLabelText('Active identity links')).toHaveTextContent('0');
    await waitFor(() => expect(screen.getByLabelText('Claim')).toHaveValue('claim-a'));
    fireEvent.change(screen.getByLabelText('Claim decision'), { target: { value: 'accepted' } });
    fireEvent.change(screen.getByLabelText('Claim review reason'), { target: { value: 'Reviewed source and retained contradictory synthetic filing' } });
    fireEvent.change(screen.getByLabelText('Claim counterevidence IDs'), { target: { value: 'obs-c' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record claim review' }));
    await screen.findByText('Claim review recorded with reason, evidence and audit history.');
    expect(screen.getByRole('option', { name: 'claim-a: associated_with (accepted)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect graph edge associated_with claim-edge:claim-a' }));
    const evidence = screen.getByRole('region', { name: 'Selected edge evidence' });
    expect(evidence).toHaveTextContent('Synthetic Alpha'); expect(evidence).toHaveTextContent('Synthetic Beta');
    expect(within(evidence).getAllByRole('link', { name: 'Open observation citation' })).toHaveLength(2);
    expect(screen.getByText(/Reason: Reviewed source and retained contradictory synthetic filing/)).toHaveTextContent('Counterevidence: obs-c');
    const timeline = screen.getByRole('heading', { name: 'Event timeline' }).parentElement!;
    expect(timeline).toHaveTextContent('1 observation(s) are undated'); expect(timeline).toHaveTextContent('2019-01-01'); expect(timeline).toHaveTextContent('2020-01-02');
    expect(timeline.textContent!.indexOf('2019-01-01')).toBeLessThan(timeline.textContent!.indexOf('2020-01-02'));
  });

  it('requires manual match evidence/reason and reverses the link while preserving originals', async () => {
    render(<EvidenceWorkbenchPanel {...base} />); await importTyped();
    fireEvent.change(screen.getByLabelText('Left entity'), { target: { value: 'person-a' } }); fireEvent.change(screen.getByLabelText('Right entity'), { target: { value: 'person-b' } });
    expect(screen.getByRole('button', { name: 'Record identity decision' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Identity review reason'), { target: { value: 'Synthetic manual hypothesis reviewed' } });
    expect(screen.getByRole('button', { name: 'Record identity decision' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Identity supporting evidence IDs'), { target: { value: 'obs-a' } }); fireEvent.change(screen.getByLabelText('Identity counterevidence IDs'), { target: { value: 'obs-b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record identity decision' }));
    await waitFor(() => expect(screen.getByLabelText('Active identity links')).toHaveTextContent('1'));
    fireEvent.click(screen.getByRole('button', { name: 'Choose for revocation' }));
    fireEvent.change(screen.getByLabelText('Identity review reason'), { target: { value: 'Distinct records established by counterevidence' } }); fireEvent.click(screen.getByRole('button', { name: 'Record identity decision' }));
    await waitFor(() => expect(screen.getByLabelText('Active identity links')).toHaveTextContent('0'));
    expect(counts()).toHaveTextContent('Observations: 3'); expect(screen.getAllByRole('option', { name: 'Same Display Name (person-a)' }).length).toBeGreaterThan(0); expect(screen.getByText(/Reason: Distinct records established by counterevidence/)).toBeInTheDocument();
  });

  it('never auto-loads/saves; failed load blocks overwrite, successful retry and explicit review allow scoped save', async () => {
    const loadLedger = vi.fn().mockRejectedValueOnce(new Error('PRIVATE_SERVICE_TOKEN')).mockResolvedValueOnce(null);
    const saveLedger = vi.fn().mockResolvedValue(undefined);
    render(<EvidenceWorkbenchPanel {...base} loadLedger={loadLedger} saveLedger={saveLedger} />);
    expect(loadLedger).not.toHaveBeenCalled(); expect(saveLedger).not.toHaveBeenCalled();
    await importTyped();
    fireEvent.click(screen.getByLabelText('I reviewed the evidence for cloud storage and excluded passwords, API keys and private email content.'));
    expect(screen.getByRole('button', { name: 'Save reviewed evidence to cloud' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Allow a successfully loaded saved ledger to replace my current local evidence.'));
    fireEvent.click(screen.getByRole('button', { name: 'Load saved ledger' }));
    await screen.findByRole('alert'); expect(document.body.textContent).not.toContain('PRIVATE_SERVICE_TOKEN'); expect(screen.getByRole('button', { name: 'Save reviewed evidence to cloud' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Load saved ledger' })); await screen.findByText('No saved ledger exists for this context. Current local evidence is retained.');
    expect(counts()).toHaveTextContent('Observations: 3');
    fireEvent.click(screen.getByLabelText('I reviewed the evidence for cloud storage and excluded passwords, API keys and private email content.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save reviewed evidence to cloud' }));
    await screen.findByText('Evidence save confirmed by the scoped application callback.');
    expect(saveLedger).toHaveBeenCalledTimes(1); expect(saveLedger.mock.calls[0][0].caseId).toBe(base.contextKey); expect(saveLedger.mock.calls[0][0].observations).toHaveLength(3);
  });

  it('discards a late load across context changes and blocks a wrong-context load', async () => {
    let resolve!: (value: unknown) => void;
    const oldLedger = await ingestEvidence(createLedger({ caseId: 'persona:old', createdAt: at }), normalized(), { actor: base.actor, at });
    const load = vi.fn(() => new Promise<unknown>(done => { resolve = done; }));
    const save = vi.fn().mockResolvedValue(undefined);
    const view = render(<EvidenceWorkbenchPanel {...base} contextKey="persona:old" loadLedger={load} saveLedger={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load saved ledger' })); await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    view.rerender(<EvidenceWorkbenchPanel {...base} contextKey="persona:new" loadLedger={async () => oldLedger} saveLedger={save} />);
    await act(async () => { resolve(oldLedger); });
    expect(counts()).toHaveTextContent('Sources: 0');
    fireEvent.click(screen.getByRole('button', { name: 'Load saved ledger' })); await screen.findByRole('alert');
    expect(counts()).toHaveTextContent('Sources: 0'); expect(screen.getByRole('button', { name: 'Save reviewed evidence to cloud' })).toBeDisabled(); expect(save).not.toHaveBeenCalled();
  });

  it('imports only after explicit saved-source action and adds the organization callback result with provenance', async () => {
    const saved = vi.fn().mockResolvedValue([normalized()]);
    const organization = vi.fn().mockResolvedValue({ source: { id: 'gleif-fixture', label: 'Public LEI fixture', url: 'https://example.invalid/lei' }, entities: [{ id: 'lei-fixture', type: 'Organization', label: 'Synthetic public organization' }], observations: [{ id: 'lei-name', entityId: 'lei-fixture', property: 'name', value: 'Synthetic public organization', eventTime: null }] });
    render(<EvidenceWorkbenchPanel {...base} importSavedEvidence={saved} lookupOrganization={organization} />);
    expect(saved).not.toHaveBeenCalled(); expect(organization).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Import selected saved evidence' })); await screen.findByText('1 selected source record(s) imported. No unrelated contacts were requested.');
    fireEvent.change(screen.getByLabelText('Legal Entity Identifier (LEI)'), { target: { value: 'abcdefghijklmnopqrst' } }); fireEvent.click(screen.getByRole('button', { name: 'Look up and import organization' }));
    await screen.findByText('Public organization result imported with its source. Review the source assertions before accepting claims.');
    expect(organization).toHaveBeenCalledWith('ABCDEFGHIJKLMNOPQRST'); expect(counts()).toHaveTextContent('Sources: 2'); expect(screen.getAllByText('Public LEI fixture').length).toBeGreaterThan(0);
  });

  it('fails closed on free-plan exports/uploads and account errors; discards late lookup results', async () => {
    let resolve!: (value: unknown) => void;
    const lookup = vi.fn(() => new Promise(done => { resolve = done; }));
    const view = render(<EvidenceWorkbenchPanel {...base} lookupOrganization={lookup} />);
    expect(screen.getByLabelText('Evidence JSON file')).toBeDisabled(); expect(screen.getByLabelText('Bundle or manifest file')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Download selected export' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Legal Entity Identifier (LEI)'), { target: { value: 'ABCDEFGHIJKLMNOPQRST' } }); fireEvent.click(screen.getByRole('button', { name: 'Look up and import organization' })); await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    view.rerender(<EvidenceWorkbenchPanel {...base} lookupOrganization={lookup} disabled reason="Usage verification failed" canImportFiles canExport />);
    await act(async () => { resolve(normalized()); }); expect(counts()).toHaveTextContent('Sources: 0'); expect(screen.getByRole('alert')).toHaveTextContent('Usage verification failed'); expect(screen.getByRole('button', { name: 'Import pasted evidence' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Look up and import organization' })).toBeDisabled();
  });

  it('discards pending source import after permission revocation and supports cancelling a late callback', async () => {
    let resolve!: (value: unknown[]) => void;
    const saved = vi.fn(() => new Promise<unknown[]>(done => { resolve = done; }));
    const view = render(<EvidenceWorkbenchPanel {...base} importSavedEvidence={saved} canImportFiles />);
    fireEvent.click(screen.getByRole('button', { name: 'Import selected saved evidence' })); await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    view.rerender(<EvidenceWorkbenchPanel {...base} importSavedEvidence={saved} canImportFiles={false} />);
    await act(async () => { resolve([normalized()]); }); expect(counts()).toHaveTextContent('Sources: 0');
    fireEvent.click(screen.getByRole('button', { name: 'Import selected saved evidence' })); await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel pending work' })); await act(async () => { resolve([normalized()]); });
    expect(counts()).toHaveTextContent('Sources: 0'); expect(screen.getByText(/Pending results discarded/)).toBeInTheDocument();
  });

  it('requires explicit full-ledger replacement and safely resets a graph seed absent from the new ledger', async () => {
    render(<EvidenceWorkbenchPanel {...base} />); await importTyped();
    fireEvent.change(screen.getByLabelText('Explore from entity'), { target: { value: 'person-a' } });
    fireEvent.change(screen.getByLabelText('Evidence input format'), { target: { value: 'ledger' } });
    fireEvent.change(screen.getByLabelText('Evidence JSON'), { target: { value: JSON.stringify(createLedger({ caseId: base.contextKey, createdAt: at })) } });
    expect(screen.getByRole('button', { name: 'Import pasted evidence' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Replace my current local ledger with this imported ledger. Existing local observations will be replaced.'));
    fireEvent.click(screen.getByRole('button', { name: 'Import pasted evidence' }));
    await screen.findByText('Ledger imported and digest checked. Its context matches this workbench.');
    expect(counts()).toHaveTextContent('Observations: 0'); expect(screen.getByLabelText('Explore from entity')).toHaveValue('');
  });

  it('imports a real selected Hunchly JSON/MHTML file offline without rendering capture scripts', async () => {
    render(<EvidenceWorkbenchPanel {...base} canImportFiles />);
    const original = 'SYNTHETIC MHTML'; const hash = createHash('sha256').update(original).digest('hex');
    const payload = { page_content: '<script>window.privateCaptureExecuted=true</script>', page: { case_id: 1, page_id: 2, hash, timestamp_created: '2020-01-01T00:00:00Z', title: 'Synthetic Hunchly capture', url: 'https://example.invalid/capture' } };
    fireEvent.change(screen.getByLabelText('Evidence input format'), { target: { value: 'hunchly' } });
    fireEvent.change(screen.getByLabelText('Evidence JSON file'), { target: { files: [new File([JSON.stringify(payload)], 'capture.json', { type: 'application/json' })] } });
    fireEvent.change(screen.getByLabelText('Original MHTML file'), { target: { files: [new File([original], 'original.mhtml')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import selected JSON file' }));
    await screen.findByText(/Hunchly format imported offline. Original MHTML: hash matched/);
    expect(Reflect.get(window, 'privateCaptureExecuted')).toBeUndefined(); expect(document.querySelectorAll('script')).toHaveLength(0); expect(counts()).toHaveTextContent('Sources: 1');
    expect(screen.getByRole('heading', { name: 'Event timeline' }).parentElement).toHaveTextContent('3 observation(s) are undated');
  });

  it('downloads a real bundle, verifies its bytes, and detects an altered file in the imported container', async () => {
    let blob: Blob | null = null;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((value: Blob) => { blob = value; return 'blob:fixture'; }) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<EvidenceWorkbenchPanel {...base} canExport canImportFiles />); await importTyped();
    fireEvent.change(screen.getByLabelText('Export format'), { target: { value: 'bundle' } }); fireEvent.click(screen.getByRole('button', { name: 'Download selected export' }));
    await screen.findByText(/Ten-file bundle container prepared/); expect(blob).not.toBeNull();
    const exported = await readBlob(blob!); const bundle = JSON.parse(exported) as { files: Array<{ path: string; bytes: string }> }; expect(bundle.files).toHaveLength(10);
    fireEvent.change(screen.getByLabelText('Bundle or manifest file'), { target: { files: [new File([exported], 'bundle.json', { type: 'application/json' })] } }); fireEvent.click(screen.getByRole('button', { name: 'Verify selected files' }));
    await screen.findByText('Byte integrity checks passed'); expect(screen.getByLabelText('Verification result')).toHaveTextContent('External checkpoint: not supplied');
    bundle.files.find(file => file.path === 'report.md').bytes += 'TAMPERED';
    fireEvent.change(screen.getByLabelText('Bundle or manifest JSON'), { target: { value: JSON.stringify(bundle) } }); fireEvent.click(screen.getByRole('button', { name: 'Verify pasted bundle' }));
    await screen.findByText('Tampering or incomplete file set detected'); expect(screen.getByLabelText('Verification result')).toHaveTextContent('changed files: 1'); expect(counts()).toHaveTextContent('Observations: 3');
  });

  it('keeps oversized cloud evidence local and does not call save', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<EvidenceWorkbenchPanel {...base} loadLedger={async () => null} saveLedger={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load saved ledger' })); await screen.findByText(/No saved ledger exists/);
    const input = normalized(); input.observations = Array.from({ length: 40 }, (_, index) => ({ id: `large-${index}`, entityId: 'person-a', property: `field-${index}`, value: 'Synthetic text '.repeat(250), capturedAt: at, eventTime: null })); input.claims = [];
    await importTyped(input);
    fireEvent.click(screen.getByLabelText('I reviewed the evidence for cloud storage and excluded passwords, API keys and private email content.'));
    expect(screen.getByText(/This ledger exceeds the cloud limit/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Save reviewed evidence to cloud' })).toBeDisabled(); expect(save).not.toHaveBeenCalled();
  });

  it('rejects hostile JSON without changing evidence or leaking callback errors', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('PRIVATE_API_KEY private-email@example.invalid'));
    render(<EvidenceWorkbenchPanel {...base} lookupOrganization={lookup} />);
    fireEvent.change(screen.getByLabelText('Evidence JSON'), { target: { value: '{"__proto__":{"polluted":true}}' } }); fireEvent.click(screen.getByRole('button', { name: 'Import pasted evidence' })); await screen.findByRole('alert');
    expect(counts()).toHaveTextContent('Sources: 0'); expect(Reflect.get({}, 'polluted')).toBeUndefined();
    fireEvent.change(screen.getByLabelText('Legal Entity Identifier (LEI)'), { target: { value: 'ABCDEFGHIJKLMNOPQRST' } }); fireEvent.click(screen.getByRole('button', { name: 'Look up and import organization' })); await screen.findByText('Public organization lookup is unavailable or returned invalid evidence. Nothing was added.');
    expect(document.body.textContent).not.toMatch(/PRIVATE_API_KEY|private-email@example/); expect(counts()).toHaveTextContent('Sources: 0');
  });
});
