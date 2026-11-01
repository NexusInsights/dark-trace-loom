export async function onRequest({request,env,params}){
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(!env.MARKETPLACE_MONITOR)return new Response(JSON.stringify({error:'The durable monitoring service is not deployed or bound to this app.'}),{status:503,headers});
  const suffix=Array.isArray(params.path)?params.path.join('/'):String(params.path||'');
  if(!/^v1\/[a-zA-Z0-9/_-]+$/.test(suffix))return new Response(JSON.stringify({error:'Unknown monitoring route.'}),{status:404,headers});
  const own=new URL(request.url),origin=request.headers.get('origin');
  if(!['GET','POST','PATCH','DELETE'].includes(request.method))return new Response(JSON.stringify({error:'Unsupported method.'}),{status:405,headers});
  if(origin&&origin!==own.origin)return new Response(JSON.stringify({error:'Same-origin monitoring requests are required.'}),{status:403,headers});
  try{return await env.MARKETPLACE_MONITOR.fetch(new Request(`https://monitor.internal/${suffix}${own.search}`,request));}catch{return new Response(JSON.stringify({error:'The monitoring runtime could not be reached. No success or alert was recorded by this proxy.'}),{status:502,headers});}
}
