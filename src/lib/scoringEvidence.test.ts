import { beforeEach, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, saved: [] as Record<string, unknown>[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from(table: string) {
  let bounds: [number, number] | undefined;
  const filters: [string, unknown][] = [];
  const query = { select: () => query, order: () => query, in:()=>query, eq: (key: string, value: unknown) => { filters.push([key,value]); return query; }, range: (from: number, to: number) => { bounds=[from,to]; return query; }, upsert: (rows: Record<string,unknown>[]) => { state.saved.push(...rows); return query; }, then(resolve:(value:unknown)=>unknown) { let rows=(state.tables[table]||[]).filter(row=>filters.every(([key,value])=>row[key]===value)); if(bounds)rows=rows.slice(bounds[0],bounds[1]+1); return Promise.resolve({data:rows,error:null}).then(resolve); } }; return query;
} } }));
import { computeEntityScores } from "./scoringEngine";
import { supportedProfileAssociations } from "./identityEvidence";
import type { SavedIdentityRecord } from "./identityEvidence";
const date="2026-11-04T00:00:00Z";
const profile={platform:"GitHub",platformId:"1",accountId:"github:1",username:"sourceuser",profileUrl:"https://github.com/sourceuser",sourceUrl:"https://api.github.com/users/sourceuser",retrievedAt:date,evidenceKind:"public_account",existence:"found",personAssociation:"unreviewed"};
const records:SavedIdentityRecord[]=[{id:"lookup",tool_name:"public-profile-search",status:"success",created_at:date,result_data:{persona_id:"person",schemaVersion:2,status:"success",username:"sourceuser",retrievedAt:date,profiles:[profile],checks:[{platform:"GitHub",sourceUrl:profile.sourceUrl,retrievedAt:date,status:"found",profile}]}},{id:"review",tool_name:"profile-association-review",status:"success",created_at:"2026-11-04T01:00:00Z",result_data:{persona_id:"person",account_id:profile.accountId,profile_url:profile.profileUrl,lookup_result_id:"lookup",decision:"supported",supporting_source_url:"https://sample.org/author",reason:"Original author source explicitly links the observed public account.",reviewed_at:"2026-11-04T01:00:00Z"}}];
beforeEach(()=>{state.saved=[];state.tables={personas:[{id:"person",user_id:"user"}],tool_results:records.map(row=>({...row,user_id:"user"})),identity_entities:[{id:"observed",user_id:"user",entity_type:"social_profile",entity_value:profile.profileUrl,metadata:{identity_evidence:supportedProfileAssociations(records)[0].evidence}},{id:"guess",user_id:"user",entity_type:"username",entity_value:"inventeduser",metadata:{}}]};});
describe("source-reviewed connectivity scores",()=>{
  it("does not score unsupported entities or inflate an admitted account with old guessed edges and case observations",async()=>{
    state.tables.identity_entity_links=[{user_id:"user",source_entity_id:"observed",target_entity_id:"guess",relationship_type:"username_matches_profile"}];
    state.tables.social_graph_edges=[{user_id:"user",source_entity_id:"observed",target_entity_id:"guess",relationship_type:"shared_infrastructure"}];
    state.tables.entity_observations=[{user_id:"user",entity_id:"observed",case_id:"old",source_tool:"generated_guess"}];
    expect(await computeEntityScores("user")).toEqual({entitiesScored:1});expect(state.saved).toHaveLength(1);expect(state.saved[0]).toMatchObject({entity_id:"observed",score:0,linked_identifiers:0,case_appearances:0,infrastructure_overlap:0,relationship_density:0});
  });
  it("counts a retained current-review case observation as a connectivity heuristic with an explicit method marker",async()=>{
    state.tables.entity_observations=[{user_id:"user",entity_id:"observed",case_id:"source-case",source_tool:"profile_association:review"}];
    await computeEntityScores("user");expect(state.saved[0]).toMatchObject({score:12,case_appearances:1});expect(state.saved[0].score_reasons).toEqual(expect.arrayContaining([expect.objectContaining({factor:"Source-reviewed connectivity heuristic"})]));
  });
  it("does not score a formerly admitted account after its review is rejected",async()=>{
    state.tables.tool_results.push({...records[1],id:"reject",user_id:"user",created_at:"2026-11-04T02:00:00Z",result_data:{...(records[1].result_data as object),decision:"rejected"}});
    expect(await computeEntityScores("user")).toEqual({entitiesScored:0});expect(state.saved).toEqual([]);
  });
});
