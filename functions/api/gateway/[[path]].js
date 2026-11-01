const json = (body,status) => Response.json(body,{status,headers:{"Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"x-api-key,content-type,authorization","Access-Control-Allow-Methods":"GET,POST,OPTIONS"}});
export async function onRequest({request,env}) {
  if (request.method === "OPTIONS") return json({},200);
  const url = new URL(request.url);
  const path = url.pathname.slice("/api/gateway".length);
  if (path === "/v1/tools/run") return json({error:"API tool execution is unavailable: the managed endpoint only creates a queued row and has no verified executor. No result was queued or fabricated. Use the authenticated Tool Suite, agent or pipeline execution paths."},501);
  if (!/^\/v1\/(cases|subjects|reports|artifacts|entities|relationships|graph|scores|analysis|breaches)(\/[^/]+)?$/.test(path)) return json({error:"Unknown API resource"},404);
  const key = request.headers.get("x-api-key") || request.headers.get("authorization")?.replace(/^Bearer /,"");
  if (!key) return json({error:"API key required"},401);
  try {
    if (!env.SUPABASE_URL) return json({error:"Backend not configured"},503);
    const body = ["GET","HEAD"].includes(request.method) ? undefined : await request.text();
    if (body && body.length > 50000) return json({error:"Request too large"},413);
    const response = await fetch(`${env.SUPABASE_URL}/functions/v1/api-gateway${path}${url.search}`,{method:request.method,headers:{"x-api-key":key,"Content-Type":"application/json",apikey:env.SUPABASE_PUBLISHABLE_KEY},body,signal:AbortSignal.timeout(20000),redirect:"manual"});
    const data = await response.json();
    if (response.ok && path === "/v1/breaches" && Array.isArray(data.data)) data.data = data.data.filter(record => record.status === "exposure");
    return json(data,response.status);
  } catch(error) { return json({error:error instanceof Error ? error.message : "Backend API failed"},502); }
}
