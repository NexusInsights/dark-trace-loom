import { it, expect, vi } from "vitest";
const { updates, provider } = vi.hoisted(() => ({ updates: [] as Record<string,unknown>[], provider: vi.fn(async () => ({summary:"Provider not configured",details:{status:"not_configured",reason:"Missing provider"}})) }));
vi.mock("@/components/tools/toolDefinitions",() => ({allTools:[{id:"username-search",name:"Profile lookup",fields:[{key:"username",label:"Username",required:true}],process:provider}]}));
vi.mock("@/integrations/supabase/client",() => ({supabase:{auth:{getUser:async()=>({data:{user:{id:"user"}},error:null})},from:(table:string) => {
  let operation="read"; let payload: Record<string,unknown> = {};
  const builder = { select:()=>builder,eq:()=>builder,insert:(data: Record<string,unknown>)=>{operation="insert";payload=data;return builder;},update:(data: Record<string,unknown>)=>{operation="update";payload=data;updates.push(data);return builder;},maybeSingle:async()=>({error:null,data:null}),single:()=>Promise.resolve({error:null,data:table === "pipelines" ? {id:"pipeline",user_id:"user",name:"Actual lookup",tool_sequence:["username-search"],input_params:{username:"octocat"},target_case_id:null} : {id:"run"}}),then:(resolve: (value:unknown)=>unknown)=>Promise.resolve({error:null,data:operation === "insert" ? [payload] : []}).then(resolve) };
  return builder;
}}}));
import { executePipeline } from "./pipelineEngine";
it("preserves not-configured when its provider is unavailable and creates no fake evidence", async () => {
  expect((await executePipeline("pipeline","user")).status).toBe("not_configured");
  expect(updates.some(update => update.status === "completed")).toBe(false);
  expect(updates.some(update => update.status === "not_configured" && update.artifacts_created === 0)).toBe(true);
});
