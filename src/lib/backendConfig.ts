export function publicBackendConfig(urlValue:unknown,keyValue:unknown){
 if(typeof urlValue!=='string'||typeof keyValue!=='string'||!urlValue||!keyValue)throw new Error('The app backend URL and public API key must be configured.');
 let url:URL;try{url=new URL(urlValue);}catch{throw new Error('The app backend URL is invalid.');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||(url.port&&url.port!=='443'))throw new Error('The app backend must use an HTTPS origin without credentials or extra URL components.');
 if(keyValue.startsWith('sb_publishable_')&&/^sb_publishable_[A-Za-z0-9_-]+$/.test(keyValue))return {url:url.origin,key:keyValue};
 const parts=keyValue.split('.');if(parts.length!==3)throw new Error('Only a public publishable or anon backend key may be included in the app.');
 let payload:Record<string,unknown>;try{const normalized=parts[1].replace(/-/g,'+').replace(/_/g,'/');payload=JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,'=')));}catch{throw new Error('The public backend key is invalid.');}
 if(!payload||payload.role!=='anon')throw new Error('A privileged backend key cannot be included in the app.');
 const ref=url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1];
 if(ref&&payload.ref!==ref)throw new Error('The public backend key does not belong to the configured project.');
 return {url:url.origin,key:keyValue};
}
