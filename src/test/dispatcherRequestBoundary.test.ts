// @vitest-environment node
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import { afterEach, expect, it, vi } from "vitest";

// Exact shared Auth/body and handler source; every transport/SDK response is
// synthetic. These checks neither read real users nor contact any provider.
const code=(path:string)=>ts.transpileModule(readFileSync(path,"utf8").replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,""),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function fixture(){
  let handler:(request:Request)=>Promise<Response>;
  const fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({id:"11111111-1111-4111-8111-111111111111",role:"authenticated",is_anonymous:false})));
  const from=vi.fn(()=>{throw new Error("No permission/provider/database work is permitted before body validation");});
  const createClient=vi.fn(()=>({from}));
  const env={SUPABASE_URL:"https://fixture-auth.invalid",SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture"};
  new Function("Deno","serve","fetch","createClient","safeFetch","z",code("supabase/functions/_shared/authenticateUser.ts")+code("supabase/functions/osint-dispatch/index.ts"))({env:{get:(key:keyof typeof env)=>env[key]}},(fn:typeof handler)=>{handler=fn;},fetch,createClient,()=>{throw new Error("Provider work is prohibited");},z);
  return {handler:handler!,fetch,from,createClient};
}
const request=(body:string)=>new Request("https://fixture-handler.invalid",{method:"POST",headers:{Authorization:"Bearer synthetic-session"},body});
afterEach(()=>vi.useRealTimers());
it.each(["{", "[]", "null"])("rejects invalid bounded dispatcher body %s before permission/provider work",async body=>{const f=fixture();expect((await f.handler(request(body))).status).toBe(400);expect(f.from).not.toHaveBeenCalled();});
it("rejects an oversized body without trusting Content-Length",async()=>{const f=fixture();expect((await f.handler(request("x".repeat(16385)))).status).toBe(413);expect(f.from).not.toHaveBeenCalled();});
it("expires a stalled dispatcher request after its body deadline",async()=>{
  vi.useFakeTimers();const f=fixture();const stream=new ReadableStream<Uint8Array>({start(){}});
  const req=new Request("https://fixture-handler.invalid",{method:"POST",headers:{Authorization:"Bearer synthetic-session"},body:stream,duplex:"half"} as RequestInit);
  const result=f.handler(req);await vi.waitFor(()=>expect(f.createClient).toHaveBeenCalledOnce());await vi.advanceTimersByTimeAsync(15001);
  const response=await result;expect(response.status).toBe(408);expect((await response.json()).reason).toBe("request_timed_out");expect(f.from).not.toHaveBeenCalled();
});
