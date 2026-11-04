import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const taskDir = path.dirname(fileURLToPath(import.meta.url));
const reviewedPath = path.join(taskDir, 'reviewed-20261104/deployment-manifest.json');
const reviewed = JSON.parse(fs.readFileSync(reviewedPath, 'utf8'));
function run(name, manifestPath = reviewedPath) {
  const result = spawnSync(process.execPath, [path.join(taskDir, 'prepare-edge-deploy.mjs'), name, '--manifest', manifestPath], { encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}
function changedManifest(change, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insight-edge-manifest-test-'));
  try {
    const manifest = structuredClone(reviewed); change(manifest);
    const file = path.join(dir, 'manifest.json'); fs.writeFileSync(file, JSON.stringify(manifest)); fn(file);
  } finally {
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('insight-edge-manifest-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
test('all reviewed function payloads match canonical manifest hashes without deployment', () => {
  assert.equal(reviewed.functions.length, 20);
  assert.equal(reviewed.cloudflare_pages_routes.length, 8);
  for (const spec of reviewed.functions) {
    const result = run(spec.name); assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.project_id, 'ocliymtdvtxfxczxgbjr'); assert.equal(payload.name, spec.name);
    assert.equal(payload.files.length, spec.files.length);
    for (const file of payload.files) {
      const source = spec.files.find(row => row.path === `supabase/functions/${file.name}`); assert.ok(source);
      const bytes = Buffer.from(file.content); assert.equal(bytes.length, source.bytes);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), source.sha256);
      assert.equal(file.content.includes('\r\n'), false);
    }
  }
});
test('production source can never become prepared migration target', () => changedManifest(m => { m.destination_project_ref = 'zisrsttmjeipkmllqubi'; }, file => {
  const result = run('osint-dispatch', file); assert.equal(result.status, 1); assert.match(result.stderr, /target reference mismatch/); assert.equal(result.stdout, '');
}));
test('unknown hash encoding fails closed', () => changedManifest(m => { m.text_encoding = 'ignore-whitespace'; }, file => {
  const result = run('osint-dispatch', file); assert.equal(result.status, 1); assert.match(result.stderr, /Unknown deployment manifest format/);
}));
test('unreviewed new handler contract cannot bypass gateway authentication', () => changedManifest(m => { m.functions.find(row => row.name === 'intelligence-tools').authorization_contract_known = false; }, file => {
  const result = run('intelligence-tools', file); assert.equal(result.status, 1); assert.match(result.stderr, /authorization manifest missing/);
}));
test('source hash drift rejects transport', () => changedManifest(m => { m.functions.find(row => row.name === 'osint-dispatch').files[0].sha256 = '0'.repeat(64); }, file => {
  const result = run('osint-dispatch', file); assert.equal(result.status, 1); assert.match(result.stderr, /changed since reviewed manifest/);
}));
test('source traversal rejects transport', () => changedManifest(m => { m.functions.find(row => row.name === 'osint-dispatch').files[0].path = '../outside.ts'; }, file => {
  const result = run('osint-dispatch', file); assert.equal(result.status, 1); assert.match(result.stderr, /Unsafe source path/);
}));
test('omitted entrypoint rejects incomplete source closure', () => changedManifest(m => { const row = m.functions.find(row => row.name === 'osint-dispatch'); row.files = row.files.filter(file => file.path !== row.entrypoint); }, file => {
  const result = run('osint-dispatch', file); assert.equal(result.status, 1); assert.match(result.stderr, /Incomplete or duplicate/);
}));
test('duplicate source file rejects ambiguous source closure', () => changedManifest(m => { const row = m.functions.find(row => row.name === 'osint-dispatch'); row.files.push(row.files[0]); }, file => {
  const result = run('osint-dispatch', file); assert.equal(result.status, 1); assert.match(result.stderr, /Incomplete or duplicate/);
}));

function runtimeFixture(fn) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'insight-runtime-inventory-'));
  const app=path.join(directory,'source'), output=path.join(directory,'deployment.json');
  const put=(name,text)=>{const file=path.join(app,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
  try {
    put('supabase/config.toml','[functions.osint-tools]\nverify_jwt = false\n');
    put('supabase/functions/osint-tools/index.ts','export const handler=true;\n');
    put('supabase/functions/_shared/independentAi.ts','export const ai=false;\n');
    for(const name of ['marketplacePublic','marketplaceOpen','marketplaceConnected','marketplaceLicensed','marketplaceAlternatives','marketplaceSocialFull','marketplaceAuth','marketplaceDispatch'])put(`supabase/functions/osint-tools/${name}.ts`,'export const module=true;\n');
    put('functions/api/fixture.js','export const fixture=true;\n');
    for(const name of ['ai-worker','monitor-worker']){put(`${name}/wrangler.jsonc`,JSON.stringify({main:'src/index.js'}));put(`${name}/src/index.js`,'export default {};\n');}
    put('services/cloudflare/wrangler.jsonc',JSON.stringify({main:'src/index.js',containers:[{name:'fixture-container',class_name:'FixtureContainer',image:'./Dockerfile',image_build_context:'../..',max_instances:1,scheduling_policy:'default',instance_type:'standard-1'}],durable_objects:{bindings:[{name:'INTELLIGENCE_CONTAINER',class_name:'FixtureContainer'}]}}));
    put('services/cloudflare/src/index.js',"import { controller } from './controller.mjs'; export default controller;\n");
    put('services/cloudflare/src/controller.mjs','export const controller={};\n');
    put('services/cloudflare/container/entrypoint.mjs',"import { worker } from '../../intelligence/worker.mjs'; import { controller } from '../src/controller.mjs'; export { worker, controller };\n");
    put('services/cloudflare/container/torrc','SocksPort 127.0.0.1:9050\n');
    put('services/intelligence/worker.mjs',"import { shared } from './shared.mjs'; export const worker=shared;\n");
    put('services/intelligence/shared.mjs','export const shared=true;\n');
    put('services/cloudflare/package.json','{"dependencies":{"fixture":"1.0.0"}}\n');
    put('services/cloudflare/package-lock.json','{"lockfileVersion":3}\n');
    put('services/cloudflare/Dockerfile','FROM node:24\nWORKDIR /app\nCOPY services/cloudflare/package.json services/cloudflare/package-lock.json ./\nCOPY services/intelligence/*.mjs ./services/intelligence/\nCOPY services/cloudflare/container/ ./services/cloudflare/container/\nCOPY services/cloudflare/src/controller.mjs ./services/cloudflare/src/controller.mjs\nENTRYPOINT ["node","services/cloudflare/container/entrypoint.mjs"]\n');
    put('services/cloudflare/Dockerfile.dockerignore','**\n!services/**\n');
    function command(mode='--output'){
      const result=spawnSync(process.execPath,[path.join(taskDir,'build-deployment-manifest.mjs'),'--source-root',app,mode,output],{encoding:'utf8',timeout:15000,windowsHide:true});
      if(result.error)throw result.error;return result;
    }
    fn({app,output,put,build:()=>command(),verify:()=>command('--verify')});
  }finally{
    const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('insight-runtime-inventory-'));fs.rmSync(resolved,{recursive:true,force:true});
  }
}

