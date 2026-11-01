import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailResearchHandler, onRequestPost } from '../../functions/api/research-email.js';
import { EmailAuthError } from './email-auth.mjs';

const message = Buffer.concat([Buffer.from('From: sender@example.com\r\nTo: private-recipient@example.net\r\nSubject: private-fixture-subject\r\n\r\n'),Buffer.from([0,255,13,10])]);
const USER = '11111111-1111-4111-8111-111111111111', EXECUTION = '22222222-2222-4222-8222-222222222222';
const environment = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_isolated_fixture' };
const input = (body = message, extra = {}) => new Request('https://app.example/api/research-email', { method: 'POST', headers: { Authorization: 'Bearer fixture-session', 'Content-Type': 'message/rfc822', 'X-Email-Processing-Consent': 'true', ...extra }, body });
function accountFixture({ auth, admission = { allowed: true, id: EXECUTION }, settlement = { ok: true } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const target = String(url); calls.push({ url: target, body: init.body ? JSON.parse(init.body) : null });
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-session');
    assert.equal(init.redirect, 'manual');
    if (target === 'https://project.supabase.co/auth/v1/user') return auth || Response.json({ id: USER, role: 'authenticated' });
    if (target.endsWith('/reserve_intelligence_execution')) return Response.json(admission);
    assert.equal(target, 'https://project.supabase.co/rest/v1/rpc/finish_intelligence_execution');
    return Response.json(settlement);
  };
  return { calls, fetchImpl };
}
const rpcBodies = fixture => fixture.calls.filter(call => call.body).map(call => call.body);
function assertPrivateInputExcluded(fixture) {
  for (const body of rpcBodies(fixture)) {
    assert.deepEqual(Object.keys(body).sort(), 'p_action' in body ? ['p_action'] : ['p_execution_id', 'p_success']);
    if ('p_action' in body) assert.equal(body.p_action, 'research-email');
    else { assert.equal(body.p_execution_id, EXECUTION); assert.equal(typeof body.p_success, 'boolean'); }
  }
  assert.doesNotMatch(JSON.stringify(rpcBodies(fixture)), /sender@|recipient@|private-fixture|domainkey|DKIM-Signature|bodyHash/);
}
test('email admission authenticates and enforces same-origin before body, reservation, SDK or DNS', async () => {
  for (const scenario of [{ missingToken: true }, { origin: true }, { auth: new Response('{}', { status: 401 }) }, { auth: Response.json({ id: USER, is_anonymous: true }) }]) {
    const account = accountFixture(scenario); let checked = 0;
    const handler = createEmailResearchHandler({ fetchImpl: account.fetchImpl, verify: async () => { checked++; } });
    const request = input(); if (scenario.missingToken) request.headers.delete('authorization'); if (scenario.origin) request.headers.set('origin', 'https://other.example');
    const response = await handler({ request, env: environment });
    assert.ok([401, 403].includes(response.status)); assert.equal(request.bodyUsed, false); assert.equal(checked, 0); assert.deepEqual(rpcBodies(account), []);
  }
});
test('invalid consent, content type and oversized raw input consume zero reservations', async () => {
  for (const scenario of [{ headers: { 'X-Email-Processing-Consent': 'false' }, status: 400 }, { headers: { 'Content-Type': 'application/json' }, status: 415 }, { body: new Uint8Array(262145), status: 413 }, { body: new Uint8Array(), status: 400 }]) {
    const account = accountFixture(); let checked = 0;
    const handler = createEmailResearchHandler({ fetchImpl: account.fetchImpl, verify: async () => { checked++; } });
    const response = await handler({ request: input(scenario.body, scenario.headers), env: environment });
    assert.equal(response.status, scenario.status); assert.equal(checked, 0); assert.equal(account.calls.length, 1); assert.deepEqual(rpcBodies(account), []);
  }
});
test('quota and administrator denials run zero SDK or DNS work and preserve retry metadata', async () => {
  for (const code of ['DAILY_LIMIT', 'FORBIDDEN']) {
    const account = accountFixture({ admission: { allowed: false, code, retryAfter: 60 } }); let checked = 0;
    const handler = createEmailResearchHandler({ fetchImpl: account.fetchImpl, verify: async () => { checked++; throw new Error('SDK and DNS must not start.'); } });
    const response = await handler({ request: input(), env: environment });
    assert.equal(response.status, code === 'DAILY_LIMIT' ? 429 : 403); assert.equal((await response.json()).error.code, code); assert.equal(response.headers.get('retry-after'), '60');
    assert.equal(checked, 0); assert.equal(account.calls.length, 2); assert.deepEqual(rpcBodies(account), [{ p_action: 'research-email' }]); assertPrivateInputExcluded(account);
  }
});
test('successful verification preserves original bytes and settles exactly once with metadata only', async () => {
  const account = accountFixture(); let checked = 0;
  const handler = createEmailResearchHandler({ fetchImpl: account.fetchImpl, verify: async (bytes, { signal }) => {
    assert.deepEqual(Buffer.from(bytes), message); assert.equal(signal.aborted, false); checked++; return { status: 'unsigned' };
  } });
  const response = await handler({ request: input(), env: environment });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(checked, 1);
  assert.deepEqual(rpcBodies(account), [{ p_action: 'research-email' }, { p_execution_id: EXECUTION, p_success: true }]); assertPrivateInputExcluded(account);
});
test('verification failure releases exactly once and accounting failures never return a successful result', async () => {
  for (const scenario of [{ taskFails: true, settlement: { ok: true }, code: 'VERIFICATION_UNAVAILABLE', status: 502 }, { taskFails: false, settlement: { ok: false }, code: 'ACCOUNTING_FAILED', status: 503 }, { taskFails: true, settlement: { ok: false }, code: 'ACCOUNTING_RELEASE_FAILED', status: 503 }]) {
    const account = accountFixture(scenario); let checked = 0;
    const handler = createEmailResearchHandler({ fetchImpl: account.fetchImpl, verify: async () => { checked++; if (scenario.taskFails) throw new EmailAuthError('VERIFICATION_UNAVAILABLE', 'No authentication conclusion is available.', 502); return { status: 'unsigned' }; } });
    const response = await handler({ request: input(), env: environment }); const body = await response.json();
    assert.equal(response.status, scenario.status); assert.equal(body.error.code, scenario.code); assert.equal(body.ok, false); assert.equal(body.data, undefined); assert.equal(checked, 1);
    assert.deepEqual(rpcBodies(account), [{ p_action: 'research-email' }, { p_execution_id: EXECUTION, p_success: !scenario.taskFails }]); assertPrivateInputExcluded(account);
    if (scenario.code === 'ACCOUNTING_FAILED') assert.equal(body.error.operationCompleted, true);
  }
});
test('production handler uses strict Supabase auth, reservation and settlement with the default SDK core', async () => {
  const original = globalThis.fetch, account = accountFixture(); globalThis.fetch = account.fetchImpl;
  try {
    const response = await onRequestPost({ request: input(), env: environment }); const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.data.status, 'unsigned'); assert.equal(account.calls.length, 3);
    assert.deepEqual(rpcBodies(account), [{ p_action: 'research-email' }, { p_execution_id: EXECUTION, p_success: true }]); assertPrivateInputExcluded(account);
  } finally { globalThis.fetch = original; }
});
test('cancelled upload consumes no reservation even when stream cancellation stalls', async () => {
  const account = accountFixture(), controller = new AbortController(); let began;
  const ready = new Promise(resolve => { began = resolve; });
  const stream = new ReadableStream({ pull() { began(); }, cancel() { return new Promise(() => {}); } });
  const sample = input();
  const request = { url: sample.url, method: 'POST', headers: sample.headers, signal: controller.signal, body: stream };
  const handler = createEmailResearchHandler({ fetchImpl: account.fetchImpl, verify: async () => { throw new Error('Must not start SDK.'); } });
  const pending = handler({ request, env: environment }); await ready; controller.abort();
  const response = await pending; assert.equal(response.status, 408); assert.equal((await response.json()).error.code, 'RESEARCH_CANCELLED');
  assert.deepEqual(rpcBodies(account), []);
});
test('request cancellation aborts the SDK task signal and releases its reservation once', async () => {
  const account = accountFixture(), controller = new AbortController(); let started, taskSignal;
  const ready = new Promise(resolve => { started = resolve; });
  const handler = createEmailResearchHandler({ fetchImpl: account.fetchImpl, verify: async (_bytes, { signal }) => {
    taskSignal = signal; started(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private fixture cancellation')), { once: true }));
  } });
  const request = new Request(input(), { signal: controller.signal });
  const pending = handler({ request, env: environment }); await ready; controller.abort();
  const response = await pending; const body = await response.json();
  assert.equal(response.status, 408); assert.equal(body.error.code, 'RESEARCH_CANCELLED'); assert.equal(taskSignal.aborted, true);
  assert.deepEqual(rpcBodies(account), [{ p_action: 'research-email' }, { p_execution_id: EXECUTION, p_success: false }]); assertPrivateInputExcluded(account);
  assert.doesNotMatch(JSON.stringify(body), /private fixture/);
});
