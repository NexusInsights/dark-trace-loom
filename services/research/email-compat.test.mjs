import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('DKIM compatibility adapter is an exact pinned SDK copy with one reviewed digest alias', () => {
  const application = fileURLToPath(new URL('../../', import.meta.url));
  const guard = fileURLToPath(new URL('./vendor/mailauth-8.0.4/verify-upstream.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [guard, application], {
    cwd: application, encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout || 'DKIM source guard failed.');
  assert.match(result.stdout, /^PASS: pinned mailauth8\.0\.4 source SHA256/);
});
