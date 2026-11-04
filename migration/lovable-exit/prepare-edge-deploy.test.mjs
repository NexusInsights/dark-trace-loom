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
