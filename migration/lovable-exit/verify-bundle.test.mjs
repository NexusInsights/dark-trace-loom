import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { preparationFiles } from './bundle-sources.mjs';

const taskDir = path.dirname(fileURLToPath(import.meta.url));
function command(script, args) {
  const result = spawnSync(process.execPath, [path.join(taskDir, script), ...args], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (result.error) throw result.error;
  return result;
}
function put(root, name, text) { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function fixture(fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'insight-bundle-test-'));
  const app = path.join(temp, 'source');
  const output = path.join(temp, 'candidate');
  try {
    put(app, 'supabase/migrations/20261104000000_fixture.sql', 'CREATE TABLE public.records (id uuid PRIMARY KEY);\n');
    put(app, 'supabase/migrations/20261104000001_fixture.sql', '-- second ordered migration\n');
    put(app, 'supabase/functions/fixture/index.ts', 'export const fixture = true;\n');
    put(app, 'supabase/config.toml', 'project_id = "fixture"\n');
    put(app, 'src/integrations/supabase/types.ts', '      records: {\n        Row: {\n          id: string\n        }\n      }\n');
    for (const name of preparationFiles) put(app, `migration/lovable-exit/${name}`, fs.readFileSync(path.join(taskDir, name)));
    const build = () => command('build-bundle.mjs', ['--source-root', app, '--output', output]);
    const verify = (...extra) => command('verify-bundle.mjs', ['--bundle', output, '--source-root', app, ...extra]);
    fn({ app, output, temp, build, verify });
  } finally {
    const resolved = path.resolve(temp);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('insight-bundle-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
function built(fn) { fixture(f => { const result = f.build(); assert.equal(result.status, 0, result.stderr); fn(f); }); }
function alterManifest(output, fn) {
  const file = path.join(output, 'manifest.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(value);
  fs.writeFileSync(file, JSON.stringify(value));
}
function rehash(output, name) {
  alterManifest(output, m => { const item = m.files.find(row => row.path === name); const bytes = fs.readFileSync(path.join(output, name)); item.bytes = bytes.length; item.sha256 = crypto.createHash('sha256').update(bytes).digest('hex'); });
}
function allFiles(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? allFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]); }

test('new snapshot verifies current sources, count coverage and no database work', () => built(({ output, verify }) => {
  const result = verify(); assert.equal(result.status, 0, result.stderr);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.source_freshness_verified, true); assert.equal(proof.database_actions, 0);
  assert.match(fs.readFileSync(path.join(output, 'row-counts-and-id-digests.sql'), 'utf8'), /public\.records/);
}));
test('type/schema drift leaves no output or staging files', () => fixture(({ app, temp, output, build }) => {
  put(app, 'supabase/migrations/20261104000002_missing.sql', 'CREATE TABLE public.missing (id uuid PRIMARY KEY);');
  const result = build(); assert.equal(result.status, 1); assert.match(result.stderr, /table names differ/);
  assert.equal(fs.existsSync(output), false); assert.deepEqual(fs.readdirSync(temp), ['source']);
}));
test('existing historical output is preserved even when source validation fails', () => fixture(({ app, output, build }) => {
  put(output, 'historic.txt', 'preserve exactly');
  put(app, 'supabase/config.toml', 'changed');
  const result = build(); assert.equal(result.status, 1); assert.match(result.stderr, /already exists and is preserved/);
  assert.equal(fs.readFileSync(path.join(output, 'historic.txt'), 'utf8'), 'preserve exactly');
  assert.deepEqual(fs.readdirSync(output), ['historic.txt']);
}));
test('staged guard validation failure leaves no published candidate', () => fixture(({ app, temp, output, build }) => {
  put(app, 'migration/lovable-exit/target-preflight.sql', '-- removed fresh target protection');
  const result = build(); assert.equal(result.status, 1); assert.match(result.stderr, /Staged bundle rejected: Fresh-target guards/);
  assert.equal(fs.existsSync(output), false); assert.deepEqual(fs.readdirSync(temp), ['source']);
}));
test('LF and CRLF sources produce identical portable snapshot bytes', () => fixture(({ app, output, temp, build }) => {
  assert.equal(build().status, 0);
  for (const file of allFiles(app)) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
  const second = path.join(temp, 'crlf-candidate');
  const result = command('build-bundle.mjs', ['--source-root', app, '--output', second]);
  assert.equal(result.status, 0, result.stderr);
  for (const file of allFiles(output)) assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(second, path.relative(output, file))));
}));
test('version2 survives Git CRLF checkout but still verifies current source', () => built(({ output, verify }) => {
  for (const file of allFiles(output)) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
  const result = verify(); assert.equal(result.status, 0, result.stderr);
}));
test('version1 remains strict about historical bytes', () => built(({ output }) => {
  const verify = () => command('verify-bundle.mjs', ['--bundle', output, '--integrity-only']);
  alterManifest(output, m => { m.format_version = 1; delete m.text_encoding; });
  assert.equal(verify().status, 0);
  const file = path.join(output, 'functions/fixture/index.ts'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('\n', '\r\n'));
  assert.match(verify().stderr, /Bundle integrity mismatch/);
}));
test('changed source handler cannot receive freshness acceptance', () => built(({ app, verify }) => {
  put(app, 'supabase/functions/fixture/index.ts', 'export const fixture = false;\n');
  const result = verify(); assert.equal(result.status, 1); assert.match(result.stderr, /Bundle source changed/);
}));
test('new source function cannot be omitted from acceptance', () => built(({ app, verify }) => {
  put(app, 'supabase/functions/new-handler/index.ts', 'export const added = true;');
  const result = verify(); assert.equal(result.status, 1); assert.match(result.stderr, /source inventory is stale/);
}));
test('new migration cannot be omitted from acceptance', () => built(({ app, verify }) => {
  put(app, 'supabase/migrations/20261104000002_added.sql', '-- newly reviewed migration');
  const result = verify(); assert.equal(result.status, 1); assert.match(result.stderr, /source inventory is stale/);
}));
test('removed source file cannot receive freshness acceptance', () => built(({ app, verify }) => {
  fs.unlinkSync(path.join(app, 'supabase/migrations/20261104000001_fixture.sql'));
  const result = verify(); assert.equal(result.status, 1); assert.match(result.stderr, /source inventory is stale/);
}));
test('historical integrity-only mode explicitly does not claim freshness', () => built(({ app, output }) => {
  put(app, 'supabase/functions/fixture/index.ts', 'changed current source');
  const result = command('verify-bundle.mjs', ['--bundle', output, '--integrity-only']);
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).source_freshness_verified, false);
}));
test('whitespace content tampering is still rejected', () => built(({ output, verify }) => {
  fs.appendFileSync(path.join(output, 'inventory.json'), ' ');
  const result = verify(); assert.equal(result.status, 1); assert.match(result.stderr, /Bundle integrity mismatch/);
}));
test('duplicate manifest entries are rejected', () => built(({ output, verify }) => {
  alterManifest(output, m => m.files.push(m.files[0])); assert.match(verify().stderr, /Unsafe or duplicate/);
}));
test('manifest traversal is rejected', () => built(({ output, verify }) => {
  alterManifest(output, m => { m.files[0].path = '../outside.sql'; }); assert.match(verify().stderr, /Unsafe or duplicate/);
}));
test('rehashed replay with removed guards is rejected', () => built(({ output, verify }) => {
  const file = path.join(output, 'schema-replay.sql'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('app.lovable_exit_target_confirmed', 'removed_guard'));
  rehash(output, 'schema-replay.sql'); assert.match(verify().stderr, /Fresh-target guards/);
}));
test('reordered migration history is rejected', () => built(({ output, verify }) => {
  alterManifest(output, m => m.migration_order.reverse()); assert.match(verify().stderr, /Migration order/);
}));
test('unlisted stale bundle file is rejected', () => built(({ output, verify }) => {
  put(output, 'unlisted.sql', 'SELECT 1;'); assert.match(verify().stderr, /Unlisted bundle file/);
}));
test('unrecognized SQL filename fails before any output', () => fixture(({ app, output, build }) => {
  put(app, 'supabase/migrations/forgotten.sql', '-- do not silently omit this');
  const result = build(); assert.equal(result.status, 1); assert.match(result.stderr, /unrecognized migration/); assert.equal(fs.existsSync(output), false);
}));

test('migration names with descriptive underscores are included, never silently omitted', () => fixture(({ app, output, build }) => {
  put(app, 'supabase/migrations/20261104000002_scope_guard.sql', '-- reviewed ownership scope migration');
  const result = build(); assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
  assert.ok(manifest.migration_order.includes('20261104000002_scope_guard.sql'));
  assert.match(fs.readFileSync(path.join(output, 'schema-replay.sql'), 'utf8'), /20261104000002_scope_guard\.sql/);
}));
