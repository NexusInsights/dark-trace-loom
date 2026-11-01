import { authenticatedUser } from "../_lib/auth";
const json = (body, status=200) => Response.json(body, {status, headers:{"Cache-Control":"no-store"}});
export async function onRequestPost({request,env}) {
  try {
    if (!await authenticatedUser(request,env)) return json({error:"Sign in to query the provider"},401);
    const raw = await request.text();
    if (raw.length > 2048) return json({error:"Request is too large"},413);
    let body;
    try { body=JSON.parse(raw); } catch { return json({error:"Invalid JSON"},400); }
    if (typeof body.query !== "string" || body.query.length < 3 || body.query.length > 255) return json({error:"Provide a valid email or username"},400);
    const sourceUrl=`https://leakcheck.io/api/public?check=${encodeURIComponent(body.query)}`;
    const response=await fetch(sourceUrl,{signal:AbortSignal.timeout(10000),redirect:"manual"});
    if (!response.ok) throw new Error(`LeakCheck returned HTTP ${response.status}`);
    const data=await response.json();
    if (data.success !== true || typeof data.found !== "number") throw new Error(`LeakCheck did not return a successful query: ${String(data.error || data.message || "Unusable provider response")}`);
    return json({query:body.query,found:data.found>0,total:data.found,sources:data.sources || [],fields:data.fields || [],source:"LeakCheck public preview",retrievedAt:new Date().toISOString(),note:"Limited provider preview. A negative result is not evidence of no exposure across all breach databases."});
  } catch(error) { return json({error:error instanceof Error ? error.message : "Provider query failed"},502); }
}
