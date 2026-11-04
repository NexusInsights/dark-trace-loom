import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state=vi.hoisted(()=>({tables:{} as Record<string,Record<string,unknown>[]>,failure:'',user:'user',calls:[] as string[]}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:state.user?{id:state.user}:null})}));
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}));
vi.mock('@/components/intel',()=>({StatDisplay:({label,value}:{label:string;value:unknown})=><div data-stat={label}>{String(value)}</div>,IntelCard:({title,children}:{title:string;children:React.ReactNode})=><section><h2>{title}</h2>{children}</section>,GlassPanel:({children}:{children:React.ReactNode})=><div>{children}</div>}));
vi.mock('recharts',()=>Object.fromEntries(['BarChart','Bar','XAxis','YAxis','Tooltip','ResponsiveContainer','AreaChart','Area','PieChart','Pie','Cell','RadarChart','Radar','PolarGrid','PolarAngleAxis','PolarRadiusAxis'].map(name=>[name,({children}:{children:React.ReactNode})=><div>{children}</div>])));
vi.mock('@/integrations/supabase/client',()=>({supabase:{channel(){const channel={on:()=>channel,subscribe:()=>channel};return channel;},removeChannel:vi.fn(),from(table:string){state.calls.push(table);let head=false,bounds:[number,number]|undefined,limit:number|undefined;const filters:[string,unknown][]=[],listFilters:[string,unknown[]][]=[];const query={select:(_fields?:string,options?:{head?:boolean})=>{head=!!options?.head;return query;},eq:(key:string,value:unknown)=>{filters.push([key,value]);return query;},in:(key:string,values:unknown[])=>{listFilters.push([key,values]);return query;},or:()=>query,order:()=>query,limit:(count:number)=>{limit=count;return query;},range:(from:number,to:number)=>{bounds=[from,to];return query;},then(resolve:(value:unknown)=>unknown){if(state.failure===table)return Promise.resolve({data:null,error:{message:`${table} read denied`},count:null}).then(resolve);let rows=(state.tables[table]||[]).filter(row=>filters.every(([key,value])=>row[key]===value)&&listFilters.every(([key,values])=>values.includes(row[key])));const count=rows.length;if(bounds)rows=rows.slice(bounds[0],bounds[1]+1);if(limit!==undefined)rows=rows.slice(0,limit);return Promise.resolve({data:head?null:rows,error:null,count}).then(resolve);}};return query;}}}));
import Dashboard from './Dashboard';
import {supportedProfileAssociations,type SavedIdentityRecord} from '@/lib/identityEvidence';
const date='2026-11-04T00:00:00Z';
const profile={platform:'GitHub',username:'sourceuser',platformId:'1',accountId:'github:1',profileUrl:'https://github.com/sourceuser',sourceUrl:'https://api.github.com/users/sourceuser',retrievedAt:date,existence:'found',personAssociation:'unreviewed',evidenceKind:'public_account'};
const ledger:SavedIdentityRecord[]=[{id:'lookup',tool_name:'public-profile-search',status:'success',created_at:date,result_data:{persona_id:'person',schemaVersion:2,status:'success',username:'sourceuser',retrievedAt:date,profiles:[profile],checks:[{platform:'GitHub',sourceUrl:profile.sourceUrl,retrievedAt:date,status:'found',profile}]}},{id:'review',tool_name:'profile-association-review',status:'success',created_at:'2026-11-04T01:00:00Z',result_data:{persona_id:'person',profile_url:profile.profileUrl,account_id:profile.accountId,lookup_result_id:'lookup',decision:'supported',supporting_source_url:'https://sample.org/author',reason:'Original author page explicitly links this observed account.',reviewed_at:'2026-11-04T01:00:00Z'}}];
const admitted=()=>({id:'supported',user_id:'user',entity_type:'social_profile',entity_value:profile.profileUrl,created_at:date,metadata:{identity_evidence:supportedProfileAssociations(ledger)[0].evidence}});
beforeEach(()=>{cleanup();state.failure='';state.user='user';state.calls=[];state.tables={personas:[{id:'person',user_id:'user'}],cases:[],artifacts:[],subjects:[],activity_logs:[],tool_results:[],identity_entities:[],identity_entity_links:[],entity_scores:[],breach_records:[]};});
async function show(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});render(<QueryClientProvider client={client}><Dashboard/></QueryClientProvider>);await waitFor(()=>{const queries=client.getQueryCache().findAll();expect(queries.length).toBeGreaterThan(0);expect(queries.every(query=>query.state.fetchStatus==='idle'&&query.state.status!=='pending')).toBe(true);});return client;}
function stat(pattern:RegExp){const node=[...document.querySelectorAll('[data-stat]')].find(node=>pattern.test(node.getAttribute('data-stat')||''));expect(node).toBeDefined();return node?.textContent;}
describe('original dashboard evidence boundary',()=>{
  it('excludes historical guesses, pattern links and old risk scores from factual analytics',async()=>{
    state.tables.identity_entities=[{id:'guess',user_id:'user',entity_type:'username',entity_value:'inventeduser',created_at:date,confidence_score:1,metadata:{}}];
    state.tables.identity_entity_links=[{id:'link',user_id:'user',source_entity_id:'guess',target_entity_id:'guess',relationship_type:'username_matches_profile',confidence_score:.9,created_at:date}];
    state.tables.entity_scores=[{id:'score',user_id:'user',entity_id:'guess',score:98,score_reasons:[],entity:{entity_value:'inventeduser',entity_type:'username'}}];
    await show();expect(stat(/Entities|Reviewed accounts/i)).toBe('0');expect(stat(/^Links$|Supported links/i)).toBe('0');expect(screen.queryByText('inventeduser')).toBeNull();
  });
  it('counts only a currently owned source-bound supported account',async()=>{
    state.tables.tool_results=ledger.map(row=>({...row,user_id:'user'}));state.tables.identity_entities=[admitted()];
    await show();expect(stat(/Entities|Reviewed accounts/i)).toBe('1');
  });
  it('suppresses stale entity metadata immediately after the latest review is rejected',async()=>{
    state.tables.tool_results=[...ledger.map(row=>({...row,user_id:'user'})),{...ledger[1],id:'reject',user_id:'user',created_at:'2026-11-04T02:00:00Z',result_data:{...(ledger[1].result_data as object),decision:'rejected'}}];state.tables.identity_entities=[admitted()];
    await show();expect(stat(/Entities|Reviewed accounts/i)).toBe('0');
  });
  it('shows a failed outcome when a legacy completed record contains an actual error',async()=>{
    state.tables.tool_results=[{id:'failed',user_id:'user',tool_name:'legacy lookup',status:'completed',created_at:date,result_data:{error:'Provider refused request',summary:'Invented success claim'}}];
    await show();expect(screen.getByText(/Failed.*saved output/i)).toBeTruthy();expect(screen.queryByText('Invented success claim')).toBeNull();
  });
  it('shows a source-read error instead of cached factual metrics when the review ledger cannot be checked',async()=>{
    state.failure='tool_results';state.tables.identity_entities=[admitted()];
    await show();expect(screen.getByRole('alert').textContent).toMatch(/unavailable|could not/i);expect(document.querySelector('[data-stat]')).toBeNull();
  });
});
