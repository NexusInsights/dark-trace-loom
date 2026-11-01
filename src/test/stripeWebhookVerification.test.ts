import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';

// Use the actual pinned Stripe SDK/WebCrypto verifier locally. Fixture signing
// secrets and mocked persistence are isolated; no Stripe/Supabase account call.
const require=createRequire(import.meta.url);
const StripeSDK=require('stripe');
const transpile=(file:string)=>ts.transpileModule(readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const sharedJs=transpile('supabase/functions/_shared/authenticateUser.ts');
const handlerJs=transpile('supabase/functions/_shared/stripeSubscription.ts')+transpile('supabase/functions/stripe-webhook/index.ts');
const signingSecret='whsec_isolated_signature_fixture';
const actor={id:'11111111-1111-4111-8111-111111111111',email:'recipient@example.test'};
const subscription={id:'sub_fixture',customer:'cus_fixture',status:'active',items:{data:[{current_period_end:2000000000,price:{product:'prod_U7cSZe7C3SrSuh'}}]}};
function fixture(options:{env?:Record<string,string>;override?:boolean;existing?:unknown;delivered?:boolean;deliveryError?:boolean;writeError?:boolean;logError?:boolean;stripeError?:boolean}={}){
  const network=vi.fn(()=>Promise.reject(new Error('External account requests are prohibited in these tests')));
  const retrieveCustomer=options.stripeError?vi.fn().mockRejectedValue(new Error('private customer diagnostic')):vi.fn().mockResolvedValue({email:actor.email});
  const retrieveSubscription=vi.fn().mockResolvedValue(subscription);
  const stripeCalls:unknown[]=[];const verifiers:Array<ReturnType<typeof vi.spyOn>>=[];
  class FixtureStripe extends StripeSDK {
    static createFetchHttpClient(){return StripeSDK.createFetchHttpClient(network);}
    static createSubtleCryptoProvider(){return StripeSDK.createSubtleCryptoProvider(webcrypto.subtle);}
    constructor(key:string,config:unknown){super(key,config);stripeCalls.push(config);this.customers.retrieve=retrieveCustomer;this.subscriptions.retrieve=retrieveSubscription;verifiers.push(vi.spyOn(this.webhooks,'constructEventAsync'));}
  }
  const upsert=vi.fn().mockResolvedValue({error:options.writeError?{message:'private database diagnostic'}:null});
  const insert=vi.fn().mockResolvedValue({error:options.logError?{code:'XX000',message:'private billing diagnostic'}:null});
  const maybeSingle=vi.fn().mockResolvedValue({data:options.override?{stripe_customer_id:'admin_override_enterprise'}:options.existing===undefined?{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_fixture'}:options.existing,error:null});
  const deliveryLookup=vi.fn().mockResolvedValue({data:options.delivered?{id:'delivered-fixture'}:null,error:options.deliveryError?{message:'private lookup diagnostic'}:null});
  const from=vi.fn((table:string)=>table==='subscriptions'?{select:()=>({eq:()=>({maybeSingle})}),upsert}:{select:()=>({eq:()=>({maybeSingle:deliveryLookup})}),insert});
  const listUsers=vi.fn().mockResolvedValue({data:{users:[actor]},error:null});
  const createClient=vi.fn(()=>({from,auth:{admin:{listUsers}}}));
  const env=options.env??{STRIPE_SECRET_KEY:'sk_test_isolated_fixture',STRIPE_WEBHOOK_SECRET:signingSecret,SUPABASE_URL:'https://owned-backend.example.test',SUPABASE_SERVICE_ROLE_KEY:'server-fixture'};
  const timeout=vi.fn(()=>new AbortController().signal);
  const shared=new Function('Deno','fetch','AbortSignal',`${sharedJs};return {boundedRawBody,RequestAuthenticationError};`)({env:{get:(key:string)=>env[key]}},network,{timeout});
  let handler:(req:Request)=>Promise<Response>;
  new Function('serve','Stripe','createClient','Deno','boundedRawBody','RequestAuthenticationError','fetch','AbortSignal',handlerJs)((h:typeof handler)=>{handler=h;},FixtureStripe,createClient,{env:{get:(key:string)=>env[key]}},shared.boundedRawBody,shared.RequestAuthenticationError,network,{timeout});
  return {handler:handler!,network,retrieveCustomer,retrieveSubscription,createClient,upsert,insert,from,listUsers,stripeCalls,verifiers,deliveryLookup};
}
const event=(type='customer.subscription.updated',object:unknown=subscription)=>({id:'evt_fixture',object:'event',type,created:Math.floor(Date.now()/1000),data:{object}});
function signedRequest(value:unknown=event(),options:{tampered?:boolean;timestamp?:number;secret?:string}={}){
  const raw=JSON.stringify(value,null,2);
  const sdk=new StripeSDK('sk_test_isolated_fixture');
  const signature=sdk.webhooks.generateTestHeaderString({payload:raw,secret:options.secret??signingSecret,timestamp:options.timestamp});
  return {raw,signature,request:new Request('https://app.test/webhook',{method:'POST',headers:{'stripe-signature':signature},body:options.tampered?raw+' ':raw})};
}
describe('Stripe webhook verified processing boundary',()=>{
  it('rejects non-POST before reading payload or creating API clients',async()=>{const f=fixture();expect((await f.handler(new Request('https://app.test'))).status).toBe(405);expect(f.stripeCalls).toHaveLength(0);expect(f.createClient).not.toHaveBeenCalled();});
  it.each(['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'])('rejects missing %s without unsigned fallback or external calls',async missing=>{
    const env={STRIPE_SECRET_KEY:'sk_test_isolated_fixture',STRIPE_WEBHOOK_SECRET:signingSecret,SUPABASE_URL:'https://owned-backend.example.test',SUPABASE_SERVICE_ROLE_KEY:'server-fixture'};delete env[missing as keyof typeof env];
    const f=fixture({env});const response=await f.handler(signedRequest().request);expect(response.status).toBe(424);expect(f.stripeCalls).toHaveLength(0);expect(f.createClient).not.toHaveBeenCalled();expect(f.network).not.toHaveBeenCalled();
  });
  it('rejects absent signature even for a plausible subscription event',async()=>{
    const f=fixture();const req=new Request('https://app.test',{method:'POST',body:JSON.stringify(event())});expect((await f.handler(req)).status).toBe(400);expect(f.createClient).not.toHaveBeenCalled();expect(f.upsert).not.toHaveBeenCalled();expect(f.retrieveCustomer).not.toHaveBeenCalled();expect(f.network).not.toHaveBeenCalled();
  });
  it.each([{tampered:true},{secret:'whsec_wrong_fixture'},{timestamp:1}])('actual SDK rejects tampering, wrong secret or stale signature %# before all DB/provider work',async options=>{
    const f=fixture();const response=await f.handler(signedRequest(event(),options).request);expect(response.status).toBe(400);expect(await response.json()).toEqual({error:'invalid_signature'});expect(f.verifiers).toHaveLength(1);expect(f.createClient).not.toHaveBeenCalled();expect(f.upsert).not.toHaveBeenCalled();expect(f.insert).not.toHaveBeenCalled();expect(f.retrieveCustomer).not.toHaveBeenCalled();expect(f.retrieveSubscription).not.toHaveBeenCalled();expect(f.network).not.toHaveBeenCalled();
  });
  it('passes the exact raw body to async WebCrypto verification and bounds/no-retries the Stripe client',async()=>{
    const f=fixture();const signed=signedRequest();const response=await f.handler(signed.request);if(response.status!==200)await expect(f.verifiers[0].mock.results[0].value).resolves.toBeDefined();expect(response.status).toBe(200);expect(f.verifiers[0].mock.calls[0][0]).toBe(signed.raw);expect(f.verifiers[0].mock.calls[0][1]).toBe(signed.signature);expect(f.stripeCalls[0]).toMatchObject({timeout:15000,maxNetworkRetries:0});expect(f.network).not.toHaveBeenCalled();
  });
  it('uses Basil item period and known product to persist a verified subscription',async()=>{
    const f=fixture();expect((await f.handler(signedRequest().request)).status).toBe(200);expect(f.upsert).toHaveBeenCalledWith(expect.objectContaining({user_id:actor.id,plan:'enterprise',status:'active',current_period_end:new Date(2000000000000).toISOString()}),{onConflict:'user_id'});expect(f.insert).toHaveBeenCalledTimes(1);
  });
  it('supports invoice parent subscription references and original event/customer mapping',async()=>{
    const f=fixture();const invoice={id:'in_fixture',customer:'cus_fixture',parent:{subscription_details:{subscription:'sub_fixture'}},amount_paid:100,currency:'usd'};
    expect((await f.handler(signedRequest(event('invoice.paid',invoice)).request)).status).toBe(200);expect(f.retrieveSubscription).toHaveBeenCalledWith('sub_fixture');expect(f.upsert).toHaveBeenCalledTimes(1);expect(f.insert).toHaveBeenCalledWith(expect.objectContaining({stripe_event_id:'evt_fixture',event_type:'invoice.paid',stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_fixture'}));
  });
  it('retains an approved manual Enterprise override even for a verified cancellation event',async()=>{
    const f=fixture({override:true});expect((await f.handler(signedRequest(event('customer.subscription.deleted',subscription)).request)).status).toBe(200);expect(f.upsert).not.toHaveBeenCalled();expect(f.insert).toHaveBeenCalledTimes(1);
  });
  it.each([null,{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_other'},{stripe_customer_id:'cus_other',stripe_subscription_id:'sub_fixture'}])('does not create/demote a billing record from an unrelated signed cancellation %#',async existing=>{
    const f=fixture({existing});expect((await f.handler(signedRequest(event('customer.subscription.deleted',subscription)).request)).status).toBe(200);expect(f.upsert).not.toHaveBeenCalled();expect(f.insert).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({subscription_sync_applied:false})}));
  });
  it('demotes only the exact existing customer/subscription referenced by a valid signed cancellation',async()=>{
    const f=fixture();expect((await f.handler(signedRequest(event('customer.subscription.deleted',subscription)).request)).status).toBe(200);expect(f.upsert).toHaveBeenCalledWith(expect.objectContaining({stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_fixture',plan:'free',status:'canceled'}),{onConflict:'user_id'});
  });
  it('does not demote for a signed cancellation with an unmapped app product even if stored refs match',async()=>{
    const f=fixture();const unrelated={...subscription,items:{data:[{current_period_end:2000000000,price:{product:'prod_unrelated'}}]}};expect((await f.handler(signedRequest(event('customer.subscription.deleted',unrelated)).request)).status).toBe(500);expect(f.upsert).not.toHaveBeenCalled();expect(f.retrieveCustomer).not.toHaveBeenCalled();
  });
  it('does not overwrite a different preserved paid subscription from a signed older update',async()=>{
    const f=fixture({existing:{stripe_customer_id:'cus_fixture',stripe_subscription_id:'sub_newer'}});expect((await f.handler(signedRequest().request)).status).toBe(500);expect(f.upsert).not.toHaveBeenCalled();expect(f.insert).not.toHaveBeenCalled();
  });
  it('ignores an already recorded signed delivery before provider requests or subscription mutation',async()=>{
    const f=fixture({delivered:true});const r=await f.handler(signedRequest().request);expect(r.status).toBe(200);expect(await r.json()).toEqual({received:true,duplicate:true});expect(f.upsert).not.toHaveBeenCalled();expect(f.retrieveCustomer).not.toHaveBeenCalled();expect(f.retrieveSubscription).not.toHaveBeenCalled();expect(f.insert).not.toHaveBeenCalled();
  });
  it('fails delivery lookup explicitly without provider requests or subscription mutation',async()=>{
    const f=fixture({deliveryError:true});const r=await f.handler(signedRequest().request);expect(r.status).toBe(500);expect(await r.json()).toEqual({error:'event_processing_failed'});expect(f.upsert).not.toHaveBeenCalled();expect(f.retrieveCustomer).not.toHaveBeenCalled();expect(f.insert).not.toHaveBeenCalled();
  });
  it.each([{writeError:true},{logError:true},{stripeError:true}])('does not acknowledge failed verified processing or expose private diagnostics %#',async options=>{
    const f=fixture(options);const response=await f.handler(signedRequest().request);expect(response.status).toBe(500);expect(await response.json()).toEqual({error:'event_processing_failed'});expect(f.network).not.toHaveBeenCalled();
  });
  it('rejects large or malformed signed-event inputs without database access',async()=>{
    const f=fixture();const response=await f.handler(signedRequest(event('customer.subscription.updated',{padding:'x'.repeat(270000)})).request);expect(response.status).toBe(413);expect(f.createClient).not.toHaveBeenCalled();expect(f.upsert).not.toHaveBeenCalled();
  });
  it('does not invent Professional access for an unmapped signed product',async()=>{
    const f=fixture();const bad={...subscription,items:{data:[{current_period_end:2000000000,price:{product:'prod_unmapped_fixture'}}]}};expect((await f.handler(signedRequest(event('customer.subscription.updated',bad)).request)).status).toBe(500);expect(f.upsert).not.toHaveBeenCalled();
  });
});
