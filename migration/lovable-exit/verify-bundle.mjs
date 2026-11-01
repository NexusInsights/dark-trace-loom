import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);
if(args.length && (args.length!==2||args[0]!=='--bundle')){console.error('Usage: node verify-bundle.mjs [--bundle DIRECTORY]');process.exit(1);}
const dir=path.resolve(args.length?args[1]:path.join(path.dirname(fileURLToPath(import.meta.url)),'bundle'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
try{
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  if(manifest.format_version!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw new Error('Invalid migration manifest');
  const realDir=fs.realpathSync(dir);
  const seen=new Set();for(const entry of manifest.files){if(typeof entry.path!=='string'||seen.has(entry.path)||path.isAbsolute(entry.path)||entry.path.split(/[\\/]/).includes('..'))throw new Error('Unsafe or duplicate manifest path');seen.add(entry.path);const full=path.resolve(dir,entry.path);const relative=path.relative(realDir,fs.realpathSync(full));if(fs.lstatSync(full).isSymbolicLink()||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('Bundle entries must not be symlinks or escape the bundle');const bytes=fs.readFileSync(full);if(bytes.length!==entry.bytes||hash(bytes)!==entry.sha256)throw new Error(`Bundle integrity mismatch: ${entry.path}`);}
  function actualFiles(base){return fs.readdirSync(base,{withFileTypes:true}).flatMap(item=>{const full=path.join(base,item.name);if(item.isSymbolicLink())throw new Error('Symlinks are not allowed in the bundle');return item.isDirectory()?actualFiles(full):[path.relative(dir,full).split(path.sep).join('/')];});}
  for(const filename of actualFiles(dir))if(filename!=='manifest.json'&&!seen.has(filename))throw new Error(`Unlisted bundle file requires review: ${filename}`);
  const ordered=[...manifest.migration_order].sort();if(JSON.stringify(ordered)!==JSON.stringify(manifest.migration_order)||new Set(ordered).size!==ordered.length)throw new Error('Migration order is not deterministic');
  const inventory=JSON.parse(fs.readFileSync(path.join(dir,'inventory.json'),'utf8'));
  if(inventory.migration_count!==ordered.length)throw new Error('Inventory/migration count mismatch');
  const replay=fs.readFileSync(path.join(dir,'schema-replay.sql'),'utf8');
  if(!replay.includes('app.lovable_exit_target_confirmed')||!replay.includes('Existing public application relations')||!replay.includes('auth.users')||!replay.includes('dbdkvrkmeowdydizrsmn')||!replay.startsWith('-- FRESH EMPTY TARGET ONLY.')||!replay.trimEnd().endsWith('COMMIT;'))throw new Error('Fresh-target guards are missing');
  let offset=-1;for(const migration of ordered){const index=replay.indexOf(`-- Source migration: ${migration}`);if(index<=offset)throw new Error('Replay migration ordering mismatch');offset=index;}
  console.log(JSON.stringify({verified:true,files:manifest.files.length,migrations:ordered.length,public_tables:inventory.public_tables.length,edge_functions:inventory.edge_function_directories.length,database_actions:0,notice:'Local hashes/guards only; this verifier performs no SQL or deployment and the bundle is not a production export.'}));
}catch(error){console.error(error instanceof Error?error.message:'Bundle verification failed');process.exitCode=1;}
