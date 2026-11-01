import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { checkPrivatePassword, matchPasswordRange, capturePrivacySnapshot, comparePrivacySnapshots } from './privacy-password.mjs';

test('password range request transmits only five digest characters, no password/full hash/account/session', async () => {
  const password = 'synthetic-only-example-password'; const hash = createHash('sha1').update(password).digest('hex').toUpperCase(); let calls = 0;
  const result = await checkPrivatePassword(password, { cryptoImpl: webcrypto, fetchImpl: async (url, init) => {
    calls++; assert.equal(url, `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    assert.equal(init.headers['Add-Padding'], 'true'); assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store'); assert.equal(init.referrerPolicy, 'no-referrer');
    assert.equal(init.body, undefined); assert.ok(!JSON.stringify([url, init.headers]).includes(password)); assert.ok(!url.includes(hash));
    return new Response(`${hash.slice(5)}:12\r\n${'A'.repeat(35)}:0\r\n`);
  } });
  assert.equal(calls, 1); assert.equal(result.status, 'found'); assert.equal(result.exposureCount, 12); assert.ok(!JSON.stringify(result).includes(password)); assert.ok(!JSON.stringify(result).includes(hash));
});
test('padding zero counts are ignored; a valid missing suffix is a bounded negative finding', async () => {
  assert.equal(matchPasswordRange(`${'A'.repeat(35)}:0\r\n`, 'A'.repeat(35)), 0);
  const result = await checkPrivatePassword('synthetic', { cryptoImpl: webcrypto, fetchImpl: async () => new Response(`${'A'.repeat(35)}:0\n`) });
  assert.equal(result.status, 'not_found'); assert.match(result.limitation, /not a guarantee/);
});
test('empty, malformed and inconsistent ranges fail instead of reporting no exposure', () => {
  for (const text of ['', 'garbage', `${'A'.repeat(35)}:-1`, `${'A'.repeat(35)}:1\n${'A'.repeat(35)}:2`]) assert.throws(() => matchPasswordRange(text, 'B'.repeat(35)), error => error.code === 'INVALID_RESPONSE');
});
test('rate limit is distinct and never automatically retried', async () => {
  let calls = 0;
  await assert.rejects(checkPrivatePassword('synthetic', { cryptoImpl: webcrypto, fetchImpl: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '5' } }); } }), error => error.code === 'RATE_LIMITED' && error.retryAfter === 5);
  assert.equal(calls, 1);
});
test('provider failure, cancellation and deadline never become a negative finding', async () => {
  await assert.rejects(checkPrivatePassword('synthetic', { cryptoImpl: webcrypto, fetchImpl: async () => new Response('', { status: 503 }) }), error => error.code === 'PROVIDER_UNAVAILABLE');
  const abort = new AbortController(); abort.abort(); let fetched = false;
  await assert.rejects(checkPrivatePassword('synthetic', { cryptoImpl: webcrypto, signal: abort.signal, fetchImpl: async () => { fetched = true; } }), error => error.code === 'CANCELLED'); assert.equal(fetched, false);
  await assert.rejects(checkPrivatePassword('synthetic', { cryptoImpl: webcrypto, timeoutMs: 10, fetchImpl: async (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true })) }), error => error.code === 'TIMEOUT');
});
test('invalid input and missing secure crypto do no network work', async () => {
  for (const value of ['', 'x'.repeat(4097), null]) await assert.rejects(checkPrivatePassword(value, { fetchImpl: () => assert.fail('must not fetch') }), error => error.code === 'INVALID_INPUT');
  await assert.rejects(checkPrivatePassword('synthetic', { cryptoImpl: {}, fetchImpl: () => assert.fail('must not fetch') }), error => error.code === 'UNSUPPORTED');
});
test('an oversized range is rejected', async () => {
  await assert.rejects(checkPrivatePassword('synthetic', { cryptoImpl: webcrypto, fetchImpl: async () => new Response('x'.repeat(1024 * 1024 + 1)) }), error => error.code === 'RESPONSE_TOO_LARGE');
});

function browserScope() {
  let valueReads = 0;
  const storage = { length: 2, getItem: () => { valueReads++; throw new Error('not allowed'); } };
  return { scope: {
    navigator: { language: 'en-US', languages: ['en-US'], cookieEnabled: true, permissions: { query: async ({ name }) => { if (name === 'camera') throw new Error('unsupported'); return { state: 'prompt' }; } }, storage: { persisted: async () => false } },
    document: { cookie: 'session=secret; preference=private' }, location: { origin: 'https://example.test' },
    localStorage: storage, sessionStorage: storage, innerWidth: 1000, innerHeight: 800, devicePixelRatio: 1,
    performance: { getEntriesByType: () => [{ name: 'https://example.test/app.js?token=PRIVATE' }, { name: 'https://other.test/path/user@example.test?key=SECRET' }] },
  }, readCount: () => valueReads };
}
test('privacy lab queries permission states without requesting access; storage/resource output excludes secrets', async () => {
  const { scope, readCount } = browserScope(); let captures = 0;
  const result = await capturePrivacySnapshot({ scope, fingerprintCapture: async () => { captures++; return { visitorId: 'a'.repeat(32), version: 'test', confidence: { score: 0.6 } }; } });
  assert.equal(captures, 1); assert.equal(result.permissions.camera, 'unsupported'); assert.equal(result.permissions.geolocation, 'prompt'); assert.equal(readCount(), 0);
  assert.equal(result.storage.readableCookieCount, 2); assert.equal(result.storage.httpOnlyCookies, 'not_observable');
  for (const value of ['secret', 'private', 'PRIVATE', 'SECRET', 'user@example.test', '/path/']) assert.ok(!JSON.stringify(result).includes(value));
  assert.deepEqual(result.resources.map(x => x.origin), ['https://example.test', 'https://other.test']);
});
test('privacy capture handles unavailable browser APIs honestly', async () => {
  const { scope } = browserScope(); scope.navigator.permissions = undefined; Object.defineProperty(scope, 'localStorage', { get() { throw new Error('denied'); } });
  const result = await capturePrivacySnapshot({ scope }); assert.equal(result.permissions.camera, 'unsupported'); assert.equal(result.storage.localStorage.status, 'unavailable'); assert.equal(result.fingerprint.status, 'not_requested');
});
test('controlled real viewport changes are detected while capture time and resource counts are ignored', async () => {
  const { scope } = browserScope(); const before = await capturePrivacySnapshot({ scope });
  const unchanged = structuredClone(before); unchanged.capturedAt = '2030-01-01T00:00:00Z'; unchanged.resources[0].observedCount++;
  assert.equal(comparePrivacySnapshots(before, unchanged).changed, false);
  scope.innerWidth = 390; const after = await capturePrivacySnapshot({ scope }); const diff = comparePrivacySnapshots(before, after);
  assert.equal(diff.changed, true); assert.ok(diff.changes.some(x => x.signal === 'signals.viewportWidth' && x.after === 390));
  assert.throws(() => comparePrivacySnapshots(before, { ...after, origin: 'https://different.test' }));
});
