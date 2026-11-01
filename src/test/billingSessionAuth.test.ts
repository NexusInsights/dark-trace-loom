import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';

// Exact handler/helper execution with the pinned SDK, isolated account/DB
// fixtures, and no live account request/session/purchase creation.
const require=createRequire(import.meta.url);
const StripeSDK=require('stripe');
const transpile=(file:string)=>ts.transpileModule(readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const sharedJs=transpile('supabase/functions/_shared/authenticateUser.ts')+transpile('supabase/functions/_shared/billingConfiguration.ts');
const actor={id:'11111111-1111-4111-8111-111111111111',email:'recipient@example.test',role:'authenticated',is_anonymous:false};
const approvedPrice='price_1T9NC1Q4s8rfSgucApe67wQN';
const storedCustomer={id:'cus_fixture',email:actor.email,metadata:{user_id:actor.id}};
const validPrice={id:approvedPrice,active:true,recurring:{interval:'month'},product:'prod_U7cQdUjRIZLpaD'};
type Route='create-checkout'|'customer-portal';
type Options={env?:Record<string,string>;auth?:Response|Error;local?:unknown;readError?:boolean;customer?:unknown;customers?:unknown;price?:unknown;providerError?:boolean;sessionUrl?:unknown};
function fixture(route:Route,options:Options={}){
  const authFetch=options.auth instanceof Error?vi.fn().mockRejectedValue(options.auth):vi.fn().mockResolvedValue(options.auth??new Response(JSON.stringify(actor)));
  const env=options.env??{SUPABASE_URL:'https://owned-backend.example.test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SERVICE_ROLE_KEY:'server-fixture',STRIPE_SECRET_KEY:'sk_test_isolated_fixture',APP_ORIGIN:'https://owned-app.example.test'};
  const timeout=vi.fn(()=>new AbortController().signal);
  const shared=new Function('Deno','fetch','AbortSignal',`${sharedJs};return {authenticateUser,boundedJsonBody,boundedRawBody,RequestAuthenticationError,billingAppOrigin,billingBackendFetch,stripeSessionUrl};`)({env:{get:(key:string)=>env[key]}},authFetch,{timeout});
  const retrieveCustomer=options.providerError?vi.fn().mockRejectedValue(new Error('private Stripe diagnostic')):vi.fn().mockResolvedValue(options.customer??storedCustomer);
  const listCustomers=vi.fn().mockResolvedValue(options.customers??{data:[storedCustomer],has_more:false});
  const retrievePrice=vi.fn().mockResolvedValue(options.price??validPrice);
  const createSession=options.providerError?vi.fn().mockRejectedValue(new Error('private Stripe diagnostic')):vi.fn().mockResolvedValue({url:options.sessionUrl===undefined?(route==='create-checkout'?'https://checkout.stripe.com/c/pay/fixture':'https://billing.stripe.com/p/session/fixture'):options.sessionUrl});
  const configs:unknown[]=[];const external=vi.fn(()=>Promise.reject(new Error('Live account request is prohibited')));
  class FixtureStripe extends StripeSDK{
    static createFetchHttpClient(){return StripeSDK.createFetchHttpClient(external);}
    constructor(key:string,config:unknown){super(key,config);configs.push(config);this.prices.retrieve=retrievePrice;this.customers.retrieve=retrieveCustomer;this.customers.list=listCustomers;this.checkout.sessions.create=createSession;this.billingPortal.sessions.create=createSession;}
  }
  const maybeSingle=vi.fn().mockResolvedValue({data:options.local===undefined?{stripe_customer_id:'cus_fixture'}:options.local,error:options.readError?{message:'private database diagnostic'}:null});
  const eq=vi.fn(()=>({maybeSingle}));const from=vi.fn(()=>({select:()=>({eq})}));const createClient=vi.fn(()=>({from}));
  let handler:(req:Request)=>Promise<Response>;
  new Function('serve','Stripe','createClient','Deno','authenticateUser','boundedJsonBody','boundedRawBody','RequestAuthenticationError','billingAppOrigin','billingBackendFetch','stripeSessionUrl',transpile(`supabase/functions/${route}/index.ts`))((h:typeof handler)=>{handler=h;},FixtureStripe,createClient,{env:{get:(key:string)=>env[key]}},shared.authenticateUser,shared.boundedJsonBody,shared.boundedRawBody,shared.RequestAuthenticationError,shared.billingAppOrigin,shared.billingBackendFetch,shared.stripeSessionUrl);
  const request=(body:unknown=route==='create-checkout'?{priceId:approvedPrice}:undefined,headers:Record<string,string>={Authorization:'Bearer fixture-session',Origin:'https://untrusted-return.example.test'},method='POST')=>{
    const req=new Request('https://app.example.test/billing',{method,headers,...(body===undefined||method!=='POST'?{}:{body:JSON.stringify(body)})});const bytes=req.body;let reads=0;Object.defineProperty(req,'body',{get(){reads++;return bytes;}});return {req,get reads(){return reads;}};
  };
  return {handler:handler!,request,authFetch,createClient,eq,from,retrieveCustomer,listCustomers,retrievePrice,createSession,configs,external,...shared};
}
describe.each(['create-checkout','customer-portal'] as const)('%s verified-session and return-origin boundary',route=>{
  it('rejects missing sessions before reading body or constructing DB/Stripe clients',async()=>{const f=fixture(route);const r=f.request(undefined,{});expect((await f.handler(r.req)).status).toBe(401);expect(r.reads).toBe(0);expect(f.authFetch).not.toHaveBeenCalled();expect(f.createClient).not.toHaveBeenCalled();expect(f.configs).toHaveLength(0);expect(f.createSession).not.toHaveBeenCalled();});
  it.each([new Response('private invalid token',{status:401}),new Response(JSON.stringify({...actor,is_anonymous:true})),new Response(JSON.stringify({...actor,email:undefined})),new DOMException('private Auth timeout','AbortError')])('rejects false credentials/anonymous/missing verified email/Auth timeout before body or privileged work %#',async auth=>{
    const f=fixture(route,{auth});const r=f.request();const response=await f.handler(r.req);expect([401,403,503]).toContain(response.status);expect(await response.text()).not.toContain('private');expect(r.reads).toBe(0);expect(f.createClient).not.toHaveBeenCalled();expect(f.configs).toHaveLength(0);expect(f.createSession).not.toHaveBeenCalled();
  });
  it('permits OPTIONS and rejects GET without any session or provider call',async()=>{const f=fixture(route);expect((await f.handler(f.request(undefined,{},'OPTIONS').req)).status).toBe(204);expect((await f.handler(f.request(undefined,{},'GET').req)).status).toBe(405);expect(f.authFetch).not.toHaveBeenCalled();expect(f.createClient).not.toHaveBeenCalled();expect(f.createSession).not.toHaveBeenCalled();});
  it('rejects a missing Stripe key with424 before database/customer/session work',async()=>{
    const f=fixture(route,{env:{SUPABASE_URL:'https://owned-backend.example.test',SUPABASE_PUBLISHABLE_KEY:'public-fixture',SUPABASE_SERVICE_ROLE_KEY:'server-fixture',APP_ORIGIN:'https://owned-app.example.test'}});expect((await f.handler(f.request().req)).status).toBe(424);expect(f.createClient).not.toHaveBeenCalled();expect(f.configs).toHaveLength(0);expect(f.createSession).not.toHaveBeenCalled();
  });
  it.each(['','http://unsafe.example.test','https://user:password@app.example.test','https://app.example.test/path','https://app.example.test/?query=1','https://app.example.test/#fragment'])('rejects invalid configured APP_ORIGIN %s before all privileged/provider work',async origin=>{
    const f=fixture(route,{env:{SUPABASE_URL:'https://owned-backend.example.test',SUPABASE_PUBLISHABLE_KEY:'public-fixture',SUPABASE_SERVICE_ROLE_KEY:'server-fixture',STRIPE_SECRET_KEY:'sk_test_isolated_fixture',APP_ORIGIN:origin}});expect((await f.handler(f.request().req)).status).toBe(424);expect(f.createClient).not.toHaveBeenCalled();expect(f.configs).toHaveLength(0);expect(f.createSession).not.toHaveBeenCalled();
  });
  it('does not let a body select another user, customer or redirect',async()=>{
    const f=fixture(route);const body=route==='create-checkout'?{priceId:approvedPrice,customerId:'cus_other',return_url:'https://victim.example.test'}:{customerId:'cus_other'};expect((await f.handler(f.request(body).req)).status).toBe(400);expect(f.createClient).not.toHaveBeenCalled();expect(f.createSession).not.toHaveBeenCalled();
  });
  it('bounds actual request bytes before DB/provider calls',async()=>{const f=fixture(route);expect((await f.handler(f.request({padding:'x'.repeat(2200)}).req)).status).toBe(413);expect(f.createClient).not.toHaveBeenCalled();expect(f.createSession).not.toHaveBeenCalled();});
  it('uses only configured APP_ORIGIN and verified actor/customer despite a hostile Origin header',async()=>{
    const f=fixture(route);const r=await f.handler(f.request().req);expect(r.status).toBe(200);expect(f.eq).toHaveBeenCalledWith('user_id',actor.id);expect(f.retrieveCustomer).toHaveBeenCalledWith('cus_fixture');expect(f.listCustomers).not.toHaveBeenCalled();expect(f.createSession).toHaveBeenCalledTimes(1);
    expect(f.createSession.mock.calls[0][0]).toMatchObject(route==='create-checkout'?{customer:'cus_fixture',success_url:'https://owned-app.example.test/dashboard?checkout=success',cancel_url:'https://owned-app.example.test/pricing?canceled=true',metadata:{user_id:actor.id}}:{customer:'cus_fixture',return_url:'https://owned-app.example.test/pricing'});expect(JSON.stringify(f.createSession.mock.calls[0][0])).not.toContain('untrusted');expect(f.configs[0]).toMatchObject({timeout:10000,maxNetworkRetries:0,apiVersion:'2025-08-27.basil'});expect(f.external).not.toHaveBeenCalled();
  });
  it('protects a manually approved Enterprise account from unintended Stripe session creation',async()=>{const f=fixture(route,{local:{stripe_customer_id:'admin_override_enterprise'}});expect((await f.handler(f.request().req)).status).toBe(409);expect(f.configs).toHaveLength(0);expect(f.createSession).not.toHaveBeenCalled();});
  it.each([{id:'cus_fixture',email:'different@example.test',metadata:{}},{...storedCustomer,metadata:{user_id:'another-actor'}},{id:'cus_fixture',deleted:true},{...storedCustomer,id:'cus_other'}])('rejects mismatched/deleted customer ownership %#',async customer=>{
    const f=fixture(route,{customer});expect((await f.handler(f.request().req)).status).toBe(409);expect(f.listCustomers).not.toHaveBeenCalled();expect(f.createSession).not.toHaveBeenCalled();
  });
  it('rejects ambiguous email-only customer results instead of selecting first',async()=>{const f=fixture(route,{local:null,customers:{data:[storedCustomer,storedCustomer],has_more:false}});expect((await f.handler(f.request().req)).status).toBe(409);expect(f.createSession).not.toHaveBeenCalled();});
  it.each([{readError:true},{providerError:true}])('handles database/provider errors without leaking private diagnostics or declaring session success %#',async options=>{const f=fixture(route,options);const r=await f.handler(f.request().req);expect(r.status).toBe(503);expect(await r.text()).not.toContain('private');expect(f.external).not.toHaveBeenCalled();});
  it('fails explicitly if provider returns an unsafe session URL',async()=>{const f=fixture(route,{sessionUrl:'http://untrusted-return.example.test/session'});const r=await f.handler(f.request().req);expect(r.status).toBe(502);expect(await r.json()).toEqual({error:'invalid_billing_session_response'});});
  it('preserves an already configured custom HTTPS domain returned by the Stripe API',async()=>{const f=fixture(route,{sessionUrl:'https://payments.example.test/provider-session'});const r=await f.handler(f.request().req);expect(r.status).toBe(200);expect(await r.json()).toEqual({url:'https://payments.example.test/provider-session'});expect(f.createSession).toHaveBeenCalledTimes(1);expect(f.external).not.toHaveBeenCalled();});
});
describe('checkout app price/product scope',()=>{
  it('rejects an arbitrary price before Stripe or DB work',async()=>{const f=fixture('create-checkout');expect((await f.handler(f.request({priceId:'price_other'}).req)).status).toBe(400);expect(f.createClient).not.toHaveBeenCalled();expect(f.retrievePrice).not.toHaveBeenCalled();expect(f.createSession).not.toHaveBeenCalled();});
  it.each([{...validPrice,product:'prod_unrelated'},{...validPrice,active:false},{...validPrice,recurring:null},{...validPrice,id:'price_other'}])('checks actual provider price scope before creating a session %#',async price=>{const f=fixture('create-checkout',{price});expect((await f.handler(f.request().req)).status).toBe(424);expect(f.createSession).not.toHaveBeenCalled();expect(f.retrieveCustomer).not.toHaveBeenCalled();});
  it('can retain the original new-customer email flow only after verified Auth and approved price',async()=>{const f=fixture('create-checkout',{local:null,customers:{data:[],has_more:false}});expect((await f.handler(f.request().req)).status).toBe(200);expect(f.createSession).toHaveBeenCalledWith(expect.objectContaining({customer:undefined,customer_email:actor.email,line_items:[{price:approvedPrice,quantity:1}]}));});
  it('does not pretend a portal exists when there is no verified customer',async()=>{const f=fixture('customer-portal',{local:null,customers:{data:[],has_more:false}});expect((await f.handler(f.request().req)).status).toBe(404);expect(f.createSession).not.toHaveBeenCalled();});
});
