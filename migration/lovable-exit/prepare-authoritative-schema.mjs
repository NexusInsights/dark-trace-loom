import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Explicit authorized private inputs. No DB connection and no archive data rows
// are decoded: pg_restore is restricted to reviewed schema/ACL TOC entries.
const privateDir='D:/CodexData/InsightNexus-Migration/2026-10-14';
const archive=path.join(privateDir,'unpacked-source-export','dark-trace-loom_261014.backup');
const tocFile=path.join(privateDir,'backup-toc.txt');
const restoreExe='D:/CodexTools/InsightNexus-Postgres/18.6/bin/pg_restore.exe';
const taskDir=path.dirname(fileURLToPath(import.meta.url));
const selectedFile=path.join(privateDir,'target-public-schema.toc');
const decodedFile=path.join(privateDir,'target-public-schema.decoded.sql');
const finalFile=path.join(privateDir,'target-public-schema.sql');
const kinds=['MATERIALIZED VIEW DATA','SEQUENCE OWNED BY','PUBLICATION TABLE','DEFAULT ACL','CHECK CONSTRAINT','FK CONSTRAINT','ROW SECURITY','EVENT TRIGGER','TABLE ATTACH','INDEX ATTACH','SEQUENCE SET','TABLE DATA','MATERIALIZED VIEW','FUNCTION','PROCEDURE','CONSTRAINT','SEQUENCE','POLICY','TRIGGER','COMMENT','SCHEMA','EXTENSION','TABLE','INDEX','TYPE','ACL','VIEW','PUBLICATION','DEFAULT'].sort((a,b)=>b.length-a.length);
const expression=new RegExp(`^(\\d+); \\d+ \\d+ (${kinds.join('|')}) (\\S+) (.*)$`);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const expectedStoragePolicies=new Set(['Owners can delete own artifacts','Owners can read own artifacts','Owners can upload artifacts','Users can delete own reports','Users can read own reports','Users can upload reports']);

function sqlStatements(text){
  const statements=[];let start=0,quote='',dollar='',lineComment=false,blockDepth=0;
  for(let i=0;i<text.length;i++){
    if(lineComment){if(text[i]==='\n')lineComment=false;continue;}
    if(blockDepth){if(text.slice(i,i+2)==='/*'){blockDepth++;i++;}else if(text.slice(i,i+2)==='*/'){blockDepth--;i++;}continue;}
    if(dollar){if(text.startsWith(dollar,i)){i+=dollar.length-1;dollar='';}continue;}
    if(quote){if(text[i]===quote){if(text[i+1]===quote)i++;else quote='';}continue;}
    if(text.slice(i,i+2)==='--'){lineComment=true;i++;continue;}
    if(text.slice(i,i+2)==='/*'){blockDepth=1;i++;continue;}
    if(text[i]==="'"||text[i]==='"'){quote=text[i];continue;}
    const tag=text[i]==='$'?text.slice(i).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/i):null;
    if(tag){dollar=tag[0];i+=dollar.length-1;continue;}
    if(text[i]===';'){statements.push(text.slice(start,i+1));start=i+1;}
  }
  if(quote||dollar||blockDepth)throw new Error('Unterminated selected-schema SQL requires review');
  if(text.slice(start).trim())statements.push(text.slice(start));
  return statements;
}
const statementCode=statement=>statement.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/,'').trim();

