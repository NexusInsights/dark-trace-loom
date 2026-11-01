import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import * as hashing from '../../supabase/functions/_shared/imageHash';
import {webcrypto} from 'node:crypto';
import {describe,it,expect,vi,afterEach} from 'vitest';

// Execute the exact shared helper and each handler boundary. Fixtures never
// contact Auth, WiGLE or image hosts and are not production acceptance evidence.
const transpile=(file:string)=>ts.transpileModule(readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const sharedJs=transpile('supabase/functions/_shared/authenticateUser.ts');
const owner='11111111-1111-4111-8111-111111111111';
const validUser={id:owner,role:'authenticated',is_anonymous:false};
function fixture(kind:'wigle-lookup'|'image-hash',authResponse:Response|Error=new Response(JSON.stringify(validUser)),envOverride?:Record<string,string>){
  const authFetch=authResponse instanceof Error?vi.fn().mockRejectedValue(authResponse):vi.fn().mockResolvedValue(authResponse);
  const timeout=vi.fn(()=>new AbortController().signal);
  const env=envOverride??{SUPABASE_URL:'https://owned-backend.example.test',SUPABASE_ANON_KEY:'public-fixture',WIGLE_API_NAME:'provider-name-fixture',WIGLE_API_KEY:'provider-key-fixture'};
  const shared=new Function('Deno','fetch','AbortSignal',`${sharedJs};return {authenticateUser,boundedJsonBody,RequestAuthenticationError};`)({env:{get:(key:string)=>env[key]}},authFetch,{timeout});
  const safeFetch=kind==='wigle-lookup'
    ? vi.fn().mockResolvedValue(new Response(JSON.stringify({results:[{ssid:'fixture-network',trilat:1,trilong:2}]})))
    : vi.fn().mockImplementation(async()=>new Response(readFileSync('src/test/fixtures/image-hash/ascending.png')));
  const decode=vi.fn().mockResolvedValue({width:9,height:8,bitmap:new Uint8ClampedArray(9*8*4)});
  let handler:(req:Request)=>Promise<Response>;
  new Function('serve','z','safeFetch','decode','Deno','authenticateUser','boundedJsonBody','RequestAuthenticationError','inspectImage','hashDecodedImage','IMAGE_HASH_MAX_BYTES','IMAGE_HASH_MAX_PIXELS','IMAGE_HASH_MAX_SIDE','crypto',transpile(`supabase/functions/${kind}/index.ts`))(
    (h:typeof handler)=>{handler=h;},z,safeFetch,decode,{env:{get:(key:string)=>env[key]}},shared.authenticateUser,shared.boundedJsonBody,shared.RequestAuthenticationError,hashing.inspectImage,hashing.hashDecodedImage,hashing.IMAGE_HASH_MAX_BYTES,hashing.IMAGE_HASH_MAX_PIXELS,hashing.IMAGE_HASH_MAX_SIDE,webcrypto);
  const request=(headers:Record<string,string>={Authorization:'Bearer valid-session-token'},body:unknown=kind==='wigle-lookup'?{bssid:'AA:BB:CC:DD:EE:FF'}:{url:'https://images.example.test/photo.png'})=>{
    const req=new Request('https://app.example.test',{method:'POST',headers,body:JSON.stringify(body)});
    const originalBody=req.body;let bodyReads=0;Object.defineProperty(req,'body',{get(){bodyReads++;return originalBody;}});
    return {req,get bodyReads(){return bodyReads;}};
  };
  return {handler:handler!,request,authFetch,safeFetch,decode,timeout,...shared};
}
afterEach(()=>vi.useRealTimers());
describe.each(['wigle-lookup','image-hash'] as const)('%s authenticated request boundary',kind=>{
  it('rejects missing authorization before reading body, fetching images or spending provider requests',async()=>{
    const f=fixture(kind);const r=f.request({});expect((await f.handler(r.req)).status).toBe(401);expect(r.bodyReads).toBe(0);expect(f.authFetch).not.toHaveBeenCalled();expect(f.safeFetch).not.toHaveBeenCalled();expect(f.decode).not.toHaveBeenCalled();
  });
  it('rejects invalid auth remotely before body/provider/image work',async()=>{
    const f=fixture(kind,new Response('private Auth diagnostic',{status:401}));const r=f.request();const response=await f.handler(r.req);
    expect(response.status).toBe(401);expect(await response.text()).not.toContain('private');expect(r.bodyReads).toBe(0);expect(f.safeFetch).not.toHaveBeenCalled();expect(f.decode).not.toHaveBeenCalled();
  });
  it('denies an anonymous Auth session with a valid UUID',async()=>{
    const f=fixture(kind,new Response(JSON.stringify({...validUser,is_anonymous:true})));const r=f.request();expect((await f.handler(r.req)).status).toBe(403);expect(r.bodyReads).toBe(0);expect(f.safeFetch).not.toHaveBeenCalled();expect(f.decode).not.toHaveBeenCalled();
  });
  it.each([new Response(JSON.stringify({id:'not-a-uuid'})),new Response('malformed private JSON'),new Response('private outage',{status:500}),new DOMException('Auth timed out','AbortError')])('fails closed on malformed Auth, outage or timeout %#',async response=>{
    const f=fixture(kind,response);const r=f.request();expect([502,503]).toContain((await f.handler(r.req)).status);expect(r.bodyReads).toBe(0);expect(f.safeFetch).not.toHaveBeenCalled();expect(f.decode).not.toHaveBeenCalled();expect(f.timeout).toHaveBeenCalledWith(15000);
  });
  it('uses the public key and verifies actual token claims via fixed Auth endpoint with redirects disallowed',async()=>{
    const f=fixture(kind);expect(await f.authenticateUser(f.request().req)).toEqual({id:owner});expect(f.authFetch.mock.calls[0][0]).toBe('https://owned-backend.example.test/auth/v1/user');expect(f.authFetch.mock.calls[0][1]).toMatchObject({redirect:'error',headers:{Authorization:'Bearer valid-session-token',apikey:'public-fixture'}});
  });
  it('does not substitute a service-role key when public Auth configuration is missing or privileged',async()=>{
    for(const env of [{SUPABASE_URL:'https://owned-backend.example.test',SUPABASE_SERVICE_ROLE_KEY:'private-fixture'},{SUPABASE_URL:'https://owned-backend.example.test',SUPABASE_ANON_KEY:'sb_secret_fixture'}]){
      const f=fixture(kind,undefined,env);expect((await f.handler(f.request().req)).status).toBe(503);expect(f.authFetch).not.toHaveBeenCalled();expect(f.safeFetch).not.toHaveBeenCalled();
    }
  });
  it('supports configured publishable keys without requiring a legacy JWT public key',async()=>{
    const f=fixture(kind,undefined,{SUPABASE_URL:'https://owned-backend.example.test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'});expect(await f.authenticateUser(f.request().req)).toEqual({id:owner});expect(f.authFetch.mock.calls[0][1].headers.apikey).toBe('sb_publishable_fixture');
  });
  it('rejects oversized request bytes after Auth and before provider/image fetch',async()=>{
    const f=fixture(kind);const r=f.request(undefined,{padding:'x'.repeat(17000)});expect((await f.handler(r.req)).status).toBe(413);expect(f.safeFetch).not.toHaveBeenCalled();expect(f.decode).not.toHaveBeenCalled();
  });
  it('rejects GET, permits preflight and never verifies Auth for either',async()=>{
    const f=fixture(kind);expect((await f.handler(new Request('https://app.test'))).status).toBe(405);expect((await f.handler(new Request('https://app.test',{method:'OPTIONS'}))).status).toBe(204);expect(f.authFetch).not.toHaveBeenCalled();expect(f.safeFetch).not.toHaveBeenCalled();
  });
  it('allows the existing supplied-data operation only after successful Auth',async()=>{
    const f=fixture(kind);const r=f.request();const response=await f.handler(r.req);expect(response.status).toBe(200);expect((await response.json()).status).toBe('success');expect(f.authFetch).toHaveBeenCalledTimes(1);expect(f.safeFetch).toHaveBeenCalledTimes(1);expect(r.bodyReads).toBeGreaterThan(0);
    if(kind==='image-hash')expect(f.decode).toHaveBeenCalledTimes(1);
  });
});
describe('bounded shared request body',()=>{
  it('cancels a stalled request at the read deadline without provider/image work',async()=>{
    vi.useFakeTimers();const f=fixture('image-hash');const stream=new ReadableStream<Uint8Array>({start(){}});
    const req={headers:new Headers(),body:stream} as unknown as Request;
    const outcome=f.boundedJsonBody(req).catch((error:unknown)=>error);await vi.advanceTimersByTimeAsync(15001);expect(await outcome).toMatchObject({status:408,code:'request_timed_out'});expect(f.safeFetch).not.toHaveBeenCalled();expect(f.decode).not.toHaveBeenCalled();
  });
  it('bounds successful Auth response size and suppresses its private contents',async()=>{
    const f=fixture('image-hash',new Response('x'.repeat(70000)));const response=await f.handler(f.request().req);expect(response.status).toBe(503);expect((await response.text()).length).toBeLessThan(200);expect(f.safeFetch).not.toHaveBeenCalled();
  });
});
