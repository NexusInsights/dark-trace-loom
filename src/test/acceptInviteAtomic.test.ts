import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';

// Exact Edge handler, isolated Auth/RPC contract fixtures. No database/provider
// is called; these tests do not prove SQL locking or a live invitation delivery.
const source=readFileSync('supabase/functions/accept-invite/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const actor={id:'11111111-1111-4111-8111-111111111111',email:'recipient@example.test'};
const success={status:'success',org_id:'22222222-2222-4222-8222-222222222222',role:'investigator',idempotent:false,already_member:false};
function fixture(options:{auth?:unknown;rpc?:unknown;env?:Record<string,string>;authThrow?:boolean;rpcThrow?:boolean}={}){
  const authResult=options.auth??{data:{user:actor},error:null};
  const rpcResult=options.rpc??{data:success,error:null};
  const getUser=options.authThrow?vi.fn().mockRejectedValue(new Error('private auth diagnostic')):vi.fn().mockResolvedValue(authResult);
  const rpc=options.rpcThrow?vi.fn().mockRejectedValue(new Error('private RPC diagnostic')):vi.fn().mockResolvedValue(rpcResult);
  const from=vi.fn(()=>{throw new Error('Non-atomic fallback is prohibited');});
  const createClient=vi.fn((_url:string,key:string)=>key==='public-fixture'?{auth:{getUser}}:{rpc,from});
  const fetch=vi.fn();
  const timeout=vi.fn(()=>new AbortController().signal);
  const env=options.env??{SUPABASE_URL:'https://owned-backend.example.test',SUPABASE_ANON_KEY:'public-fixture',SUPABASE_SERVICE_ROLE_KEY:'server-fixture'};
  const helpers=new Function('createClient','serve','Deno','fetch','AbortSignal',`${js};return {acceptInvitation,boundedBackendFetch};`)(createClient,()=>undefined,{env:{get:(key:string)=>env[key]}},fetch,{timeout});
  return {...helpers,createClient,getUser,rpc,from,fetch,timeout};
}
const request=(body:unknown={token:'real-token-contract-fixture'},headers:Record<string,string>={Authorization:'Bearer verified-auth-token'})=>new Request('https://app.example.test/accept-invite',{method:'POST',headers,body:JSON.stringify(body)});
describe('atomic invitation Edge acceptance contracts',()=>{
  it('allows OPTIONS and rejects other methods before Auth or RPC',async()=>{
    const f=fixture();expect((await f.acceptInvitation(new Request('https://app.test',{method:'OPTIONS'}))).status).toBe(204);
    expect((await f.acceptInvitation(new Request('https://app.test'))).status).toBe(405);expect(f.createClient).not.toHaveBeenCalled();
  });
  it.each([{}, {Authorization:'Basic credentials'}, {Authorization:'Bearer two tokens'}])('rejects absent or malformed authorization %#',async headers=>{
    const f=fixture();expect((await f.acceptInvitation(request(undefined,headers))).status).toBe(401);expect(f.createClient).not.toHaveBeenCalled();
  });
  it.each([{token:'short'}, {token:'x'.repeat(129)}, {token:'has white space'}, {token:42}, [], {token:'valid-token',user_id:actor.id}, {token:'valid-token',email:actor.email}])('rejects invalid body or attempted actor injection %#',async body=>{
    const f=fixture();expect((await f.acceptInvitation(request(body))).status).toBe(400);expect(f.createClient).not.toHaveBeenCalled();
  });
  it('bounds request bytes and rejects malformed JSON before database access',async()=>{
    const f=fixture();const req=new Request('https://app.test',{method:'POST',headers:{Authorization:'Bearer token'},body:'{'+ 'x'.repeat(3000)});
    expect((await f.acceptInvitation(req)).status).toBe(400);expect(f.createClient).not.toHaveBeenCalled();
  });
  it('fails closed when backend dependencies or URL are not configured',async()=>{
    for(const env of [{},{SUPABASE_URL:'http://owned.example',SUPABASE_ANON_KEY:'public-fixture',SUPABASE_SERVICE_ROLE_KEY:'server-fixture'}]){
      const f=fixture({env});expect((await f.acceptInvitation(request())).status).toBe(503);expect(f.createClient).not.toHaveBeenCalled();
    }
  });
  it('verifies the actual bearer token and only forwards the returned actor ID/email to one RPC',async()=>{
    const f=fixture();const response=await f.acceptInvitation(request());expect(response.status).toBe(200);expect(await response.json()).toEqual(success);
    expect(f.getUser).toHaveBeenCalledWith('verified-auth-token');expect(f.rpc).toHaveBeenCalledExactlyOnceWith('accept_organization_invitation',{p_token:'real-token-contract-fixture',p_user_id:actor.id,p_email:actor.email});expect(f.from).not.toHaveBeenCalled();
  });
  it.each([{data:{user:null},error:null},{data:{user:actor},error:{status:401}},{data:{user:{...actor,id:'unverified-claim'}},error:null}])('does not execute acceptance for invalid Auth %#',async auth=>{
    const f=fixture({auth});expect((await f.acceptInvitation(request())).status).toBe(401);expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([{data:null,error:{status:503}},{data:null,error:{status:0,name:'AuthRetryableFetchError'}}])('reports Auth service failure without claiming an invalid user %#',async auth=>{
    const f=fixture({auth});expect((await f.acceptInvitation(request())).status).toBe(503);expect(f.rpc).not.toHaveBeenCalled();
  });
  it('reports missing atomic RPC instead of falling back to separate table writes',async()=>{
    const f=fixture({rpc:{data:null,error:{code:'PGRST202',message:'private schema diagnostic'}}});const response=await f.acceptInvitation(request());expect(response.status).toBe(424);expect(await response.json()).toEqual({error:'acceptance_not_configured'});expect(f.from).not.toHaveBeenCalled();
  });
  it('does not claim success or reveal private diagnostics when RPC update fails or outcome is uncertain',async()=>{
    for(const options of [{rpc:{data:null,error:{code:'P0001',message:'private token/record diagnostic'}}},{rpcThrow:true},{authThrow:true}]){
      const f=fixture(options);const response=await f.acceptInvitation(request());expect(response.status).toBe(503);expect(await response.text()).not.toContain('private');expect(f.from).not.toHaveBeenCalled();
    }
  });
  it.each([['not_found',404],['email_mismatch',403],['expired',410],['already_accepted',410],['invalid_body',400]] as const)('maps verified RPC rejection %s to %s',async(error,status)=>{
    const f=fixture({rpc:{data:{error,http_status:200},error:null}});const response=await f.acceptInvitation(request());expect(response.status).toBe(status);expect(await response.json()).toEqual({error});
  });
  it.each([null,[],{status:'success'}, {...success,org_id:'wrong-id'}, {error:'__proto__'}])('rejects malformed or unknown backend results %#',async data=>{
    const f=fixture({rpc:{data,error:null}});expect([502,503]).toContain((await f.acceptInvitation(request())).status);
  });
  it('returns confirmed idempotence and actual retained member role without extra backend fields',async()=>{
    const f=fixture({rpc:{data:{...success,role:'owner',idempotent:true,already_member:true,token:'private-token'},error:null}});const response=await f.acceptInvitation(request());expect(await response.json()).toEqual({...success,role:'owner',idempotent:true,already_member:true});expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it('prevents credential forwarding outside the configured backend origin',async()=>{
    const f=fixture();await expect(f.boundedBackendFetch('https://other.example.test/auth/v1/user',{headers:{Authorization:'Bearer fixture'}})).rejects.toThrow('Unexpected backend origin');expect(f.fetch).not.toHaveBeenCalled();
  });
  it('bounds real backend response bytes and disallows redirects',async()=>{
    const f=fixture();f.fetch.mockResolvedValueOnce(new Response('x'.repeat(300*1024)));
    await expect(f.boundedBackendFetch('https://owned-backend.example.test/auth/v1/user')).rejects.toThrow('Body exceeded its limit');expect(f.fetch.mock.calls[0][1].redirect).toBe('error');expect(f.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);expect(f.timeout).toHaveBeenCalledWith(8000);
  });
});
