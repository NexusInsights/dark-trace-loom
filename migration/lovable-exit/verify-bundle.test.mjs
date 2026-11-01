import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const taskDir=path.dirname(fileURLToPath(import.meta.url));
const original=path.join(taskDir,'bundle');
const temporary=fs.mkdtempSync(path.join(taskDir,'.verification-'));
const verifier=path.join(taskDir,'verify-bundle.mjs');
function run(dir){const r=spawnSync(process.execPath,[verifier,'--bundle',dir],{encoding:'utf8',timeout:15000,windowsHide:true});if(r.error)throw r.error;return r;}
function clone(name){const dir=path.join(temporary,name);fs.cpSync(original,dir,{recursive:true,errorOnExist:true});return dir;}
function manifest(dir,change){const file=path.join(dir,'manifest.json');const value=JSON.parse(fs.readFileSync(file,'utf8'));change(value);fs.writeFileSync(file,JSON.stringify(value));}
try{
  assert.equal(run(original).status,0,'Intact bundle must pass');
  const changed=clone('changed');fs.appendFileSync(path.join(changed,'inventory.json'),' ');
  assert.equal(run(changed).status,1,'Changed bytes must fail');
  const duplicated=clone('duplicate');manifest(duplicated,m=>m.files.push(m.files[0]));
  assert.equal(run(duplicated).status,1,'Duplicate manifest entry must fail');
  const escaped=clone('escaped');manifest(escaped,m=>m.files[0].path='../outside.sql');
  assert.equal(run(escaped).status,1,'Path traversal must fail');
  const unguarded=clone('unguarded');const file=path.join(unguarded,'schema-replay.sql');
  const bytes=Buffer.from(fs.readFileSync(file,'utf8').replaceAll('app.lovable_exit_target_confirmed','removed_confirmation_guard'));
  fs.writeFileSync(file,bytes);manifest(unguarded,m=>{const e=m.files.find(x=>x.path==='schema-replay.sql');e.bytes=bytes.length;e.sha256=crypto.createHash('sha256').update(bytes).digest('hex');});
  assert.equal(run(unguarded).status,1,'Rehashed replay without target guard must fail');
  const reordered=clone('reordered');manifest(reordered,m=>m.migration_order.reverse());
  assert.equal(run(reordered).status,1,'Reordered history must fail');
  const unlisted=clone('unlisted');fs.writeFileSync(path.join(unlisted,'unlisted.sql'),'SELECT 1;');
  assert.equal(run(unlisted).status,1,'Unlisted stale files must fail');
  console.log(JSON.stringify({passed:7,database_actions:0,meaning:'Bundle integrity, ordering and guards only; these local tests do not verify SQL execution or production record migration'}));
}catch(error){console.error(error instanceof Error?error.message:'Bundle test failed');process.exitCode=1;}
finally{const relative=path.relative(taskDir,path.resolve(temporary));if(relative.startsWith('.verification-')&&!relative.includes(path.sep))fs.rmSync(temporary,{recursive:true,force:true});else throw new Error('Refused cleanup outside migration verification directory');}
