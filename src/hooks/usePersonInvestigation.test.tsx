import { beforeEach,describe,it,expect,vi } from "vitest";
import { act,renderHook,waitFor } from "@testing-library/react";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
const harness=vi.hoisted(()=>({ownerError:null as unknown,writeError:null as unknown,writes:[] as Record<string,unknown>[],filters:[] as unknown[][],reads:0}));
vi.mock('./useAuth',()=>({useAuth:()=>({user:{id:'current-user'}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from(table:string){
  let writing=false;let offset=0;
  const query={select:()=>query,eq:(key:string,value:unknown)=>{harness.filters.push([table,key,value]);return query;},contains:(key:string,value:unknown)=>{harness.filters.push([table,key,value]);return query;},order:()=>query,abortSignal:()=>query,range:(start:number)=>{offset=start;return query;},
    single:async()=>({data:harness.ownerError?null:{id:'person'},error:harness.ownerError}),
    insert:(data:Record<string,unknown>)=>{writing=true;harness.writes.push(data);return query;},
    then(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown){if(writing)return Promise.resolve({data:null,error:harness.writeError}).then(resolve,reject);harness.reads++;return Promise.resolve({data:offset===0?Array.from({length:200},(_,i)=>({id:`r${i}`,tool_name:'fixture',result_data:{},created_at:'2026-10-15'})):[{id:'last',tool_name:'fixture',result_data:{},created_at:'2026-10-15'}],error:null}).then(resolve,reject);},
  };return query;
}}}));
import { usePersonRecords,useSavePersonRecord } from './usePersonInvestigation';
const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}>{children}</QueryClientProvider>;
beforeEach(()=>{harness.ownerError=null;harness.writeError=null;harness.writes=[];harness.filters=[];harness.reads=0;});
describe('person evidence persistence boundary',()=>{
  it('verifies owner before writing and overrides any supplied persona identifier',async()=>{
    const {result}=renderHook(()=>useSavePersonRecord('selected-person'),{wrapper});
    await act(async()=>result.current.mutateAsync({toolName:'person-investigation-review',data:{persona_id:'wrong-person',decision:'rejected'}}));
    expect(harness.filters).toContainEqual(['personas','user_id','current-user']);expect(harness.filters).toContainEqual(['personas','id','selected-person']);
    expect(harness.writes[0]).toMatchObject({user_id:'current-user',result_data:{persona_id:'selected-person',decision:'rejected'}});
  });
  it('preserves evidence on an ownership failure by making no write',async()=>{
    harness.ownerError={message:'Person unavailable'};const {result}=renderHook(()=>useSavePersonRecord('other-person'),{wrapper});
    await act(async()=>{await expect(result.current.mutateAsync({toolName:'person-investigation-review',data:{decision:'accepted'}})).rejects.toMatchObject({message:'Person unavailable'});});
    expect(harness.writes).toEqual([]);
  });
  it('does not report a successful save when the database rejects the write',async()=>{
    harness.writeError={message:'Database write failed'};const {result}=renderHook(()=>useSavePersonRecord('person'),{wrapper});
    await act(async()=>{await expect(result.current.mutateAsync({toolName:'person-investigation-evidence',data:{item:{title:'Evidence'}}})).rejects.toMatchObject({message:'Database write failed'});});
    await waitFor(()=>expect(result.current.isError).toBe(true));
  });
  it('scopes history to the signed-in user and selected person and reads beyond one page',async()=>{
    const {result}=renderHook(()=>usePersonRecords('selected-person'),{wrapper});await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(201);expect(harness.reads).toBe(2);expect(harness.filters).toContainEqual(['tool_results','user_id','current-user']);expect(harness.filters).toContainEqual(['tool_results','result_data',{persona_id:'selected-person'}]);
  });
});
