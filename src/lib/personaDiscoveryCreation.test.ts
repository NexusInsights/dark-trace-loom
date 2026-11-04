import {beforeEach,describe,it,expect,vi} from 'vitest';
const harness=vi.hoisted(()=>({lookup:vi.fn(),writes:[] as {table:string;data:unknown}[],identifierError:null as unknown,ownerAvailable:true}));
vi.mock('./profileLookup',()=>({lookupProfiles:harness.lookup}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from(table:string){let writing=false;const query={insert:(data:unknown)=>{writing=true;harness.writes.push({table,data});return query;},upsert:(data:unknown)=>{writing=true;harness.writes.push({table,data});return query;},eq:()=>query,select:()=>query,single:async()=>({data:writing||harness.ownerAvailable?{id:'new-person'}:null,error:null}),then(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown){return Promise.resolve({data:null,error:table==='persona_identifiers'?harness.identifierError:null}).then(resolve,reject);}};return query;}}}));
import {runPersonaDiscovery} from './personaDiscoveryEngine';
beforeEach(()=>{harness.lookup.mockReset();harness.writes=[];harness.identifierError=null;harness.ownerAvailable=true;});
describe('creating a person before research',()=>{
  it('retains unavailable-provider reasons and makes no writes when no account observation was established',async()=>{
    harness.lookup.mockResolvedValue({schemaVersion:2,status:'error',username:'fixture',retrievedAt:'2026-11-04T00:00:00Z',profiles:[],checks:[{platform:'GitHub',sourceUrl:'https://api.github.com/users/fixture',retrievedAt:'2026-11-04T00:00:00Z',status:'unavailable',reason:'Provider returned HTTP 429'}]});
    await expect(runPersonaDiscovery('user',{profileUrl:'https://github.com/fixture'})).rejects.toThrow('GitHub: Provider returned HTTP 429');expect(harness.writes).toEqual([]);
  });
  it('bounds unavailable-provider diagnostics and supplies a missing-reason fallback without saving findings',async()=>{
    harness.lookup.mockResolvedValue({status:'error',username:'fixture',profiles:[],checks:Array.from({length:10},(_,i)=>({platform:`Fixture ${i}`,status:'unavailable',reason:i===0?undefined:' SYNTHETIC\n'+'x'.repeat(2000)}))});
    const error=await runPersonaDiscovery('user',{username:'fixture'}).catch(error=>error);
    expect(error).toBeInstanceOf(Error);expect(error.message.length).toBeLessThanOrEqual(1000);expect(error.message).not.toContain('\n');expect(error.message).toContain('no provider reason supplied');expect(error.message).toContain('Fixture 9:');expect(harness.writes).toEqual([]);
  });
  it('rejects legacy enrichment requests before provider or storage work instead of saving an invalid profile lookup',async()=>{
    await expect(runPersonaDiscovery('user',{name:'Research subject',enrich:true})).rejects.toThrow('separately in Tools');
    expect(harness.lookup).not.toHaveBeenCalled();expect(harness.writes).toEqual([]);
  });
  it('saves known inputs without any provider request when creating the investigation',async()=>{
    const result=await runPersonaDiscovery('user',{name:'Research subject',username:'knownhandle',email:'known@sample.org',searchProfiles:false});
    expect(result.personaId).toBe('new-person');expect(harness.lookup).not.toHaveBeenCalled();expect(harness.writes.find(w=>w.table==='personas')?.data).toMatchObject({user_id:'user',persona_label:'Research subject'});
    expect(harness.writes.find(w=>w.table==='persona_identifiers')?.data).toEqual(expect.arrayContaining([expect.objectContaining({identifier_type:'username',identifier_value:'knownhandle',source:'input'}),expect.objectContaining({identifier_type:'email',identifier_value:'known@sample.org'})]));
    expect(harness.writes.find(w=>w.table==='persona_identifiers')?.data).toEqual(expect.arrayContaining([expect.objectContaining({confidence_score:0})]));
  });
  it('saves exact account observations with provenance without making them person identifiers',async()=>{
    const profile={platform:'GitHub',platformId:'123',accountId:'github:123',username:'knownhandle',profileUrl:'https://github.com/knownhandle',sourceUrl:'https://api.github.com/users/knownhandle',retrievedAt:'2026-11-04T00:00:00Z',existence:'found',personAssociation:'unreviewed',evidenceKind:'public_account',email:'observed@sample.org'};
    harness.lookup.mockResolvedValue({schemaVersion:2,status:'success',username:'knownhandle',retrievedAt:profile.retrievedAt,profiles:[profile],checks:[{platform:'GitHub',sourceUrl:profile.sourceUrl,retrievedAt:profile.retrievedAt,status:'found',profile}]});
    await runPersonaDiscovery('user',{username:'knownhandle'});
    const identifiers=harness.writes.find(w=>w.table==='persona_identifiers')?.data as Record<string,unknown>[];
    expect(identifiers).toHaveLength(1);expect(identifiers[0]).toMatchObject({identifier_type:'username',source:'input',confidence_score:0});
    expect(harness.writes.find(w=>w.table==='tool_results')?.data).toMatchObject({tool_name:'public-profile-search',status:'success',result_data:{profiles:[profile],persona_id:'new-person'}});
  });
  it('reports a failed identifier save instead of claiming the investigation is complete',async()=>{
    harness.identifierError={message:'Identifier storage failed'};
    await expect(runPersonaDiscovery('user',{name:'Research subject',searchProfiles:false})).rejects.toMatchObject({message:'Identifier storage failed'});expect(harness.lookup).not.toHaveBeenCalled();
  });
  it('rejects conflicting exact seeds before any provider or storage operation',async()=>{
    await expect(runPersonaDiscovery('user',{username:'knownhandle',profileUrl:'https://github.com/knownhandle'})).rejects.toThrow('one exact');
    expect(harness.lookup).not.toHaveBeenCalled();expect(harness.writes).toEqual([]);
  });
  it('checks existing investigation ownership before looking up a supplied account',async()=>{
    harness.ownerAvailable=false;
    await expect(runPersonaDiscovery('user',{personaId:'00000000-0000-0000-0000-000000000001',username:'knownhandle'})).rejects.toThrow('unavailable');
    expect(harness.lookup).not.toHaveBeenCalled();expect(harness.writes).toEqual([]);
  });
  it('accepts an exact supported profile URL as an input lead without a lookup when explicitly requested',async()=>{
    await runPersonaDiscovery('user',{profileUrl:'https://github.com/knownhandle',searchProfiles:false});
    expect(harness.lookup).not.toHaveBeenCalled();expect(harness.writes.find(w=>w.table==='persona_identifiers')?.data).toEqual([expect.objectContaining({identifier_type:'social_profile',identifier_value:'https://github.com/knownhandle',source:'input',confidence_score:0})]);
  });
  it('rejects private or unrelated URL seeds before any provider request',async()=>{
    await expect(runPersonaDiscovery('user',{profileUrl:'https://127.0.0.1/profile'})).rejects.toThrow('direct');
    expect(harness.lookup).not.toHaveBeenCalled();expect(harness.writes).toEqual([]);
  });
});
