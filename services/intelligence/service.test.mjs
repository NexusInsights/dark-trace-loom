import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { EventEmitter } from 'node:events';
import { createConnection } from 'node:net';
import { dispatchAction, IntelligenceError, toErrorResult, validateAction } from './service.mjs';
import { createIntelligenceWorker } from './worker.mjs';

const env = { HIBP_API_KEY: 'test-key-not-a-real-credential', IPINFO_TOKEN: 'test-token', TOR_SOCKS_PROXY: 'socks5://127.0.0.1:9050' };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
const rejectsCode = (operation, code) => assert.rejects(operation, error => error instanceof IntelligenceError && error.code === code);

test('validates all actions before any provider or browser operation', async () => {
  for (const [action, input] of [['unknown', {}], ['ipinfo', { ip: '127.0.0.1' }], ['ipinfo', { ip: '0:0:0:0:0:0:0:1' }], ['ipinfo', { ip: 'not-an-ip' }], ['breach', { email: 'bad' }], ['profile', { username: '../../login' }], ['onion', { url: 'http://localhost' }], ['onion', { url: 'http://example.onion' }]]) {
    await assert.rejects(dispatchAction(action, input, { env, fetchImpl: () => { throw new Error('must not call'); }, launchBrowser: () => { throw new Error('must not launch'); } }), IntelligenceError);
  }
  assert.equal(validateAction('profile', { username: '@example' }).username, 'example');
});

test('missing provider configuration is explicit and never calls fetch', async () => {
  await rejectsCode(dispatchAction('breach', { email: 'test@example.com' }, { env: {}, fetchImpl: () => assert.fail('unexpected provider call') }), 'CONFIGURATION_REQUIRED');
  await rejectsCode(dispatchAction('ipinfo', { ip: '8.8.8.8' }, { env: {} }), 'CONFIGURATION_REQUIRED');
});

test('HIBP normalizes actual breach fields and URL-encodes addresses', async () => {
  const result = await dispatchAction('breach', { email: 'test+tag@example.com' }, { env, fetchImpl: async (url, options) => {
    assert.ok(url.includes('test%2Btag%40example.com'));
    assert.equal(options.headers['hibp-api-key'], env.HIBP_API_KEY);
    assert.ok(options.headers['User-Agent']);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    return json([{ Name: 'SyntheticFixture', Domain: 'example.com', IsVerified: true, DataClasses: ['Email addresses'] }]);
  } });
  assert.equal(result.matched, true);
  assert.equal(result.breaches[0].name, 'SyntheticFixture');
});

test('HIBP no-match response is distinct from credential and rate errors', async () => {
  const result = await dispatchAction('breach', { email: 'test@example.com' }, { env, fetchImpl: async () => new Response(null, { status: 404 }) });
  assert.equal(result.matched, false);
  assert.deepEqual(result.breaches, []);
  for (const status of [401, 403]) await rejectsCode(dispatchAction('breach', { email: 'test@example.com' }, { env, fetchImpl: async () => json({}, status) }), 'PROVIDER_ACCESS_DENIED');
  await assert.rejects(dispatchAction('breach', { email: 'test@example.com' }, { env, fetchImpl: async () => json({}, 429, { 'retry-after': '17' }) }), error => error.code === 'RATE_LIMITED' && error.status === 429 && error.retryAfter === 17);
});

test('provider malformed JSON, wrong shape, oversized bodies and timeout fail honestly', async () => {
  const input = { email: 'test@example.com' };
  await rejectsCode(dispatchAction('breach', input, { env, fetchImpl: async () => new Response('not json') }), 'INVALID_PROVIDER_RESPONSE');
  await rejectsCode(dispatchAction('breach', input, { env, fetchImpl: async () => json({ error: true }) }), 'INVALID_PROVIDER_RESPONSE');
  await rejectsCode(dispatchAction('breach', input, { env, fetchImpl: async () => new Response('x'.repeat(1024 * 1024 + 1)) }), 'RESPONSE_TOO_LARGE');
  await rejectsCode(dispatchAction('breach', input, { env, fetchImpl: async () => { throw new DOMException('timeout', 'TimeoutError'); } }), 'TIMEOUT');
});

