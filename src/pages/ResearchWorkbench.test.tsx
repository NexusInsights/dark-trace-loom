import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
type AuthFixture = { user: { id: string; role?: string; is_anonymous?: boolean } | null; loading: boolean };
type SubscriptionFixture = { plan: string; loading: boolean; error: string | null; refreshSubscription: ReturnType<typeof vi.fn> };
type UsageFixture = { dailyTotal: number; loading: boolean; error: string | null; refresh: ReturnType<typeof vi.fn>; recordExecution: ReturnType<typeof vi.fn> };
type PeopleFixture = { data: Array<{ id: string; persona_label: string }>; error: unknown; isLoading: boolean };
const h = vi.hoisted(() => ({
  auth: {} as AuthFixture, subscription: {} as SubscriptionFixture, usage: {} as UsageFixture, people: {} as PeopleFixture,
  load: vi.fn(), save: vi.fn(), importSaved: vi.fn(), lookup: vi.fn(), admission: vi.fn(), verifyEmail: vi.fn(), capture: vi.fn(), password: vi.fn(), fingerprint: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => h.auth }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => h.subscription }));
vi.mock('@/hooks/useUsageTracking', () => ({ useUsageTracking: () => h.usage }));
vi.mock('@/hooks/usePersonas', () => ({ usePersonas: () => h.people }));
vi.mock('@/features/research/MonitorCoveragePanel', () => ({ MonitorCoveragePanel: () => <p>Existing coverage workspace boundary</p> }));
vi.mock('@/features/research/research-client', () => ({ researchContext: (id: string | null) => id ? `persona:${id}` : 'research-default', loadResearchLedger: h.load, saveResearchLedger: h.save, importInvestigationEvidence: h.importSaved, lookupOrganizationEvidence: h.lookup }));
vi.mock('@/features/research/admission-client', () => ({ executeResearchAction: h.admission }));
vi.mock('@/features/research/email-client', () => ({ verifyEmailMessage: h.verifyEmail }));
vi.mock('@/features/research/privacy-password.mjs', () => ({ capturePrivacySnapshot: h.capture, checkPrivatePassword: h.password, comparePrivacySnapshots: () => ({ changed: false, changes: [], limitation: 'Synthetic comparison' }) }));
vi.mock('@/features/intelligence/browser-client.js', () => ({ captureFingerprint: h.fingerprint }));
import ResearchWorkbench from './ResearchWorkbench';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { createLedger, ingestEvidence } from '@/features/research/evidence-core.mjs';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PERSONA = '33333333-3333-4333-8333-333333333333';
const at = '2026-11-01T12:00:00Z';
const source = () => ({ source: { id: 'selected-source', label: 'Selected synthetic case source', url: 'https://example.invalid/filing' }, entities: [{ id: 'selected-company', type: 'Company', label: 'Synthetic Company' }], observations: [{ id: 'selected-observation', entityId: 'selected-company', property: 'name', value: 'Synthetic Company', capturedAt: at }], claims: [] });
let cryptoDescriptor: PropertyDescriptor | undefined;
beforeAll(() => { cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto'); Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }); });
afterAll(() => { if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor); });
beforeEach(() => {
  vi.clearAllMocks();
  h.auth = { user: { id: USER, role: 'authenticated', is_anonymous: false }, loading: false };
  h.subscription = { plan: 'free', loading: false, error: null, refreshSubscription: vi.fn().mockResolvedValue(undefined) };
  h.usage = { dailyTotal: 0, loading: false, error: null, refresh: vi.fn().mockResolvedValue(undefined), recordExecution: vi.fn() };
  h.people = { data: [{ id: PERSONA, persona_label: 'Selected synthetic investigation' }], error: null, isLoading: false };
  h.load.mockResolvedValue(null); h.save.mockResolvedValue(undefined); h.importSaved.mockResolvedValue([source()]); h.lookup.mockResolvedValue(source());
  h.admission.mockImplementation(async (_action, operation, options) => { const result = await operation({ signal: new AbortController().signal }); await options?.onUsageRefresh?.(); return result; });
  h.capture.mockResolvedValue({ capturedAt: at, permissions: { camera: 'prompt' }, storage: { readableCookieCount: 0, localStorage: { keyCount: 0 }, sessionStorage: { keyCount: 0 }, persistence: 'unknown' }, signals: { viewportWidth: 1280, viewportHeight: 720 }, fingerprint: { status: 'not_requested' }, resources: [] });
  h.password.mockResolvedValue({ status: 'not_found', exposureCount: 0, checkedAt: at, limitation: 'A synthetic missing match is not a safety guarantee.' });
  h.verifyEmail.mockResolvedValue({ status: 'aligned_signature', dkim: { cryptographicPass: true, dnsUnavailable: false, dnsQueries: 1, signatures: [] }, fromAlignment: { mode: 'strict', fromDomain: 'example.invalid', status: 'aligned' }, uploadedReceiverClaims: { trust: 'untrusted', authenticationResultsPresent: true, receivedSpfPresent: false, arcHeadersPresent: false }, spf: 'not_verified', dmarc: 'not_verified', arc: 'not_verified', checkedAt: at, limitations: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function app(section = 'evidence', protectedRoute = false) {
  return <MemoryRouter initialEntries={[`/research?section=${section}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes><Route path="/research" element={protectedRoute ? <ProtectedRoute><ResearchWorkbench /></ProtectedRoute> : <ResearchWorkbench />} /><Route path="/auth" element={<p>Existing authentication page</p>} /></Routes></MemoryRouter>;
}
function permitPurpose() {
  fireEvent.change(screen.getByLabelText('Purpose and scope'), { target: { value: 'Review selected synthetic public-source evidence' } });
  fireEvent.click(screen.getByLabelText('I am authorized to use the selected records and sources for this purpose.'));
}

describe('ResearchWorkbench preserves real account/plan/usage integration boundaries', () => {
  it('uses the existing protected route and blocks direct actions while auth/plan/usage are unresolved', () => {
    h.auth.user = null; render(app('evidence', true)); expect(screen.getByText('Existing authentication page')).toBeInTheDocument(); expect(screen.queryByRole('heading', { name: 'Evidence workbench' })).not.toBeInTheDocument();
    cleanup(); h.auth.user = { id: USER }; h.usage.error = 'Daily usage could not be verified'; render(app());
    expect(screen.getAllByRole('alert').some(node => node.textContent?.includes('Daily usage could not be verified'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Load saved ledger' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Look up and import organization' })).toBeDisabled(); expect(h.load).not.toHaveBeenCalled();
  });

  it('preserves free-plan upload/export/save denial even after purpose authorization', () => {
    render(app()); permitPurpose();
    expect(screen.getByLabelText('Evidence JSON file')).toBeDisabled(); expect(screen.getByLabelText('Bundle or manifest file')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Download selected export' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save reviewed evidence to cloud' })).not.toBeInTheDocument();
    expect(screen.getByText(/Cloud saves require your plan/)).toBeInTheDocument(); expect(h.save).not.toHaveBeenCalled(); expect(h.load).not.toHaveBeenCalled();
  });

  it('paid saving/import require purpose and authorization, and callbacks receive only the selected owner context', async () => {
    h.subscription.plan = 'professional'; render(app());
    fireEvent.change(screen.getByLabelText('Saved investigation context'), { target: { value: PERSONA } });
    expect(screen.queryByRole('button', { name: 'Import selected saved evidence' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Save reviewed evidence to cloud' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Purpose and scope'), { target: { value: 'Review selected synthetic public-source evidence' } });
    expect(screen.queryByRole('button', { name: 'Save reviewed evidence to cloud' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('I am authorized to use the selected records and sources for this purpose.'));
    fireEvent.click(screen.getByRole('button', { name: 'Load saved ledger' })); await screen.findByText('No saved ledger exists for this context. Current local evidence is retained.');
    expect(h.load).toHaveBeenCalledWith(USER, PERSONA);
    fireEvent.click(screen.getByRole('button', { name: 'Import selected saved evidence' })); await screen.findByText('1 selected source record(s) imported. No unrelated contacts were requested.');
    expect(h.importSaved).toHaveBeenCalledWith(USER, PERSONA, 'Selected synthetic investigation'); expect(h.lookup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('I reviewed the evidence for cloud storage and excluded passwords, API keys and private email content.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save reviewed evidence to cloud' })); await screen.findByText('Evidence save confirmed by the scoped application callback.');
    expect(h.save).toHaveBeenCalledOnce(); expect(h.save.mock.calls[0][0]).toBe(USER); expect(h.save.mock.calls[0][1]).toBe(PERSONA); expect(h.save.mock.calls[0][2]).toMatchObject({ caseId: `persona:${PERSONA}` }); expect(h.save.mock.calls[0][3]).toEqual({ purpose: 'Review selected synthetic public-source evidence', authorized: true });
    expect(h.admission).not.toHaveBeenCalled(); expect(h.usage.recordExecution).not.toHaveBeenCalled();
  });

  it('failed cloud load cannot become empty-state overwrite; failed save remains unconfirmed with local evidence retained', async () => {
    h.subscription.plan = 'professional'; h.load.mockRejectedValueOnce(new Error('PRIVATE_LOAD_TOKEN')).mockResolvedValueOnce(null); h.save.mockRejectedValueOnce(new Error('PRIVATE_SAVE_TOKEN'));
    render(app()); permitPurpose();
    fireEvent.click(screen.getByRole('button', { name: 'Load saved ledger' })); await screen.findByText(/Saved evidence could not be loaded/);
    expect(screen.getByRole('button', { name: 'Save reviewed evidence to cloud' })).toBeDisabled(); expect(h.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Load saved ledger' })); await screen.findByText(/No saved ledger exists/);
    fireEvent.click(screen.getByRole('button', { name: 'Fill synthetic example' })); fireEvent.click(screen.getByRole('button', { name: 'Import pasted evidence' })); await screen.findByText(/Source evidence imported/);
    fireEvent.click(screen.getByLabelText('I reviewed the evidence for cloud storage and excluded passwords, API keys and private email content.')); fireEvent.click(screen.getByRole('button', { name: 'Save reviewed evidence to cloud' }));
    await screen.findByText(/Save could not be confirmed/); expect(screen.getByLabelText('Evidence counts')).toHaveTextContent('Observations: 1'); expect(screen.getByRole('button', { name: 'Save reviewed evidence to cloud' })).toBeDisabled(); expect(document.body.textContent).not.toMatch(/PRIVATE_LOAD_TOKEN|PRIVATE_SAVE_TOKEN/);
  });

  it('account changes clear purpose, authorization and evidence and discard a late prior-account load', async () => {
    h.subscription.plan = 'professional'; let resolve!: (value: unknown) => void;
    h.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const old = await ingestEvidence(createLedger({ caseId: `persona:${PERSONA}`, createdAt: at }), source(), { actor: `analyst:${USER}`, at });
    const view = render(app()); fireEvent.change(screen.getByLabelText('Saved investigation context'), { target: { value: PERSONA } }); permitPurpose(); fireEvent.click(screen.getByRole('button', { name: 'Load saved ledger' })); await waitFor(() => expect(h.load).toHaveBeenCalledOnce());
    h.auth = { ...h.auth, user: { id: OTHER, role: 'authenticated' } }; h.people = { data: [], error: null, isLoading: false }; view.rerender(app());
    await act(async () => { resolve(old); });
    expect(screen.getByLabelText('Purpose and scope')).toHaveValue(''); expect(screen.getByLabelText('I am authorized to use the selected records and sources for this purpose.')).not.toBeChecked(); expect(screen.getByLabelText('Saved investigation context')).toHaveValue(''); expect(screen.getByLabelText('Evidence counts')).toHaveTextContent('Sources: 0'); expect(screen.queryByRole('button', { name: 'Save reviewed evidence to cloud' })).not.toBeInTheDocument();
  });

  it('routes local privacy/password through exactly one admission executor and excludes private inputs from other callbacks', async () => {
    render(app('privacy')); fireEvent.click(screen.getByLabelText('I agree to inspect this browser locally.')); fireEvent.click(screen.getByRole('button', { name: 'Capture baseline' })); await screen.findByText(/Captured 2026-11-01/);
    expect(h.admission).toHaveBeenCalledTimes(1); expect(h.admission.mock.calls[0][0]).toBe('research-privacy'); expect(h.capture).toHaveBeenCalledOnce(); expect(h.usage.refresh).toHaveBeenCalledTimes(1); expect(h.usage.refresh).toHaveBeenLastCalledWith({ background: true });
    fireEvent.click(screen.getByRole('button', { name: 'Password exposure' }));
    fireEvent.change(screen.getByLabelText('Password to check'), { target: { value: 'PRIVATE_PASSWORD_FIXTURE' } }); fireEvent.click(screen.getByLabelText('I understand that HIBP receives a five-character hash prefix and my network request.')); fireEvent.click(screen.getByRole('button', { name: 'Check password exposure' }));
    await screen.findByText('No matching password hash found in this response');
    expect(h.admission).toHaveBeenCalledTimes(2); expect(h.admission.mock.calls[1][0]).toBe('research-password'); expect(h.password).toHaveBeenCalledWith('PRIVATE_PASSWORD_FIXTURE', { signal: expect.any(AbortSignal) }); expect(h.usage.refresh).toHaveBeenLastCalledWith({ background: true });
    expect(screen.getByLabelText('Password to check')).toHaveValue(''); expect(JSON.stringify(h.admission.mock.calls)).not.toContain('PRIVATE_PASSWORD_FIXTURE'); expect(h.save).not.toHaveBeenCalled(); expect(h.importSaved).not.toHaveBeenCalled(); expect(h.usage.recordExecution).not.toHaveBeenCalled();
  });

  it('email and GLEIF server routes do not receive a second client admission reservation', async () => {
    render(app('email')); const file = new File(['Subject: synthetic\r\n\r\nPRIVATE_EML_FIXTURE'], 'fixture.eml', { type: 'message/rfc822' });
    fireEvent.change(screen.getByLabelText('Original EML file'), { target: { files: [file] } }); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Verify DKIM' }));
    await screen.findByText('A full-body DKIM signature aligns with the From domain'); expect(h.verifyEmail).toHaveBeenCalledOnce(); expect(h.admission).not.toHaveBeenCalled(); expect(h.usage.refresh).toHaveBeenCalledTimes(1); expect(h.usage.refresh).toHaveBeenLastCalledWith({ background: true }); expect(document.body.textContent).not.toContain('PRIVATE_EML_FIXTURE');
    fireEvent.click(screen.getByRole('button', { name: 'Evidence workbench' })); fireEvent.change(screen.getByLabelText('Legal Entity Identifier (LEI)'), { target: { value: 'ABCDEFGHIJKLMNOPQRST' } }); fireEvent.click(screen.getByRole('button', { name: 'Look up and import organization' })); await screen.findByText(/Public organization result imported/);
    expect(h.lookup).toHaveBeenCalledWith(USER, 'ABCDEFGHIJKLMNOPQRST'); expect(h.lookup).toHaveBeenCalledOnce(); expect(h.admission).not.toHaveBeenCalled(); expect(h.usage.refresh).toHaveBeenCalledTimes(2); expect(h.usage.refresh).toHaveBeenLastCalledWith({ background: true }); expect(h.usage.recordExecution).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
  });

  it('daily free allowance blocks privacy/password/email execution while local evidence and methods remain inspectable', async () => {
    h.usage.dailyTotal = 5; render(app('privacy'));
    fireEvent.click(screen.getByLabelText('I agree to inspect this browser locally.')); expect(screen.getByRole('button', { name: 'Capture baseline' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Password exposure' })); fireEvent.change(screen.getByLabelText('Password to check'), { target: { value: 'PRIVATE_FIXTURE' } }); fireEvent.click(screen.getByLabelText('I understand that HIBP receives a five-character hash prefix and my network request.')); expect(screen.getByRole('button', { name: 'Check password exposure' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Email authenticity' })); expect(screen.getByLabelText('Original EML file')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Evidence workbench' })); expect(screen.getByRole('button', { name: 'Fill synthetic example' })).toBeEnabled();
    expect(h.admission).not.toHaveBeenCalled(); expect(h.verifyEmail).not.toHaveBeenCalled(); expect(h.password).not.toHaveBeenCalled(); expect(h.capture).not.toHaveBeenCalled();
  });

  it('renders all 38 real methods with filterable evidence rules and public research downloads', () => {
    const view = render(app('methods'));
    expect(screen.getByRole('status')).toHaveTextContent('Showing 38 of 38 methods'); expect(view.container.querySelectorAll('details')).toHaveLength(38);
    expect(screen.getByRole('link', { name: 'Download the full methods research' })).toHaveAttribute('href', '/research-resources/person-methods.md'); expect(screen.getByRole('link', { name: 'Download the platform comparison' })).toHaveAttribute('href', '/research-resources/platforms.md');
    fireEvent.change(screen.getByPlaceholderText('licence, provenance, court, LEI…'), { target: { value: 'no-synthetic-method-matches-this-unique-string' } }); expect(screen.getByRole('status')).toHaveTextContent('Showing 0 of 38 methods'); expect(screen.getByText(/This is not a finding about any person/)).toBeInTheDocument();
    expect(h.lookup).not.toHaveBeenCalled(); expect(h.admission).not.toHaveBeenCalled();
  });
});
