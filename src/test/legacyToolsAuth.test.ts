import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const compile = (source: string) => ts.transpileModule(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const authSource = readFileSync('supabase/functions/osint-tools/marketplaceAuth.ts', 'utf8');
const strictSource = readFileSync('supabase/functions/_shared/authenticateUser.ts', 'utf8');
const serverSource = readFileSync('supabase/functions/osint-tools/index.ts', 'utf8').split('// END GENERATED MARKETPLACE ADAPTERS')[1];
const legacyNames = ['ipGeo','dnsQuery','subdomainEnum','whois','asnLookup','cveLookup','githubRecon','reverseGeo','urlUnshorten','btcWallet','ethWallet','urlReputation','sslInspect','usernameSearch','pasteSearch','darkWebSearch','breachLookup','phoneLookup','pdlPersonEnrich','pdlPersonSearch','pdlCompanyEnrich'];
const verified = { id: '11111111-1111-4111-8111-111111111111', role: 'authenticated', is_anonymous: false };
function fixture(authorized = true, authData: unknown = verified) {
  let handler: (request: Request) => Promise<Response>;
  const env = { SUPABASE_URL: 'https://fixture-auth.invalid', SUPABASE_ANON_KEY: 'synthetic-public-key' };
  const authFetch = vi.fn(async () => new Response(JSON.stringify(authorized ? authData : { error: 'private Auth diagnostic' }), { status: authorized ? 200 : 401 }));
  const helpers = new Function('Deno','fetch','AbortSignal', compile(strictSource) + '\n' + compile(authSource) + '; return { marketplaceUser, marketplaceRequestBody, MarketplaceHttpError };')({env:{get:(key:keyof typeof env)=>env[key]}},authFetch,{timeout:()=>new AbortController().signal});
  const actor = { id: verified.id, authorization: 'Bearer synthetic-session', url: env.SUPABASE_URL, key: env.SUPABASE_ANON_KEY };
  const marketplaceUser = vi.fn(helpers.marketplaceUser);
  const marketplaceRun = vi.fn().mockResolvedValue({ source: 'isolated fixture' });
  const providers = legacyNames.map(() => vi.fn().mockResolvedValue({ source: 'isolated fixture' }));
  const bodyReader = helpers.marketplaceRequestBody;
  const marketplacePermission = vi.fn().mockResolvedValue(undefined);
  new Function('Deno','corsHeaders','json','marketplaceUser','marketplaceRequestBody','marketplaceRun','marketplaceStatus','MarketplaceHttpError','marketplacePermission',...legacyNames,compile(serverSource))(
    { serve: (fn: typeof handler) => { handler = fn; } }, {}, (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }), marketplaceUser, bodyReader, marketplaceRun, () => ({ tools: {} }), helpers.MarketplaceHttpError, marketplacePermission, ...providers);
  return { handler: handler!, providers, marketplaceUser, marketplaceRun, marketplacePermission, actor, authFetch, MarketplaceHttpError: helpers.MarketplaceHttpError };
}
const request = (action: string) => new Request('https://owned-backend.example/functions/v1/osint-tools', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-session' }, body: JSON.stringify({ action, params: { name: 'local fixture' } }) });
describe('legacy tool authentication on the independent backend', () => {
  it.each(['pdl-person-enrich','pdl-person-search','pdl-company-enrich','dns-query','breach-lookup','marketplace-status'])('rejects invalid Auth for %s before any provider operation', async action => {
    const h = fixture(false); expect((await h.handler(request(action))).status).toBe(401);
    for (const provider of h.providers) expect(provider).not.toHaveBeenCalled(); expect(h.marketplaceRun).not.toHaveBeenCalled();
  });
  it('rejects missing authorization before reading the body or contacting Auth', async()=>{
    const h=fixture();const req=new Request('https://owned-backend.example',{method:'POST',body:'{}'});const original=req.body;let reads=0;Object.defineProperty(req,'body',{get(){reads++;return original;}});
    expect((await h.handler(req)).status).toBe(401);expect(reads).toBe(0);expect(h.authFetch).not.toHaveBeenCalled();expect(h.marketplacePermission).not.toHaveBeenCalled();for(const provider of h.providers)expect(provider).not.toHaveBeenCalled();
  });
  it.each([{payload:{...verified,is_anonymous:true},status:403,reason:'anonymous_session_not_allowed'},{payload:{...verified,role:'anon'},status:401,reason:'unauthenticated'},{payload:{id:'malformed'},status:502,reason:'invalid_authentication_response'}])('rejects $reason before body, policy or provider work', async({payload,status,reason})=>{
    const h=fixture(true,payload);const req=request('dns-query');const original=req.body;let reads=0;Object.defineProperty(req,'body',{get(){reads++;return original;}});const response=await h.handler(req);
    expect(response.status).toBe(status);expect(await response.json()).toMatchObject({status:'error',reason});expect(reads).toBe(0);expect(h.marketplacePermission).not.toHaveBeenCalled();expect(h.marketplaceRun).not.toHaveBeenCalled();for(const provider of h.providers)expect(provider).not.toHaveBeenCalled();
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
    const h=fixture(); h.marketplacePermission.mockRejectedValue(new h.MarketplaceHttpError('Disabled',403));
    expect((await h.handler(request(action))).status).toBe(403);
    expect(h.marketplacePermission).toHaveBeenCalledWith(h.actor,id);
    for(const provider of h.providers) expect(provider).not.toHaveBeenCalled();
  });
  it.each(['[]','null','invalid-json'])('rejects invalid request body %s before provider calls', async body => {
    const h = fixture(); const req = new Request('https://owned-backend.example', { method: 'POST', headers:{Authorization:'Bearer synthetic-session'}, body }); expect((await h.handler(req)).status).toBe(400); for (const provider of h.providers) expect(provider).not.toHaveBeenCalled();
  });
  it('bounds streamed requests even without a Content-Length', async () => {
    const h = fixture(); const req = new Request('https://owned-backend.example', { method: 'POST', headers:{Authorization:'Bearer synthetic-session'}, body: 'x'.repeat(1024 * 1024 + 1) }); expect((await h.handler(req)).status).toBe(413); for (const provider of h.providers) expect(provider).not.toHaveBeenCalled();
  });
  it('times out a stalled request body and cancels the stream', async () => {
    vi.useFakeTimers();
    try {
      const h = fixture(); const cancel = vi.fn(); const req = new Request('https://owned-backend.example', { method: 'POST', headers:{Authorization:'Bearer synthetic-session'}, body: new ReadableStream({ cancel }), duplex: 'half' } as RequestInit);
      const response = h.handler(req); await vi.advanceTimersByTimeAsync(5001); expect((await response).status).toBe(408); expect(cancel).toHaveBeenCalled(); for (const provider of h.providers) expect(provider).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
