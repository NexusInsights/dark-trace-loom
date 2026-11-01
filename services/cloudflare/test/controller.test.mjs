import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { CONTAINER_NAME, INACTIVITY_TIMEOUT_MS, createContainerController, handleGatewayRequest, readAction } from '../src/controller.mjs';

const token = 'synthetic-worker-token-only-123456789012345';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const request = (path, payload, authorization = headers.Authorization) => new Request(`https://fixture.invalid${path}`, {
  method: payload === undefined ? 'GET' : 'POST', headers: { ...headers, Authorization: authorization },
  ...(payload === undefined ? {} : { body: typeof payload === 'string' ? payload : JSON.stringify(payload) }),
});
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } });
const ready = () => json({ ok: true, data: { status: 'ready', torBootstrap: 100, browserVerified: true } });

test('authentication, health, bad routes, and HTTP-provider inputs never acquire a paid container', async () => {
  let acquired = 0;
  const env = { INTELLIGENCE_WORKER_TOKEN: token, INTELLIGENCE_CONTAINER: { getByName() { acquired++; assert.fail('Container must not be acquired'); } } };
  assert.equal((await handleGatewayRequest(request('/ready', undefined, 'Bearer incorrect'), env)).status, 401);
  assert.equal((await handleGatewayRequest(request('/health'), env)).status, 200);
  assert.equal((await handleGatewayRequest(request('/missing'), env)).status, 404);
  assert.equal((await handleGatewayRequest(request('/intelligence', '{'), env)).status, 400);
  assert.equal((await handleGatewayRequest(request('/intelligence', { action: 'ipinfo', input: { ip: '8.8.8.8' } }), env)).status, 400);
  assert.equal((await handleGatewayRequest(request('/intelligence', { action: 'profile', input: { username: '../login' } }), env)).status, 400);
  assert.equal((await handleGatewayRequest(request('/intelligence', 'x'.repeat(16385)), env)).status, 413);
  assert.equal(acquired, 0);
});

test('the gateway addresses only its fixed Durable Object and preserves normalized browser input', async () => {
  const names = []; const calls = [];
  const env = { INTELLIGENCE_WORKER_TOKEN: token, INTELLIGENCE_CONTAINER: { getByName(name) {
    names.push(name); return { async fetch(value) { calls.push(await value.json()); return json({ ok: true }); } };
  } } };
  for (const username of ['@example', 'second_user']) {
    assert.equal((await handleGatewayRequest(request('/intelligence', { action: 'profile', input: { username, ignored: 'discard' }, instance: 'untrusted-instance' }), env)).status, 200);
  }
  assert.deepEqual(names, [CONTAINER_NAME, CONTAINER_NAME]);
  assert.deepEqual(calls, [{ action: 'profile', input: { username: 'example' } }, { action: 'profile', input: { username: 'second_user' } }]);
});

test('a stalled request body has a bounded deadline and is cancelled', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const input = new Request('https://fixture.invalid/intelligence', { method: 'POST', headers, body: stream, duplex: 'half' });
  await assert.rejects(readAction(input, { timeoutMs: 10 }), error => error.code === 'REQUEST_TIMEOUT');
  assert.equal(cancelled, true);
});

function containerFixture() {
  const state = { starts: [], inactivity: [], calls: [], readiness: 'starting', operations: 0 };
  const container = { running: false, images: { base: 'registry.cloudflare.com/fixture/image@sha256:fixture' },
    start(options) { state.starts.push(options); this.running = true; },
    async setInactivityTimeout(value) { state.inactivity.push(value); },
    monitor() { return new Promise(() => {}); },
    getTcpPort(port) { assert.equal(port, 43410); return { async fetch(value) {
      state.calls.push(value);
      if (typeof value === 'string') {
        if (state.readiness === 'starting') throw new Error('Port is not yet listening; private path');
        if (state.readiness === 'tor_booting') return json({ ok: true, data: { status: 'ready', torBootstrap: 70, browserVerified: true } });
        if (state.readiness === 'failed') return json({ secret: 'must not be forwarded' }, 500);
        return ready();
      }
      state.operations++; state.payload = await value.json();
      return json({ ok: true, data: { fixture: state.payload } }, state.operationStatus || 200,
        state.operationStatus === 429 ? { 'Retry-After': '7' } : {});
    } }; },
  };
  return { container, state };
}

