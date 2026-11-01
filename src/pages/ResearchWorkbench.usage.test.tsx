import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

const h = vi.hoisted(() => ({ query: vi.fn(), lookup: vi.fn(), email: vi.fn(), auth: { user: { id: '11111111-1111-4111-8111-111111111111', is_anonymous: false }, loading: false } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => h.auth }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ plan: 'professional', loading: false, error: null, refreshSubscription: vi.fn() }) }));
vi.mock('@/hooks/usePersonas', () => ({ usePersonas: () => ({ data: [], error: null, isLoading: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  const query = { select: () => query, eq: () => query, abortSignal: h.query };
  return query;
} } }));
vi.mock('@/features/research/research-client', () => ({ researchContext: () => 'research-default', lookupOrganizationEvidence: h.lookup, loadResearchLedger: vi.fn(), saveResearchLedger: vi.fn(), importInvestigationEvidence: vi.fn() }));
vi.mock('@/features/research/email-client', () => ({ verifyEmailMessage: h.email }));
vi.mock('@/features/research/MonitorCoveragePanel', () => ({ MonitorCoveragePanel: () => null }));
import ResearchWorkbench from './ResearchWorkbench';

const source = { source: { id: 'public-registry-fixture', label: 'Synthetic public registry' }, entities: [{ id: 'company-fixture', type: 'Organization', label: 'Synthetic Company' }], observations: [{ id: 'observation-fixture', entityId: 'company-fixture', property: 'legalName', value: 'Synthetic Company', eventTime: null, capturedAt: '2026-11-01T12:00:00Z' }], claims: [] };
let originalCrypto: PropertyDescriptor | undefined;
beforeAll(() => { originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto'); Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }); });
afterAll(() => { if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto); });
beforeEach(() => { vi.clearAllMocks(); h.query.mockResolvedValue({ data: [{ executions: 1 }], error: null }); h.lookup.mockResolvedValue(source); });
afterEach(cleanup);

describe('successful research results survive the real usage hook refresh', () => {
  it('ingests a successful organization result after a pending same-account usage refresh without revoking the workbench', async () => {
    render(<MemoryRouter initialEntries={['/research?section=evidence']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ResearchWorkbench /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load saved ledger' })).toBeEnabled());
    let finishUsage!: (response: unknown) => void;
    h.query.mockImplementationOnce(() => new Promise(resolve => { finishUsage = resolve; }));
    fireEvent.change(screen.getByLabelText('Legal Entity Identifier (LEI)'), { target: { value: 'ABCDEFGHIJKLMNOPQRST' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up and import organization' }));
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(2));
    const revokedDuringRefresh = Boolean(screen.queryByText(/Permissions changed; pending results were discarded/));
    const misleadingPlanDenial = Boolean(screen.queryByText('Your plan does not include report/evidence exports here.'));
    await act(async () => { finishUsage({ data: [{ executions: 2 }], error: null }); });
    await waitFor(() => expect(screen.getByText(/Daily tool usage: 2/)).toBeInTheDocument());
    expect(revokedDuringRefresh).toBe(false);
    expect(misleadingPlanDenial).toBe(false);
    await screen.findByText(/Public organization result imported with its source/);
    expect(screen.getByLabelText('Evidence counts')).toHaveTextContent('Observations: 1');
    expect(h.lookup).toHaveBeenCalledOnce();
    expect(screen.queryByText('Your plan does not include report/evidence exports here.')).not.toBeInTheDocument();
  });

  it('still fails closed and discards a pending import if the real refresh reports a verification error', async () => {
    render(<MemoryRouter initialEntries={['/research?section=evidence']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ResearchWorkbench /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load saved ledger' })).toBeEnabled());
    let finishUsage!: (response: unknown) => void;
    h.query.mockImplementationOnce(() => new Promise(resolve => { finishUsage = resolve; }));
    fireEvent.change(screen.getByLabelText('Legal Entity Identifier (LEI)'), { target: { value: 'ABCDEFGHIJKLMNOPQRST' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up and import organization' }));
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(2));
    await act(async () => { finishUsage({ data: null, error: { message: 'Daily usage verification unavailable' } }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Look up and import organization' })).toBeDisabled());
    expect(screen.getAllByRole('alert').some(node => node.textContent?.includes('Daily usage verification unavailable'))).toBe(true);
    expect(screen.getByLabelText('Evidence counts')).toHaveTextContent('Observations: 0');
    expect(h.lookup).toHaveBeenCalledOnce();
  });
});
