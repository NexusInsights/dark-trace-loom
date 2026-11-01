import {beforeEach,describe,it,expect,vi} from 'vitest';
const harness=vi.hoisted(()=>({lookup:vi.fn(),writes:[] as {table:string;data:unknown}[],identifierError:null as unknown}));
vi.mock('./profileLookup',()=>({lookupProfiles:harness.lookup}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from(table:string){const query={insert:(data:unknown)=>{harness.writes.push({table,data});return query;},upsert:(data:unknown)=>{harness.writes.push({table,data});return query;},select:()=>query,single:async()=>({data:{id:'new-person'},error:null}),then(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown){return Promise.resolve({data:null,error:table==='persona_identifiers'?harness.identifierError:null}).then(resolve,reject);}};return query;}}}));
import {runPersonaDiscovery} from './personaDiscoveryEngine';
beforeEach(()=>{harness.lookup.mockReset();harness.writes=[];harness.identifierError=null;});
describe('creating a person before research',()=>{
  it('saves known inputs without any provider request when creating the investigation',async()=>{
    const result=await runPersonaDiscovery('user',{name:'Research subject',username:'knownhandle',email:'known@sample.org',searchProfiles:false});
    expect(result.personaId).toBe('new-person');expect(harness.lookup).not.toHaveBeenCalled();expect(harness.writes.find(w=>w.table==='personas')?.data).toMatchObject({user_id:'user',persona_label:'Research subject'});
    expect(harness.writes.find(w=>w.table==='persona_identifiers')?.data).toEqual(expect.arrayContaining([expect.objectContaining({identifier_type:'username',identifier_value:'knownhandle',source:'input'}),expect.objectContaining({identifier_type:'email',identifier_value:'known@sample.org'})]));
  });
  it('reports a failed identifier save instead of claiming the investigation is complete',async()=>{
    harness.identifierError={message:'Identifier storage failed'};
    await expect(runPersonaDiscovery('user',{name:'Research subject',searchProfiles:false})).rejects.toMatchObject({message:'Identifier storage failed'});expect(harness.lookup).not.toHaveBeenCalled();
  });
});
