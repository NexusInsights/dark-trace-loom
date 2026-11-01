import { describe,it,expect } from "vitest";
import { buildPersonDossier,dossierMarkdown,sourceUrl,type DossierRecord,type DossierIdentifier } from "./personDossier";
const row=(id:string,tool_name:string,result_data:unknown,created_at="2026-10-15T12:00:00Z"):DossierRecord=>({id,tool_name,result_data,created_at});
const profile={platform:"GitHub",username:"octocat",profileUrl:"https://github.com/octocat",sourceUrl:"https://api.github.com/users/octocat",retrievedAt:"2026-10-15T12:00:00Z",email:"public@sample.org",avatarUrl:"https://avatars.githubusercontent.com/u/1",accountCreatedAt:"2011-01-25T18:44:36Z"};
describe("person investigation dossier",()=>{
  it("uses source event dates and keeps retrieval time separate",()=>{
    const d=buildPersonDossier([], [row('lookup','public-profile-search',{profiles:[profile]})]);
    expect(d.events).toHaveLength(1);expect(d.events[0]).toMatchObject({occurredAt:profile.accountCreatedAt,retrievedAt:profile.retrievedAt,sourceUrl:profile.sourceUrl});
  });
  it("retains the most recent review across a repeated lookup and excludes rejected profile contacts/events",()=>{
    const d=buildPersonDossier([], [row('lookup','public-profile-search',{profiles:[profile]}),row('review','person-investigation-review',{profile_url:profile.profileUrl,decision:'rejected'},'2026-10-15T12:01:00Z'),row('rerun','public-profile-search',{profiles:[profile]},'2026-10-15T12:02:00Z')]);
    expect(d.accounts[0].decision).toBe('rejected');expect(d.contacts).toEqual([]);expect(d.events).toEqual([]);
  });
  it("allows a later explicit review to restore a match",()=>{
    const d=buildPersonDossier([], [row('lookup','public-profile-search',{profiles:[profile]}),row('no','person-investigation-review',{profile_url:profile.profileUrl,decision:'rejected'},'2026-10-15T12:01:00Z'),row('yes','person-investigation-review',{profile_url:profile.profileUrl,decision:'accepted'},'2026-10-15T12:02:00Z')]);
    expect(d.accounts[0].decision).toBe('accepted');expect(d.contacts).toHaveLength(1);expect(d.events).toHaveLength(1);
  });
  it("does not convert generated identifiers, search candidates or availability flags into contacts",()=>{
    const ids=[{id:'guess',identifier_type:'email',identifier_value:'guess@sample.org',source:'email_permutation',created_at:'2026-10-15'}] as DossierIdentifier[];
    const d=buildPersonDossier(ids,[row('search','pdl-person-search',{details:{matches:[{emails:[{address:'other@sample.org'}]}]}}),row('enrich','pdl-person-enrich',{details:{personal_emails:true,phone_numbers:true,raw:{has_email:true}}})]);
    expect(d.contacts).toEqual([]);
  });
  it("combines explicit PDL enrichment contacts and provided inputs with their different provenance",()=>{
    const ids=[{id:'phone',identifier_type:'phone',identifier_value:'+14155552671',source:'input',created_at:'2026-10-15'}];
    const d=buildPersonDossier(ids,[row('enrich','pdl-person-enrich',{details:{work_email:'actual@sample.org'}})]);
    expect(d.contacts.map(c=>c.type)).toEqual(['phone','email']);expect(d.contacts[0].source).toContain('Provided');expect(d.contacts[1].sourceUrl).toContain('peopledatalabs');
  });
  it("keeps actual provider-returned profile URLs as reviewable account candidates",()=>{
    const d=buildPersonDossier([],[row('match','public-profile-search',{profiles:[],enrichment:{linkedin_url:'linkedin.com/in/example-person',linkedin_username:'example-person'}})]);
    expect(d.accounts[0]).toMatchObject({profileUrl:'https://linkedin.com/in/example-person',decision:'unreviewed',evidenceKind:'provider_match'});
  });
  it("normalizes actual X post dates and CourtListener filing dates into source-linked events",()=>{
    const d=buildPersonDossier([], [row('x','twitter-deep-search',{details:{posts:[{id:'12345678',text:'A real post',created_at:'2022-02-01T01:00:00Z'}]}}),row('court','public-records',{details:{results:[{caseName:'Example v. Example',dateFiled:'2020-05-20',absolute_url:'/opinion/123/example/'}]}})]);
    expect(d.events.map(e=>e.occurredAt)).toEqual(['2022-02-01T01:00:00Z','2020-05-20']);expect(d.events[0].sourceUrl).toBe('https://x.com/i/web/status/12345678');expect(d.events[1].title).toContain('requires review');
  });
  it("keeps undated evidence out of the timeline and deduplicates repeated source posts",()=>{
    const data={details:{posts:[{url:'https://sample.org/post/1',text:'A post',created_at:'2020-01-01'}]}};
    const d=buildPersonDossier([], [row('note','person-investigation-evidence',{item:{kind:'asset',title:'An asset document',sourceUrl:'https://sample.org/deed'}}),row('one','x',data),row('two','x',data)]);
    expect(d.evidence).toHaveLength(1);expect(d.events).toHaveLength(1);expect(d.events[0].occurredAt).toBe('2020-01-01');
  });
  it("rejects unsafe source links and invalid dates instead of inventing evidence",()=>{
    expect(sourceUrl('javascript:alert(1)')).toBe('');expect(sourceUrl('https://user:secret@sample.org')).toBe('');
    const d=buildPersonDossier([], [row('bad','public-profile-search',{profiles:[{...profile,profileUrl:'javascript:alert(1)'}]}),row('date','person-investigation-evidence',{item:{title:'Bad date',sourceUrl:'https://sample.org',occurredAt:'2026-02-31'}})]);
    expect(d.accounts).toEqual([]);expect(d.events).toEqual([]);
  });
  it("exports evidence, review decisions and original source references without a fictional criminal-history conclusion",()=>{
    const d=buildPersonDossier([], [row('lookup','public-profile-search',{profiles:[profile]})]);const report=dossierMarkdown('Research subject',d);
    expect(report).toContain(profile.sourceUrl);expect(report).toContain('unreviewed');expect(report).toContain('2011-01-25');expect(report).toContain('not a comprehensive background check');
  });
  it('exports actual vehicle facts and source photos instead of only internal record counts',()=>{
    const d=buildPersonDossier([],[row('profile','public-profile-search',{profiles:[profile]}),row('vin','vin-decoder',{details:{source:'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/example',vehicle:{VIN:'EXAMPLE',Make:'HONDA',Model:'Accord',ModelYear:'2003'}}})]);
    const report=dossierMarkdown('Public test fixture',d);expect(report).toContain('Make: HONDA');expect(report).toContain('ModelYear: 2003');expect(report).toContain(profile.avatarUrl);expect(report).toContain('vpic.nhtsa.dot.gov');
  });
});
