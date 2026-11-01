// @vitest-environment node
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Execute exact DNS implementations and the real dispatch error adapter. Only
// provider transport is synthetic; this is not live DNS, Auth or persistence
// acceptance. The existing handler suites cover those separate boundaries.
function declaration(path: string, name: string): string {
  const source=readFileSync(path,"utf8"),tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
  const node=tree.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text===name);
  if(!node)throw new Error("Missing actual source declaration: "+name);
  return node.getText(tree);
}
const manualSource=declaration("supabase/functions/osint-tools/index.ts","dnsQuery");
const dispatcherSource=declaration("supabase/functions/osint-dispatch/index.ts","dnsLookup")+"\n"+declaration("supabase/functions/osint-dispatch/index.ts","dispatch");
const compile=(source:string)=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const domain="example.invalid";
type Outcome={status:string;result?:Record<string,unknown>;reason?:string};
async function paired(transport:ReturnType<typeof vi.fn>){
  const manual=new Function("safeFetch",compile(manualSource)+"; return dnsQuery;")(transport);
  const dispatch=new Function("safeFetch",compile(dispatcherSource)+"; return dispatch;")(transport);
  let result:Outcome;
  try { result={status:"success",result:await manual(domain)}; }
  catch(error){result={status:"error",reason:error instanceof Error?error.message:"DNS failed"};}
  return {manual:result,dispatcher:await dispatch("dns_lookup",{domain},null,"Bearer synthetic") as Outcome};
}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
describe("manual/legacy dispatcher DNS provider-response parity",()=>{
  it.each([2,5,undefined])("never reports DNS status %s as successful empty data",async status=>{
    const result=await paired(vi.fn(async()=>json({Status:status})));
    expect(result.manual.status).toBe("error");expect(result.dispatcher.status).toBe("error");
    expect(result.dispatcher.reason).toContain("DNS status");expect(result.dispatcher.result).toBeUndefined();
  });
  it.each([0,3])("preserves a verified empty DNS status %s",async status=>{
    const result=await paired(vi.fn(async()=>json({Status:status})));
    for(const outcome of Object.values(result)){expect(outcome.status).toBe("success");for(const key of ["a","aaaa","mx","txt","ns"])expect(outcome.result?.[key]).toEqual([]);}
  });
  it("keeps only each requested RR type when a response contains aliases and other records",async()=>{
    const values={a:["192.0.2.1"],aaaa:["2001:db8::1"],mx:["10 mail.example.invalid."],txt:['"SYNTHETIC"'],ns:["ns.example.invalid."]};
    const Answer=[{type:5,data:"alias.example.invalid."},{type:1,data:values.a[0]},{type:28,data:values.aaaa[0]},{type:15,data:values.mx[0]},{type:16,data:values.txt[0]},{type:2,data:values.ns[0]}];
    const result=await paired(vi.fn(async()=>json({Status:0,Answer})));
    for(const outcome of Object.values(result)){expect(outcome.status).toBe("success");for(const[key,value]of Object.entries(values))expect(outcome.result?.[key]).toEqual(value);}
  });
  it.each(["http","network","json","answer-shape"])("preserves %s failure as error",async failure=>{
    const transport=vi.fn(async()=>{if(failure==="network")throw new Error("SYNTHETIC DNS unavailable");if(failure==="json")return new Response("invalid JSON");return json(failure==="answer-shape"?{Status:0,Answer:{}}:{},failure==="http"?503:200);});
    const result=await paired(transport);expect(result.manual.status).toBe("error");expect(result.dispatcher.status).toBe("error");expect(result.dispatcher.result).toBeUndefined();
  });
});