test('deployment inventory retains both existing workers and complete third container runtime with paid activation gate',()=>runtimeFixture(({output,build,verify})=>{
  const result=build();assert.equal(result.status,0,result.stderr);
  const manifest=JSON.parse(fs.readFileSync(output,'utf8'));
  assert.deepEqual(manifest.workers.map(row=>row.name),['ai-worker','monitor-worker','services/cloudflare']);
  const runtime=manifest.workers[2];
  assert.equal(runtime.deployment_status,'not_deployed');assert.match(runtime.billing_gate,/Workers Paid/);assert.match(runtime.deployment_requirement,/explicit approval/);
  assert.deepEqual(runtime.binding_names,['INTELLIGENCE_CONTAINER']);
  assert.ok(runtime.files.some(row=>row.path==='services/intelligence/shared.mjs'));
  assert.ok(runtime.files.some(row=>row.path==='services/cloudflare/src/controller.mjs'));
  for(const name of ['Dockerfile','Dockerfile.dockerignore','package.json','package-lock.json','container/torrc'])assert.ok(runtime.container.build_source_files.some(row=>row.path===`services/cloudflare/${name}`));
  assert.equal(manifest.remote_actions,0);assert.equal(manifest.secret_values_copied,0);
  const before=fs.readFileSync(output);assert.equal(verify().status,0);assert.deepEqual(fs.readFileSync(output),before);
}));
test('container dependency omitted from Docker COPY is rejected before publishing manifest',()=>runtimeFixture(({app,output,put,build})=>{
  const file=path.join(app,'services/cloudflare/Dockerfile');put('services/cloudflare/Dockerfile',fs.readFileSync(file,'utf8').replace('COPY services/intelligence/*.mjs ./services/intelligence/\n',''));
  const result=build();assert.equal(result.status,1);assert.match(result.stderr,/absent from Docker COPY/);assert.equal(fs.existsSync(output),false);
}));
test('new image COPY source is inventoried and stale manifests fail freshness',()=>runtimeFixture(({output,put,build,verify})=>{
  assert.equal(build().status,0);put('services/intelligence/new-support.mjs','export const newSupport=true;\n');
  const result=verify();assert.equal(result.status,1);assert.match(result.stderr,/source inventory is stale/);
  fs.unlinkSync(output);assert.equal(build().status,0);
  assert.ok(JSON.parse(fs.readFileSync(output,'utf8')).workers[2].container.build_source_files.some(row=>row.path==='services/intelligence/new-support.mjs'));
}));
test('container lockfile changes invalidate reviewed deployment source inventory',()=>runtimeFixture(({put,build,verify})=>{
  assert.equal(build().status,0);put('services/cloudflare/package-lock.json','{"lockfileVersion":3,"changed":true}\n');
  const result=verify();assert.equal(result.status,1);assert.match(result.stderr,/source inventory is stale/);
}));
test('container runtime controller changes invalidate reviewed deployment source inventory',()=>runtimeFixture(({put,build,verify})=>{
  assert.equal(build().status,0);put('services/cloudflare/src/controller.mjs','export const controller={changed:true};\n');
  assert.match(verify().stderr,/source inventory is stale/);
}));
test('Docker COPY traversal cannot read sources outside the approved build context',()=>runtimeFixture(({app,put,output,build})=>{
  put('services/cloudflare/Dockerfile',fs.readFileSync(path.join(app,'services/cloudflare/Dockerfile'),'utf8')+'COPY ../private-data /app/private-data\n');
  const result=build();assert.equal(result.status,1);assert.match(result.stderr,/escaped build context/);assert.equal(fs.existsSync(output),false);
}));
test('unreviewed remote Docker ADD fails rather than hiding a dependency',()=>runtimeFixture(({app,put,output,build})=>{
  put('services/cloudflare/Dockerfile',fs.readFileSync(path.join(app,'services/cloudflare/Dockerfile'),'utf8')+'ADD https://example.invalid/remote /app/remote\n');
  const result=build();assert.equal(result.status,1);assert.match(result.stderr,/ADD requires explicit/);assert.equal(fs.existsSync(output),false);
}));
