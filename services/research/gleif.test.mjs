import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupLegalEntity, validateLEI } from './gleif.mjs';

const lei = '984500B4BD9ZA1B87320';
const fixture = () => ({ data: { type: 'lei-records', id: lei, attributes: { lei, entity: { legalName: { name: 'Synthetic company fixture' }, jurisdiction: 'DE', status: 'ACTIVE', legalAddress: { addressLines: ['must not be copied'] } }, registration: { status: 'ISSUED', lastUpdateDate: '2026-01-02T12:00:00Z', nextRenewalDate: '2027-01-02T12:00:00Z' } } } });
test('LEI format and MOD97 checks reject invalid inputs before network work', async () => {
  assert.equal(validateLEI(` ${lei.toLowerCase()} `), lei);
  for (const bad of ['example', lei.slice(0, -1) + '1', 'https://example.test/' + lei, { lei }]) await assert.rejects(lookupLegalEntity(bad, { fetchImpl: () => assert.fail('no fetch') }), error => error.code === 'INVALID_INPUT');
});
test('fixed public endpoint uses no app credential and returns only minimal professional business fields', async () => {
  let calls = 0;
  const result = await lookupLegalEntity(lei, { now: () => '2026-11-01T12:00:00.000Z', fetchImpl: async (url, init) => {
    calls++; assert.equal(url, `https://api.gleif.org/api/v1/lei-records/${lei}`); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'manual'); assert.deepEqual(Object.keys(init.headers), ['Accept']);
    return Response.json(fixture());
  } });
  assert.equal(calls, 1); assert.equal(result.status, 'found'); assert.equal(result.evidenceInput.entities[0].type, 'Organization');
  assert.ok(result.evidenceInput.observations.every(row => row.eventTime === null)); assert.ok(!JSON.stringify(result).includes('must not be copied')); assert.ok(!JSON.stringify(result).includes('legalAddress'));
});
test('not found is scoped to registry coverage and not a universal negative', async () => {
  const result = await lookupLegalEntity(lei, { fetchImpl: async () => new Response('', { status: 404 }) });
  assert.equal(result.status, 'no_match'); assert.match(result.coverage, /does not establish/);
});
test('rate limits preserve a retry hint with exactly one request', async () => {
  let calls = 0;
  await assert.rejects(lookupLegalEntity(lei, { fetchImpl: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '9' } }); } }), error => error.status === 429 && error.retryAfter === 9);
  assert.equal(calls, 1);
});
test('mismatched, malformed, oversized and unavailable responses are not accepted as legal entity findings', async () => {
  const wrong = fixture(); wrong.data.id = 'different';
  for (const response of [Response.json(wrong), new Response('not JSON'), new Response('x'.repeat(524289)), new Response('', { status: 503 })]) await assert.rejects(lookupLegalEntity(lei, { fetchImpl: async () => response }), error => ['INVALID_RESPONSE', 'RESPONSE_TOO_LARGE', 'PROVIDER_UNAVAILABLE'].includes(error.code));
});
test('cancelled requests establish no finding', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(lookupLegalEntity(lei, { signal: controller.signal, fetchImpl: async (url, init) => { assert.equal(init.signal.aborted, true); throw new Error('aborted'); } }), error => error.code === 'CANCELLED');
});

test('Cloudflare-compatible manual redirect mode never follows an alternate registry origin', async () => {
  let calls = 0;
  await assert.rejects(lookupLegalEntity(lei, { fetchImpl: async (url, init) => {
    calls++; assert.equal(url, `https://api.gleif.org/api/v1/lei-records/${lei}`); assert.equal(init.redirect, 'manual');
    return new Response('', { status: 302, headers: { Location: 'https://untrusted.invalid/redirect' } });
  } }), error => error.code === 'PROVIDER_UNAVAILABLE' && /redirect/.test(error.message));
  assert.equal(calls, 1);
});
