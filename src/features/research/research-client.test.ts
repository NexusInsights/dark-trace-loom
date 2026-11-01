import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
type QueryStep = [string, ...unknown[]];
const h = vi.hoisted(() => ({ session: vi.fn(), from: vi.fn(), rpc: vi.fn(), responses: [] as unknown[], queries: [] as Array<{ table: string; steps: QueryStep[] }> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: h.session }, from: h.from, rpc: h.rpc } }));
import { importInvestigationEvidence, loadResearchLedger, lookupOrganizationEvidence, normalizeSavedEvidence, researchContext, saveResearchLedger } from './research-client';
import { createLedger, ingestEvidence } from './evidence-core.mjs';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PERSONA = '33333333-3333-4333-8333-333333333333';
const ROW = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'synthetic-session-only';
const at = '2026-11-01T12:00:00.000Z';
const ok = (data: unknown) => ({ data, error: null });
let cryptoDescriptor: PropertyDescriptor | undefined;
beforeAll(() => { cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto'); Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }); });
afterAll(() => { if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor); });
beforeEach(() => {
  vi.clearAllMocks(); h.responses = []; h.queries = [];
  h.session.mockResolvedValue({ data: { session: { access_token: TOKEN, user: { id: USER, role: 'authenticated' } } }, error: null });
  h.from.mockImplementation((table: string) => {
    const query = { table, steps: [] as QueryStep[] }; h.queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'contains', 'order', 'limit', 'abortSignal', 'maybeSingle', 'insert']) builder[method] = (...args: unknown[]) => { query.steps.push([method, ...args]); return builder; };
    builder.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
      if (!h.responses.length) return Promise.reject(new Error(`Unexpected synthetic query for ${table}`)).then(resolve, reject);
      return Promise.resolve(h.responses.shift()).then(resolve, reject);
    };
    return builder;
  });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function ledger(persona: string | null = PERSONA, large = false) {
  return ingestEvidence(createLedger({ caseId: researchContext(persona), createdAt: at }), {
    source: { id: 'synthetic-source', label: 'Synthetic selected source', url: 'https://example.invalid/source' },
    entities: [{ id: 'entity-a', type: 'Company', label: 'Synthetic Company' }],
    observations: large ? Array.from({ length: 4 }, (_, index) => ({ id: `observation-${index}`, entityId: 'entity-a', property: `field-${index}`, value: 'x'.repeat(25000), capturedAt: at })) : [{ id: 'observation-a', entityId: 'entity-a', property: 'name', value: 'Synthetic Company', capturedAt: at }], claims: [],
  }, { actor: `analyst:${USER}`, at });
}
function savedRecord(value: Awaited<ReturnType<typeof ingestEvidence>>, context = value.caseId) { return { result_data: { kind: 'research-evidence-ledger', workspace_id: context, audit_head: value.audit.at(-1)?.digest ?? null, ledger: value } }; }
const sourceRow = (overrides: Record<string, unknown> = {}) => ({ id: ROW, created_at: at, result_data: { persona_id: PERSONA, item: { sourceUrl: 'https://example.invalid/filing', title: 'Public synthetic filing', note: 'PUBLIC_NOTE_FIXTURE', occurredAt: '2020-01-02', ...overrides }, privatePassword: 'PRIVATE_PASSWORD_FIXTURE', privateEmailBody: 'PRIVATE_EML_FIXTURE' } });