test('cold starts return retryable 202 without dispatching and do not copy provider secrets', async () => {
  const fixture = containerFixture();
  const env = { INTELLIGENCE_WORKER_TOKEN: token, HIBP_API_KEY: 'synthetic-unused-provider-key', IPINFO_TOKEN: 'synthetic-unused-token' };
  const controller = createContainerController({ container: fixture.container, env });
  for (let index = 0; index < 2; index++) {
    const response = await controller.fetch(request('/intelligence', { action: 'profile', input: { username: 'example' } }));
    assert.equal(response.status, 202); assert.equal(response.headers.get('retry-after'), '5');
    assert.equal((await response.json()).error.code, 'WORKER_STARTING');
  }
  assert.equal(fixture.state.starts.length, 1);
  assert.equal(fixture.state.operations, 0);
  assert.equal(fixture.state.inactivity[0], INACTIVITY_TIMEOUT_MS);
  assert.deepEqual(Object.keys(fixture.state.starts[0].env).sort(), ['INTELLIGENCE_WORKER_HOST', 'INTELLIGENCE_WORKER_PORT',
    'INTELLIGENCE_WORKER_TOKEN', 'PUPPETEER_EXECUTABLE_PATH', 'TOR_SOCKS_PROXY'].sort());
  assert.equal('instance' in fixture.state.starts[0], false);
  assert.equal('image' in fixture.state.starts[0], false);
  assert.equal(fixture.state.starts[0].enableInternet, true);
});

test('Tor progress below 100 never dispatches, then an unchanged retry dispatches once ready', async () => {
  const fixture = containerFixture(); const controller = createContainerController({ container: fixture.container, env: { INTELLIGENCE_WORKER_TOKEN: token } });
  fixture.state.readiness = 'tor_booting';
  const payload = { action: 'profile', input: { username: 'example' } };
  assert.equal((await controller.fetch(request('/intelligence', payload))).status, 202);
  assert.equal(fixture.state.operations, 0);
  fixture.state.readiness = 'ready';
  assert.equal((await controller.fetch(request('/ready'))).status, 200);
  const result = await controller.fetch(request('/intelligence', payload));
  assert.equal(result.status, 200); assert.deepEqual((await result.json()).data.fixture, payload);
  assert.equal(fixture.state.operations, 1);
  assert.equal(fixture.state.starts.length, 1);
});

test('readiness failures are sanitized and upstream rate status remains explicit', async () => {
  const fixture = containerFixture(); const controller = createContainerController({ container: fixture.container, env: { INTELLIGENCE_WORKER_TOKEN: token } });
  fixture.state.readiness = 'failed';
  let response = await controller.fetch(request('/ready'));
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /must not be forwarded|private path/);
  fixture.state.readiness = 'ready'; fixture.state.operationStatus = 429;
  response = await controller.fetch(request('/intelligence', { action: 'profile', input: { username: 'example' } }));
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '7');
});

test('lifecycle configuration must succeed before a container can start', async () => {
  const fixture = containerFixture(); fixture.container.setInactivityTimeout = async () => { throw new Error('Synthetic lifecycle failure'); };
  const controller = createContainerController({ container: fixture.container, env: { INTELLIGENCE_WORKER_TOKEN: token } });
  assert.equal((await controller.fetch(request('/ready'))).status, 502);
  assert.equal(fixture.state.starts.length, 0);
});

test('a failed container has a cooldown instead of immediate repeated paid starts', async () => {
  const fixture = containerFixture(); let rejectMonitor;
  fixture.container.monitor = () => new Promise((_, reject) => { rejectMonitor = reject; });
  const events = [];
  const controller = createContainerController({ container: fixture.container, env: { INTELLIGENCE_WORKER_TOKEN: token }, now: () => 1000, log: event => events.push(event) });
  assert.equal((await controller.fetch(request('/ready'))).status, 202);
  rejectMonitor(Object.assign(new Error('Synthetic exit with secret detail'), { exitCode: 1 })); fixture.container.running = false;
  await new Promise(resolve => setImmediate(resolve));
  const result = await controller.fetch(request('/ready'));
  assert.equal(result.status, 503); assert.equal(result.headers.get('retry-after'), '60');
  assert.equal(fixture.state.starts.length, 1);
  assert.deepEqual(events, [{ event: 'container_exit', exitCode: 1 }]);
});

test('deployment configuration caps instances and does not contain credentials or production provider env', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.containers.length, 1); assert.equal(config.containers[0].max_instances, 1);
  assert.equal(config.containers[0].scheduling_policy, 'default');
  assert.equal(config.containers[0].instance_type, 'standard-1');
  assert.equal(config.containers[0].image_build_context, '../..');
  assert.equal('vars' in config, false);
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.doesNotMatch(dockerfile, /--no-sandbox|ARG\s+(?:.*TOKEN|.*KEY)|HIBP_API_KEY|IPINFO_TOKEN/);
  assert.match(dockerfile, /chromium-sandbox/); assert.match(dockerfile, /tini/);
});
