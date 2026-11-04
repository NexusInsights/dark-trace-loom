import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {canonicalTextBytes, checkedSource} from './bundle-sources.mjs';

// Client-side source transport only. No credentials, provider calls or deployment.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
try {
  const args=process.argv.slice(2);
  const name=args[0];
  if(args.length!==1 && !(args.length===3&&args[1]==='--manifest'))throw new Error('Usage: node prepare-edge-deploy.mjs FUNCTION [--manifest FILE]');
  if(!/^[a-z][a-z0-9-]{1,63}$/.test(name||'')) throw new Error('An exact function name is required');
  const manifestFile=args.length===3?path.resolve(args[2]):path.join(root,'migration/lovable-exit/deployment-manifest.json');
  const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
  if(![1,2].includes(manifest.format_version)||(manifest.format_version===2&&manifest.text_encoding!=='utf8-lf'))throw new Error('Unknown deployment manifest format');
  if(manifest.destination_project_ref!=='ocliymtdvtxfxczxgbjr') throw new Error('Independent target reference mismatch');
  const spec=manifest.functions.find(row=>row.name===name);
  if(!spec || !spec.authorization_review_requirement || (manifest.format_version===2&&!spec.authorization_contract_known)) throw new Error('Function authorization manifest missing');
  if(spec.entrypoint!==`supabase/functions/${name}/index.ts`||!Array.isArray(spec.files)||!spec.files.length||!spec.files.some(row=>row.path===spec.entrypoint)||new Set(spec.files.map(row=>row.path)).size!==spec.files.length)throw new Error('Incomplete or duplicate function source closure');
  const files=[];
  for(const row of spec.files) {
    const filename=checkedSource(root,row.path);
    const relative=path.relative(path.join(root,'supabase/functions'),filename);
    if(relative.startsWith('..') || path.isAbsolute(relative) || (await fs.lstat(filename)).isSymbolicLink()) throw new Error('Function source path escaped approved directory');
    const raw=await fs.readFile(filename);
    const bytes=manifest.format_version===2?canonicalTextBytes(raw):raw;
    if(bytes.length!==row.bytes || crypto.createHash('sha256').update(bytes).digest('hex')!==row.sha256) throw new Error('Function changed since reviewed manifest: '+name);
    files.push({name:relative.split(path.sep).join('/'),content:bytes.toString('utf8')});
  }
  // Each reviewed handler verifies a real user, application API key, or signed
  // Stripe event. Gateway legacy JWT verification cannot validate modern Auth
  // signing keys or application API-key/webhook routes.
  process.stdout.write(JSON.stringify({project_id:manifest.destination_project_ref,name,entrypoint_path:name+'/index.ts',verify_jwt:false,files}));
} catch(error) { console.error(error instanceof Error?error.message:'Source preparation failed'); process.exitCode=1; }
