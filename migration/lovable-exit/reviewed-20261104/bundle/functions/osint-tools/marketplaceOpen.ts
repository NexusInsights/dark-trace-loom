// Real public APIs. Fixed provider origins, bounded requests, and explicit coverage.
type MarketParams = Record<string, unknown>;
type MarketRecord = Record<string, unknown>;
const MARKET_USER_AGENT = "InsightNexus/1.0 (contact: travis@tjksecurity.com)";
const marketFeedCache = new Map<string, { data: unknown; retrieved_at: string; expires: number; last_modified: string | null }>();
function marketEnv(name: string): string { return (globalThis as unknown as { Deno?: { env?: { get(name: string): string | undefined } } }).Deno?.env?.get(name)?.trim() || ""; }
function marketObject(value: unknown): MarketRecord { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as MarketRecord : {}; }
function marketText(value: unknown, max = 300): string { return typeof value === "string" ? value.trim().slice(0,max) : ""; }
function marketIp(value: unknown): string {
  const ip = marketText(value, 45);
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) || ip.split('.').some(x => Number(x)>255)) throw new Error("Enter a valid IPv4 address.");
  const parts = ip.split('.').map(Number);
  if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)) throw new Error("This provider lookup requires a public IPv4 address.");
  return parts.join('.');
}
function marketDomain(value: unknown): string {
  const d = marketText(value,253).toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) throw new Error("Enter a hostname without a URL, port or path.");
  return d;
}
async function marketFetch(url: string, init: RequestInit = {}, allow404 = false): Promise<Response> {
  let r: Response;
  try { r = await fetch(url,{...init,headers:{"User-Agent":MARKET_USER_AGENT,...Object.fromEntries(new Headers(init.headers).entries())},redirect:'error',signal:AbortSignal.timeout(20000)}); }
  catch { throw new Error(`${new URL(url).hostname} request failed or timed out; no automatic retry was made.`); }
  if (!r.ok && !(allow404 && r.status===404)) throw new Error(`${new URL(url).hostname} returned HTTP ${r.status}${r.status===429 ? '; provider rate limit reached; no automatic retry' : ''}`);
  return r;
}
async function marketRead(r: Response, max = 8_000_000): Promise<string> {
  if (Number(r.headers.get('content-length')) > max) throw new Error('Provider response exceeded the processing limit.');
  const reader = r.body?.getReader(); if (!reader) throw new Error('Provider response had no body.');
  const decoder = new TextDecoder(); let text='', bytes=0;
  try { for (;;) { const part=await reader.read(); if(part.done) break; bytes+=part.value.byteLength; if(bytes>max) throw new Error('Provider response exceeded the processing limit.'); text+=decoder.decode(part.value,{stream:true}); } text+=decoder.decode(); }
  catch(e) { await reader.cancel().catch(()=>undefined); throw e; } finally { reader.releaseLock(); } return text;
}
async function marketParse(r: Response): Promise<unknown> { const text=await marketRead(r); try{return JSON.parse(text);}catch{throw new Error('Provider returned invalid JSON.');} }
async function marketJson(url: string, init: RequestInit = {}): Promise<MarketRecord> {
  const r = await marketFetch(url,init);
  const d=await marketParse(r); if (!d || typeof d!=='object' || Array.isArray(d)) throw new Error(`${new URL(url).hostname} returned no valid JSON object.`); return d as MarketRecord;
}
const marketEvidence = (source: string, data: unknown, coverage: string) => ({source,retrieved_at:new Date().toISOString(),coverage,data});
async function marketCachedFeed(source: string, ttl: number) {
  const cached=marketFeedCache.get(source); if(cached && cached.expires>Date.now()) return cached;
  const r=await marketFetch(source), data=await marketParse(r); if(source.includes('feodotracker')?!Array.isArray(data):!Array.isArray(marketObject(data).vulnerabilities)) throw new Error(`${new URL(source).hostname} returned no valid feed record array.`); const entry={data,retrieved_at:new Date().toISOString(),expires:Date.now()+ttl,last_modified:r.headers.get('last-modified')}; marketFeedCache.set(source,entry); return entry;
}

