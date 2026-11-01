import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Client-side source transport only. No credentials, provider calls or deployment.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
try {
  const name=process.argv[2];
  if(!/^[a-z][a-z0-9-]{1,63}$/.test(name||'')) throw new Error('An exact function name is required');
  const manifest=JSON.parse(await fs.readFile(path.join(root,'migration/lovable-exit/deployment-manifest.json'),'utf8'));
  if(manifest.destination_project_ref!=='ocliymtdvtxfxczxgbjr') throw new Error('Independent target reference mismatch');
  const spec=manifest.functions.find(row=>row.name===name);
  if(!spec || !spec.authorization_review_requirement) throw new Error('Function authorization manifest missing');
  const files=[];
  for(const row of spec.files) {
    const filename=path.resolve(root,row.path);
    const relative=path.relative(path.join(root,'supabase/functions'),filename);
    if(relative.startsWith('..') || path.isAbsolute(relative) || (await fs.lstat(filename)).isSymbolicLink()) throw new Error('Function source path escaped approved directory');
    const bytes=await fs.readFile(filename);
    if(bytes.length!==row.bytes || crypto.createHash('sha256').update(bytes).digest('hex')!==row.sha256) throw new Error('Function changed since reviewed manifest: '+name);
    files.push({name:relative.split(path.sep).join('/'),content:bytes.toString('utf8')});
  }
  // Each reviewed handler verifies a real user, application API key, or signed
  // Stripe event. Gateway legacy JWT verification cannot validate modern Auth
  // signing keys or application API-key/webhook routes.
  process.stdout.write(JSON.stringify({project_id:manifest.destination_project_ref,name,entrypoint_path:name+'/index.ts',verify_jwt:false,files}));
} catch(error) { console.error(error instanceof Error?error.message:'Source preparation failed'); process.exitCode=1; }
