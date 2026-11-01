// Actual KartaView public street imagery; plate OCR executes locally in the browser.
type AlternativeParams = Record<string, unknown>;
type RecordValue = Record<string, unknown>;
export const ALTERNATIVE_REQUIRED_SECRETS: Record<string, readonly string[]> = { 'streetview-compare': [] };
function object(value: unknown, label: string): RecordValue { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value as RecordValue; }
async function body(response: Response, provider="KartaView"): Promise<string> {
  if (!response.body) throw new Error(`${provider} returned an empty response.`);
  const reader=response.body.getReader(); const chunks: Uint8Array[]=[]; let total=0;
  try { for (;;) { const part=await reader.read(); if (part.done) break; total+=part.value.byteLength; if (total>2*1024*1024) throw new Error(`${provider} response exceeded 2 MiB.`); chunks.push(part.value); } }
  finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  const output=new Uint8Array(total); let offset=0; for (const chunk of chunks) { output.set(chunk,offset); offset+=chunk.length; } return new TextDecoder().decode(output);
}
function coordinate(p: AlternativeParams, name: string, max: number): number {
  const input=p[name];
  if ((typeof input!=="number" && typeof input!=="string") || input==="" || typeof input==="string" && !input.trim()) throw new Error(`Provide ${name}.`);
  const value=Number(input);
  if (!Number.isFinite(value) || value < -max || value > max) throw new Error(`${name} must be between ${-max} and ${max}.`);
  return value;
}
function year(p: AlternativeParams, name: string): number | null {
  if (p[name]===undefined || p[name]===null || p[name]==="") return null;
  const value=Number(p[name]);
  if (!Number.isInteger(value) || value<1900 || value>new Date().getUTCFullYear()) throw new Error(`${name} must be a supported calendar year.`);
  return value;
}
function distance(a: [number,number], b: [number,number]): number {
  const rad=Math.PI/180;const dlat=(b[0]-a[0])*rad;const dlon=(b[1]-a[1])*rad;
  const h=Math.sin(dlat/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(dlon/2)**2;
  return 6_371_000*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}
type StreetImage = {id:string;captured_at:string;image_url:string;lat:number;lon:number;heading:number|null;source_url:string;year:number;distance_from_query_m:number;sort_time:number};
function streetImage(value: unknown, query: [number,number]): StreetImage | null {
  const row=object(value,"KartaView image");
  const id=String(row.id??"");const captured=typeof row.shotDate==="string"?row.shotDate:"";
  if (!/^\d{1,18}$/.test(id) || !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)?$/.test(captured)) return null;
  // Preserve the provider's timezone-unspecified capture string. UTC is used
  // solely as a consistent calendar ordering convention, not as a capture claim.
  const sortTime=Date.parse(captured.replace(" ","T")+(captured.length===10?"T00:00:00Z":"Z"));
  if (Number.isFinite(sortTime) && new Date(sortTime).toISOString().slice(0,10)!==captured.slice(0,10)) return null;
  const lat=Number(row.lat),lon=Number(row.lng);
  if (!Number.isFinite(sortTime) || row.lat===null || row.lng===null || row.lat==="" || row.lng==="" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return null;
  const distanceFromQuery=distance(query,[lat,lon]);
  if (distanceFromQuery>500) return null;
  const candidate=row.fileurlProc||row.fileurlTh||row.fileurl;
  if (typeof candidate!=="string" || candidate.includes("{{") || candidate.includes("[[")) return null;
  let url: URL;try {url=new URL(candidate);} catch {return null;}
  if (url.protocol!=="https:" || url.username || url.password || url.port || !/^storage\d+\.openstreetcam\.org$/.test(url.hostname) || !url.pathname.startsWith("/files/photo/") || url.search || url.hash) return null;
  const heading=row.heading===undefined||row.heading===null||row.heading===""?null:Number(row.heading);
  if (heading!==null && (!Number.isFinite(heading)||heading<0||heading>360)) return null;
  return {id,captured_at:captured,image_url:url.toString(),lat,lon,heading,source_url:`https://api.openstreetcam.org/2.0/photo/${id}`,year:Number(captured.slice(0,4)),distance_from_query_m:Math.round(distanceFromQuery*10)/10,sort_time:sortTime};
}
async function streetComparison(p: AlternativeParams): Promise<RecordValue> {
  const lat=coordinate(p,"latitude",90),lon=coordinate(p,"longitude",180);const beforeYear=year(p,"before_year"),afterYear=year(p,"after_year");
  if (beforeYear!==null && afterYear!==null && beforeYear>afterYear) throw new Error("before_year must not be later than after_year.");
  const url=new URL("https://api.openstreetcam.org/2.0/photo/");
  for (const [key,value] of Object.entries({lat:lat.toString(),lng:lon.toString(),zoomLevel:"18",join:"sequence",orderBy:"id",orderDirection:"desc",page:"1",itemsPerPage:"25"})) url.searchParams.set(key,value);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);let responseData:RecordValue;
  try {
    const response=await fetch(url,{redirect:"error",signal:controller.signal});
    if (!response.ok) {await response.body?.cancel().catch(()=>{});throw new Error(`KartaView returned HTTP ${response.status}. No comparison or retry was generated.`);}
    let parsed:unknown;try {parsed=JSON.parse(await body(response,"KartaView"));} catch(error) {if(error instanceof Error&&error.message.startsWith("KartaView"))throw error;throw new Error("KartaView returned invalid JSON.");}
    responseData=object(parsed,"KartaView response");
  } catch(error) {
    if (controller.signal.aborted) throw new Error("KartaView timed out after 20 seconds. No automatic retry was made.");
    if(error instanceof Error&&error.message.startsWith("KartaView"))throw error;
    throw new Error("KartaView request failed. No comparison or substitute imagery was generated.");
  } finally {clearTimeout(timer);}
  const status=object(responseData.status,"KartaView status"),result=object(responseData.result,"KartaView result");
  if(Number(status.apiCode)!==600 || Number(status.httpCode)!==200)throw new Error("KartaView did not return a successful data response; an HTTP 200 alone is not a comparison.");
  if(!Array.isArray(result.data))throw new Error("KartaView returned an invalid image list.");
  const images=result.data.slice(0,25).map(row=>streetImage(row,[lat,lon])).filter((row):row is StreetImage=>row!==null);
  const ordered=images.slice().sort((a,b)=>a.sort_time-b.sort_time||a.distance_from_query_m-b.distance_from_query_m);
  const before=beforeYear===null?ordered[0]:ordered.filter(row=>row.year===beforeYear)[0];
  const after=afterYear===null?ordered.at(-1):ordered.filter(row=>row.year===afterYear).at(-1);
  const clean=(row:StreetImage)=>({id:row.id,captured_at:row.captured_at,image_url:row.image_url,lat:row.lat,lon:row.lon,heading:row.heading,source_url:row.source_url,distance_from_query_m:row.distance_from_query_m});
  const comparison=before&&after&&before.id!==after.id&&after.sort_time>before.sort_time?{before:clean(before),after:clean(after),elapsed_days:Math.round((after.sort_time-before.sort_time)/86_400_000*1000)/1000,distance_m:Math.round(distance([before.lat,before.lon],[after.lat,after.lon])*10)/10,heading_difference_degrees:before.heading===null||after.heading===null?null:Math.min(Math.abs(before.heading-after.heading),360-Math.abs(before.heading-after.heading)),different_calendar_years:before.year!==after.year}:null;
  return {source:url.toString(),observed_at:new Date().toISOString(),coverage:"Actual KartaView street images with provider capture dates, within 500 meters of the supplied coordinates. Bounded to the provider's first 25 nearby records; dates and image alignment may be incomplete. Side-by-side temporal observations do not automatically prove physical change. Google Street View and Mapillary access are separate and not supplied by this source.",data:{provider:"KartaView",attribution:"Grab and KartaView contributors",license:"CC-BY-SA-4.0",license_reference:"https://kartaview.org/terms",query:{latitude:lat,longitude:lon,before_year:beforeYear,after_year:afterYear},capture_timezone:"Provider timestamps do not specify a timezone; elapsed days use the same calendar-ordering convention for both images.",comparison,comparison_status:comparison?"dated_pair_available":"no_dated_pair_in_bounded_response",notice:comparison?"Review distance, headings and capture dates before interpreting differences.":"This bounded source response did not contain two distinct usable dated images matching the requested years. This does not prove historical imagery is absent.",images:ordered.map(clean),available_years:[...new Set(ordered.map(row=>row.year))],returned_records:result.data.length,considered_records:Math.min(result.data.length,25),usable_images:images.length,has_more_data:typeof result.hasMoreData==="boolean"?result.hasMoreData:null}};
}
export async function runMarketplaceAlternatives(tool: string, p: AlternativeParams): Promise<RecordValue | undefined> {
  if (tool === 'streetview-compare') return streetComparison(p);
  return undefined;
}
