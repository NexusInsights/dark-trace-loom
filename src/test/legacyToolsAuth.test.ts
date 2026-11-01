import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const authSource = readFileSync('supabase/functions/osint-tools/marketplaceAuth.ts', 'utf8');
const serverSource = readFileSync('supabase/functions/osint-tools/index.ts', 'utf8').split('// END GENERATED MARKETPLACE ADAPTERS')[1];
const legacyNames = ['ipGeo','dnsQuery','subdomainEnum','whois','asnLookup','cveLookup','githubRecon','reverseGeo','urlUnshorten','btcWallet','ethWallet','urlReputation','sslInspect','usernameSearch','pasteSearch','darkWebSearch','breachLookup','phoneLookup','pdlPersonEnrich','pdlPersonSearch','pdlCompanyEnrich'];
class FixtureError extends Error { constructor(message: string, public status: number) { super(message); } }
function fixture(authorized = true) {
  let handler: (request: Request) => Promise<Response>;
  const actor = { id: 'verified-user' };
  const marketplaceUser = vi.fn().mockImplementation(async () => { if (!authorized) throw new FixtureError('Sign in', 401); return actor; });
  const marketplaceRun = vi.fn().mockResolvedValue({ source: 'isolated fixture' });
  const providers = legacyNames.map(() => vi.fn().mockResolvedValue({ source: 'isolated fixture' }));
  const bodyReader = new Function('MarketplaceHttpError', compile(authSource.slice(authSource.indexOf('async function marketplaceRequestBody'), authSource.indexOf('async function marketplacePermission'))) + '; return marketplaceRequestBody;')(FixtureError);
  const marketplacePermission = vi.fn().mockResolvedValue(undefined);
  new Function('Deno','corsHeaders','json','marketplaceUser','marketplaceRequestBody','marketplaceRun','marketplaceStatus','MarketplaceHttpError','marketplacePermission',...legacyNames,compile(serverSource))(
    { serve: (fn: typeof handler) => { handler = fn; } }, {}, (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }), marketplaceUser, bodyReader, marketplaceRun, () => ({ tools: {} }), FixtureError, marketplacePermission, ...providers);
  return { handler: handler!, providers, marketplaceUser, marketplaceRun, marketplacePermission, actor };
}
const request = (action: string) => new Request('https://owned-backend.example/functions/v1/osint-tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, params: { name: 'local fixture' } }) });
describe('legacy tool authentication on the independent backend', () => {
  it.each(['pdl-person-enrich','pdl-person-search','pdl-company-enrich','dns-query','breach-lookup','marketplace-status'])('rejects anonymous %s before any provider operation', async action => {
    const h = fixture(false); expect((await h.handler(request(action))).status).toBe(401);
    for (const provider of h.providers) expect(provider).not.toHaveBeenCalled(); expect(h.marketplaceRun).not.toHaveBeenCalled();
  });
  it('rejects non-POST requests without calling Auth or providers', async () => {
    const h = fixture(); expect((await h.handler(new Request('https://owned-backend.example'))).status).toBe(405); expect(h.marketplaceUser).not.toHaveBeenCalled();
  });
  it('keeps CORS preflight available without provider requests', async () => {
    const h = fixture(false); expect((await h.handler(new Request('https://owned-backend.example', { method: 'OPTIONS' }))).status).toBe(200); expect(h.marketplaceUser).not.toHaveBeenCalled();
  });
  it.each(['pdl-person-enrich','pdl-person-search','pdl-company-enrich'])('retains authorized %s routing', async action => {
    const h = fixture(); expect((await h.handler(request(action))).status).toBe(200); expect(h.providers[legacyNames.indexOf(action === 'pdl-person-enrich' ? 'pdlPersonEnrich' : action === 'pdl-person-search' ? 'pdlPersonSearch' : 'pdlCompanyEnrich')]).toHaveBeenCalledOnce(); expect(h.marketplaceUser).toHaveBeenCalledOnce();
  });
  it('passes the already verified actor to the marketplace dispatcher', async () => {
    const h = fixture(); const req = request('marketplace-run'); expect((await h.handler(req)).status).toBe(200); expect(h.marketplaceRun).toHaveBeenCalledWith(req, { name: 'local fixture' }, h.actor); expect(h.marketplaceUser).toHaveBeenCalledOnce();
  });
  it.each([['ip-geo','ip-geolocation'],['pdl-company-enrich','company-lookup'],['ssl-inspect','ssl-inspector'],['reverse-geo','geo-reverse']])('enforces canonical permission before built-in %s execution', async (action, id) => {
    const h=fixture(); h.marketplacePermission.mockRejectedValue(new FixtureError('Disabled',403));
    expect((await h.handler(request(action))).status).toBe(403);
    expect(h.marketplacePermission).toHaveBeenCalledWith(h.actor,id);
    for(const provider of h.providers) expect(provider).not.toHaveBeenCalled();
  });
  it.each(['[]','null','invalid-json'])('rejects invalid request body %s before provider calls', async body => {
    const h = fixture(); const req = new Request('https://owned-backend.example', { method: 'POST', body }); expect((await h.handler(req)).status).toBe(400); for (const provider of h.providers) expect(provider).not.toHaveBeenCalled();
  });
  it('bounds streamed requests even without a Content-Length', async () => {
    const h = fixture(); const req = new Request('https://owned-backend.example', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) }); expect((await h.handler(req)).status).toBe(413); for (const provider of h.providers) expect(provider).not.toHaveBeenCalled();
  });
  it('times out a stalled request body and cancels the stream', async () => {
    vi.useFakeTimers();
    try {
      const h = fixture(); const cancel = vi.fn(); const req = new Request('https://owned-backend.example', { method: 'POST', body: new ReadableStream({ cancel }), duplex: 'half' } as RequestInit);
      const response = h.handler(req); await vi.advanceTimersByTimeAsync(5001); expect((await response).status).toBe(408); expect(cancel).toHaveBeenCalled(); for (const provider of h.providers) expect(provider).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
