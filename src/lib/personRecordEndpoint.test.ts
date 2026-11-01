import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock('../../functions/_lib/auth.js', () => ({ authenticatedUser: authenticate }));
import { onRequestPost, onRequestGet } from '../../functions/api/person-records.js';
import { lookupPlate } from '../../functions/_lib/carsxe.js';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public-test-key', CARSXE_API_KEY: 'private-test-value', CARSXE_ACCOUNT_USER_ID: 'test-user' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const request = (body: unknown, origin = 'https://app.test') => new Request('https://app.test/api/person-records', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session', Origin: origin }, body: JSON.stringify(body) });
beforeEach(() => { authenticate.mockResolvedValue({ id: 'test-user' }); vi.stubGlobal('AbortSignal', { timeout: () => new AbortController().signal }); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('authenticated record endpoint boundary', () => {
  it('denies anonymous and cross-origin access before calling a source', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); authenticate.mockResolvedValue(null);
    expect((await onRequestPost({ request: request({ tool: 'public-records', inputs: { q: 'Madoff' } }), env })).status).toBe(401);
    expect((await onRequestPost({ request: request({}, 'https://other.test'), env })).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps administrator source permissions enforced on the server', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply([{ allowed: false }])); vi.stubGlobal('fetch', fetcher);
    expect((await onRequestPost({ request: request({ tool: 'public-records', inputs: { q: 'Madoff' } }), env })).status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('never exposes the connected paid allowance to another signed-in account', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); authenticate.mockResolvedValue({ id: 'other-user' });
    const response = await onRequestPost({ request: request({ tool: 'vehicle-lookup', inputs: { plate: 'TEST', state: 'TX', country: 'US' } }), env });
    expect(response.status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
    const status = await onRequestGet({ request: new Request('https://app.test/api/person-records'), env });
    expect((await status.json()).configured).toBe(false);
  });
  it('rejects unknown sources and oversized or non-string payloads', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const body of [{ tool: 'http://localhost', inputs: {} }, { tool: 'public-records', inputs: { q: [] } }, { tool: 'public-records', inputs: { q: 'x'.repeat(5000) } }]) expect((await onRequestPost({ request: request(body), env })).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns key presence, never the credential itself, without a paid provider request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const result = await onRequestGet({ request: new Request('https://app.test/api/person-records'), env });
    expect((await result.text())).not.toContain(env.CARSXE_API_KEY); expect(fetcher).not.toHaveBeenCalled();
  });
  it('performs the public source call after permissions and returns actual records', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply({ count: 0, next: null, results: [] })); vi.stubGlobal('fetch', fetcher);
    const result = await onRequestPost({ request: request({ tool: 'public-records', inputs: { q: 'Unmatched Test' } }), env });
    expect(result.status).toBe(200); expect((await result.json()).returned).toBe(0); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain('courtlistener.com');
  });
});
describe('CarsXE request and secret handling', () => {
  it('requires state and country, sends one request, and normalizes actual provider fields', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ success: true, make: 'FORD', model: 'F150', year: 2020, vin: '1FTTESTFIXTURE0000', key: env.CARSXE_API_KEY }));
    await expect(lookupPlate({ plate: 'TEST', country: 'US' }, env.CARSXE_API_KEY, fetcher)).rejects.toThrow('state'); expect(fetcher).not.toHaveBeenCalled();
    const result = await lookupPlate({ plate: 'TEST', state: 'TX', country: 'US' }, env.CARSXE_API_KEY, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1); const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get('state')).toBe('TX'); expect(url.searchParams.has('decodeVIN')).toBe(false); expect(url.searchParams.has('require_vin')).toBe(false);
    expect(result.vehicle).toMatchObject({ make: 'FORD', model: 'F150', year: '2020' }); expect(JSON.stringify(result)).not.toContain(env.CARSXE_API_KEY);
    expect(new Headers(fetcher.mock.calls[0][1].headers).get('Idempotency-Key')).toBeTruthy();
    expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
  });
  it('does not retry errors or echo a credential from an upstream error', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ success: false, message: `Failure ${env.CARSXE_API_KEY}` }, 403));
    await expect(lookupPlate({ plate: 'TEST', state: 'TX', country: 'US' }, env.CARSXE_API_KEY, fetcher)).rejects.toThrow('[REDACTED]'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
