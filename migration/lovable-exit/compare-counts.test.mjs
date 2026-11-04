import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const taskDir=path.dirname(fileURLToPath(import.meta.url));
const temporary=fs.mkdtempSync(path.join(taskDir,'.verification-'));
const bundle=path.join(taskDir,'reviewed-20261104','bundle');
const inventory=JSON.parse(fs.readFileSync(path.join(bundle,'inventory.json'),'utf8'));
const required=[...inventory.public_tables.map(t=>`public.${t}`),'auth.users','auth.identities'];
const fixtureRows=required.map(r=>`${r},0,d41d8cd98f00b204e9800998ecf8427e`);
const header='relation,row_count,id_set_digest\n';
const source=path.join(temporary,'source.csv');fs.writeFileSync(source,header+fixtureRows.join('\n')+'\n');
function run(text){const target=path.join(temporary,'target.csv');fs.writeFileSync(target,text);const result=spawnSync(process.execPath,[path.join(taskDir,'compare-counts.mjs'),source,target,'--bundle',bundle],{encoding:'utf8',timeout:15000,windowsHide:true});if(result.error)throw result.error;return result.status;}
try{
  assert.equal(run(header+fixtureRows.join('\n')+'\n'),0,'All matching required relations pass');
  assert.equal(run(header+fixtureRows.slice(1).join('\n')+'\n'),1,'Missing table rejects partial acceptance');
  assert.equal(run(header+fixtureRows.map((r,i)=>i===0?r.replace(',0,',',1,'):r).join('\n')+'\n'),1,'Changed row count is rejected');
  assert.equal(run(header+fixtureRows.map((r,i)=>i===0?r.replace('d41d8cd98f00b204e9800998ecf8427e','00000000000000000000000000000000'):r).join('\n')+'\n'),1,'Changed ID set is rejected');
  assert.equal(run(header+[...fixtureRows,fixtureRows[0]].join('\n')+'\n'),1,'Duplicate relation is rejected');
  assert.equal(run(header+[...fixtureRows,'public.extra_live_table,0,d41d8cd98f00b204e9800998ecf8427e'].join('\n')+'\n'),1,'Unmatched extra relation is rejected');
  assert.equal(run(header.replace('id_set_digest','other')+fixtureRows.join('\n')+'\n'),1,'Wrong evidence header is rejected');
  assert.equal(run(header+fixtureRows.map(r=>r.split(',').map(v=>`"${v}"`).join(',')).join('\r\n')+'\r\n'),0,'Standard quoted CSV with CRLF passes');
  assert.equal(run(header+fixtureRows.filter(row=>!row.startsWith('public.intelligence_executions,')).join('\n')+'\n'),1,'Current intelligence table cannot be omitted from counts');
  const stale=spawnSync(process.execPath,[path.join(taskDir,'compare-counts.mjs'),source,source,'--bundle',path.join(taskDir,'bundle')],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(stale.status,1,'Historical source inventory must not accept current counts');
  assert.match(stale.stderr,/current verified bundle/);
  console.log(JSON.stringify({passed:10,database_actions:0,fixture_scope:'Synthetic count-metadata contract only; no production records or app seed data created'}));
}catch(error){console.error(error instanceof Error?error.message:'Count comparison test failed');process.exitCode=1;}
finally{const relative=path.relative(taskDir,path.resolve(temporary));if(relative.startsWith('.verification-')&&!relative.includes(path.sep))fs.rmSync(temporary,{recursive:true,force:true});else throw new Error('Refused cleanup outside migration verification directory');}
