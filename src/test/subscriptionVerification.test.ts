import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';

// Execute the actual helpers/handler with isolated Auth/provider/database
// fixtures. Neither fixture success nor signature success proves live billing.
const require=createRequire(import.meta.url);
const StripeSDK=require('stripe');
const transpile=(file:string)=>ts.transpileModule(readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const authJs=transpile('supabase/functions/_shared/authenticateUser.ts');
const stateJs=transpile('supabase/functions/_shared/stripeSubscription.ts');
const handlerJs=transpile('supabase/functions/check-subscription/index.ts');
const actor={id:'11111111-1111-4111-8111-111111111111',email:'recipient@example.test',role:'authenticated',is_anonymous:false};
const subscription={id:'sub_fixture',customer:'cus_fixture',status:'active',items:{data:[{current_period_end:2000000000,price:{product:'prod_U7cSZe7C3SrSuh'}}]}};
const localRecord={plan:'enterprise',status:'active',current_period_end:null,stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_fixture'};
type Options={local?:unknown;auth?:Response|Error;env?:Record<string,string>;readError?:boolean;writeError?:boolean;customer?:unknown;sub?:unknown;customers?:unknown;subscriptions?:unknown;providerError?:boolean};
function fixture(options:Options={}){
  const network=options.auth instanceof Error?vi.fn().mockRejectedValue(options.auth):vi.fn().mockResolvedValue(options.auth??new Response(JSON.stringify(actor)));
  const timeout=vi.fn(()=>new AbortController().signal);
  const env=options.env??{SUPABASE_URL:'https://owned-backend.example.test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SERVICE_ROLE_KEY:'server-fixture',STRIPE_SECRET_KEY:'sk_test_isolated_fixture'};
  const shared=new Function('Deno','fetch','AbortSignal',`${authJs};return {authenticateUser,boundedRawBody,RequestAuthenticationError};`)({env:{get:(key:string)=>env[key]}},network,{timeout});
  const retrieveCustomer=options.providerError?vi.fn().mockRejectedValue(new Error('private account diagnostic')):vi.fn().mockResolvedValue(options.customer??{id:'cus_fixture',email:actor.email});
  const retrieveSubscription=vi.fn().mockResolvedValue(options.sub??subscription);
  const listCustomers=vi.fn().mockResolvedValue(options.customers??{data:[{id:'cus_fixture',email:actor.email}],has_more:false});
  const listSubscriptions=vi.fn().mockResolvedValue(options.subscriptions??{data:[subscription],has_more:false});
  const stripeConfigs:unknown[]=[];
  class FixtureStripe extends StripeSDK {
    static createFetchHttpClient(){return StripeSDK.createFetchHttpClient(()=>Promise.reject(new Error('No real provider requests allowed')));}
    constructor(key:string,config:unknown){super(key,config);stripeConfigs.push(config);this.customers.retrieve=retrieveCustomer;this.customers.list=listCustomers;this.subscriptions.retrieve=retrieveSubscription;this.subscriptions.list=listSubscriptions;}
  }
  const upsert=vi.fn().mockResolvedValue({error:options.writeError?{message:'private database diagnostic'}:null});
  const maybeSingle=vi.fn().mockResolvedValue({data:options.local===undefined?localRecord:options.local,error:options.readError?{message:'private read diagnostic'}:null});
  const eq=vi.fn(()=>({maybeSingle}));
  const from=vi.fn(()=>({select:()=>({eq}),upsert}));
  const createClient=vi.fn(()=>({from}));
  let handler:(req:Request)=>Promise<Response>;
  new Function('serve','Stripe','createClient','Deno','authenticateUser','boundedRawBody','RequestAuthenticationError','fetch','AbortSignal',stateJs+handlerJs)((h:typeof handler)=>{handler=h;},FixtureStripe,createClient,{env:{get:(key:string)=>env[key]}},shared.authenticateUser,shared.boundedRawBody,shared.RequestAuthenticationError,network,{timeout});
  const request=(method='GET',body?:unknown,headers:Record<string,string>={Authorization:'Bearer fixture-session'})=>new Request('https://app.example.test/check-subscription',{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {handler:handler!,request,network,timeout,createClient,upsert,eq,retrieveCustomer,retrieveSubscription,listCustomers,listSubscriptions,stripeConfigs};
}
describe('check-subscription preserved account boundaries',()=>{
  it('allows GET monitor checks and POST UI checks after actual session verification',async()=>{
    for(const method of ['GET','POST']){const f=fixture();const r=await f.handler(f.request(method));expect(r.status).toBe(200);expect(await r.json()).toMatchObject({plan:'enterprise',subscribed:true,billing_verification:'verified'});expect(f.eq).toHaveBeenCalledWith('user_id',actor.id);expect(f.upsert).toHaveBeenCalledWith(expect.objectContaining({current_period_end:new Date(2000000000000).toISOString()}),{onConflict:'user_id'});}
  });
  it('never creates privileged clients for absent sessions',async()=>{const f=fixture();expect((await f.handler(f.request('GET',undefined,{}))).status).toBe(401);expect(f.network).not.toHaveBeenCalled();expect(f.createClient).not.toHaveBeenCalled();expect(f.stripeConfigs).toHaveLength(0);});
  it.each([new Response('private Auth reason',{status:401}),new Response(JSON.stringify({...actor,is_anonymous:true})),new Response(JSON.stringify({...actor,email:undefined})),new Response(JSON.stringify({id:'bad-id'})),new DOMException('private timeout','AbortError')])('stops malformed/anonymous/missing-email/failed Auth before any privileged work %#',async auth=>{
    const f=fixture({auth});const r=await f.handler(f.request());expect([401,403,502,503]).toContain(r.status);expect(await r.text()).not.toContain('private');expect(f.createClient).not.toHaveBeenCalled();expect(f.stripeConfigs).toHaveLength(0);
  });
  it('rejects actor injection and oversized input before database access',async()=>{
    for(const body of [{user_id:'another-user'},{email:'victim@example.test'},{padding:'x'.repeat(2100)}]){const f=fixture();expect([400,413]).toContain((await f.handler(f.request('POST',body))).status);expect(f.createClient).not.toHaveBeenCalled();}
  });
  it('permits preflight and rejects unsupported methods without session/provider work',async()=>{const f=fixture();expect((await f.handler(f.request('OPTIONS'))).status).toBe(204);expect((await f.handler(f.request('DELETE'))).status).toBe(405);expect(f.network).not.toHaveBeenCalled();expect(f.createClient).not.toHaveBeenCalled();});
  it('returns the approved exact Enterprise override before Stripe initialization or writes',async()=>{
    const f=fixture({local:{...localRecord,stripe_customer_id:'admin_override_enterprise',stripe_subscription_id:null}});const r=await f.handler(f.request());expect(await r.json()).toEqual({plan:'enterprise',subscribed:true,subscription_end:null,billing_verification:'admin_override'});expect(f.upsert).not.toHaveBeenCalled();expect(f.stripeConfigs).toHaveLength(0);
  });
  it('does not grant a malformed Free sentinel record Enterprise access',async()=>{const f=fixture({local:{...localRecord,plan:'free',stripe_customer_id:'admin_override_enterprise'}});expect((await f.handler(f.request())).status).toBe(502);expect(f.upsert).not.toHaveBeenCalled();expect(f.stripeConfigs).toHaveLength(0);});
  it('preserves a paid migration record with explicit pending verification when Stripe key is absent',async()=>{
    const f=fixture({env:{SUPABASE_URL:'https://owned-backend.example.test',SUPABASE_PUBLISHABLE_KEY:'public-fixture',SUPABASE_SERVICE_ROLE_KEY:'server-fixture'}});const r=await f.handler(f.request());expect(await r.json()).toMatchObject({plan:'enterprise',subscribed:true,billing_verification:'pending',verification_reason:'stripe_not_configured'});expect(f.upsert).not.toHaveBeenCalled();expect(f.stripeConfigs).toHaveLength(0);
  });
  it.each([{providerError:true},{customer:{id:'cus_fixture',email:'another@example.test'}},{customer:{id:'cus_fixture',deleted:true}},{sub:{...subscription,customer:'cus_other'}}])('preserves paid records when configured account/customer/subscription cannot be verified %#',async options=>{
    const f=fixture(options);const r=await f.handler(f.request());expect(await r.json()).toMatchObject({plan:'enterprise',subscribed:true,billing_verification:'pending'});expect(f.upsert).not.toHaveBeenCalled();expect(f.listCustomers).not.toHaveBeenCalled();
  });
  it('does not demote paid records when an email search has no customer in this Stripe account',async()=>{
    const f=fixture({local:{...localRecord,stripe_customer_id:null,stripe_subscription_id:null},customers:{data:[],has_more:false}});expect(await(await f.handler(f.request())).json()).toMatchObject({plan:'enterprise',billing_verification:'pending'});expect(f.upsert).not.toHaveBeenCalled();
  });
  it('does not demote a stored paid customer when no active subscription is returned',async()=>{
    const f=fixture({local:{...localRecord,stripe_subscription_id:null},subscriptions:{data:[],has_more:false}});expect(await(await f.handler(f.request())).json()).toMatchObject({plan:'enterprise',billing_verification:'pending'});expect(f.upsert).not.toHaveBeenCalled();
  });
  it('does not select ambiguous customers or paginated/ambiguous subscriptions',async()=>{
    for(const options of [{local:null,customers:{data:[{id:'cus_one'},{id:'cus_two'}],has_more:false}},{local:{...localRecord,stripe_subscription_id:null},subscriptions:{data:[subscription],has_more:true}},{local:{...localRecord,stripe_subscription_id:null},subscriptions:{data:[subscription,subscription],has_more:false}}]){const f=fixture(options);expect(await(await f.handler(f.request())).json()).toMatchObject({billing_verification:'pending'});expect(f.upsert).not.toHaveBeenCalled();}
  });
  it('does not invent paid plan or a date for unknown products/invalid periods',async()=>{
    for(const sub of [{...subscription,items:{data:[{current_period_end:2000000000,price:{product:'prod_unknown'}}]}},{...subscription,items:{data:[{current_period_end:0,price:{product:'prod_U7cSZe7C3SrSuh'}}]}}]){const f=fixture({sub});expect(await(await f.handler(f.request())).json()).toMatchObject({plan:'enterprise',billing_verification:'pending'});expect(f.upsert).not.toHaveBeenCalled();}
  });
  it('reflects terminal cancellation only from the exact verified stored subscription',async()=>{
    const f=fixture({sub:{...subscription,status:'canceled'}});expect(await(await f.handler(f.request())).json()).toMatchObject({plan:'free',subscribed:false,billing_verification:'verified'});expect(f.upsert).toHaveBeenCalledWith(expect.objectContaining({plan:'free',status:'canceled',stripe_subscription_id:'sub_fixture'}),{onConflict:'user_id'});
  });
  it.each([{readError:true},{writeError:true}])('handles persistence failures without claiming synchronization or disclosing raw diagnostics %#',async options=>{
    const f=fixture(options);const r=await f.handler(f.request());expect(r.status).toBe(503);expect(await r.text()).not.toContain('private');
  });
  it('bounds provider calls and disables paid retry fanout',async()=>{const f=fixture();await f.handler(f.request());expect(f.stripeConfigs[0]).toMatchObject({timeout:10000,maxNetworkRetries:0,apiVersion:'2025-08-27.basil'});});
});
describe('shared pinned Stripe subscription shapes',()=>{
  const state=new Function(`${stateJs};return {subscriptionState,invoiceSubscriptionId};`)();
  it('prefers Basil item renewal over conflicting legacy top-level date',()=>{expect(state.subscriptionState({...subscription,current_period_end:1000000000}).periodEnd).toBe(new Date(2000000000000).toISOString());});
  it('supports legacy saved events only when item period is absent',()=>{expect(state.subscriptionState({...subscription,current_period_end:2000000000,items:{data:[{price:{product:{id:'prod_U7cSZe7C3SrSuh'}}}]}}).plan).toBe('enterprise');});
  it('rejects mixed mapped plans and invalid dates instead of selecting an arbitrary plan',()=>{expect(()=>state.subscriptionState({...subscription,items:{data:[...subscription.items.data,{current_period_end:2000000000,price:{product:'prod_U7cSMflIeLynmi'}}]}})).toThrow();expect(()=>state.subscriptionState({...subscription,current_period_end:2000000000,items:{data:[{current_period_end:-1,price:{product:'prod_U7cSZe7C3SrSuh'}}]}})).toThrow();});
  it('recognizes Basil invoice parents and legacy IDs without accepting malformed reference objects',()=>{expect(state.invoiceSubscriptionId({parent:{subscription_details:{subscription:{id:'sub_parent'}}},subscription:'sub_old'})).toBe('sub_parent');expect(state.invoiceSubscriptionId({subscription:'sub_old'})).toBe('sub_old');expect(()=>state.invoiceSubscriptionId({subscription:{id:'invalid'}})).toThrow();});
});
