import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const application = fileURLToPath(new URL('../../', import.meta.url));
const vendor = new URL('./vendor/mailauth-8.0.4/', import.meta.url);
const fixtureFiles = ['verify-upstream.mjs', 'verify-checkout-text.mjs', 'manifest.json', 'dkim-verifier.mjs', 'verify.mjs', 'LICENSE.txt'];

function runGuard(guard) {
  const result = spawnSync(process.execPath, [guard, application], {
    cwd: application, encoding: 'utf8', timeout: 10_000, maxBuffer: 256 * 1024,
    windowsHide: true,
  });
  assert.ifError(result.error);
  return result;
}

async function fixtureGuard(t, transform) {
  const fixture = await mkdtemp(join(tmpdir(), 'insight-dkim-guard-'));
  t.after(async () => {
    // Cleanup is restricted to this test's uniquely created direct child.
    assert.equal(dirname(resolve(fixture)), resolve(tmpdir()));
    assert.ok(basename(fixture).startsWith('insight-dkim-guard-'));
    await rm(fixture, { recursive: true, force: true });
  });
  const files = Object.fromEntries(await Promise.all(fixtureFiles.map(async name => [name, (await readFile(new URL(name, vendor), 'utf8')).replace(/\r\n/g, '\n')])));
  transform(files);
  await Promise.all(Object.entries(files).map(([name, content]) => writeFile(join(fixture, name), content)));
  return runGuard(join(fixture, 'verify-upstream.mjs'));
}

test('DKIM compatibility adapter preserves pinned SDK content with one reviewed digest alias', () => {
  const guard = fileURLToPath(new URL('./vendor/mailauth-8.0.4/verify-upstream.mjs', import.meta.url));
  const result = runGuard(guard);
  assert.equal(result.status, 0, result.stderr || result.stdout || 'DKIM source guard failed.');
  assert.match(result.stdout, /^PASS: pinned mailauth8\.0\.4 source SHA256/);
});

for (const newline of ['\n', '\r\n']) {
  test(`complete DKIM guard accepts ${newline === '\n' ? 'LF' : 'CRLF'} repository checkouts`, async t => {
    const result = await fixtureGuard(t, files => {
      for (const name of Object.keys(files)) files[name] = files[name].replace(/\n/g, newline);
    });
    assert.equal(result.status, 0, result.stderr);
  });
}

const rejectedChanges = [
  ['unreviewed digest algorithm', files => {
    const manifest = JSON.parse(files['manifest.json']);
    files['dkim-verifier.mjs'] = files['dkim-verifier.mjs'].replace(manifest.after, 'null');
  }, /Vendored verifier has unreviewed edits/],
  ['changed verifier import', files => {
    files['dkim-verifier.mjs'] = files['dkim-verifier.mjs'].replace("from 'mailauth/lib/tools'", "from 'mailauth/lib/trim'");
  }, /Vendored verifier has unreviewed edits/],
  ['changed wrapper import', files => {
    files['verify.mjs'] = files['verify.mjs'].replace("from './dkim-verifier.mjs'", "from './unreviewed.mjs'");
  }, /Vendored wrapper has unreviewed edits/],
  ['missing license text', files => { files['LICENSE.txt'] = 'MIT\n'; }, /MIT notice must remain identical/],
  ['extra source whitespace', files => { files['dkim-verifier.mjs'] += ' '; }, /Vendored verifier has unreviewed edits/],
  ['bare carriage returns', files => { files['dkim-verifier.mjs'] = files['dkim-verifier.mjs'].replace('\n', '\r'); }, /Vendored verifier has unreviewed edits/],
  ['wrong raw upstream hash', files => {
    const manifest = JSON.parse(files['manifest.json']); manifest.files['dkim-verifier.js'] = '0'.repeat(64);
    files['manifest.json'] = JSON.stringify(manifest);
  }, /Upstream source changed: dkim-verifier.js/],
  ['changed pinned version', files => {
    const manifest = JSON.parse(files['manifest.json']); manifest.version = '8.0.5';
    files['manifest.json'] = JSON.stringify(manifest);
  }, /Pinned mailauth version changed/],
];
for (const [label, mutate, expectedError] of rejectedChanges) {
  test(`complete DKIM guard rejects ${label}`, async t => {
    const result = await fixtureGuard(t, mutate);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, expectedError);
  });
}
