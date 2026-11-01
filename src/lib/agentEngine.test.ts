import { beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({actor:"owner",caseOwner:"owner",runOwner:"owner",runCase:"case",status:"success",failure:"",permission:true as boolean|null, writes:[] as {table:string,payload:Record<string,unknown>,filters:Record<string,unknown>}[],calls:0}));
vi.mock("@/components/tools/toolDefinitions",()=>({allTools:[{id:"fixture-tool",name:"Fixture",fields:[{key:"value",label:"Value",required:true}],process:async()=>{state.calls++;return {status:state.status,summary:"SYNTHETIC",details:{source:"offline fixture"}};}}]}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{auth:{getUser:async()=>({data:{user:state.actor?{id:state.actor}:null},error:null})},from:(table:string)=>{
  const filters:Record<string,unknown>={};let payload:Record<string,unknown>|undefined;
  const result=()=>{
    if(payload){state.writes.push({table,payload,filters});return {data:null,error:state.failure===table?{message:"SYNTHETIC persistence rejected"}:null};}
    return {error:state.failure==="permissions"&&table==="tool_permissions"?{message:"SYNTHETIC outage"}:null,data:table==="tool_permissions"?(state.permission===null?null:{allowed:state.permission}):table==="cases"?{id:"case",owner_id:state.caseOwner}:{id:"run",user_id:state.runOwner,case_id:state.runCase}};
  };
  const q={select:()=>q,eq:(key:string,value:unknown)=>{filters[key]=value;return q;},insert:(value:Record<string,unknown>)=>{payload=value;return q;},update:(value:Record<string,unknown>)=>{payload=value;return q;},single:async()=>result(),maybeSingle:async()=>result(),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};return q;
}}}));
import { executeAgentRun, buildToolInputs } from "./agentEngine";
beforeEach(()=>{state.actor="owner";state.caseOwner="owner";state.runOwner="owner";state.runCase="case";state.status="success";state.failure="";state.permission=true;state.writes=[];state.calls=0;});
const run=()=>executeAgentRun("run",["fixture-tool"],"synthetic","case",()=>undefined);
it.each(["success","partial","demo","not_configured","error","unknown_tool"])("preserves actual %s and saves only successful case evidence",async status=>{
  state.status=status;const result=await run();
  expect(result.status).toBe(status==="success"?"completed":["error","unknown_tool"].includes(status)?"failed":status);
  expect(state.writes.filter(w=>w.table==="artifacts")).toHaveLength(status==="success"?1:0);
  expect(state.writes.filter(w=>w.table==="agent_runs").every(w=>w.filters.user_id==="owner")).toBe(true);
  if(status==="demo")expect(result.steps[0].result?.summary).toMatch(/^DEMO/);
});
it.each(["missing-session","foreign-case","foreign-run","wrong-run-case"])("rejects %s before execution or writes",async scenario=>{
  if(scenario==="missing-session")state.actor="";if(scenario==="foreign-case")state.caseOwner="other";if(scenario==="foreign-run")state.runOwner="other";if(scenario==="wrong-run-case")state.runCase="foreign";
  await expect(run()).rejects.toThrow(/verified|ownership/);expect(state.calls).toBe(0);expect(state.writes).toHaveLength(0);
});
it.each(["disabled","lookup-failure"])("does not execute an automated tool when permission is %s",async scenario=>{
  if(scenario==="disabled")state.permission=false;else state.failure="permissions";
  expect((await run()).status).toBe("failed");expect(state.calls).toBe(0);expect(state.writes.some(w=>w.table==="artifacts")).toBe(false);
});
it("preserves a plain database save error and never reports completed",async()=>{state.failure="artifacts";const outcome=await run();expect(outcome.status).toBe("failed");expect(outcome.steps[0].error).toContain("SYNTHETIC persistence rejected");});
it("rejects a final run save failure instead of returning success",async()=>{state.failure="agent_runs";await expect(run()).rejects.toMatchObject({message:"SYNTHETIC persistence rejected"});expect(state.calls).toBe(0);});
it("maps per-tool aliases and refuses nested inputs",()=>{expect(buildToolInputs("fixture-tool",'{"fixture-tool":{"value":"synthetic"}}')).toEqual({value:"synthetic"});expect(()=>buildToolInputs("fixture-tool",'{"value":{}}')).toThrow("scalar");});
it("rejects an empty agent before creating a running state",async()=>{await expect(executeAgentRun("run",[],"synthetic","case",()=>undefined)).rejects.toThrow("at least one");expect(state.writes).toHaveLength(0);});
it("preserves an unknown tool ID rather than calling a substitute",async()=>{const result=await executeAgentRun("run",["social_analyzer"],"synthetic","case",()=>undefined);expect(result.steps[0].status).toBe("unknown_tool");expect(result.status).toBe("failed");expect(state.calls).toBe(0);});
