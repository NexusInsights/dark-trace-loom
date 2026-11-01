import test from 'node:test';
import assert from 'node:assert/strict';
import { executeResearch, readResearchJson, ResearchAdmissionError } from './admission.mjs';
const USER='11111111-1111-4111-8111-111111111111',ID='22222222-2222-4222-8222-222222222222';
const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_isolated_fixture'};
const token='isolated-session-token';
const request=(headers={},body)=>new Request('https://app.example/api/research',{method:'POST',headers:{Authorization:`Bearer ${token}`,...headers},...(body?{body}: {})});
function fixture({auth,admission,settlement,failSettlement=false}={}){
  const calls=[];const fetchImpl=async(url,init)=>{calls.push({url:String(url),headers:new Headers(init.headers),redirect:init.redirect,body:init.body?JSON.parse(init.body):null});if(String(url).endsWith('/auth/v1/user'))return auth||Response.json({id:USER,role:'authenticated'});if(String(url).endsWith('/reserve_intelligence_execution'))return Response.json(admission||{allowed:true,id:ID});if(failSettlement)throw new Error('private fixture diagnostic');return Response.json(settlement||{ok:true});};return{calls,fetchImpl};
}
test('strict Auth precedes prepare, reservation and task; private prepared input never enters accounting',async()=>{
  const f=fixture();let prepared=0,ran=0;const privateInput='PRIVATE-EML-OR-LEI-FIXTURE';
  const result=await executeResearch(request(),env,'research-email',async({userId,input,signal})=>{ran++;assert.equal(userId,USER);assert.equal(input,privateInput);assert.equal(signal.aborted,false);return{verified:true};},{fetchImpl:f.fetchImpl,prepare:async({userId})=>{prepared++;assert.equal(userId,USER);assert.equal(f.calls.length,1);return privateInput;}});
  assert.deepEqual(result,{verified:true});assert.equal(prepared,1);assert.equal(ran,1);
  assert.deepEqual(f.calls.map(c=>c.body),[null,{p_action:'research-email'},{p_execution_id:ID,p_success:true}]);
  assert.ok(f.calls.every(c=>c.headers.get('Authorization')===`Bearer ${token}`&&c.redirect==='manual'));
  assert.equal(JSON.stringify(f.calls.map(c=>c.body)).includes(privateInput),false);
});
test('invalid prepare input is rejected after Auth and before any reservation or provider work',async()=>{
  const f=fixture();let ran=0;
  await assert.rejects(executeResearch(request(),env,'research-gleif',()=>{ran++;},{fetchImpl:f.fetchImpl,prepare:()=>{throw new ResearchAdmissionError(400,'INVALID_INPUT','Invalid LEI fixture');}}),error=>error.status===400);
  assert.equal(f.calls.length,1);assert.equal(ran,0);
});
test('Auth and accounting redirects are never followed with credentials or private input',async()=>{
  for(const stage of ['auth','reserve','finish'])for(const status of [301,302,303,307,308]){
    const calls=[];let prepared=0,ran=0;const privateInput='PRIVATE-UNREAD-EML-FIXTURE';
    const req=request({'Content-Type':'message/rfc822'},privateInput);
    const fetchImpl=async(url,init)=>{
      const target=String(url);calls.push({url:target,init});
      // A Fetch-compatible adapter must not follow the hostile Location. This
      // also catches use of Workers' unsupported redirect:error mode.
      assert.equal(init.redirect,'manual');
      assert.equal(new URL(target).origin,env.SUPABASE_URL);
      assert.equal(new Headers(init.headers).get('Authorization'),`Bearer ${token}`);
      const current=target.endsWith('/auth/v1/user')?'auth':target.endsWith('/reserve_intelligence_execution')?'reserve':'finish';
      if(current===stage)return new Response(null,{status,headers:{Location:'https://redirected.example/collect'}});
      if(current==='auth')return Response.json({id:USER,role:'authenticated'});
      if(current==='reserve')return Response.json({allowed:true,id:ID});
      throw new Error('Unexpected request after failed boundary');
    };
    await assert.rejects(executeResearch(req,env,'research-email',()=>{ran++;return{verified:true};},{fetchImpl,prepare:()=>{prepared++;return privateInput;}}),error=>stage==='finish'?error.code==='ACCOUNTING_FAILED'&&error.operationCompleted===true:error.code==='BACKEND_UNAVAILABLE'&&error.status===503);
    assert.equal(calls.length,stage==='auth'?1:stage==='reserve'?2:3);
    assert.equal(prepared,stage==='auth'?0:1);assert.equal(ran,stage==='finish'?1:0);
    assert.equal(req.bodyUsed,false);assert.equal(await req.text(),privateInput);
    assert.equal(JSON.stringify(calls.map(c=>c.init.body)).includes(privateInput),false);
    assert.ok(calls.every(c=>new URL(c.url).origin===env.SUPABASE_URL));
  }
});
test('cross-origin, unsupported actions, invalid or anonymous Auth never run prepare or RPC',async()=>{
  for(const setup of [{req:request({Origin:'https://other.example'})},{action:'research-invalid'},{auth:new Response('private token text',{status:401})},{auth:Response.json({id:USER,is_anonymous:true})}]){
    const f=fixture(setup);let prepared=0,ran=0;
    await assert.rejects(executeResearch(setup.req||request(),env,setup.action||'research-email',()=>{ran++;},{fetchImpl:f.fetchImpl,prepare:()=>{prepared++;}}));
    assert.equal(prepared,0);assert.equal(ran,0);assert.ok(f.calls.length<=1);
  }
});
test('privileged keys or credential-bearing backend URLs are rejected without an outbound request',async()=>{
  for(const bad of [{...env,SUPABASE_URL:'https://user:private@project.supabase.co'},{...env,SUPABASE_PUBLISHABLE_KEY:'sb_secret_private'},{...env,SUPABASE_URL:'https://project.supabase.co/?token=private'}]){
    const f=fixture();await assert.rejects(executeResearch(request(),bad,'research-email',()=>{},f),error=>error.code==='AUTH_CONFIGURATION');assert.equal(f.calls.length,0);
  }
});
test('server daily/admin denial stops the provider and preserves retry information',async()=>{
  const f=fixture({admission:{allowed:false,code:'DAILY_LIMIT',retryAfter:60}});let ran=0;
  await assert.rejects(executeResearch(request(),env,'research-gleif',()=>{ran++;},{fetchImpl:f.fetchImpl}),error=>error.status===429&&error.retryAfter===60);
  assert.equal(ran,0);assert.equal(f.calls.length,2);
});
test('task failure releases once and successful work is not returned when accounting fails',async()=>{
  const failed=fixture();await assert.rejects(executeResearch(request(),env,'research-email',()=>{throw new Error('provider fixture failed');},{fetchImpl:failed.fetchImpl}),/provider fixture failed/);
  assert.deepEqual(failed.calls.at(-1).body,{p_execution_id:ID,p_success:false});assert.equal(failed.calls.length,3);
  const unconfirmed=fixture({failSettlement:true});let ran=0;
  await assert.rejects(executeResearch(request(),env,'research-gleif',()=>{ran++;return{data:'not-returned'};},{fetchImpl:unconfirmed.fetchImpl}),error=>error.code==='ACCOUNTING_FAILED'&&error.operationCompleted===true&&!error.message.includes('private'));
  assert.equal(ran,1);assert.equal(unconfirmed.calls.length,3);assert.equal(unconfirmed.calls.at(-1).body.p_success,true);
});
test('task timeout aborts its signal and releases admission without a retry',async()=>{
  const f=fixture();let signal;
  await assert.rejects(executeResearch(request(),env,'research-email',context=>{signal=context.signal;return new Promise(()=>{});},{fetchImpl:f.fetchImpl,taskTimeoutMs:5}),error=>error.code==='RESEARCH_CANCELLED');
  assert.equal(signal.aborted,true);assert.deepEqual(f.calls.at(-1).body,{p_execution_id:ID,p_success:false});assert.equal(f.calls.length,3);
});
test('JSON bodies are bounded, malformed input is explicit and a stalled cancellation cannot hang the deadline',async()=>{
  await assert.rejects(readResearchJson(request({'Content-Type':'application/json'},'x'.repeat(30)),10),error=>error.status===413);
  await assert.rejects(readResearchJson(request({'Content-Type':'application/json'},'{invalid')),error=>error.code==='INVALID_INPUT');
  const stream=new ReadableStream({start(){},cancel(){return new Promise(()=>{});}});
  await assert.rejects(readResearchJson({headers:new Headers({'Content-Type':'application/json'}),body:stream},100,{timeoutMs:5}),error=>error.status===408);
});
