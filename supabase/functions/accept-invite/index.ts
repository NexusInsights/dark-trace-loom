import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function boundedText(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!stream) return "";
  const reader=stream.getReader(); const chunks: Uint8Array[]=[]; let bytes=0;
  try {
    while (true) {
      const {done,value}=await reader.read(); if(done) break;
      bytes+=value.byteLength;
      if(bytes>limit){await reader.cancel();throw new Error("Body exceeded its limit");}
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const all=new Uint8Array(bytes);let offset=0;
  for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder().decode(all);
}

async function boundedBackendFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target=new URL(input instanceof Request?input.url:String(input));
  if(target.origin!==new URL(Deno.env.get("SUPABASE_URL")||"").origin)throw new Error("Unexpected backend origin");
  const response=await fetch(input,{...init,redirect:"error",signal:AbortSignal.timeout(8000)});
  if(!response.body)return response;
  const text=await boundedText(response.body,256*1024);
  return new Response(text,{status:response.status,statusText:response.statusText,headers:response.headers});
}

async function acceptInvitation(req: Request): Promise<Response> {
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders});
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  const auth=req.headers.get("Authorization");
  if(!auth||auth.length>8192||!/^Bearer [^\s]+$/i.test(auth))return json({error:"unauthenticated"},401);
  let body:unknown;
  try{body=JSON.parse(await boundedText(req.body,2048));}catch{return json({error:"invalid_body"},400);}
  if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length!==1||typeof (body as {token?:unknown}).token!=="string")return json({error:"invalid_body"},400);
  const token=(body as {token:string}).token;
  if(token.length<8||token.length>128||/\s/.test(token))return json({error:"invalid_body"},400);
  const url=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publicKey=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if(!url||!serviceKey||!publicKey)return json({error:"backend_not_configured"},503);
  try{const configured=new URL(url);if(configured.protocol!=="https:"||configured.username||configured.password||configured.search||configured.hash||(configured.pathname!=="/"&&configured.pathname!==""))return json({error:"backend_not_configured"},503);}catch{return json({error:"backend_not_configured"},503);}
  try{
    const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:boundedBackendFetch}};
    const userClient=createClient(url,publicKey,options);
    const {data,error:authError}=await userClient.auth.getUser(auth.slice(7));
    if(authError){if(![400,401,403,422].includes(authError.status??0))return json({error:"authentication_unavailable"},503);return json({error:"unauthenticated"},401);}
    const user=data?.user;
    if(!user||typeof user.id!=="string"||!UUID.test(user.id)||typeof user.email!=="string"||user.email.length>254||!user.email.includes("@"))return json({error:"unauthenticated"},401);
    // One service-role-only RPC locks the invitation and changes membership/state
    // atomically. Actor ID/email come only from remotely verified Auth.
    const admin=createClient(url,serviceKey,options);
    const {data:result,error:operationError}=await admin.rpc("accept_organization_invitation",{p_token:token,p_user_id:user.id,p_email:user.email.toLowerCase()});
    if(operationError){
      if(operationError.code==="PGRST202"||operationError.code==="42883")return json({error:"acceptance_not_configured"},424);
      return json({error:"invitation_operation_unconfirmed",message:"Acceptance could not be confirmed. Retry the same invitation link to check its recorded state."},503);
    }
    if(!result||typeof result!=="object"||Array.isArray(result))return json({error:"invalid_backend_response"},502);
    if(typeof result.error==="string"){
      const statuses:Record<string,number>={invalid_body:400,not_found:404,email_mismatch:403,expired:410,already_accepted:410};
      return Object.prototype.hasOwnProperty.call(statuses,result.error)?json({error:result.error},statuses[result.error]):json({error:"invitation_operation_unconfirmed"},503);
    }
    if(result.status!=="success"||typeof result.org_id!=="string"||!UUID.test(result.org_id)||!["owner","admin","investigator","viewer"].includes(result.role)||typeof result.idempotent!=="boolean"||typeof result.already_member!=="boolean")return json({error:"invalid_backend_response"},502);
    return json({status:"success",org_id:result.org_id,role:result.role,idempotent:result.idempotent,already_member:result.already_member});
  }catch{return json({error:"invitation_operation_unconfirmed",message:"Acceptance could not be confirmed. Retry the same invitation link to check its recorded state."},503);}
}

serve(acceptInvitation);
