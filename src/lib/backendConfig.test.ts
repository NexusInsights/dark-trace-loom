import { describe,it,expect } from 'vitest';
import { publicBackendConfig } from './backendConfig';
const publicKey=(role='anon',ref='targetproject')=>'e30.'+btoa(JSON.stringify({role,ref}))+'.signature';
describe('independent public backend configuration',()=>{
 it('accepts a matched public anon project key',()=>expect(publicBackendConfig('https://targetproject.supabase.co',publicKey()).url).toBe('https://targetproject.supabase.co'));
 it('accepts a modern publishable key',()=>expect(publicBackendConfig('https://targetproject.supabase.co','sb_publishable_public-fixture').key).toBe('sb_publishable_public-fixture'));
 it('rejects a mismatched project key',()=>expect(()=>publicBackendConfig('https://otherproject.supabase.co',publicKey())).toThrow('does not belong'));
 it.each(['service_role','authenticated','admin'])('rejects privileged %s frontend keys',role=>expect(()=>publicBackendConfig('https://targetproject.supabase.co',publicKey(role))).toThrow('privileged'));
 it.each(['http://targetproject.supabase.co','https://name:password@targetproject.supabase.co','https://targetproject.supabase.co/path','https://targetproject.supabase.co/?token=value','https://targetproject.supabase.co/#fragment'])('rejects unsafe backend origins %s',url=>expect(()=>publicBackendConfig(url,publicKey())).toThrow('HTTPS origin'));
 it.each(['sb_secret_never-public','invalid','e30.bad-json.sig'])('rejects malformed or private keys',key=>expect(()=>publicBackendConfig('https://targetproject.supabase.co',key)).toThrow());
});