test('IPinfo uses a fixed provider host, explicit IP and server-only bearer token', async () => {
  const result = await dispatchAction('ipinfo', { ip: '8.8.8.8' }, { env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://ipinfo.io/8.8.8.8/json');
    assert.equal(options.headers.Authorization, `Bearer ${env.IPINFO_TOKEN}`);
    assert.ok(!url.includes(env.IPINFO_TOKEN));
    return json({ ip: '8.8.8.8', city: 'Fixture city', loc: '1,2' });
  } });
  assert.equal(result.scope, 'explicit_ip');
  assert.equal(result.city, 'Fixture city');
});

function browserFixture({ failNavigation = false } = {}) {
  const state = { closed: false, args: [], handlers: {}, jsEnabled: true, url: 'https://x.com/example' };
  const page = {
    setDefaultTimeout() {}, setDefaultNavigationTimeout() {},
    async setRequestInterception() {}, on(name, handler) { state.handlers[name] = handler; },
    async setJavaScriptEnabled(value) { state.jsEnabled = value; },
    async createCDPSession() { return { async send() {}, on(name, handler) { state.handlers[name] = handler; } }; },
    async goto(url) { state.url = url; if (failNavigation) throw new Error('navigation failed'); return { ok: () => true, status: () => 200, headers: () => ({}) }; },
    async waitForSelector(selector) { assert.equal(selector, '[data-testid="UserName"]'); },
    async evaluate(fn) { return state.jsEnabled ? { name: 'Fixture Name', bio: 'Fixture Bio', location: 'Fixture Location' } : { title: 'Fixture Onion', text: 'Controlled content', html: '<p>Controlled content</p>', truncated: false }; },
    url: () => state.url, async close() {},
  };
  const launchBrowser = async options => { state.args = options.args; return { async newPage() { return page; }, async close() { state.closed = true; } }; };
  return { state, launchBrowser };
}

test('profile field extraction preserves separate bio/location and always closes browser', async () => {
  const fixture = browserFixture();
  const result = await dispatchAction('profile', { username: 'example' }, { env, launchBrowser: fixture.launchBrowser });
  assert.equal(result.bio, 'Fixture Bio'); assert.equal(result.location, 'Fixture Location'); assert.equal(fixture.state.closed, true);
  const failing = browserFixture({ failNavigation: true });
  await rejectsCode(dispatchAction('profile', { username: 'example' }, { env, launchBrowser: failing.launchBrowser }), 'BROWSER_UNAVAILABLE');
  assert.equal(failing.state.closed, true);
});

test('onion operation requires configured SOCKS, disables scripts, blocks off-origin requests', async () => {
  const input = { url: `http://${'a'.repeat(56)}.onion/` };
  await rejectsCode(dispatchAction('onion', input, { env: {} }), 'CONFIGURATION_REQUIRED');
  const fixture = browserFixture();
  const result = await dispatchAction('onion', input, { env, launchBrowser: fixture.launchBrowser });
  assert.equal(result.via, 'configured_socks5');
  assert.ok(fixture.state.args.some(value => /^--proxy-server=socks5:\/\/127\.0\.0\.1:\d+$/.test(value)));
  assert.ok(!fixture.state.args.some(value => value.includes('direct://')));
  assert.ok(fixture.state.args.includes('--disable-features=HttpsUpgrades'));
  assert.equal(fixture.state.jsEnabled, false);
  assert.equal(fixture.state.closed, true);
  let blocked = false;
  fixture.state.handlers.request({ url: () => 'http://127.0.0.1/secret', resourceType: () => 'document', abort: async () => { blocked = true; }, continue: async () => assert.fail('unsafe request allowed') });
  assert.equal(blocked, true);
});

test('unexpected internal errors do not expose secrets or internal paths', () => {
  assert.deepEqual(toErrorResult(new Error('test-secret D:/private')), { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The intelligence operation could not be completed.' } });
});

test('real worker HTTP boundary enforces auth, input size, JSON and meaningful failure responses', async t => {
  const token = 'fixture-worker-token-only-1234567890';
  const server = createIntelligenceWorker({ token, dispatch: async (action, input) => {
    if (action === 'failure') throw new IntelligenceError('CONFIGURATION_REQUIRED', 'Fixture configuration required.', 503);
    return { action, value: input.value };
  } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/health`)).status, 401);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base}/health`, { headers })).status, 200);
  let response = await fetch(`${base}/intelligence`, { method: 'POST', headers, body: JSON.stringify({ action: 'fixture', input: { value: 3 } }) });
  assert.deepEqual(await response.json(), { ok: true, data: { action: 'fixture', value: 3 } });
  response = await fetch(`${base}/intelligence`, { method: 'POST', headers, body: '{' });
  assert.equal(response.status, 400);
  response = await fetch(`${base}/intelligence`, { method: 'POST', headers, body: 'x'.repeat(16385) });
  assert.equal(response.status, 413);
  response = await fetch(`${base}/intelligence`, { method: 'POST', headers, body: JSON.stringify({ action: 'failure', input: {} }) });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'CONFIGURATION_REQUIRED');
});

