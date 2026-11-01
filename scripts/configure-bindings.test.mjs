import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configurePublicBindings, publicBackend, publicEnvironment } from './configure-public-bindings.mjs';
import { configureMonitorRuntime } from './configure-monitor-runtime.mjs';

const ref = 'a'.repeat(20), otherRef = 'b'.repeat(20);
const url = `https://${ref}.supabase.co`;
const key = 'sb_publishable_controlled_fixture_key_20261014';
const origin = 'https://staging.example.test';
const jwt = (role = 'anon', project = ref) => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role, ref: project, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
  'controlled_fixture_signature',
].join('.');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'insight-nexus-config-'));
  // Verify the absolute target remains this immediate temporary test directory
  // before recursive cleanup; never follow it into workspace/user data.
  t.after(() => {
    if (!fs.existsSync(directory)) return;
    const resolved = fs.realpathSync(directory), temporaryRoot = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved).toLowerCase() !== temporaryRoot.toLowerCase()
      || !path.basename(resolved).startsWith('insight-nexus-config-')) throw new Error('Refusing cleanup outside the temporary test directory.');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const write = (name, value) => {
    const filename = path.join(directory, name);
    fs.writeFileSync(filename, typeof value === 'string' ? value : JSON.stringify(value));
    return filename;
  };
  const env = write('target.env', `VITE_SUPABASE_PROJECT_ID=${ref}\nVITE_SUPABASE_URL="${url}"\nVITE_SUPABASE_PUBLISHABLE_KEY=${key}\nPRIVATE_TEST_SETTING=do-not-copy\n`);
  const pages = write('pages.jsonc', { name: 'fixture-pages', vars: { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key, RETAINED_TEST_SECRET: 'controlled-secret' }, services: [{ binding: 'OTHER_SERVICE', service: 'fixture-other' }] });
  const worker = write('worker.jsonc', {
    name: 'fixture-monitors', main: 'src/worker.js', vars: { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key, APP_ORIGIN: origin, RETAINED_TEST_SECRET: 'controlled-secret' },
    durable_objects: { bindings: [{ name: 'MONITOR_STORE', class_name: 'MonitorStore', script_name: 'fixture-monitors' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['MonitorStore'] }],
  });
  const output = path.join(directory, 'prepared.jsonc');
  const pagesOutput = path.join(directory, 'composed-pages.jsonc'), workerOutput = path.join(directory, 'composed-worker.jsonc');
  const publicArgs = ['--env-file', env, '--config', pages, '--output', output, '--expected-project-ref', ref, '--expected-config-name', 'fixture-pages'];
  const monitorArgs = ['--pages-config', pages, '--worker-config', worker, '--pages-output', pagesOutput, '--worker-output', workerOutput, '--expected-project-ref', ref, '--expected-pages-name', 'fixture-pages', '--expected-worker-name', 'fixture-monitors', '--app-origin', origin];
  return { directory, write, env, pages, worker, output, pagesOutput, workerOutput, publicArgs, monitorArgs };
}

test('public preparation writes only a fresh target output and preserves inputs/private vars', t => {
  const f = fixture(t), original = fs.readFileSync(f.pages, 'utf8'), originalEnv = fs.readFileSync(f.env, 'utf8');
  const result = configurePublicBindings(f.publicArgs);
  assert.equal(result.prepared_only, true); assert.equal(result.remote_writes, false);
  const prepared = JSON.parse(fs.readFileSync(f.output, 'utf8'));
  assert.equal(prepared.vars.SUPABASE_URL, url);
  assert.equal(prepared.vars.RETAINED_TEST_SECRET, 'controlled-secret');
  assert.equal(prepared.vars.PRIVATE_TEST_SETTING, undefined);
  assert.equal(fs.readFileSync(f.pages, 'utf8'), original);
  assert.equal(fs.readFileSync(f.env, 'utf8'), originalEnv);
  assert.equal(JSON.stringify(result).includes(key), false);
});

