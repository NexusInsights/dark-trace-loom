import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Local preparation only: no database connection, provisioning or credentials.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=path.resolve(root,'..');
const output=path.join(root,'lovable-exit','bundle');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sortedUnique=values=>[...new Set(values)].sort();
function inside(base,target){const relative=path.relative(base,target);if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('Bundle path escaped its approved directory');return target;}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(entry=>{const target=path.join(dir,entry.name);if(entry.isSymbolicLink())throw new Error('Symlink found in source snapshot; review it separately');return entry.isDirectory()?walk(target):[target];});}
function write(relative,bytes){const target=inside(output,path.resolve(output,relative));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
try{
  const migrationDir=path.join(app,'supabase','migrations');
  const migrations=fs.readdirSync(migrationDir).filter(name=>/^\d{14}_[a-zA-Z0-9-]+\.sql$/.test(name)).sort();
  if(!migrations.length)throw new Error('No timestamped SQL migrations found');
  const files=[];const sql=[];
  for(const name of migrations){const bytes=fs.readFileSync(path.join(migrationDir,name));const relative=`migrations/${name}`;write(relative,bytes);files.push({path:relative,source:`supabase/migrations/${name}`,bytes:bytes.length,sha256:hash(bytes)});sql.push({name,text:bytes.toString('utf8')});}
  const functionsDir=path.join(app,'supabase','functions');
  for(const filename of walk(functionsDir).filter(file=>/\.(?:ts|js|json|toml|lock)$/.test(file)&&!/(?:_test|\.test|\.spec)\./.test(file)&&!path.basename(file).startsWith('.'))){const relative=path.relative(functionsDir,filename).split(path.sep).join('/');const bytes=fs.readFileSync(filename);write(`functions/${relative}`,bytes);files.push({path:`functions/${relative}`,source:`supabase/functions/${relative}`,bytes:bytes.length,sha256:hash(bytes)});}
  for(const [source,dest] of [['supabase/config.toml','reference/source-config.toml'],['src/integrations/supabase/types.ts','reference/source-types.ts']]){const bytes=fs.readFileSync(path.join(app,source));write(dest,bytes);files.push({path:dest,source,bytes:bytes.length,sha256:hash(bytes)});}
  const joined=sql.map(row=>row.text).join('\n');
  const tables=sortedUnique([...joined.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)].map(m=>m[1]));
  const functions=sortedUnique([...joined.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)].map(m=>m[1]));
  const enums=sortedUnique([...joined.matchAll(/CREATE\s+TYPE\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+AS\s+ENUM/gi)].map(m=>m[1]));
  const realtime=sortedUnique([...joined.matchAll(/ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+public\.([a-z_][a-z0-9_]*)/gi)].map(m=>m[1]));
  const buckets=sortedUnique([...joined.matchAll(/VALUES\s*\('([^']+)',\s*'[^']+',\s*(?:true|false)/gi)].map(m=>m[1]));
  const functionNames=fs.readdirSync(functionsDir,{withFileTypes:true}).filter(row=>row.isDirectory()&&!row.name.startsWith('_')).map(row=>row.name).sort();
  const serverNames=sortedUnique(files.filter(row=>row.path.startsWith('functions/')).flatMap(row=>[...fs.readFileSync(path.join(output,row.path),'utf8').matchAll(/Deno\.env\.get\(["']([A-Z0-9_]+)["']\)|["']((?:MARKETPLACE_[A-Z0-9_]+|MONITOR_[A-Z0-9_]+|[A-Z][A-Z0-9_]+_(?:KEY|TOKEN|SECRET)))["']/g)].map(match=>match[1]||match[2])));
  const typesText=fs.readFileSync(path.join(app,'src/integrations/supabase/types.ts'),'utf8');
  const typedRows=[...typesText.matchAll(/^      ([a-z_][a-z0-9_]*): \{\r?\n        Row: \{([\s\S]*?)^        \}/gm)];
  const typesTables=sortedUnique(typedRows.map(row=>row[1]));
  if(JSON.stringify(typesTables)!==JSON.stringify(tables))throw new Error('Migration table names differ from generated types: review schema drift before bundling');
  if(typedRows.some(row=>!/^          id: /m.test(row[2])))throw new Error('A table lacks the expected id column; generated ID-digest query requires review');
  const risks=sql.flatMap(row=>row.text.split(/\r?\n/).flatMap((line,index)=>/^\s*(?:DROP\s+TABLE|DELETE\s+FROM|TRUNCATE\s)/i.test(line)?[{migration:row.name,line:index+1,statement:line.trim()}]:[]));
  const inventory={provenance:'Static local repository inventory; not an authoritative live schema/data export',migration_count:migrations.length,public_tables:tables,generated_types_match_public_tables:true,functions,enums,realtime_tables:realtime,known_private_buckets:buckets,edge_function_directories:functionNames,server_config_names_only:serverNames,destructive_history:risks,unknown_live_components:['additional schemas/tables/views/functions','auth users/password hashes/identities/MFA','storage object binaries and metadata','provider secret values and allowance verification','auth provider/SMTP settings','scheduled jobs/webhooks/extensions and grants','data changed since migrations/source snapshot']};
  write('inventory.json',JSON.stringify(inventory,null,2)+'\n');
  const guard=fs.readFileSync(path.join(root,'lovable-exit','target-preflight.sql'),'utf8');
  write('schema-replay.sql','-- FRESH EMPTY TARGET ONLY. Never run this after production data import.\nBEGIN;\n'+guard+'\n'+sql.map(row=>`\n-- Source migration: ${row.name}\n${row.text}`).join('\n')+'\nCOMMIT;\n');
  const countRows=[...tables.map(table=>`SELECT 'public.${table}'::text AS relation, count(*)::bigint AS row_count, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) AS id_set_digest FROM public.${table}`),"SELECT 'auth.users', count(*)::bigint, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) FROM auth.users","SELECT 'auth.identities', count(*)::bigint, md5(coalesce(string_agg(id::text, ',' ORDER BY id::text),'')) FROM auth.identities"];
  const adminGuard=fs.readFileSync(path.join(root,'lovable-exit','admin-read-guard.sql'),'utf8');
  write('row-counts-and-id-digests.sql','-- Run on source and target with administrative access; compare every row.\n-- Unknown production drift is detected separately by source-audit.sql.\nBEGIN TRANSACTION READ ONLY;\nSET LOCAL statement_timeout = \'120s\';\n'+adminGuard+'\n'+countRows.join('\nUNION ALL\n')+'\nORDER BY relation;\nCOMMIT;\n');
  for(const name of ['source-audit.sql','integrity-check.sql','admin-read-guard.sql','target-preflight.sql','post-restore-invitation-hardening.sql','post-restore-invitation-rpc.sql','post-restore-stored-alerts.sql','stored-alerts-acceptance.rollback.sql','stored-alerts-hash-vectors.rollback.sql','activate-stored-alerts-cron.sql','stored-alerts-concurrency.session-A.sql','stored-alerts-concurrency.session-B.sql']){const bytes=fs.readFileSync(path.join(root,'lovable-exit',name));write(name,bytes);files.push({path:name,source:`migration/lovable-exit/${name}`,bytes:bytes.length,sha256:hash(bytes)});}
  for(const name of ['inventory.json','schema-replay.sql','row-counts-and-id-digests.sql']){const bytes=fs.readFileSync(path.join(output,name));files.push({path:name,source:'generated local preparation',bytes:bytes.length,sha256:hash(bytes)});}
  const manifest={format_version:1,source_project_ref:'zisrsttmjeipkmllqubi',protected_existing_project_refs:['dbdkvrkmeowdydizrsmn'],provenance:'Local schema/source reconstruction only; contains no production record/auth/storage export or secret values',migration_order:migrations,files:files.sort((a,b)=>a.path.localeCompare(b.path,'en'))};
  write('manifest.json',JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({prepared:true,migrations:migrations.length,public_tables:tables.length,edge_functions:functionNames.length,files:files.length,output:path.relative(app,output).split(path.sep).join('/'),database_actions:0,secret_values_copied:0}));
}catch(error){console.error(error instanceof Error?error.message:'Local bundle preparation failed');process.exitCode=1;}
