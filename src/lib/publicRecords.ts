// Shared by the authenticated Pages endpoint and its contract tests. All upstreams
// are fixed public query APIs; caller-controlled URLs and credentials are absent.
export type PublicRecordTool = 'public-records' | 'property-records';
export interface PublicRecordItem {
  title: string;
  kind: string;
  source_url: string;
  [key: string]: unknown;
}
export interface PublicRecordResult {
  source: string;
  provider: string;
  retrieved_at: string;
  query: string;
  coverage: string;
  results: PublicRecordItem[];
  total: number | null;
  returned: number;
  has_more: boolean;
  next: string | null;
  page: number;
}
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const scalar = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const plain = (value: unknown) => text(value).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").slice(0, 1500);
const WCAD = 'https://services1.arcgis.com/Xff0bbfp6vwIWmlU/arcgis/rest/services/WCAD_Tax_Parcels/FeatureServer/0';
const TRAVIS = 'https://taxmaps.traviscountytx.gov/arcgis/rest/services/Parcels/MapServer/0';
const COURT = 'https://www.courtlistener.com/api/rest/v4/search/';

function choice(value: string | undefined, options: string[], fallback: string): string {
  const selected = value || fallback;
  if (!options.includes(selected)) throw new Error(`Unsupported option: ${selected.slice(0, 80)}`);
  return selected;
}
function queryInput(inputs: Record<string, string>): string {
  const q = text(inputs.q).replace(/\s+/g, ' ');
  if (q.length < 3 || q.length > 200 || [...(inputs.q || '')].some(character => character.charCodeAt(0) < 32) || !/[\p{L}\p{N}]{2}/u.test(q)) throw new Error('Enter a specific name, address, property ID or court query, from 3 to 200 characters.');
  return q;
}
function pageInput(value?: string): number {
  if (value && !/^[1-9]\d?$/.test(value)) throw new Error('Result page must be from 1 to 40.');
  const page = Number(value || 1);
  if (page > 40) throw new Error('Result page must be from 1 to 40.');
  return page;
}
async function publicJson(url: URL, fetcher: Fetcher): Promise<Row> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetcher(url.href, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: controller.signal });
    if (!response.ok) throw new Error(`${url.hostname} returned HTTP ${response.status}${response.status === 429 ? '; wait before searching again' : ''}. No usable records were retrieved.`);
    if (!/json/i.test(response.headers.get('Content-Type') || '')) throw new Error(`${url.hostname} returned an unexpected content type; no records were inferred.`);
    if (Number(response.headers.get('Content-Length') || 0) > 2_000_000) throw new Error('Public source response exceeded the size limit. Narrow the query.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Public source returned an empty response.');
    let bytes = 0; let content = ''; const decoder = new TextDecoder();
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 2_000_000) { await reader.cancel(); throw new Error('Public source response exceeded the size limit. Narrow the query.'); }
        content += decoder.decode(part.value, { stream: true });
      }
      content += decoder.decode();
    } finally { reader.releaseLock(); }
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { throw new Error('Public source returned invalid JSON; no records were inferred.'); }
    const data = row(parsed);
    if (data.error) throw new Error(`Public source query failed: ${plain(row(data.error).message) || 'upstream error'}`);
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Public source timed out after 20 seconds; no automatic retry was made.');
    throw error;
  } finally { clearTimeout(timer); }
}
function courtUrl(value: unknown): string {
  const path = text(value);
  if (!/^\/(docket|opinion)\/\d+\/[a-zA-Z0-9_/-]*$/.test(path)) return '';
  return `https://www.courtlistener.com${path}`;
}
function date(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  const str = text(value);
  return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(str) && Number.isFinite(Date.parse(str)) && (str.includes('T') || new Date(str).toISOString().slice(0, 10) === str) ? str : null;
}