test('legacy public key must belong to the expected target and be unexpired', () => {
  assert.equal(publicBackend(url, jwt(), ref).keyType, 'legacy_anon');
  assert.throws(() => publicBackend(url, jwt('anon', otherRef), ref), /different project ref/);
  const expired = [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from(JSON.stringify({ role: 'anon', ref, exp: 1 })).toString('base64url'), 'fixture'].join('.');
  assert.throws(() => publicBackend(url, expired, ref), /expired/);
});

test('privileged, secret, malformed and unsigned keys are rejected', () => {
  for (const badKey of [jwt('service_role'), 'sb_secret_controlled_fixture_key', 'not-a-key', jwt().replace('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', Buffer.from('{"alg":"none"}').toString('base64url'))])
    assert.throws(() => publicBackend(url, badKey, ref));
});

test('public origins are strict and cannot silently point to another project', () => {
  for (const badUrl of [`http://${ref}.supabase.co`, `${url}/path`, `${url}?token=x`, `${url}#fragment`, `https://user:pass@${ref}.supabase.co`, `https://${otherRef}.supabase.co`, `https://${ref}.supabase.co.example.test`, `${url}:8443`])
    assert.throws(() => publicBackend(badUrl, key, ref));
});

test('declared ref mismatches and duplicate env settings fail closed', () => {
  assert.throws(() => publicEnvironment(`VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_PUBLISHABLE_KEY=${key}\nVITE_SUPABASE_PROJECT_ID=${otherRef}`, ref), /Declared project ID/);
  assert.throws(() => publicEnvironment(`VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_URL=${url}\nVITE_SUPABASE_PUBLISHABLE_KEY=${key}`, ref), /Duplicate/);
});

test('config identity mismatch creates no output', t => {
  const f = fixture(t), args = [...f.publicArgs]; args[9] = 'different-pages';
  assert.throws(() => configurePublicBindings(args), /Configuration name/);
  assert.equal(fs.existsSync(f.output), false);
});

test('output cannot overwrite input configs or an existing backup', t => {
  const f = fixture(t), original = fs.readFileSync(f.pages, 'utf8');
  const args = [...f.publicArgs]; args[5] = f.pages;
  assert.throws(() => configurePublicBindings(args), /cannot be overwritten/);
  f.write('prepared.jsonc', 'preserved backup');
  assert.throws(() => configurePublicBindings(f.publicArgs), /cannot be overwritten/);
  assert.equal(fs.readFileSync(f.output, 'utf8'), 'preserved backup');
  assert.equal(fs.readFileSync(f.pages, 'utf8'), original);
});

test('monitor composition works without triggers and preserves DO namespace, migrations and other bindings', t => {
  const f = fixture(t), beforePages = fs.readFileSync(f.pages, 'utf8'), beforeWorker = fs.readFileSync(f.worker, 'utf8');
  const result = configureMonitorRuntime(f.monitorArgs);
  const preparedPages = JSON.parse(fs.readFileSync(f.pagesOutput, 'utf8'));
  const preparedWorker = JSON.parse(fs.readFileSync(f.workerOutput, 'utf8'));
  const originalWorker = JSON.parse(beforeWorker);
  assert.equal(result.scheduler, 'durable_object_alarm'); assert.equal(result.remote_writes, false);
  assert.deepEqual(preparedWorker.durable_objects, originalWorker.durable_objects);
  assert.deepEqual(preparedWorker.migrations, originalWorker.migrations);
  assert.equal(preparedWorker.vars.RETAINED_TEST_SECRET, 'controlled-secret');
  assert.equal(preparedWorker.vars.FEED_INGRESS_BASE, `${origin}/api/marketplace-monitor`);
  assert.deepEqual(preparedPages.services, [{ binding: 'OTHER_SERVICE', service: 'fixture-other' }, { binding: 'MARKETPLACE_MONITOR', service: 'fixture-monitors' }]);
  assert.equal(fs.readFileSync(f.pages, 'utf8'), beforePages); assert.equal(fs.readFileSync(f.worker, 'utf8'), beforeWorker);
  assert.equal(JSON.stringify(result).includes(key), false);
});

