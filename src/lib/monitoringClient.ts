import { supabase } from '@/integrations/supabase/client';
export async function monitoringRequest<T>(path:string,method='GET',body?:unknown):Promise<T>{
  if(!/^\/v1\/[a-z0-9/_-]+(?:\?[a-z0-9_=&-]*)?$/i.test(path))throw new Error('Invalid monitoring route.');
  const {data,error}=await supabase.auth.getSession();if(error)throw new Error(`Session check failed: ${error.message}`);if(!data.session?.access_token)throw new Error('Sign in to manage monitors.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{const r=await fetch(`/api/marketplace-monitor${path}`,{method,headers:{Authorization:`Bearer ${data.session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'same-origin',signal:controller.signal});let result:unknown;try{result=await r.json();}catch{throw new Error(`Monitoring service returned HTTP ${r.status} without valid JSON.`);}if(!r.ok)throw new Error(result&&typeof result==='object'&&'error'in result?String(result.error):`Monitoring HTTP ${r.status}`);return result as T;
  }catch(e){if(controller.signal.aborted)throw new Error('Monitoring request timed out; no automatic mutation retry was made.');throw e;}finally{clearTimeout(timer);}
}
