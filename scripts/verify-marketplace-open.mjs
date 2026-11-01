import fs from "node:fs/promises";
import ts from "typescript";
const source=await fs.readFile(new URL("../supabase/functions/osint-tools/marketplaceOpen.ts",import.meta.url),"utf8");
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
const {runMarketplaceOpen}=await import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString("base64")}`);
const cases=[
 ["flight-tracking",{latitude:30.2672,longitude:-97.7431,radius_nm:25}],
 ["reverse-ip",{ip:"1.1.1.1"}],
 ["cve-tracker",{cve:"CVE-2021-44228"}],
 ["threat-feed",{keyword:"CVE-2021-44228"}],
 ["ip-reputation",{ip:"1.1.1.1"}],
 ["crypto-wallet-tracer",{address:"1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"}],
 ["blockchain-tracer",{address:"1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"}],
 ["phishing-detector",{domain:"example.com"}],
];
const evidence=[];
for(const [tool,params] of cases){try{const r=await runMarketplaceOpen(tool,params);if(!r)throw new Error("Missing handler");if(tool==="flight-tracking"&&!Array.isArray(r.data?.ac))throw new Error("No provider aircraft list");if(tool==="cve-tracker"&&r.returned!==1)throw new Error("Known CVE not returned");if(tool==="threat-feed"&&r.status!=="complete")throw new Error("Partial feed coverage");if(tool.includes("tracer")&&!Array.isArray(r.data?.transactions))throw new Error("No transaction list");if(tool==="phishing-detector"&&r.status!=="complete")throw new Error("Partial DNS coverage");const item={tool,passed:true,source:r.source,retrieved_at:r.retrieved_at,record_count:r.aircraft_count??r.returned??r.data?.transactions?.length??r.observations?.length??r.data?.matches?.length,feed_totals:r.feeds?.map(f=>({source:f.source,total:f.total,matched:f.matched,status:f.status}))};evidence.push(item);console.log(JSON.stringify(item));}catch(error){const item={tool,passed:false,error:String(error)};evidence.push(item);console.error(JSON.stringify(item));process.exitCode=1;}}
try{await runMarketplaceOpen("shodan-integration",{ip:"1.1.1.1"});throw new Error("Unconfigured Shodan unexpectedly ran");}catch(error){const expected=String(error).includes("SHODAN_API_KEY is not configured");evidence.push({tool:"shodan-integration",passed:expected,status:"provider_configuration_required",note:"No Shodan licensed account request or licensing flag was fabricated during verification."});if(!expected)process.exitCode=1;}
if(process.argv.includes("--save"))await fs.writeFile(new URL("../deployment-evidence/marketplace-open-live.json",import.meta.url),JSON.stringify({checked_at:new Date().toISOString(),execution:"Local Node making actual public-provider requests; separate live backend/UI acceptance is required.",evidence},null,2));
