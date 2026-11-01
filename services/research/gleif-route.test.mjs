import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistryResearchHandler, onRequest } from '../../functions/api/research-gleif.js';

const USER = '11111111-1111-4111-8111-111111111111', EXECUTION = '22222222-2222-4222-8222-222222222222', lei = '984500B4BD9ZA1B87320';
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' };
const input = (body = { lei }, headers = {}) => new Request('https://app.example/api/research-gleif', { method: 'POST', headers: { Authorization: 'Bearer fixture-session', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
function fixture({ auth, admission = { allowed: true, id: EXECUTION }, settlement = { ok: true }, providerStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    assert.equal(init.redirect, 'manual');
    const target = String(url), body = init.body ? JSON.parse(init.body) : null; calls.push({ target, body });
    if (target.startsWith('https://api.gleif.org/')) {
      assert.equal(target, `https://api.gleif.org/api/v1/lei-records/${lei}`); assert.equal(new Headers(init.headers).has('authorization'), false);
      return Response.json({ data: { type: 'lei-records', id: lei, attributes: { lei, entity: { legalName: { name: 'Synthetic organization fixture' }, jurisdiction: 'DE', status: 'ACTIVE', legalAddress: { addressLines: ['excluded-private-field'] } }, registration: { status: 'ISSUED' } } } }, { status: providerStatus });
    }
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-session');
    if (target.endsWith('/auth/v1/user')) return auth || Response.json({ id: USER, role: 'authenticated' });
    if (target.endsWith('/reserve_intelligence_execution')) return Response.json(admission);
    assert.ok(target.endsWith('/finish_intelligence_execution')); return Response.json(settlement);
  };
  return { calls, handler: createRegistryResearchHandler({ fetchImpl }) };
}
const rpc = f => f.calls.filter(call => call.body).map(call => call.body);
test('registry route authenticates and checks same-origin before input, quota or external access', async () => {
  for (const scenario of [{ missing: true }, { origin: true }, { auth: new Response('{}', { status: 401 }) }, { auth: Response.json({ id: USER, is_anonymous: true }) }]) {
    const f = fixture(scenario), request = input(); if (scenario.missing) request.headers.delete('authorization'); if (scenario.origin) request.headers.set('origin', 'https://other.example');
    const response = await f.handler({ request, env }); assert.ok([401,403].includes(response.status)); assert.equal(request.bodyUsed, false); assert.deepEqual(rpc(f), []); assert.ok(f.calls.every(call => !call.target.startsWith('https://api.gleif.org/')));
  }
});
test('invalid identifier, extra fields or oversized body reserve nothing', async () => {
  for (const body of [{ lei: 'invalid' }, { lei, person: 'private-input' }, { lei, extra: 'x'.repeat(2049) }]) {
    const f = fixture(), response = await f.handler({ request: input(body), env }); assert.ok([400,413].includes(response.status)); assert.deepEqual(rpc(f), []); assert.equal(f.calls.length, 1);
  }
});
test('quota denial prevents the external lookup and preserves retry metadata', async () => {
  const f = fixture({ admission: { allowed: false, code: 'DAILY_LIMIT', retryAfter: 60 } });
  const response = await f.handler({ request: input(), env }); assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '60'); assert.equal(f.calls.length, 2); assert.deepEqual(rpc(f), [{ p_action: 'research-gleif' }]);
});
test('registry success settles once and journals no identifier, lookup result or provider fields', async () => {
  const f = fixture(), response = await f.handler({ request: input(), env }), body = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(body.data.status, 'found');
  assert.doesNotMatch(JSON.stringify(body), /excluded-private-field|legalAddress/);
  assert.deepEqual(rpc(f), [{ p_action: 'research-gleif' }, { p_execution_id: EXECUTION, p_success: true }]);
  assert.doesNotMatch(JSON.stringify(rpc(f)), /984500|Synthetic|jurisdiction/);
});
test('provider failure releases once; settlement failure cannot be reported as success', async () => {
  for (const scenario of [{ providerStatus: 503 }, { settlement: { ok: false } }]) {
    const f = fixture(scenario), response = await f.handler({ request: input(), env }), body = await response.json();
    assert.ok(response.status >= 500); assert.equal(body.ok, false); assert.equal(body.data, undefined);
    assert.deepEqual(rpc(f), [{ p_action: 'research-gleif' }, { p_execution_id: EXECUTION, p_success: !scenario.providerStatus }]);
  }
});
test('unsupported methods fail before any session or provider request', async () => {
  const response = await onRequest({ request: new Request('https://app.example/api/research-gleif'), env }); assert.equal(response.status,405); assert.equal(response.headers.get('allow'),'POST');
});