describe('research context storage uses the existing owned account path', () => {
  it('validates context and account IDs before database or provider work', async () => {
    expect(researchContext(null)).toBe('research-default'); expect(researchContext(PERSONA)).toBe(`persona:${PERSONA}`);
    expect(() => researchContext('not-a-persona-id')).toThrow('valid investigation');
    await expect(loadResearchLedger('invalid-user', null)).rejects.toThrow('Sign in');
    expect(h.session).not.toHaveBeenCalled(); expect(h.from).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects changed, anonymous or missing sessions without reading another account', async () => {
    for (const session of [{ access_token: TOKEN, user: { id: OTHER } }, { access_token: TOKEN, user: { id: USER, is_anonymous: true } }, null]) {
      h.session.mockResolvedValueOnce({ data: { session }, error: null });
      await expect(loadResearchLedger(USER, null)).rejects.toThrow();
    }
    expect(h.from).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it('loads the latest owned persona ledger using the real core .ok integrity contract', async () => {
    const value = await ledger(); h.responses = [ok({ id: PERSONA }), ok([savedRecord(value)])];
    await expect(loadResearchLedger(USER, PERSONA)).resolves.toEqual(value);
    expect(h.queries[0].table).toBe('personas'); expect(h.queries[0].steps).toContainEqual(['eq', 'id', PERSONA]); expect(h.queries[0].steps).toContainEqual(['eq', 'user_id', USER]);
    const read = h.queries[1]; expect(read.table).toBe('tool_results'); expect(read.steps).toContainEqual(['eq', 'user_id', USER]); expect(read.steps).toContainEqual(['eq', 'tool_name', 'research-evidence-ledger']); expect(read.steps).toContainEqual(['contains', 'result_data', { workspace_id: `persona:${PERSONA}` }]); expect(read.steps).toContainEqual(['limit', 1]);
    expect(read.steps).toContainEqual(['order', 'created_at', { ascending: false }]); expect(read.steps).toContainEqual(['order', 'id', { ascending: false }]); expect(h.rpc).not.toHaveBeenCalled();
  });

  it('keeps genuine empty state distinct from database, ownership, scope and tamper failures', async () => {
    h.responses = [ok([])]; await expect(loadResearchLedger(USER, null)).resolves.toBeNull();
    h.responses = [{ data: null, error: { code: 'FIXTURE_DB_ERROR' } }]; await expect(loadResearchLedger(USER, null)).rejects.toMatchObject({ code: 'FIXTURE_DB_ERROR' });
    h.responses = [ok(null)]; await expect(loadResearchLedger(USER, PERSONA)).rejects.toThrow('unavailable');
    const value = await ledger(null); const mismatched = savedRecord(value, `persona:${PERSONA}`); h.responses = [ok([mismatched])]; await expect(loadResearchLedger(USER, null)).rejects.toThrow('does not match');
    const badHead = savedRecord(value); badHead.result_data.audit_head = '0'.repeat(64); h.responses = [ok([badHead])]; await expect(loadResearchLedger(USER, null)).rejects.toThrow('integrity');
    const tampered = JSON.parse(JSON.stringify(value)); tampered.observations[0].value = 'CHANGED'; h.responses = [ok([savedRecord(tampered)])]; await expect(loadResearchLedger(USER, null)).rejects.toThrow('integrity');
    expect(h.queries.every(query => !query.steps.some(step => step[0] === 'insert'))).toBe(true);
  });

  it('requires purpose and source authorization before save, then appends one owned snapshot without overwrite', async () => {
    const value = await ledger();
    for (const policy of [{ purpose: '', authorized: true }, { purpose: 'Synthetic review', authorized: false }]) await expect(saveResearchLedger(USER, PERSONA, value, policy)).rejects.toThrow('purpose');
    expect(h.session).not.toHaveBeenCalled(); expect(h.from).not.toHaveBeenCalled();
    h.responses = [ok({ id: PERSONA }), ok(null)];
    await expect(saveResearchLedger(USER, PERSONA, value, { purpose: '  Synthetic authorized review  ', authorized: true })).resolves.toBeUndefined();
    const writes = h.queries.filter(query => query.steps.some(step => step[0] === 'insert')); expect(writes).toHaveLength(1);
    const payload = writes[0].steps.find(step => step[0] === 'insert')[1] as { result_data: { ledger: unknown } };
    expect(payload).toMatchObject({ user_id: USER, tool_name: 'research-evidence-ledger', status: 'success', result_data: { persona_id: PERSONA, workspace_id: `persona:${PERSONA}`, purpose: 'Synthetic authorized review', source_authorization_confirmed: true, audit_head: value.audit.at(-1).digest } });
    expect(payload.result_data.ledger).toEqual(value); expect(h.rpc).not.toHaveBeenCalled();
    expect(h.queries.flatMap(query => query.steps).some(step => ['update', 'delete', 'upsert'].includes(step[0]))).toBe(false);
  });

  it('does not insert a wrong-context, corrupt, oversized or failed-write snapshot', async () => {
    const value = await ledger(null); h.responses = [ok({ id: PERSONA })]; await expect(saveResearchLedger(USER, PERSONA, value, { purpose: 'Synthetic', authorized: true })).rejects.toThrow('workspace');
    const tampered = JSON.parse(JSON.stringify(value)); tampered.title = 'CHANGED'; await expect(saveResearchLedger(USER, null, tampered, { purpose: 'Synthetic', authorized: true })).rejects.toThrow('integrity');
    const large = await ledger(null, true); await expect(saveResearchLedger(USER, null, large, { purpose: 'Synthetic', authorized: true })).rejects.toThrow('100 KB');
    expect(h.queries.flatMap(query => query.steps).filter(step => step[0] === 'insert')).toHaveLength(0);
    h.responses = [{ data: null, error: { code: 'WRITE_FAILED' } }]; await expect(saveResearchLedger(USER, null, value, { purpose: 'Synthetic', authorized: true })).rejects.toMatchObject({ code: 'WRITE_FAILED' });
    expect(h.queries.flatMap(query => query.steps).filter(step => step[0] === 'insert')).toHaveLength(1);
  });

  it('imports only selected owned investigator-added sources, excluding unrelated private tool payloads', async () => {
    h.responses = [ok({ id: PERSONA }), ok([sourceRow()])];
    const inputs = await importInvestigationEvidence(USER, PERSONA, 'Selected synthetic persona');
    expect(inputs).toHaveLength(1); expect(inputs[0].source.independence).toBe('unknown'); expect(inputs[0].observations[0]).toMatchObject({ capturedAt: at, eventTime: '2020-01-02' });
    const ingested = await ingestEvidence(createLedger({ caseId: `persona:${PERSONA}`, createdAt: at }), inputs[0], { actor: USER, at });
    expect(ingested.observations[0].eventTime).toEqual({ value: '2020-01-02T00:00:00.000Z', precision: 'day' });
    expect(JSON.stringify(inputs)).not.toMatch(/PRIVATE_PASSWORD_FIXTURE|PRIVATE_EML_FIXTURE|confidence_score/);
    const query = h.queries[1]; expect(query.steps).toContainEqual(['eq', 'user_id', USER]); expect(query.steps).toContainEqual(['eq', 'tool_name', 'person-investigation-evidence']); expect(query.steps).toContainEqual(['contains', 'result_data', { persona_id: PERSONA }]); expect(query.steps).toContainEqual(['limit', 25]);
    expect(normalizeSavedEvidence([{ ...sourceRow(), result_data: { ...sourceRow().result_data, persona_id: OTHER } }], PERSONA, 'Synthetic')).toEqual([]);
  });

  it('normalizes invalid event dates to unknown and prevents credential URLs from entering citations', () => {
    const invalid = normalizeSavedEvidence([sourceRow({ occurredAt: '2026-02-30' })], PERSONA, 'Synthetic');
    expect(invalid[0].observations[0].eventTime).toBeNull();
    for (const sourceUrl of ['https://name:FIXTURE@example.invalid/', 'https://example.invalid/?access_token=PRIVATE_FRAGMENT_FIXTURE', 'https://example.invalid/#access_token=PRIVATE_FRAGMENT_FIXTURE']) {
      expect(JSON.stringify(normalizeSavedEvidence([sourceRow({ sourceUrl })], PERSONA, 'Synthetic'))).not.toContain('PRIVATE_FRAGMENT_FIXTURE');
    }
    expect(() => normalizeSavedEvidence(Array.from({ length: 26 }, () => sourceRow()), PERSONA, 'Synthetic')).toThrow('scope');
  });

  it('aborts a stalled ownership read without continuing to records or retrying', async () => {
    vi.useFakeTimers(); h.responses = [new Promise(() => {})];
    const pending = loadResearchLedger(USER, PERSONA); const rejection = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(1); expect(h.queries).toHaveLength(1);
    const signal = h.queries[0].steps.find(step => step[0] === 'abortSignal')[1] as AbortSignal;
    await vi.advanceTimersByTimeAsync(20001); await rejection;
    expect(signal.aborted).toBe(true); expect(h.queries).toHaveLength(1); expect(h.queries[0].table).toBe('personas');
  });
});

describe('GLEIF client delegates admission to its one server route', () => {
  it('uses the verified original account on one bounded same-origin POST, with no client admission RPC', async () => {
    const evidence = { source: { id: 'gleif-fixture', label: 'Synthetic public registry' }, entities: [], observations: [], claims: [] };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, data: { status: 'found', evidenceInput: evidence } }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(lookupOrganizationEvidence(USER, 'ABCDEFGHIJKLMNOPQRST')).resolves.toEqual(evidence);
    expect(fetch).toHaveBeenCalledTimes(1); const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/research-gleif'); expect(options).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(options!.body))).toEqual({ lei: 'ABCDEFGHIJKLMNOPQRST' }); expect(h.rpc).not.toHaveBeenCalled(); expect(h.from).not.toHaveBeenCalled();
  });

  it('does not turn no-match or provider errors into proof that a business does not exist, and never retries', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { status: 'no_match' } })));
    await expect(lookupOrganizationEvidence(USER, 'ABCDEFGHIJKLMNOPQRST')).rejects.toThrow('does not establish');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: { message: 'Allowance unavailable' } }), { status: 429 }));
    await expect(lookupOrganizationEvidence(USER, 'ABCDEFGHIJKLMNOPQRST')).rejects.toThrow('Allowance unavailable');
    expect(fetch).toHaveBeenCalledTimes(2); expect(h.rpc).not.toHaveBeenCalled();
  });

  it('bounds chunked bytes and cancels an oversized body rather than buffering it all', async () => {
    const cancelled = vi.fn(); const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(40000)); controller.enqueue(new Uint8Array(40000)); }, cancel: cancelled });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream));
    await expect(lookupOrganizationEvidence(USER, 'ABCDEFGHIJKLMNOPQRST')).rejects.toThrow('display limit');
    expect(cancelled).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cancels a declared oversized body before reading it', async () => {
    const cancelled = vi.fn(); const stream = new ReadableStream({ cancel: cancelled });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { headers: { 'Content-Length': '65537' } }));
    await expect(lookupOrganizationEvidence(USER, 'ABCDEFGHIJKLMNOPQRST')).rejects.toThrow('display limit');
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('aborts and releases a stalled reader when the request deadline expires, without retrying', async () => {
    vi.useFakeTimers(); const cancelled = vi.fn(); let signal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation(async (_url, options) => { signal = options?.signal as AbortSignal; return new Response(new ReadableStream({ cancel: cancelled })); });
    const pending = lookupOrganizationEvidence(USER, 'ABCDEFGHIJKLMNOPQRST'); const rejection = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(70001); await rejection;
    expect(signal?.aborted).toBe(true); expect(cancelled).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
