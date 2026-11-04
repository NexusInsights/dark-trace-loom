import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { assertCheckoutText } from './verify-checkout-text.mjs';

// Read-only audit. The optional app path permits running this proposal outside
// the repo. Committed placement would default to this file's owning package.
const appPath = process.argv[2] || process.cwd();
const appRequire = createRequire(resolve(appPath, 'package.json'));
const packagePath = appRequire.resolve('mailauth/package.json');
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const manifest = JSON.parse(await readFile(new URL('manifest.json', import.meta.url), 'utf8'));
assert.equal(packageJson.version, manifest.version, 'Pinned mailauth version changed; review compatibility adapter.');
const applicationJson = JSON.parse(await readFile(resolve(appPath,'package.json'), 'utf8'));
assert.equal(applicationJson.dependencies?.mailauth, '8.0.4', 'Dependency must remain exactly pinned.');
const sdkDir = resolve(dirname(packagePath),'dist/esm/dkim');
const upstreamVerifier = await readFile(resolve(sdkDir,'dkim-verifier.js'),'utf8');
const upstreamWrapper = await readFile(resolve(sdkDir,'verify.js'),'utf8');
for (const [file,text] of [['dkim-verifier.js',upstreamVerifier],['verify.js',upstreamWrapper]]) {
 assert.equal(createHash('sha256').update(text).digest('hex'),manifest.files[file],`Upstream source changed: ${file}`);
}
let expected = upstreamVerifier;
for (const [before,after] of Object.entries(manifest.mappings)) {
 const needle = `from '${before}'`;
 assert.equal(expected.split(needle).length-1,1,`Import guard failed: ${before}`);
 appRequire.resolve(after);
 expected=expected.replace(needle,`from '${after}'`);
}
assert.equal(expected.split(manifest.before).length-1,1,'Algorithm guard failed.');
expected=expected.replace(manifest.before,manifest.after);
assertCheckoutText(await readFile(new URL('dkim-verifier.mjs',import.meta.url),'utf8'),expected,'Vendored verifier has unreviewed edits.');
const expectedWrapper=upstreamWrapper.replace("from '../tools.js'","from 'mailauth/lib/tools'").replace("from './dkim-verifier.js'","from './dkim-verifier.mjs'");
assertCheckoutText(await readFile(new URL('verify.mjs',import.meta.url),'utf8'),expectedWrapper,'Vendored wrapper has unreviewed edits.');
assertCheckoutText(await readFile(new URL('LICENSE.txt',import.meta.url),'utf8'),await readFile(resolve(dirname(packagePath),'LICENSE.txt'),'utf8'),'MIT notice must remain identical.');
console.log('PASS: pinned mailauth8.0.4 source SHA256, exact import map, one digest-alias substitution, wrapper and MIT notice (checkout CRLF/LF equivalent).');