export async function runMarketplaceOpen(tool: string, p: MarketParams): Promise<Record<string, unknown> | undefined> {
  if (tool==='flight-tracking') {
    if(p.latitude===undefined || p.longitude===undefined || String(p.latitude).trim()==='' || String(p.longitude).trim()==='') throw new Error('Latitude and longitude are required.');
    const lat=Number(p.latitude), lon=Number(p.longitude), radius=Number(p.radius_nm===undefined || p.radius_nm==='' ? 25 : p.radius_nm);
    if (!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>180||!Number.isFinite(radius)||radius<1||radius>250) throw new Error('Valid coordinates and radius 1–250 nautical miles are required.');
    const source=`https://api.adsb.lol/v2/point/${lat}/${lon}/${radius}`;
    const d=await marketJson(source);
    if (!Array.isArray(d.ac)) throw new Error('ADSB.lol returned no valid aircraft list.');
    return {...marketEvidence(source,d,'Live ADS-B receiver coverage; not worldwide completeness or historical flight paths.'),aircraft_count:d.ac.length,license:'ODbL, ADSB.lol attribution'};
  }
  if (tool==='shodan-integration') {
    const ip=marketIp(p.ip), key=marketEnv('SHODAN_API_KEY');
    if(key) { const source=`https://api.shodan.io/shodan/host/${ip}`; const r=await marketFetch(`${source}?key=${encodeURIComponent(key)}`,{},true); const data=r.status===404 ? {ip,status:'no_record',notice:'Shodan has no indexed host record.'} : await marketParse(r); if(!data || typeof data!=='object' || Array.isArray(data)) throw new Error('Shodan returned invalid host data.'); return marketEvidence(source,data,'Configured Shodan account indexed host details. Provider entitlements apply; this performs no active scan.'); }
    if(marketEnv('SHODAN_INTERNETDB_LICENSED')!=='true') throw new Error('SHODAN_API_KEY is not configured. Commercial InternetDB use requires a Shodan Enterprise license and explicit SHODAN_INTERNETDB_LICENSED=true configuration. No unlicensed fallback was made.');
    const source=`https://internetdb.shodan.io/${ip}`, r=await marketFetch(source,{},true);
    const data=r.status===404 ? {ip,status:'no_record',notice:'No InternetDB record was supplied; this does not prove that no ports are open.'} : await marketParse(r); if(!data || typeof data!=='object' || Array.isArray(data)) throw new Error('InternetDB returned invalid host data.');
    return {...marketEvidence(source,data,'Explicitly licensed Shodan InternetDB weekly passive snapshot for one IPv4 address; no active scanning, banners, or full Shodan search.'),license:'Commercial use requires Shodan Enterprise licensing.'};
  }
  if (tool==='reverse-ip') {
    const ip=marketIp(p.ip), source=`https://api.hackertarget.com/reverseiplookup/?q=${encodeURIComponent(ip)}`;
    const r=await marketFetch(source), text=(await marketRead(r,1_000_000)).trim();
    if (/^(error|api count|api limit|invalid|no records)/i.test(text)) throw new Error(`HackerTarget: ${text.slice(0,200)}`);
    const records=text.split(/\r?\n/).filter(x=>/^[a-z0-9_.-]+$/i.test(x)), domains=records.slice(0,500);
    if (!domains.length) throw new Error('HackerTarget returned no valid domain records.');
    return {...marketEvidence(source,domains,'Provider-associated domains; not proof of current co-hosting. At most 500 supplied records are displayed. Free provider limits apply.'),ip,returned:domains.length,provider_records:records.length,truncated:records.length>domains.length};
  }
  if (tool==='cve-tracker') {
    const keyword=marketText(p.keyword || p.cve);
    if (!keyword) throw new Error('Enter a CVE ID or product keyword.');
    const query=new URLSearchParams({resultsPerPage:'20'});
    if (/^CVE-\d{4}-\d{4,}$/i.test(keyword)) query.set('cveId',keyword.toUpperCase()); else query.set('keywordSearch',keyword);
    const source=`https://services.nvd.nist.gov/rest/json/cves/2.0?${query}`;
    const d=await marketJson(source);
    if (!Array.isArray(d.vulnerabilities)) throw new Error('NVD returned no valid vulnerability list.');
    return {...marketEvidence(source,d,'NVD vulnerability search at request time. A result does not establish that a local asset is vulnerable.'),returned:d.vulnerabilities.length};
  }
  if (tool==='threat-feed' || tool==='ip-reputation') {
    const feodo='https://feodotracker.abuse.ch/downloads/ipblocklist.json';
    if (tool==='ip-reputation') {
      const ip=marketIp(p.ip);
      const feed=await marketCachedFeed(feodo,300_000); if(!Array.isArray(feed.data)) throw new Error('Feodo Tracker returned an invalid feed.');
      return {...marketEvidence(feodo,{ip,matches:feed.data.filter(row=>marketObject(row).ip_address===ip)},'Feodo Tracker botnet C2 blocklist only. No match is not evidence that an IP is safe.'),feed_retrieved_at:feed.retrieved_at,feed_last_modified:feed.last_modified};
    }
    const kev='https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
    const query=marketText(p.keyword).toLowerCase();
    const sources=[kev,feodo], loaded=await Promise.allSettled(sources.map(source=>marketCachedFeed(source,source===feodo?300_000:3_600_000)));
    const feeds=loaded.map((entry,index)=>{ const source=sources[index]; if(entry.status==='rejected') return {source,status:'failed',error:entry.reason instanceof Error?entry.reason.message:'Provider request failed'}; const data=index===0?marketObject(entry.value.data).vulnerabilities:entry.value.data; if(!Array.isArray(data)) return {source,status:'failed',error:'Provider returned invalid feed records'}; const records=data.filter(row=>!query || JSON.stringify(row).toLowerCase().includes(query)); return {source,status:'checked',retrieved_at:entry.value.retrieved_at,last_modified:entry.value.last_modified,catalog_version:index===0?marketObject(entry.value.data).catalogVersion:undefined,total:data.length,matched:records.length,records:records.slice(0,100)}; });
    if(feeds.every(f=>f.status==='failed')) throw new Error('Both threat-feed providers failed; no records were fabricated.');
    return {retrieved_at:new Date().toISOString(),status:feeds.some(f=>f.status==='failed')?'partial':'complete',coverage:'Two real feeds: CISA KEV vulnerabilities and Feodo Tracker C2 IPs. No 100-feed coverage claim. Source failures are explicit.',feeds};
  }
  if (tool==='crypto-wallet-tracer' || tool==='blockchain-tracer') {
    const address=marketText(p.address,100);
    if (!/^(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[ac-hj-np-z02-9]{11,87})$/.test(address)) throw new Error('This public integration requires a Bitcoin mainnet address. Other chains require an explorer provider.');
    const source=`https://blockstream.info/api/address/${address}`;
    const [account,transactionsResponse]=await Promise.all([marketJson(source),marketFetch(`${source}/txs`)]);
    const transactions=await marketParse(transactionsResponse);
    if (!Array.isArray(transactions)) throw new Error('Blockstream returned invalid transactions.');
    return {...marketEvidence(source,{account,transactions},'Bitcoin mainnet on-chain transactions (values in satoshis), current address statistics and provider transaction input/output addresses. No ownership attribution or 30-chain coverage.'),transactions_source:`${source}/txs`,continuation_txid:marketObject(transactions.at(-1)).txid || null};
  }
  if (tool==='phishing-detector') {
    const domain=marketDomain(p.domain), labels=domain.split('.'), root=labels.shift()!, suffix=labels.join('.');
    const candidates=new Set<string>();
    for (let i=0;i<root.length && candidates.size<20;i++) {
      if(root.length>2)candidates.add(root.slice(0,i)+root.slice(i+1)+'.'+suffix);
      if(i<root.length-1)candidates.add(root.slice(0,i)+root[i+1]+root[i]+root.slice(i+2)+'.'+suffix);
    }
    candidates.delete(domain);
    const observations=[];
    const pending=Array.from(candidates);
    for(let offset=0;offset<pending.length;offset+=4) observations.push(...await Promise.all(pending.slice(offset,offset+4).map(async candidate=>{ const source=`https://dns.google/resolve?name=${encodeURIComponent(candidate)}&type=A`; try{const d=await marketJson(source); if(typeof d.Status!=='number') throw new Error('DNS provider returned no valid DNS status.'); return {candidate,source,status:'checked',dns_status:d.Status,answers:Array.isArray(d.Answer)?d.Answer:[]};}catch(e){return {candidate,source,status:'failed',error:e instanceof Error?e.message:'DNS request failed'};} })));
    if(observations.length && observations.every(o=>o.status==='failed')) throw new Error('DNS checks failed for every candidate; no observations were fabricated.');
    return {domain,retrieved_at:new Date().toISOString(),status:observations.some(o=>o.status==='failed')?'partial':'complete',coverage:'Generated deletion/transposition candidates checked against live DNS. Generated candidates are hypotheses, not discovered phishing sites. Resolution or a similar name does not prove phishing.',observations};
  }
  return undefined;
}