test('wrong worker target is rejected before either staging file is written', t => {
  const f = fixture(t), worker = JSON.parse(fs.readFileSync(f.worker, 'utf8'));
  worker.vars.SUPABASE_URL = `https://${otherRef}.supabase.co`; f.write('worker.jsonc', worker);
  const original = fs.readFileSync(f.worker, 'utf8');
  assert.throws(() => configureMonitorRuntime(f.monitorArgs), /expected project ref/);
  assert.equal(fs.existsSync(f.workerOutput), false); assert.equal(fs.existsSync(f.pagesOutput), false);
  assert.equal(fs.readFileSync(f.worker, 'utf8'), original);
});

test('wrong app origin, cron worker or missing DO binding creates no output', t => {
  const f = fixture(t), original = JSON.parse(fs.readFileSync(f.worker, 'utf8'));
  for (const change of [worker => { worker.vars.APP_ORIGIN = 'https://other.example.test'; }, worker => { worker.triggers = { crons: ['* * * * *'] }; }, worker => { worker.durable_objects.bindings = []; }]) {
    const worker = structuredClone(original); change(worker); f.write('worker.jsonc', worker);
    assert.throws(() => configureMonitorRuntime(f.monitorArgs));
    assert.equal(fs.existsSync(f.workerOutput), false); assert.equal(fs.existsSync(f.pagesOutput), false);
  }
});

test('colliding monitor output paths fail before writing', t => {
  const f = fixture(t), args = [...f.monitorArgs]; args[7] = f.pagesOutput;
  assert.throws(() => configureMonitorRuntime(args), /distinct files/);
  assert.equal(fs.existsSync(f.pagesOutput), false);
});

test('moving staging configurations preserves resolved worker and Pages filesystem paths', t => {
  const f = fixture(t), pages = JSON.parse(fs.readFileSync(f.pages, 'utf8'));
  pages.pages_build_output_dir = './dist'; pages.$schema = './node_modules/wrangler/config-schema.json'; f.write('pages.jsonc', pages);
  const publicArgs = [...f.publicArgs]; publicArgs[5] = path.join(f.directory, 'staging', 'pages.jsonc');
  configurePublicBindings(publicArgs);
  const stagedPages = JSON.parse(fs.readFileSync(publicArgs[5], 'utf8'));
  assert.equal(path.resolve(path.dirname(publicArgs[5]), stagedPages.pages_build_output_dir), path.join(f.directory, 'dist'));
  assert.equal(path.resolve(path.dirname(publicArgs[5]), stagedPages.$schema), path.join(f.directory, 'node_modules/wrangler/config-schema.json'));
  const monitorArgs = [...f.monitorArgs];
  monitorArgs[5] = path.join(f.directory, 'monitor-staging', 'pages.jsonc'); monitorArgs[7] = path.join(f.directory, 'monitor-staging', 'worker.jsonc');
  configureMonitorRuntime(monitorArgs);
  const stagedWorker = JSON.parse(fs.readFileSync(monitorArgs[7], 'utf8'));
  assert.equal(path.resolve(path.dirname(monitorArgs[7]), stagedWorker.main), path.join(f.directory, 'src/worker.js'));
});

test('CLI requires explicit options and help does not modify files', t => {
  const f = fixture(t);
  for (const script of ['configure-public-bindings.mjs', 'configure-monitor-runtime.mjs']) {
    const filename = fileURLToPath(new URL(script, import.meta.url));
    const noArgs = spawnSync(process.execPath, [filename], { cwd: f.directory, encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.equal(noArgs.status, 1); assert.match(noArgs.stderr, /Missing required option/);
    const help = spawnSync(process.execPath, [filename, '--help'], { cwd: f.directory, encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.equal(help.status, 0); assert.match(help.stdout, /Usage:/);
  }
  assert.equal(fs.existsSync(f.output), false); assert.equal(fs.existsSync(f.workerOutput), false);
});
