// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestPost, onRequestGet } from "../../functions/api/profile-search.js";

const user = { id:"11111111-1111-4111-8111-111111111111", role:"authenticated", is_anonymous:false };
const env = { SUPABASE_URL:"https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture" };
const json = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
let auth:Response, permissions:Response, calls:string[];
beforeEach(()=>{
  calls=[];auth=json(user);permissions=json([]);
  vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit)=>{
    calls.push(url);expect(init.redirect).toBe("manual");
    if(url===`${env.SUPABASE_URL}/auth/v1/user`)return auth;
    if(url.startsWith(`${env.SUPABASE_URL}/rest/v1/tool_permissions?`)){const q=new URL(url).searchParams;expect(q.get("user_id")).toBe(`eq.${user.id}`);expect(q.get("tool_id")).toBe("eq.username-search");return permissions;}
    if(url==="https://api.github.com/users/fixture")return json({id:42,login:"fixture",html_url:"https://github.com/fixture"});
    throw new Error("All non-fixture destinations are prohibited");
  }));
});
afterEach(()=>vi.unstubAllGlobals());
function request(body:unknown={profileUrl:"https://github.com/fixture"},headers:Record<string,string>={}){return new Request("https://app.example/api/profile-search",{method:"POST",headers:{Authorization:"Bearer fixture-session","Content-Type":"application/json",...headers},body:typeof body==="string"?body:JSON.stringify(body)});}
const run=(req=request(),config=env)=>onRequestPost({request:req,env:config});
const providerCalls=()=>calls.filter(url=>!url.startsWith(env.SUPABASE_URL));
describe("profile-search real request boundary with synthetic transport",()=>{
  it("requires Auth before any body, permission or provider work",async()=>{const r=request(undefined,{Authorization:""});const original=r.body;let reads=0;Object.defineProperty(r,"body",{get(){reads++;return original;}});expect((await run(r)).status).toBe(401);expect(reads).toBe(0);expect(calls).toEqual([]);});
  it("rejects cross-origin callers without sending their bearer to Auth",async()=>{expect((await run(request(undefined,{Origin:"https://other.example"}))).status).toBe(403);expect(calls).toEqual([]);});
  it.each(["http://project.supabase.co","https://user:pass@project.supabase.co","https://project.supabase.co/other"])("rejects unsafe configured backend %s",async SUPABASE_URL=>{expect((await run(request(),{...env,SUPABASE_URL})).status).toBe(503);expect(calls).toEqual([]);});
  it("rejects privileged backend keys",async()=>{expect((await run(request(),{...env,SUPABASE_PUBLISHABLE_KEY:"sb_secret_fixture"})).status).toBe(503);expect(calls).toEqual([]);});
  it.each([{...user,is_anonymous:true},{...user,role:"service_role"},{id:"not-a-uuid"}])("rejects invalid or anonymous Auth %j",async value=>{auth=json(value);expect([401,403]).toContain((await run()).status);expect(providerCalls()).toEqual([]);expect(calls).toHaveLength(1);});
  it("does not follow Auth redirects or return private diagnostics",async()=>{auth=new Response("private auth diagnostic",{status:302,headers:{Location:"https://other.example"}});const r=await run();expect(r.status).toBe(503);expect(await r.text()).not.toContain("private");expect(calls).toHaveLength(1);});
  it("bounds successful Auth responses before reading private contents",async()=>{auth=new Response("x".repeat(65537));const r=await run();expect(r.status).toBe(503);expect((await r.text()).length).toBeLessThan(150);expect(providerCalls()).toEqual([]);});
  it.each(["[]","null","invalid-json",JSON.stringify({profileUrl:"https://127.0.0.1/private"}),JSON.stringify({username:"fixture",profileUrl:"https://github.com/fixture"})])("rejects invalid seed/body %s before permission or providers",async body=>{expect((await run(request(body))).status).toBe(400);expect(calls).toHaveLength(1);});
  it("bounds actual UTF-8 request bytes without Content-Length",async()=>{expect((await run(request(JSON.stringify({username:"é".repeat(1100)})))).status).toBe(413);expect(calls).toHaveLength(1);});
  it.each([{value:[{allowed:false}],status:403},{value:[{allowed:"false"}],status:503},{value:{},status:503},{value:[null],status:503}])("fails closed on denied or malformed permissions $value",async({value,status})=>{permissions=json(value);expect((await run()).status).toBe(status);expect(providerCalls()).toEqual([]);});
  it("does not follow permission redirects with the bearer",async()=>{permissions=new Response(null,{status:302,headers:{Location:"https://other.example"}});expect((await run()).status).toBe(503);expect(providerCalls()).toEqual([]);});
  it("returns one bound account observation after verified Auth and canonical permission",async()=>{const r=await run();expect(r.status).toBe(200);expect(await r.json()).toMatchObject({schemaVersion:2,status:"success",profiles:[{accountId:"github:42",platformId:"42",personAssociation:"unreviewed",existence:"found"}]});expect(providerCalls()).toEqual(["https://api.github.com/users/fixture"]);});
  it("keeps GET non-executable",()=>{expect(onRequestGet().status).toBe(405);expect(calls).toEqual([]);});
});