try{
  for(const file of [archive,tocFile,restoreExe])if(!fs.statSync(file).isFile())throw new Error('A required private archive/TOC/tool file is unavailable');
  const inventory=JSON.parse(fs.readFileSync(path.join(taskDir,'bundle','inventory.json'),'utf8'));
  const selected=[];const metadata=[];const omitted=[];
  for(const line of fs.readFileSync(tocFile,'utf8').split(/\r?\n/)){
    const match=line.match(expression);if(!match){if(line.trim()&&!line.startsWith(';'))throw new Error('Unrecognized archive entry type requires review');continue;}
    const [,id,kind,schema,tail]=match;
    let keep=schema==='public'&&!['TABLE DATA','SEQUENCE SET','MATERIALIZED VIEW DATA'].includes(kind);
    if(kind==='DEFAULT ACL'&&schema==='public')keep=false;
    if(kind==='ACL'&&schema==='-'&&tail==='SCHEMA public pg_database_owner')keep=true;
    if(kind==='TRIGGER'&&schema==='auth'&&tail==='users on_auth_user_created supabase_auth_admin')keep=true;
    if(kind==='POLICY'&&schema==='storage'){
      const found=tail.match(/^objects (.*) supabase_storage_admin$/);
      if(!found||!expectedStoragePolicies.has(found[1]))throw new Error('An unknown Storage policy needs explicit review');
      keep=true;
    }
    if(keep){selected.push(line);metadata.push({id,kind,schema,description:tail});}
    else if(schema==='public')omitted.push({id,kind,reason:kind==='DEFAULT ACL'?'Future-object defaults omitted to retain the chosen destination no-automatic-exposure policy; explicit restored-object ACLs are preserved':'Record data excluded from schema preparation'});
  }
  const counts=Object.fromEntries([...new Set(metadata.map(row=>row.kind))].sort().map(kind=>[kind,metadata.filter(row=>row.kind===kind).length]));
  const publicTables=metadata.filter(row=>row.kind==='TABLE'&&row.schema==='public').map(row=>row.description.replace(/ postgres$/,'')).sort();
  if(JSON.stringify(publicTables)!==JSON.stringify(inventory.public_tables))throw new Error('Authoritative public table names differ from local inventory; review drift');
  if(metadata.filter(row=>row.kind==='TYPE'&&row.schema==='public').length!==3||metadata.filter(row=>row.kind==='FUNCTION'&&row.schema==='public').length!==11)throw new Error('Authoritative enum/function counts require review');
  if(metadata.filter(row=>row.kind==='ROW SECURITY'&&row.schema==='public').length!==62)throw new Error('Not all 62 public RLS entries were selected');
  if(metadata.filter(row=>row.kind==='TRIGGER'&&row.schema==='auth').length!==1||metadata.filter(row=>row.kind==='POLICY'&&row.schema==='storage').length!==6)throw new Error('Required custom Auth trigger/Storage policies are incomplete');
  fs.writeFileSync(selectedFile,'; Reviewed public objects and custom Auth/Storage hooks only; no DATA entries.\n'+selected.join('\n')+'\n');
  const child=spawnSync(restoreExe,['--schema-only','--no-owner','--use-list',selectedFile,'--file',decodedFile,archive],{encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:1024*1024});
  fs.writeFileSync(path.join(privateDir,'target-public-schema-diagnostics.txt'),child.stderr||'');
  if(child.error||child.status!==0)throw new Error('Selected schema/ACL decoding failed; diagnostics retained privately');
  let sql=fs.readFileSync(decodedFile,'utf8');
  sql=sql.split(/\r?\n/).filter(line=>!/^\\(?:un)?restrict\s/.test(line)).join('\n');
  const skippedStatements=[];
  sql=sqlStatements(sql).filter(statement=>{
    const code=statementCode(statement);
    if(/^SET\s+[a-z_]+\s*(?:=|TO)\s/i.test(code)||/^SELECT\s+pg_catalog\.set_config\('search_path',\s*'',\s*false\)/i.test(code)){
      skippedStatements.push('Dump session setting omitted; bounded SET LOCAL controls used');return false;
    }
    if(/^(?:GRANT|REVOKE)\b/i.test(code)&&/\bsandbox_exec\b/.test(code)){
      if(!/\b(?:TO|FROM)\s+"?sandbox_exec"?\s*;$/i.test(code))throw new Error('Mixed managed-role ACL requires explicit review');
      skippedStatements.push('sandbox_exec ACL omitted: Lovable platform role is not an application role and will not be created');return false;
    }
    return true;
  }).join('\n');
  if(/^\\/m.test(sql)||/\b(?:DROP\s+(?:TABLE|SCHEMA|DATABASE)|DELETE\s+FROM|TRUNCATE\s|COPY\s+.*?FROM\s+stdin|ALTER\s+.*?OWNER\s+TO)\b/im.test(sql))throw new Error('Unexpected client-only/destructive/data/ownership statement requires review');
  if(/^CREATE\s+(?:TABLE|TYPE|FUNCTION|SCHEMA)\s+(?:auth|storage|realtime|vault|extensions)\./im.test(sql))throw new Error('Managed-schema infrastructure was unexpectedly selected');
  if((sql.match(/^CREATE TABLE public\./gm)||[]).length!==62||(sql.match(/^CREATE TYPE public\./gm)||[]).length!==3||(sql.match(/^CREATE FUNCTION public\./gm)||[]).length!==11)throw new Error('Decoded public schema object count mismatch');
  if(!/^GRANT .* ON TABLE public\./m.test(sql)||/^ALTER DEFAULT PRIVILEGES /m.test(sql)||/\bsandbox_exec\b/.test(sql))throw new Error('Application ACL preservation or managed-role/default omission check failed');
  const guard=fs.readFileSync(path.join(taskDir,'target-preflight.sql'),'utf8');
  const extensions="-- Source job extensions; review installed target extensions and actual job requirements first.\n-- No selected public object directly requires these two extensions.\nCREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;\nCREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;\n";
  const exactTarget="DO $approved_target$ BEGIN IF current_setting('app.lovable_exit_target_ref',true) IS DISTINCT FROM 'ocliymtdvtxfxczxgbjr' THEN RAISE EXCEPTION 'This authoritative schema is prepared only for the approved new Free project'; END IF; END $approved_target$;\n";
  const localSettings="SET LOCAL statement_timeout = '120s';\nSET LOCAL lock_timeout = '10s';\nSET LOCAL standard_conforming_strings = on;\nSET LOCAL search_path = '';\nSET LOCAL check_function_bodies = false;\nSET LOCAL row_security = off;\n";
  const final='-- AUTHORITATIVE SCHEMA/ACL ONLY. NEW EMPTY TARGET ONLY; NO DATA IMPORT.\nBEGIN;\n'+localSettings+exactTarget+guard+'\n'+sql+'\nCOMMIT;\n';
  fs.writeFileSync(finalFile,final);
  const extensionFile=path.join(privateDir,'target-job-extensions.review.sql');
  fs.writeFileSync(extensionFile,'-- REVIEW BEFORE APPLYING; prepared only. Not required by the selected public DDL.\nBEGIN;\n'+localSettings+exactTarget+guard+'\n'+extensions+'COMMIT;\n');
  const report={prepared:true,source_project_ref:'zisrsttmjeipkmllqubi',approved_empty_target_ref:'ocliymtdvtxfxczxgbjr',source_postgres:'17.6',target_postgres:'17.11',schema_decode_exit_code:child.status,selected_entries:metadata.length,entry_counts:counts,public_table_count:62,all_public_tables_match_local_names:true,rls_tables:62,public_enums:3,public_functions:11,custom_auth_triggers:1,custom_storage_policies:6,source_acls_preserved:'Explicit restored-object application ACLs preserved; Lovable sandbox_exec and future-object defaults deliberately omitted',future_object_defaults_restored:false,sandbox_role_created:false,bounded_transaction_settings:true,owner_statements:false,managed_infrastructure_selected:false,table_data_selected:false,omitted_public_entries:omitted,skipped_statement_reasons:skippedStatements,files:[{path:path.basename(selectedFile),sha256:hash(fs.readFileSync(selectedFile)),bytes:fs.statSync(selectedFile).size},{path:path.basename(finalFile),sha256:hash(fs.readFileSync(finalFile)),bytes:fs.statSync(finalFile).size}],source_job_extensions_separate_review:['pg_cron','pg_net'],database_connections:0,sql_applied:false};
  fs.writeFileSync(path.join(privateDir,'target-public-schema-preparation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({prepared:true,selected_entries:metadata.length,public_tables:62,rls_tables:62,enums:3,public_functions:11,custom_auth_triggers:1,custom_storage_policies:6,public_table_acl_entries:metadata.filter(row=>row.kind==='ACL'&&row.schema==='public'&&row.description.startsWith('TABLE ')).length,private_output:'target-public-schema.sql',bytes:Buffer.byteLength(final),database_connections:0,sql_applied:false}));
}catch(error){console.error(error instanceof Error?error.message:'Authoritative schema preparation failed');process.exitCode=1;}