export async function lookupPublicRecords(tool: PublicRecordTool, inputs: Record<string, string>, fetcher: Fetcher = fetch): Promise<PublicRecordResult> {
  if (!['public-records', 'property-records'].includes(tool)) throw new Error('Unsupported public-record source.');
  const q = queryInput(inputs);
  const retrieved_at = new Date().toISOString();
  if (tool === 'public-records') {
    const mode = choice(inputs.mode, ['criminal', 'dockets', 'opinions'], 'criminal');
    const url = new URL(COURT);
    const query = mode === 'criminal' ? `(${q}) AND docketNumber:cr` : q;
    url.searchParams.set('q', query);
    url.searchParams.set('type', mode === 'opinions' ? 'o' : 'd');
    url.searchParams.set('order_by', 'score desc');
    if (inputs.cursor) {
      if (inputs.cursor.length > 3000 || !/^[a-zA-Z0-9_=.%-]+$/.test(inputs.cursor)) throw new Error('Invalid court result cursor. Start a fresh search.');
      url.searchParams.set('cursor', inputs.cursor);
    }
    const data = await publicJson(url, fetcher);
    if (!Array.isArray(data.results) || typeof data.count !== 'number') throw new Error('Court source response schema changed; no records were inferred.');
    const results: PublicRecordItem[] = [];
    for (const value of data.results.slice(0, 25)) {
      const item = row(value); const source_url = courtUrl(item.docket_absolute_url || item.absolute_url);
      if (!source_url || !text(item.caseName)) continue;
      const snippet = Array.isArray(item.opinions) ? item.opinions.map(opinion => plain(row(opinion).snippet)).filter(Boolean).join('\n').slice(0, 1500) : plain(item.snippet);
      results.push({ title: plain(item.caseName), kind: mode === 'opinions' ? 'court_opinion' : mode === 'criminal' ? 'criminal_docket' : 'court_docket', source_url, court: plain(item.court), docketNumber: plain(item.docketNumber), dateFiled: date(item.dateFiled), dateTerminated: date(item.dateTerminated), judge: plain(item.assignedTo || item.judge), nature_of_suit: plain(item.suitNature), disposition: 'Not supplied by this search', snippet });
    }
    let next: string | null = null;
    if (typeof data.next === 'string') {
      try { const parsed = new URL(data.next); if (parsed.origin === new URL(COURT).origin && parsed.pathname === new URL(COURT).pathname) next = parsed.searchParams.get('cursor'); } catch { /* An invalid upstream cursor is never followed. */ }
    }
    return { source: url.href, provider: 'CourtListener public search', retrieved_at, query, results, total: data.count, returned: results.length, has_more: Boolean(next), next, page: 1,
      coverage: mode === 'criminal' ? 'Federal criminal docket candidates in the public RECAP index, selected by the source docket-number token cr. A matching name is not a conviction or a confirmed identity. Charges and disposition require the original case record. No match does not establish a clean history; state, local, sealed and unindexed cases are outside this search.' : 'Public court index candidates. Federal dockets and published opinions have different coverage. A matching name is not a conviction or a confirmed identity. No match does not establish a clean history.' };
  }
  const county = choice(inputs.county, ['williamson', 'travis'], 'williamson');
  const field = choice(inputs.field, ['owner', 'address', 'property_id'], 'owner');
  const page = pageInput(inputs.page);
  if (!/^[\p{L}\p{N} .,'&#()/+-]+$/u.test(q)) throw new Error('Use a specific name, address or property ID without SQL operators or wildcard characters.');
  const base = county === 'williamson' ? WCAD : TRAVIS;
  const columns = county === 'williamson' ? { owner: ['OWNERNME1', 'OWNERNME2'], address: ['SITEADDRESS'], property_id: ['PropertyID'] } : { owner: ['py_owner_name'], address: ['situs_address'], property_id: ['PROP_ID'] };
  if (field === 'property_id' && !/^\d+$/.test(q)) throw new Error('Property ID must contain digits only.');
  const where = field === 'property_id' ? `${columns.property_id[0]}=${county === 'williamson' ? `'${q}'` : Number(q)}` : q.toUpperCase().split(' ').map(term => `(${columns[field].map(column => `UPPER(${column}) LIKE '%${term.replace(/'/g, "''")}%'`).join(' OR ')})`).join(' AND ');
  const url = new URL(`${base}/query`);
  url.searchParams.set('where', where);
  url.searchParams.set('outFields', county === 'williamson' ? 'OBJECTID,PropertyID,OWNERNME1,OWNERNME2,SITEADDRESS,PRPRTYDSCRP,CNTASSDVAL,LNDVALUE,LASTUPDATE' : 'OBJECTID,PROP_ID,py_owner_name,situs_address,legal_desc,assessed_val,market_value,deed_date');
  url.searchParams.set('returnGeometry', 'false'); url.searchParams.set('resultRecordCount', '25');
  url.searchParams.set('resultOffset', String((page - 1) * 25)); url.searchParams.set('orderByFields', 'OBJECTID ASC'); url.searchParams.set('f', 'json');
  const data = await publicJson(url, fetcher);
  if (!Array.isArray(data.features)) throw new Error('County source response schema changed; no properties were inferred.');
  const results: PublicRecordItem[] = data.features.slice(0, 25).flatMap(feature => {
    const a = row(row(feature).attributes); const objectId = scalar(a.OBJECTID);
    if (objectId === null) return [];
    const id = String(a.PropertyID ?? a.PROP_ID ?? '');
    const original = new URL(`${base}/query`);
    original.searchParams.set('objectIds', String(objectId)); original.searchParams.set('outFields', '*'); original.searchParams.set('returnGeometry', 'false'); original.searchParams.set('f', 'pjson');
    return [{ title: text(a.SITEADDRESS || a.situs_address) || `Property ${id}`, kind: 'property', source_url: original.href, property_id: id, owner: text(a.OWNERNME1 || a.py_owner_name), additional_owner: text(a.OWNERNME2), address: text(a.SITEADDRESS || a.situs_address), legal_description: text(a.PRPRTYDSCRP || a.legal_desc), assessed_value: scalar(a.CNTASSDVAL ?? a.assessed_val), market_value: scalar(a.market_value), source_updated_at: date(a.LASTUPDATE), deed_date: date(a.deed_date), county: county === 'williamson' ? 'Williamson County, Texas' : 'Travis County, Texas' }];
  });
  return { source: url.href, provider: county === 'williamson' ? 'Williamson Central Appraisal District public parcels' : 'Travis County public tax parcels', retrieved_at, query: q, results, total: null, returned: results.length, has_more: data.exceededTransferLimit === true, next: null, page,
    coverage: 'Official county tax/appraisal parcel records, limited to the selected Texas county. Owner-name matches are candidates until identity is corroborated. Assessed values are source-reported tax values, not market appraisals. Parcel data can lag deeds. No match does not establish absence of property. At most 25 records per page.' };
}