test('worker reserves its concurrency slot before reading delayed request bodies', { timeout: 8000 }, async t => {
  const token = 'fixture-delayed-body-token-1234567890123';
  let running = 0;
  let maximum = 0;
  let receivedHeaders = 0;
  let headersReady;
  let dispatchesReady;
  let releaseDispatch;
  const allHeaders = new Promise(resolve => { headersReady = resolve; });
  const twoDispatches = new Promise(resolve => { dispatchesReady = resolve; });
  const dispatchGate = new Promise(resolve => { releaseDispatch = resolve; });
  const server = createIntelligenceWorker({ token, dispatch: async () => {
    running++;
    maximum = Math.max(maximum, running);
    if (running === 2) dispatchesReady();
    try { await dispatchGate; return { fixture: true }; }
    finally { running--; }
  } });
  server.on('request', () => { if (++receivedHeaders === 6) headersReady(); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const pending = [];
  t.after(() => new Promise(resolve => {
    releaseDispatch();
    for (const entry of pending) entry.request.destroy();
    server.close(resolve); server.closeAllConnections();
  }));
  for (let index = 0; index < 6; index++) {
    let request;
    const completed = new Promise((resolve, reject) => {
      request = httpRequest({ host: '127.0.0.1', port: server.address().port, path: '/intelligence', method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, response => {
        response.resume(); response.once('end', () => resolve(response.statusCode));
      });
      request.once('error', reject);
      request.flushHeaders();
    });
    pending.push({ request, completed });
  }
  await allHeaders;
  for (const entry of pending) if (!entry.request.destroyed) entry.request.end(JSON.stringify({ action: 'fixture', input: {} }));
  await twoDispatches;
  releaseDispatch();
  const statuses = await Promise.all(pending.map(entry => entry.completed));
  assert.equal(maximum, 2);
  assert.equal(statuses.filter(status => status === 200).length, 2);
  assert.equal(statuses.filter(status => status === 429).length, 4);
});

test('worker releases admission after malformed and aborted request bodies', { timeout: 8000 }, async t => {
  const token = 'fixture-aborted-body-token-123456789012';
  let running = 0;
  let firstReady;
  let secondReady;
  let slowReady;
  let slowClosed;
  let releaseDispatch;
  const firstDispatch = new Promise(resolve => { firstReady = resolve; });
  const secondDispatch = new Promise(resolve => { secondReady = resolve; });
  const slowHeaders = new Promise(resolve => { slowReady = resolve; });
  const slowClose = new Promise(resolve => { slowClosed = resolve; });
  const gate = new Promise(resolve => { releaseDispatch = resolve; });
  const server = createIntelligenceWorker({ token, dispatch: async () => {
    running++;
    if (running === 1) firstReady();
    if (running === 2) secondReady();
    try { await gate; return { fixture: true }; }
    finally { running--; }
  } });
  server.on('request', request => {
    if (request.headers['x-fixture-id'] === 'slow-body') {
      request.once('close', slowClosed);
      slowReady();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let slow;
  t.after(() => new Promise(resolve => { releaseDispatch(); slow?.destroy(); server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const malformed = await fetch(`${base}/intelligence`, { method: 'POST', headers, body: '{' });
  assert.equal(malformed.status, 400);
  await malformed.json();
  const first = fetch(`${base}/intelligence`, { method: 'POST', headers, body: JSON.stringify({ action: 'fixture', input: {} }) });
  await firstDispatch;
  slow = httpRequest({ host: '127.0.0.1', port: server.address().port, path: '/intelligence', method: 'POST',
    headers: { ...headers, 'Transfer-Encoding': 'chunked', 'x-fixture-id': 'slow-body' } }, response => response.resume());
  const slowErrors = [];
  slow.on('error', error => { if (error.code !== 'ECONNRESET') slowErrors.push(error); });
  slow.write('{');
  await slowHeaders;
  const busy = await fetch(`${base}/intelligence`, { method: 'POST', headers, body: JSON.stringify({ action: 'fixture', input: {} }) });
  assert.equal(busy.status, 429);
  await busy.json();
  slow.destroy();
  await slowClose;
  const second = fetch(`${base}/intelligence`, { method: 'POST', headers, body: JSON.stringify({ action: 'fixture', input: {} }) });
  await secondDispatch;
  releaseDispatch();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(slowErrors, []);
});

test('browser close failure without a process cannot return a successful operation', async () => {
  const fixture = browserFixture();
  const launchBrowser = async options => {
    const browser = await fixture.launchBrowser(options);
    browser.close = async () => { throw new Error('Synthetic close failure'); };
    return browser;
  };
  await rejectsCode(dispatchAction('profile', { username: 'example' }, { env, launchBrowser }), 'BROWSER_CLEANUP_FAILED');
});

test('browser cleanup waits for the fallback child exit event', async () => {
  const fixture = browserFixture();
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  let exitObserved = false;
  child.kill = () => {
    setImmediate(() => { child.signalCode = 'SIGTERM'; exitObserved = true; child.emit('exit', null, 'SIGTERM'); });
    return true;
  };
  const launchBrowser = async options => {
    const browser = await fixture.launchBrowser(options);
    browser.close = async () => { throw new Error('Synthetic close failure'); };
    browser.process = () => child;
    return browser;
  };
  const result = await dispatchAction('profile', { username: 'example' }, { env, launchBrowser });
  assert.equal(result.name, 'Fixture Name');
  assert.equal(exitObserved, true);
  assert.equal(child.listenerCount('exit'), 0);
});

test('failed browser kill that never exits is a cleanup failure, not success', { timeout: 7000 }, async () => {
  const fixture = browserFixture();
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => false;
  // A real child owns referenced process/pipe handles. Keep an equivalent handle
  // alive while the bounded failure timer verifies that an exit never arrives.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const launchBrowser = async options => {
      const browser = await fixture.launchBrowser(options);
      browser.close = async () => { throw new Error('Synthetic close failure'); };
      browser.process = () => child;
      return browser;
    };
    await rejectsCode(dispatchAction('profile', { username: 'example' }, { env, launchBrowser }), 'BROWSER_CLEANUP_FAILED');
    assert.equal(child.listenerCount('exit'), 0);
  } finally { clearInterval(keepAlive); }
});

test('Tor uses a scoped loopback proxy, keeps destination DNS blocked, and releases its listener', async () => {
  const fixture = browserFixture();
  await dispatchAction('onion', { url: `http://${'a'.repeat(56)}.onion/` }, {
    env: { ...env, TOR_SOCKS_PROXY: 'socks5://tor.internal:9050' }, launchBrowser: fixture.launchBrowser,
  });
  const scoped = fixture.state.args.find(value => value.startsWith('--proxy-server='));
  assert.match(scoped, /^--proxy-server=socks5:\/\/127\.0\.0\.1:\d+$/);
  const rules = fixture.state.args.find(value => value.startsWith('--host-resolver-rules='));
  assert.ok(rules.includes('MAP * ~NOTFOUND'));
  assert.ok(rules.includes('EXCLUDE 127.0.0.1'));
  const endpoint = new URL(scoped.slice('--proxy-server='.length));
  await assert.rejects(new Promise((resolve, reject) => {
    const socket = createConnection({ host: endpoint.hostname, port: Number(endpoint.port) });
    socket.once('error', reject);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.setTimeout(1000, () => { socket.destroy(); reject(new Error('Scoped listener check timed out')); });
  }), error => error.code === 'ECONNREFUSED');
});

test('oversized provider Content-Length cancels the upstream stream before returning an error', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('[]')); },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Length': String(2 * 1024 * 1024) } });
  await rejectsCode(dispatchAction('breach', { email: 'fixture@example.com' }, { env, fetchImpl: async () => response }), 'RESPONSE_TOO_LARGE');
  assert.equal(cancelled, true);
});

test('known provider statuses survive an upstream body-discard failure', async () => {
  for (const status of [404, 401, 403, 429]) {
    let discardAttempted = false;
    const response = new Response(new ReadableStream({
      cancel() { discardAttempted = true; throw new Error('Synthetic body cleanup failure'); },
    }), { status, headers: { 'Retry-After': '9' } });
    const operation = dispatchAction('breach', { email: 'fixture@example.com' }, { env, fetchImpl: async () => response });
    if (status === 404) assert.equal((await operation).matched, false);
    else await assert.rejects(operation, error => error instanceof IntelligenceError && error.code === (status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ACCESS_DENIED') && (status !== 429 || error.retryAfter === 9));
    assert.equal(discardAttempted, true);
  }
});
