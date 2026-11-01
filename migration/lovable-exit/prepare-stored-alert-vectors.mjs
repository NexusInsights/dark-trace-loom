import fs from 'node:fs';
import crypto from 'node:crypto';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const directory=path.dirname(fileURLToPath(import.meta.url));
try{
 const original=fs.readFileSync(path.join(directory,'reference/check-alerts-before-native-engine.ts'),'utf8');
 const js=ts.transpileModule(original.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const helper=new Function('createClient','serve','Deno','crypto',js+';return alertsNotificationId;')(()=>{throw new Error('Unexpected database call');},()=>undefined,{env:{get:()=>undefined}},crypto.webcrypto);
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const cases=[
  ['2026-01-01T00:00:00+00:00',{artifact_count:1,sampled_evidence_ids:['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],evidence_sample_truncated:false}],
  ['2026-01-01T00:00:00.123456+00:00',{breach_count:2,sampled_breach_names:['Quoted " name','Back\\slash','Unicode 😀'],sampled_evidence_ids:['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],evidence_sample_truncated:true,severity_coverage:'sampled_records_only'}],
 ];
 const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
 const checks=[];
 for(const [baseline,metadata] of cases){const expected=await helper({id,last_checked:baseline,created_at:baseline},{metadata});checks.push("IF public.stored_alert_notification_id("+quote(id)+"::uuid,"+quote(baseline)+"::timestamptz,"+quote(JSON.stringify(metadata))+")<>"+quote(expected)+"::uuid THEN RAISE EXCEPTION 'Actual Edge SHA256 vector parity failed'; END IF;");}
 const sql="-- Generated from actual preserved Edge helper; controlled fixtures only.\nBEGIN;\nSET LOCAL timezone='UTC';\nSET LOCAL statement_timeout='15s';\nDO $vectors$\nBEGIN\n IF current_user<>'postgres' OR current_setting('app.lovable_exit_target_ref',true) IS DISTINCT FROM 'ocliymtdvtxfxczxgbjr' THEN RAISE EXCEPTION 'Owned target/postgres required'; END IF;\n "+checks.join('\n ')+"\nEND\n$vectors$;\nSELECT "+checks.length+" AS actual_edge_hash_vectors;\nROLLBACK;\n";
 fs.writeFileSync(path.join(directory,'stored-alerts-hash-vectors.rollback.sql'),sql);
 console.log(JSON.stringify({prepared:true,vectors:checks.length,source:'Preserved actual Edge helper',database_actions:0,production_records:0}));
}catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}
