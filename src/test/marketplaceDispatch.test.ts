import {readFileSync} from "node:fs";
import ts from "typescript";
import {describe,expect,it,vi} from "vitest";

// Read actual dependency maps and execute the exact dispatcher source. Provider
// and verified-auth boundaries are explicit fixtures; no credits/network used.
const transpile=(file:string)=>ts.transpileModule(readFileSync(`supabase/functions/osint-tools/${file}`,"utf8").replace(/^import \{ independentAiChat(?:, independentAiConfiguration)? \} from "\.\.\/_shared\/independentAi\.ts";\r?\n/m,'').replace(/\bexport\s+/g,""),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const connectedFor=(configuration:()=>unknown)=>new Function('independentAiConfiguration',`${transpile("marketplaceConnected.ts")}; return {CONNECTED_REQUIRED_SECRETS,CONNECTED_FREE_ALLOWANCE_FLAGS};`)(configuration);
const connected=connectedFor(()=>({required:['AI_CHAT_COMPLETIONS_URL','AI_MODEL','AI_API_KEY']}));
const licensed=new Function(`${transpile("marketplaceLicensed.ts")}; return {MARKETPLACE_REQUIRED_SECRETS};`)();
const code=transpile("marketplaceDispatch.ts");
class FixtureHttpError extends Error {constructor(message:string,public status:number){super(message);}}
const names=["runMarketplaceAlternatives","runMarketplaceSocialFull","runMarketplacePublic","runMarketplaceOpen","runMarketplaceConnected","runMarketplaceLicensed"];
const keys=[...new Set([...Object.values(connected.CONNECTED_REQUIRED_SECRETS as Record<string,string[]>).flat(),...Object.values(licensed.MARKETPLACE_REQUIRED_SECRETS as Record<string,string[]>).flat(),"SHODAN_API_KEY"])];
function fixture({allowances=false,keyPresence=true,flagValue="true"}:{allowances?:boolean;keyPresence?:boolean;flagValue?:string}={}){
  const fetch=vi.fn();const env:Record<string,string>={};if(keyPresence)for(const key of keys)env[key]="fixture-credential-never-live";
  if(allowances)for(const flag of ["AI_ZERO_SPEND_VERIFIED","AI_ENABLED","MARKETPLACE_FIRECRAWL_FREE_ALLOWANCE_VERIFIED","MARKETPLACE_HIBP_FREE_ALLOWANCE_VERIFIED","MARKETPLACE_SHODAN_FREE_ALLOWANCE_VERIFIED","MARKETPLACE_TWILIO_FREE_ALLOWANCE_VERIFIED","MARKETPLACE_CARSXE_FREE_ALLOWANCE_VERIFIED","MARKETPLACE_COURTLISTENER_FREE_ALLOWANCE_VERIFIED","MARKETPLACE_X_FREE_ALLOWANCE_VERIFIED","MARKETPLACE_DISCORD_FREE_ALLOWANCE_VERIFIED","MARKETPLACE_VIRUSTOTAL_FREE_ALLOWANCE_VERIFIED","MARKETPLACE_DARKOWL_FREE_ALLOWANCE_VERIFIED","MARKETPLACE_AISSTREAM_FREE_ALLOWANCE_VERIFIED"])env[flag]=flagValue;
  const marketplaceUser=vi.fn().mockResolvedValue({id:"verified-owner",authorization:'Bearer remotely-verified-fixture-user'});const marketplacePermission=vi.fn().mockResolvedValue(undefined);
  const runners=Object.fromEntries(names.map(name=>[name,vi.fn().mockResolvedValue(undefined)]));
  const independentAiConfiguration=()=>{const required=['AI_CHAT_COMPLETIONS_URL','AI_MODEL',...(env.AI_AUTH_MODE==='supabase_user'?[]:['AI_API_KEY'])];return {required,ready:env.AI_ENABLED==='true'&&env.AI_ZERO_SPEND_VERIFIED==='true'&&required.every(key=>!!env[key]),enabled:env.AI_ENABLED==='true',zero_spend_verified:env.AI_ZERO_SPEND_VERIFIED==='true'};};
  const connected=connectedFor(independentAiConfiguration);
  const helpers=new Function("Deno","CONNECTED_REQUIRED_SECRETS","CONNECTED_FREE_ALLOWANCE_FLAGS","MARKETPLACE_REQUIRED_SECRETS","marketplaceUser","marketplacePermission","MarketplaceHttpError","independentAiConfiguration",...names,"fetch",`${code};return {marketplaceStatus,marketplaceRun};`)(
    {env:{get:(name:string)=>env[name]}},connected.CONNECTED_REQUIRED_SECRETS,connected.CONNECTED_FREE_ALLOWANCE_FLAGS,licensed.MARKETPLACE_REQUIRED_SECRETS,marketplaceUser,marketplacePermission,FixtureHttpError,independentAiConfiguration,...names.map(name=>runners[name]),fetch);
  return {...helpers,env,fetch,marketplaceUser,marketplacePermission,runners};
}
const request=()=>new Request("https://app.example/run",{headers:{Authorization:"Bearer verified-fixture-session"}});
const gated=["sentiment-analysis","translation","pastebin-monitor","linkedin-harvester","reddit-profiler","instagram-osint","tiktok-tracker","social-media-scanner","lpr","caller-id","sms-detector","vehicle-lookup","public-records","twitter-deep-search","discord-intel","malware-sandbox","dark-web-monitor","vessel-tracker","shodan-integration"];
describe("marketplace zero-new-spend dispatcher",()=>{
  it.each(gated)("does not let credential-present %s bypass unknown allowance",async tool=>{
    const h=fixture();const status=h.marketplaceStatus();expect(status.new_provider_spend_allowed).toBe(false);expect(status.tools[tool]).toMatchObject({configured:false,missing_secrets:[],allowance_verified:false});expect(status.tools[tool].blocked_reason).toContain("zero-new-spend");
    await expect(h.marketplaceRun(request(),{tool,inputs:{}})).rejects.toMatchObject({status:424});expect(h.marketplacePermission).not.toHaveBeenCalled();for(const runner of Object.values(h.runners))expect(runner).not.toHaveBeenCalled();expect(h.fetch).not.toHaveBeenCalled();
  });
  it.each(["false","1","TRUE",""])("rejects ambiguous included-access flag %s",async flagValue=>{
    const h=fixture({allowances:true,flagValue});await expect(h.marketplaceRun(request(),{tool:"translation",inputs:{text:"Supplied text",target_language:"English"}})).rejects.toMatchObject({status:424});for(const runner of Object.values(h.runners))expect(runner).not.toHaveBeenCalled();expect(h.fetch).not.toHaveBeenCalled();
  });
  it("verified included allowance passes auth/permission before the real provider boundary",async()=>{
    const h=fixture({allowances:true});h.runners.runMarketplaceConnected.mockResolvedValue({source:"approved-fixture-provider",data:{translation:"fixture"}});expect(h.marketplaceStatus().tools.translation.configured).toBe(true);
    await expect(h.marketplaceRun(request(),{tool:"translation",inputs:{text:"Supplied text",target_language:"English"}})).resolves.toMatchObject({source:"approved-fixture-provider"});expect(h.marketplaceUser).toHaveBeenCalledTimes(1);expect(h.marketplacePermission).toHaveBeenCalledWith({id:"verified-owner",authorization:'Bearer remotely-verified-fixture-user'},"translation");expect(h.runners.runMarketplaceConnected).toHaveBeenCalledTimes(1);
  });
  it.each(['translation','sentiment-analysis'])("keeps %s disabled even when independent AI allowance is verified",async tool=>{
    const h=fixture({allowances:true});h.env.AI_ENABLED='false';expect(h.marketplaceStatus().tools[tool]).toMatchObject({configured:false,allowance_verified:true});await expect(h.marketplaceRun(request(),{tool,inputs:{}})).rejects.toMatchObject({status:424});expect(h.marketplacePermission).not.toHaveBeenCalled();for(const runner of Object.values(h.runners))expect(runner).not.toHaveBeenCalled();expect(h.fetch).not.toHaveBeenCalled();
  });
  it('supports verified free AI with caller authentication and no permanent API key',async()=>{
    const h=fixture({allowances:true});h.env.AI_AUTH_MODE='supabase_user';delete h.env.AI_API_KEY;h.runners.runMarketplaceConnected.mockResolvedValue({source:'owned-worker-fixture'});
    expect(h.marketplaceStatus().tools.translation).toMatchObject({configured:true,missing_secrets:[],allowance_verified:true});
    await h.marketplaceRun(request(),{tool:'translation',inputs:{text:'Supplied text',target_language:'English',authorization:'attacker-supplied-value'}});
    expect(h.runners.runMarketplaceConnected).toHaveBeenCalledWith('translation',{text:'Supplied text',target_language:'English',authorization:'attacker-supplied-value'},{authorization:'Bearer remotely-verified-fixture-user'});
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("missing provider credentials still block even when allowance flags are verified",async()=>{
    const h=fixture({allowances:true,keyPresence:false});expect(h.marketplaceStatus().tools["caller-id"]).toMatchObject({configured:false,missing_secrets:["TWILIO_API_KEY","TWILIO_API_SECRET"],allowance_verified:true});await expect(h.marketplaceRun(request(),{tool:"caller-id",inputs:{phone:"+14155550123"}})).rejects.toThrow("TWILIO_API_KEY, TWILIO_API_SECRET");for(const runner of Object.values(h.runners))expect(runner).not.toHaveBeenCalled();
  });
  it.each(["flight-tracking","reverse-ip","cve-tracker","threat-feed","ip-reputation","crypto-wallet-tracer","blockchain-tracer","phishing-detector","vin-decoder","sanctions-screening","corporate-records","insider-tracker","satellite-search"])("keeps documented keyless %s routable without provider flags",async tool=>{
    const h=fixture({keyPresence:false});expect(h.marketplaceStatus().tools[tool]).toMatchObject({configured:true,missing_secrets:[],allowance_verified:true});h.runners.runMarketplacePublic.mockResolvedValue({source:"keyless-fixture-provider"});await expect(h.marketplaceRun(request(),{tool,inputs:{}})).resolves.toMatchObject({source:"keyless-fixture-provider"});expect(h.marketplacePermission).toHaveBeenCalledTimes(1);
  });
  it.each([["streetview-compare","runMarketplaceAlternatives"],["telegram-monitor","runMarketplaceSocialFull"]])("preserves direct free %s override without old licensed/Firecrawl requirements",async(tool,handler)=>{
    const h=fixture({keyPresence:false});h.runners[handler].mockResolvedValue({source:"direct-public-fixture"});expect(h.marketplaceStatus().tools[tool]).toMatchObject({configured:true,missing_secrets:[],allowance_verified:true});await expect(h.marketplaceRun(request(),{tool,inputs:{}})).resolves.toMatchObject({source:"direct-public-fixture"});expect(h.runners[handler]).toHaveBeenCalledTimes(1);expect(h.runners.runMarketplaceConnected).not.toHaveBeenCalled();expect(h.runners.runMarketplaceLicensed).not.toHaveBeenCalled();
  });
  it("does not create an executable route from an unsupported catalog slug",async()=>{
    const h=fixture({allowances:true});await expect(h.marketplaceRun(request(),{tool:"facial-recognition",inputs:{}})).rejects.toMatchObject({status:422});for(const runner of Object.values(h.runners))expect(runner).not.toHaveBeenCalled();
  });
});
