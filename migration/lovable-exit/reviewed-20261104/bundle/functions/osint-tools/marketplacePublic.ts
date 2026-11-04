// Public, authoritative marketplace integrations. No generated records or paid fallbacks.
type PublicParams = Record<string, unknown>;
type PublicRecord = Record<string, unknown>;
type SanctionRecord = { id: string; name: string; aliases: string[]; programs: string[]; addresses: string[]; remarks: string; source: string };
const publicCache = new Map<string, { expires: number; data: unknown; fetchedAt: string; modified: string | null }>();
const SEC_HEADERS = { "User-Agent": "InsightNexus travis@tjksecurity.com", Accept: "application/json, application/xml, text/plain" };
const OFAC_BASE = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/";
const UN_SOURCE = "https://scsanctions.un.org/resources/xml/en/consolidated.xml";
// This is the Commission's published public download token, not an account/API credential.
const EU_SOURCE = "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw";
const EARTH_SEARCH = "https://earth-search.aws.element84.com/v1";

function publicString(value: unknown, max = 200): string { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function publicObject(value: unknown): PublicRecord { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as PublicRecord : {}; }
function publicArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function publicLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`Limit must be an integer from 1 to ${max}.`); return n;
}
async function publicResponse(url: string, init: RequestInit = {}): Promise<Response> {
  let r: Response;
  try { r = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) }); }
  catch (e) { throw new Error(`Public data provider ${new URL(url).hostname} could not be reached: ${e instanceof Error ? e.message : "request failed"}`); }
  if (!r.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${r.status}${r.status === 429 ? "; rate limited, retry later" : r.status === 403 ? "; provider denied this request" : ""}.`);
  return r;
}
async function publicJson(url: string, init: RequestInit = {}): Promise<PublicRecord> {
  const r = await publicResponse(url, init);
  try { const d = await r.json(); if (!d || typeof d !== "object") throw new Error("not an object"); return d as PublicRecord; }
  catch { throw new Error(`${new URL(url).hostname} returned an invalid JSON response.`); }
}
async function publicText(url: string, maxBytes = 35_000_000): Promise<{ text: string; modified: string | null }> {
  const r = await publicResponse(url); if (Number(r.headers.get("content-length")) > maxBytes) throw new Error("Public dataset exceeded the download limit.");
  const reader = r.body?.getReader(); if (!reader) throw new Error("Public dataset response had no body.");
  const decoder = new TextDecoder(); let bytes = 0, text = "";
  try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > maxBytes) throw new Error("Public dataset exceeded the download limit."); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
  catch (e) { await reader.cancel().catch(() => undefined); throw e; }
  finally { reader.releaseLock(); }
  return { text, modified: r.headers.get("last-modified") };
}
function publicDecodeXml(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#(x[\da-f]+|\d+);/gi, (_, n: string) => { const cp = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n); return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""; }).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
}
function publicXmlValues(xml: string, tag: string): string[] {
  return Array.from(xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "g")), m => publicDecodeXml(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()).filter(Boolean);
}
function publicXmlOne(xml: string, tag: string): string | null { return publicXmlValues(xml, tag)[0] || null; }
function publicXmlAttrs(xml: string): Record<string, string> { return Object.fromEntries(Array.from(xml.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g), m => [m[1], publicDecodeXml(m[2] ?? m[3])])); }
function publicNormalize(s: string): string { return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function publicCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((c === "\r" || c === "\n") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (quoted) throw new Error("OFAC CSV was incomplete or malformed."); if (cell || row.length) { row.push(cell.trim()); rows.push(row); } return rows;
}
function ofacValue(s: string | undefined): string { return s && s.trim() !== "-0-" ? s.trim() : ""; }
async function publicCachedList(key: string, loader: () => Promise<{ data: SanctionRecord[]; modified: string | null }>) {
  const cached = publicCache.get(key); if (cached && cached.expires > Date.now()) return { ...cached, data: cached.data as SanctionRecord[] };
  const loaded = await loader(); if (!loaded.data.length) throw new Error(`${key} dataset contained no recognized entries; screening was not performed.`);
  const entry = { data: loaded.data, modified: loaded.modified, fetchedAt: new Date().toISOString(), expires: Date.now() + 3_600_000 }; publicCache.set(key, entry); return entry;
}
async function loadOfac(): Promise<{ data: SanctionRecord[]; modified: string | null }> {
  const names = ["SDN.CSV", "ALT.CSV", "ADD.CSV", "SDN_COMMENTS.CSV", "CONS_PRIM.CSV", "CONS_ALT.CSV", "CONS_ADD.CSV", "CONS_COMMENTS.CSV"];
  const files = await Promise.all(names.map(n => publicText(OFAC_BASE + n, 10_000_000)));
  const records = new Map<string, SanctionRecord>();
  for (const index of [0, 4]) { for (const row of publicCsv(files[index].text)) { if (!/^\d+$/.test(row[0]) || !ofacValue(row[1])) continue; records.set(row[0], { id: row[0], name: ofacValue(row[1]), aliases: [], programs: ofacValue(row[3]).split(";").map(s => s.trim()).filter(Boolean), addresses: [], remarks: ofacValue(row[11]), source: OFAC_BASE + names[index] }); } }
  for (const index of [1, 5]) { for (const row of publicCsv(files[index].text)) { const record = records.get(row[0]); if (record && ofacValue(row[3])) record.aliases.push(ofacValue(row[3])); } }
  for (const index of [2, 6]) { for (const row of publicCsv(files[index].text)) { const record = records.get(row[0]); const address = row.slice(2, 5).map(ofacValue).filter(Boolean).join(", "); if (record && address) record.addresses.push(address); } }
  for (const index of [3, 7]) { for (const row of publicCsv(files[index].text)) { const record = records.get(row[0]); if (record && row[1]) record.remarks += row[1]; } }
  return { data: Array.from(records.values()), modified: files[0].modified };
}
async function loadUn(): Promise<{ data: SanctionRecord[]; modified: string | null }> {
  const file = await publicText(UN_SOURCE, 10_000_000); const data: SanctionRecord[] = [];
  for (const match of file.text.matchAll(/<(INDIVIDUAL|ENTITY)>([\s\S]*?)<\/\1>/g)) { const xml = match[2]; const name = ["FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"].map(tag => publicXmlOne(xml, tag)).filter(Boolean).join(" ");
    if (!name) continue; data.push({ id: publicXmlOne(xml, "REFERENCE_NUMBER") || publicXmlOne(xml, "DATAID") || "", name, aliases: [...publicXmlValues(xml, "ALIAS_NAME"), ...publicXmlValues(xml, "NAME_ORIGINAL_SCRIPT")], programs: publicXmlValues(xml, "UN_LIST_TYPE"), addresses: Array.from(xml.matchAll(/<(?:INDIVIDUAL_ADDRESS|ENTITY_ADDRESS)>([\s\S]*?)<\/(?:INDIVIDUAL_ADDRESS|ENTITY_ADDRESS)>/g), m => publicDecodeXml(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()).filter(Boolean), remarks: publicXmlOne(xml, "COMMENTS1") || "", source: UN_SOURCE }); }
  return { data, modified: file.modified || file.text.match(/dateGenerated="([^"]+)"/)?.[1] || null };
}
async function loadEu(): Promise<{ data: SanctionRecord[]; modified: string | null }> {
  const file = await publicText(EU_SOURCE); const data: SanctionRecord[] = [];
  for (const m of file.text.matchAll(/<sanctionEntity\b([^>]*)>([\s\S]*?)<\/sanctionEntity>/g)) { const attrs = publicXmlAttrs(m[1]); const xml = m[2]; const names = Array.from(xml.matchAll(/<nameAlias\b([^>]*)\/?\s*>/g), a => publicXmlAttrs(a[1]).wholeName).filter(Boolean); if (!names.length) continue;
    const regs = Array.from(xml.matchAll(/<regulation\b([^>]*)>/g), a => publicXmlAttrs(a[1])); const addresses = Array.from(xml.matchAll(/<address\b([^>]*)>/g), a => { const v = publicXmlAttrs(a[1]); return [v.street, v.zipCode, v.city, v.countryDescription].filter(Boolean).join(", "); }).filter(Boolean);
    data.push({ id: attrs.euReferenceNumber || attrs.logicalId || "", name: names[0], aliases: names.slice(1), programs: Array.from(new Set(regs.map(r => r.numberTitle || r.programme).filter(Boolean))), addresses, remarks: publicXmlOne(xml, "remark") || "", source: EU_SOURCE }); }
  return { data, modified: file.modified || file.text.match(/generationDate="([^"]+)"/)?.[1] || null };
}
async function publicSanctions(params: PublicParams): Promise<PublicRecord> {
  const query = publicString(params.name || params.query); if (publicNormalize(query).length < 3) throw new Error("Enter at least three characters of an individual or entity name.");
  const requested = publicString(params.lists || params.list || "all").toLowerCase(); const allowed = ["ofac", "un", "eu"];
  const selected = requested === "all" ? allowed : requested.split(",").map(s => s.trim()); if (!selected.length || selected.some(s => !allowed.includes(s))) throw new Error("Lists must be all, ofac, un, eu, or a comma-separated selection.");
  const limit = publicLimit(params.limit, 25, 100); const tokens = publicNormalize(query).split(" "); const loaders = { ofac: loadOfac, un: loadUn, eu: loadEu };
  const loaded = await Promise.allSettled(selected.map(key => publicCachedList(key, loaders[key as keyof typeof loaders])));
  const matches: PublicRecord[] = [], coverage: PublicRecord[] = []; let total = 0, checked = 0;
  loaded.forEach((entry, i) => { const list = selected[i]; if (entry.status === "rejected") { coverage.push({ list, status: "failed", error: entry.reason instanceof Error ? entry.reason.message : "Dataset download failed" }); return; }
    checked += entry.value.data.length; coverage.push({ list, status: "checked", entries: entry.value.data.length, retrieved_at: entry.value.fetchedAt, dataset_last_modified: entry.value.modified });
    for (const record of entry.value.data) { const matched = [record.name, ...record.aliases].find(name => { const normalized = publicNormalize(name); return tokens.every(t => normalized.split(" ").includes(t)); }); if (!matched) continue; total++; if (matches.length < limit) matches.push({ ...record, list, matched_name: matched, match_method: "all query name tokens matched" }); }
  });
  if (!checked) throw new Error(`Sanctions screening could not run: ${coverage.map(c => `${c.list}: ${c.error}`).join("; ")}`);
  return { query, status: coverage.some(c => c.status === "failed") ? "partial" : "complete", candidate_matches: matches, total_candidates: total, returned: matches.length, entries_checked: checked, coverage, retrieved_at: new Date().toISOString(), notice: "Candidate name matches require identity review. No match is not a sanctions clearance. Only the selected successfully downloaded lists were screened; partial coverage cannot establish a negative result. Token matching does not detect all transliterations, spelling variants, or indirect ownership." };
}
async function publicVin(params: PublicParams): Promise<PublicRecord> {
  const vin = publicString(params.vin, 30).toUpperCase(); if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new Error("Enter a 17-character VIN using letters and digits, excluding I, O and Q.");
  const source = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${vin}?format=json`; const data = await publicJson(source); const vehicle = publicObject(publicArray(data.Results)[0]); if (!Object.keys(vehicle).length) throw new Error("NHTSA returned no vehicle decode record.");
  return { vin, provider: "NHTSA vPIC", source, retrieved_at: new Date().toISOString(), vehicle, notice: "Manufacturer-reported VIN specifications. This source does not supply ownership, accident, title, theft, lien or service history. Empty fields mean NHTSA did not provide those values. Review ErrorCode and ErrorText for decode warnings." };
}
async function publicTickerIndex(): Promise<PublicRecord[]> {
  const cache = publicCache.get("sec-tickers"); if (cache && cache.expires > Date.now()) return cache.data as PublicRecord[];
  const data = await publicJson("https://www.sec.gov/files/company_tickers.json", { headers: SEC_HEADERS }); const entries = Object.values(data).map(publicObject).filter(d => d.cik_str && d.title);
  if (!entries.length) throw new Error("SEC company index returned no recognized companies."); publicCache.set("sec-tickers", { data: entries, fetchedAt: new Date().toISOString(), modified: null, expires: Date.now() + 3_600_000 }); return entries;
}
async function publicSecCandidates(params: PublicParams): Promise<PublicRecord[]> {
  const cik = publicString(params.cik || params.company_cik, 20); if (cik) { if (!/^\d{1,10}$/.test(cik) || Number(cik) === 0) throw new Error("CIK must contain 1 to 10 digits and cannot be zero."); return [{ cik_str: Number(cik) }]; }
  const query = publicString(params.company || params.name || params.ticker || params.query); if (query.length < 2) throw new Error("Enter an SEC company name, ticker, or CIK.");
  const index = await publicTickerIndex(); const normalized = publicNormalize(query); const exact = index.filter(r => publicNormalize(String(r.ticker)) === normalized || publicNormalize(String(r.title)) === normalized);
  return exact.length ? exact : index.filter(r => publicNormalize(String(r.title)).includes(normalized)).slice(0, publicLimit(params.limit, 3, 5));
}
function publicSecFilings(data: PublicRecord): PublicRecord[] {
  const recent = publicObject(publicObject(data.filings).recent); const forms = publicArray(recent.form);
  return forms.map((form, i) => { const accession = String(publicArray(recent.accessionNumber)[i] || ""); const doc = String(publicArray(recent.primaryDocument)[i] || ""); const cik = String(Number(data.cik)); const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/`; return { form, accession_number: accession, filing_date: publicArray(recent.filingDate)[i], report_date: publicArray(recent.reportDate)[i], primary_document: doc, document_url: base + doc, raw_document_url: base + doc.split("/").at(-1), index_url: `${base}${accession}-index.html` }; });
}
async function publicSecSubmission(cik: unknown): Promise<{ data: PublicRecord; source: string }> { const source = `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`; return { data: await publicJson(source, { headers: SEC_HEADERS }), source }; }
async function publicCorporate(params: PublicParams): Promise<PublicRecord> {
  const candidates = await publicSecCandidates(params); const matches: PublicRecord[] = [];
  for (const candidate of candidates.slice(0, publicLimit(params.limit, 3, 5))) { const { data, source } = await publicSecSubmission(candidate.cik_str); matches.push({ cik: data.cik, name: data.name, tickers: data.tickers, exchanges: data.exchanges, sic: data.sic, industry: data.sicDescription, entity_type: data.entityType, incorporation_state: data.stateOfIncorporationDescription || data.stateOfIncorporation, business_address: publicObject(data.addresses).business, mailing_address: publicObject(data.addresses).mailing, phone: data.phone, website: data.website, former_names: data.formerNames, recent_filings: publicSecFilings(data).slice(0, 15), source }); }
  return { provider: "US SEC EDGAR", returned: matches.length, matches, retrieved_at: new Date().toISOString(), notice: "Company search covers SEC ticker-indexed issuers. An explicit CIK also retrieves other SEC filers. These are securities filings and filer-provided business details; this integration does not search state incorporation registries or establish beneficial ownership." };
}
function publicForm4(xml: string): PublicRecord {
  if (!/<ownershipDocument\b/.test(xml)) throw new Error("SEC document was not an ownership XML filing.");
  const owners = Array.from(xml.matchAll(/<reportingOwner>([\s\S]*?)<\/reportingOwner>/g), m => ({ name: publicXmlOne(m[1], "rptOwnerName"), cik: publicXmlOne(m[1], "rptOwnerCik"), is_director: publicXmlOne(m[1], "isDirector"), is_officer: publicXmlOne(m[1], "isOfficer"), officer_title: publicXmlOne(m[1], "officerTitle"), is_ten_percent_owner: publicXmlOne(m[1], "isTenPercentOwner") }));
  const transactions = Array.from(xml.matchAll(/<(nonDerivativeTransaction|derivativeTransaction)>([\s\S]*?)<\/\1>/g), m => ({ security_type: m[1] === "derivativeTransaction" ? "derivative" : "non-derivative", security_title: publicXmlOne(m[2], "securityTitle"), transaction_date: publicXmlOne(m[2], "transactionDate"), transaction_code: publicXmlOne(m[2], "transactionCode"), shares: publicXmlOne(m[2], "transactionShares"), price_per_share: publicXmlOne(m[2], "transactionPricePerShare"), acquired_disposed_code: publicXmlOne(m[2], "transactionAcquiredDisposedCode"), shares_owned_following_transaction: publicXmlOne(m[2], "sharesOwnedFollowingTransaction"), direct_indirect_ownership: publicXmlOne(m[2], "directOrIndirectOwnership"), nature_of_ownership: publicXmlOne(m[2], "natureOfOwnership") }));
  return { period_of_report: publicXmlOne(xml, "periodOfReport"), issuer: { cik: publicXmlOne(xml, "issuerCik"), name: publicXmlOne(xml, "issuerName"), ticker: publicXmlOne(xml, "issuerTradingSymbol") }, reporting_owners: owners, transactions, footnotes: publicXmlValues(xml, "footnote"), remarks: publicXmlOne(xml, "remarks") };
}
async function publicInsider(params: PublicParams): Promise<PublicRecord> {
  const candidates = await publicSecCandidates({ ...params, limit: 1 }); if (!candidates.length) return { provider: "US SEC EDGAR", returned: 0, filings: [], notice: "No company matched the SEC ticker index. Supply the exact issuer CIK for companies outside that index.", retrieved_at: new Date().toISOString() };
  const { data, source } = await publicSecSubmission(candidates[0].cik_str); const filings = publicSecFilings(data).filter(f => f.form === "4" || f.form === "4/A").slice(0, publicLimit(params.limit, 3, 5)); const results: PublicRecord[] = [];
  for (const filing of filings) { try { const r = await publicResponse(String(filing.raw_document_url), { headers: SEC_HEADERS }); const xml = await r.text(); if (xml.length > 2_000_000) throw new Error("Form 4 XML exceeded the processing limit."); results.push({ ...filing, status: "parsed", ...publicForm4(xml) }); }
    catch (e) { results.push({ ...filing, status: "document_unavailable", error: e instanceof Error ? e.message : "Document download failed" }); } }
  return { provider: "US SEC EDGAR Form 4", company: data.name, cik: data.cik, source, returned: results.length, status: results.some(f => f.status === "document_unavailable") ? "partial" : "complete", filings: results, retrieved_at: new Date().toISOString(), notice: "Recent disclosed ownership transactions from the issuer's SEC submissions. Form 4 includes grants, gifts, exercises and other transaction types as well as purchases and sales; inspect transaction codes and footnotes. Older filing archives are not included in this run." };
}
async function publicSatellite(params: PublicParams): Promise<PublicRecord> {
  const rawBbox = params.bbox; let bbox: number[];
  if (rawBbox) bbox = (Array.isArray(rawBbox) ? rawBbox : String(rawBbox).split(",")).map(Number);
  else { const rawLat = params.latitude ?? params.lat, rawLon = params.longitude ?? params.lon; if (rawLat === undefined || rawLon === undefined || String(rawLat).trim() === "" || String(rawLon).trim() === "") throw new Error("Enter both latitude and longitude, or a bounding box."); const lat = Number(rawLat), lon = Number(rawLon); const radius = Number(params.radius_km === undefined || params.radius_km === "" ? 5 : params.radius_km); if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 89.5 || Math.abs(lon) > 180 || !Number.isFinite(radius) || radius < 0.1 || radius > 100) throw new Error("Enter valid latitude/longitude and a radius from 0.1 to 100 km, or a bounding box."); const dy = radius / 111.32, dx = radius / (111.32 * Math.cos(lat * Math.PI / 180)); bbox = [lon - dx, lat - dy, lon + dx, lat + dy]; }
  if (bbox.length !== 4 || bbox.some(n => !Number.isFinite(n)) || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90 || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) throw new Error("Bounding box must be west,south,east,north within valid coordinates with west < east and south < north.");
  const collection = publicString(params.collection || "sentinel-2-l2a"); const allowed = ["sentinel-2-l2a", "sentinel-2-c1-l2a", "sentinel-2-pre-c1-l2a", "landsat-c2-l2", "sentinel-1-grd", "naip"]; if (!allowed.includes(collection)) throw new Error(`Collection must be one of: ${allowed.join(", ")}.`);
  const datetime = publicString(params.datetime || params.date_range, 100); if (datetime && !/^(?:\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?|\.\.)(?:\/(?:\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?|\.\.))?$/.test(datetime)) throw new Error("Date must be YYYY-MM-DD or a STAC date interval, for example 2026-01-01/2026-10-12.");
  const limit = publicLimit(params.limit, 10, 25); const cloud = Number(params.max_cloud_cover ?? 100); if (!Number.isFinite(cloud) || cloud < 0 || cloud > 100) throw new Error("Maximum cloud cover must be from 0 to 100 percent.");
  const request: PublicRecord = { collections: [collection], bbox, limit, sortby: [{ field: "properties.datetime", direction: "desc" }] }; if (datetime) request.datetime = datetime; if (cloud < 100) request.query = { "eo:cloud_cover": { lte: cloud } };
  const source = `${EARTH_SEARCH}/search`; const data = await publicJson(source, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) }); if (!Array.isArray(data.features)) throw new Error("Earth Search returned no valid STAC feature collection.");
  const scenes = data.features.map(publicObject).map(f => ({ id: f.id, collection: f.collection, bbox: f.bbox, geometry: f.geometry, properties: f.properties, assets: f.assets, links: f.links }));
  return { provider: "Element 84 Earth Search STAC", source, query: request, returned: scenes.length, scenes, pagination_links: publicArray(data.links).filter(l => publicObject(l).rel === "next"), retrieved_at: new Date().toISOString(), notice: "Real archived satellite/aerial scene metadata and provider asset URLs. Scene dates, spatial resolution, cloud cover and collection availability come from the catalog. This integration supplies imagery discovery; it does not identify people or infer activities." };
}
export async function runMarketplacePublic(tool: string, params: PublicParams): Promise<PublicRecord | undefined> {
  switch (tool) { case "vin-decoder": return publicVin(params); case "sanctions-screening": return publicSanctions(params); case "corporate-records": return publicCorporate(params); case "insider-tracker": return publicInsider(params); case "satellite-search": return publicSatellite(params); default: return undefined; }
}
