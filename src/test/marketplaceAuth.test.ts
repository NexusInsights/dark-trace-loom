import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

// Transpile the exact deployed helper source; these are isolated contract tests,
// not live authentication or provider acceptance evidence.
const source=readFileSync("supabase/functions/osint-tools/marketplaceAuth.ts","utf8");
const compile=(text:string)=>ts.transpileModule(text.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const js=compile(readFileSync("supabase/functions/_shared/authenticateUser.ts","utf8"))+"\n"+compile(source);
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
function fixture(...responses:Response[]){
  return fixtureWithEnv({SUPABASE_URL:"https://project.example",SUPABASE_ANON_KEY:"public-anon-fixture"},responses);
}
function fixtureWithEnv(env:Record<string,string>,responses:Array<Response|Error>){
  const fetch=vi.fn();for(const value of responses){if(value instanceof Response)fetch.mockResolvedValueOnce(value);else fetch.mockRejectedValueOnce(value);}
  const timeout=vi.fn(()=>new AbortController().signal);
  const helpers=new Function("fetch","Deno","AbortSignal",`${js}; return { marketplaceUser, marketplacePermission, MarketplaceHttpError };`)(fetch,{env:{get:(key:string)=>env[key]}},{timeout});return {fetch,timeout,...helpers};
}
const userId="11111111-1111-4111-8111-111111111111";
const verified={id:userId,role:"authenticated",is_anonymous:false};
const user={id:userId,authorization:"Bearer verified-session-token",url:"https://project.example",key:"public-anon-fixture"};
const request=(authorization="Bearer verified-session-token")=>new Request("https://app.example",{headers:authorization?{Authorization:authorization}:{}});
afterEach(()=>vi.useRealTimers());
describe("marketplace authentication and permission contracts",()=>{
  it("requires a bearer token before any authentication request",async()=>{const {fetch,marketplaceUser}=fixture();await expect(marketplaceUser(new Request("https://app.example"))).rejects.toMatchObject({status:401});expect(fetch).not.toHaveBeenCalled();});
  it("verifies even JWT-looking tokens remotely instead of trusting decoded claims",async()=>{
    const {fetch,marketplaceUser}=fixture(response({error:"expired"},401));const token="eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiJ9.";
    await expect(marketplaceUser(new Request("https://app.example",{headers:{Authorization:`Bearer ${token}`}}))).rejects.toMatchObject({status:401});
    expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe("https://project.example/auth/v1/user");expect(fetch.mock.calls[0][1]).toMatchObject({redirect:"error",headers:{Authorization:`Bearer ${token}`,apikey:"public-anon-fixture"}});
  });
  it("uses the verified service user ID and denies malformed successful authentication responses",async()=>{
    const {fetch,marketplaceUser}=fixture(response(verified),response({id:42}));const req=()=>new Request("https://app.example",{headers:{Authorization:"Bearer opaque-token"}});
    expect(await marketplaceUser(req())).toMatchObject({id:userId,authorization:"Bearer opaque-token"});await expect(marketplaceUser(req())).rejects.toMatchObject({status:502,message:"invalid_authentication_response"});expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("maps an authentication service rejection to 401 and fails closed on service failure",async()=>{
    const {marketplaceUser}=fixture(response({error:"forbidden"},403),response({error:"offline"},503));const req=()=>new Request("https://app.example",{headers:{Authorization:"Bearer opaque-token"}});
    await expect(marketplaceUser(req())).rejects.toMatchObject({status:401,message:"unauthenticated"});await expect(marketplaceUser(req())).rejects.toMatchObject({status:503,message:"authentication_unavailable"});
  });
  it("denies an administrator's explicit disabled tool with 403 using verified user/tool filters",async()=>{
    const {fetch,marketplacePermission}=fixture(response([{allowed:false}]));await expect(marketplacePermission(user,"sentiment-analysis")).rejects.toMatchObject({status:403});const url=new URL(fetch.mock.calls[0][0]);expect(url.searchParams.get("user_id")).toBe(`eq.${userId}`);expect(url.searchParams.get("tool_id")).toBe("eq.sentiment-analysis");expect(fetch.mock.calls[0][1].headers.Authorization).toBe(user.authorization);
  });
  it("fails closed when permission lookup fails or returns an invalid response shape",async()=>{
    const {fetch,marketplacePermission}=fixture(response({error:"database down"},500),response({allowed:true}));await expect(marketplacePermission(user,"sentiment-analysis")).rejects.toThrow("permissions could not be verified");await expect(marketplacePermission(user,"sentiment-analysis")).rejects.toThrow("Invalid tool permission response");expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("allows a verified user's permitted tool or absence of an administrator override",async()=>{
    const {marketplacePermission}=fixture(response([{allowed:true}]),response([]));await expect(marketplacePermission(user,"sentiment-analysis")).resolves.toBeUndefined();await expect(marketplacePermission(user,"translation")).resolves.toBeUndefined();
  });
  it.each([[null],[{}],[{allowed:"false"}],[[{allowed:true}]]].map(rows=>({rows})))("denies malformed permission rows $rows",async ({rows})=>{
    const {marketplacePermission}=fixture(response(rows));await expect(marketplacePermission(user,"translation")).rejects.toThrow("Invalid tool permission response");
  });
  it("keeps the generated Auth block identical to its source module",()=>{
    const index=readFileSync("supabase/functions/osint-tools/index.ts","utf8");const marker="// Source: marketplaceAuth.ts";const start=index.indexOf(marker)+marker.length;const end=index.indexOf("// Source: marketplaceDispatch.ts",start);
    expect(start).toBeGreaterThan(marker.length);expect(end).toBeGreaterThan(start);expect(index.slice(start,end).trim()).toBe(source.replace(/^import .*;\r?\n/gm,"").trim());
  });
  it.each(["", "Basic value", "Bearer", "Bearer token extra"])("rejects malformed authorization %s without an Auth request",async authorization=>{
    const f=fixture();await expect(f.marketplaceUser(request(authorization))).rejects.toMatchObject({status:401,message:"unauthenticated"});expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([null,[],{},{id:"not-a-uuid"}].map(value=>({value})))("rejects malformed successful Auth $value",async ({value})=>{
    const f=fixture(response(value));await expect(f.marketplaceUser(request())).rejects.toMatchObject({status:502,message:"invalid_authentication_response"});expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects an anonymous Auth session even with a valid UUID",async()=>{
    const f=fixture(response({...verified,is_anonymous:true}));await expect(f.marketplaceUser(request())).rejects.toMatchObject({status:403,message:"anonymous_session_not_allowed"});
  });
  it.each(["anon","service_role",42])("rejects an unexpected returned role %s",async role=>{
    const f=fixture(response({...verified,role}));await expect(f.marketplaceUser(request())).rejects.toMatchObject({status:401,message:"unauthenticated"});
  });
  it("supports modern publishable configuration and returns the verified caller",async()=>{
    const f=fixtureWithEnv({SUPABASE_URL:user.url,SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture"},[response(verified)]);
    expect(await f.marketplaceUser(request())).toEqual({...user,key:"sb_publishable_fixture"});expect(f.fetch.mock.calls[0][1].headers.apikey).toBe("sb_publishable_fixture");expect(f.timeout).toHaveBeenCalledWith(15000);
  });
  it.each([{SUPABASE_URL:user.url,SUPABASE_SERVICE_ROLE_KEY:"server-fixture"},{SUPABASE_URL:user.url,SUPABASE_ANON_KEY:"sb_secret_fixture"},{SUPABASE_URL:"http://project.example",SUPABASE_ANON_KEY:user.key},{SUPABASE_URL:"https://user:private@project.example",SUPABASE_ANON_KEY:user.key}])("rejects unsafe/missing public configuration before any request %#",async env=>{
    const f=fixtureWithEnv(env,[]);await expect(f.marketplaceUser(request())).rejects.toMatchObject({status:503,message:"authentication_not_configured"});expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([new Response("private redirect",{status:302,headers:{location:"https://other.example"}}),new Error("private network diagnostic"),new DOMException("private timeout","AbortError"),new Response("private".repeat(12000))])("sanitizes unavailable, redirected or oversized Auth %#",async value=>{
    const f=fixtureWithEnv({SUPABASE_URL:user.url,SUPABASE_ANON_KEY:user.key},[value]);await expect(f.marketplaceUser(request())).rejects.toMatchObject({status:503,message:"authentication_unavailable"});expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds a stalled successful Auth response body without retry",async()=>{
    vi.useFakeTimers();const cancel=vi.fn();const f=fixture(new Response(new ReadableStream({cancel})));const outcome=f.marketplaceUser(request()).catch((error:unknown)=>error);await vi.advanceTimersByTimeAsync(15001);
    expect(await outcome).toMatchObject({status:503,message:"authentication_unavailable"});expect(cancel).toHaveBeenCalled();expect(f.fetch).toHaveBeenCalledTimes(1);
  });
});
