import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Transpile the exact deployed helper source; these are isolated contract tests,
// not live authentication or provider acceptance evidence.
const source=readFileSync("supabase/functions/osint-tools/marketplaceAuth.ts","utf8");
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
function fixture(...responses:Response[]){
  const fetch=vi.fn();for(const r of responses)fetch.mockResolvedValueOnce(r);
  const env={SUPABASE_URL:"https://project.example",SUPABASE_ANON_KEY:"public-anon-fixture"};
  const helpers=new Function("fetch","Deno","AbortSignal",`${js}; return { marketplaceUser, marketplacePermission, MarketplaceHttpError };`)(fetch,{env:{get:(key:keyof typeof env)=>env[key]}},{timeout:()=>undefined});return {fetch,...helpers};
}
const user={id:"verified-user-id",authorization:"Bearer verified-session-token",url:"https://project.example",key:"public-anon-fixture"};
describe("marketplace authentication and permission contracts",()=>{
  it("requires a bearer token before any authentication request",async()=>{const {fetch,marketplaceUser}=fixture();await expect(marketplaceUser(new Request("https://app.example"))).rejects.toMatchObject({status:401});expect(fetch).not.toHaveBeenCalled();});
  it("verifies even JWT-looking tokens remotely instead of trusting decoded claims",async()=>{
    const {fetch,marketplaceUser}=fixture(response({error:"expired"},401));const token="eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiJ9.";
    await expect(marketplaceUser(new Request("https://app.example",{headers:{Authorization:`Bearer ${token}`}}))).rejects.toMatchObject({status:401});
    expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe("https://project.example/auth/v1/user");expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${token}`);
  });
  it("uses the verified service user ID and denies malformed successful authentication responses",async()=>{
    const {fetch,marketplaceUser}=fixture(response({id:"real-service-user"}),response({id:42}));const req=()=>new Request("https://app.example",{headers:{Authorization:"Bearer opaque-token"}});
    expect(await marketplaceUser(req())).toMatchObject({id:"real-service-user",authorization:"Bearer opaque-token"});await expect(marketplaceUser(req())).rejects.toMatchObject({status:401});expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("maps an authentication service rejection to 401 and fails closed on service failure",async()=>{
    const {marketplaceUser}=fixture(response({error:"forbidden"},403),response({error:"offline"},503));const req=()=>new Request("https://app.example",{headers:{Authorization:"Bearer opaque-token"}});
    await expect(marketplaceUser(req())).rejects.toMatchObject({status:401});await expect(marketplaceUser(req())).rejects.toThrow("verification failed (HTTP 503)");
  });
  it("denies an administrator's explicit disabled tool with 403 using verified user/tool filters",async()=>{
    const {fetch,marketplacePermission}=fixture(response([{allowed:false}]));await expect(marketplacePermission(user,"sentiment-analysis")).rejects.toMatchObject({status:403});const url=new URL(fetch.mock.calls[0][0]);expect(url.searchParams.get("user_id")).toBe("eq.verified-user-id");expect(url.searchParams.get("tool_id")).toBe("eq.sentiment-analysis");expect(fetch.mock.calls[0][1].headers.Authorization).toBe(user.authorization);
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
});
