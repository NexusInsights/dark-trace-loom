import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createTcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync } from 'node:fs';
import { queryTorBootstrap } from '../container/tor-readiness.mjs';
import { probeBrowser, runBoundedCommand } from '../container/browser-readiness.mjs';
import { startContainerRuntime } from '../container/entrypoint.mjs';
import { createIntelligenceWorker } from '../../intelligence/worker.mjs';

const token = 'synthetic-container-token-only-1234567890123';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

test('Tor readiness authenticates on a real control socket and distinguishes progress from ready', async t => {
  const received = [];
  let progress = 45;
  const cookie = Buffer.alloc(32, 7);
  const server = createTcpServer(socket => {
    socket.on('error', () => {}); let text = '';
    socket.on('data', chunk => {
      text += chunk.toString();
      if (text.includes('QUIT\r\n')) {
        received.push(text);
        socket.end(`250 OK\r\n250-status/bootstrap-phase=NOTICE BOOTSTRAP PROGRESS=${progress} TAG=fixture SUMMARY="Fixture"\r\n250 OK\r\n`);
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const options = { port: server.address().port, readCookie: async () => cookie };
  assert.deepEqual(await queryTorBootstrap(options), { progress: 45, ready: false });
  progress = 100;
  assert.deepEqual(await queryTorBootstrap(options), { progress: 100, ready: true });
  assert.ok(received.every(value => value.startsWith(`AUTHENTICATE ${cookie.toString('hex')}\r\nGETINFO status/bootstrap-phase\r\n`)));
});

test('Tor control rejects invalid cookie sizes and bounds an unresponsive socket', async t => {
  let connected = false;
  await assert.rejects(queryTorBootstrap({ readCookie: async () => Buffer.alloc(31), connect: () => { connected = true; } }), /authentication is not ready/);
  assert.equal(connected, false);
  const sockets = new Set();
  const server = createTcpServer(socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); for (const socket of sockets) socket.destroy(); }));
  await assert.rejects(queryTorBootstrap({ port: server.address().port, readCookie: async () => Buffer.alloc(32), timeoutMs: 15 }), /timed out/);
});

test('readiness subprocess checks real exit status and waits for timeout termination', { timeout: 5000 }, async () => {
  const result = await runBoundedCommand(process.execPath, ['-e', 'process.stdout.write("fixture-success")']);
  assert.equal(result.stdout, 'fixture-success');
  await assert.rejects(runBoundedCommand(process.execPath, ['-e', 'process.exit(4)']), error => error.exitCode === 4);
  let child;
  await assert.rejects(runBoundedCommand(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], {
    timeoutMs: 30, spawnImpl: (...args) => { child = spawn(...args); return child; },
  }), /timed out/);
  assert.ok(child.exitCode !== null || child.signalCode, 'The subprocess must have actually exited before its timeout result is returned');
});

function fakeProbeSpawn({ rendered = true } = {}) {
  const state = {};
  return { state, spawnImpl(executable, args, options) {
    state.executable = executable; state.args = args; state.env = options.env;
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => { child.stdout.end(rendered ? '<p>insightnexus-browser-readiness-ok</p>' : '<p>blank</p>'); child.emit('close', 0); });
    return child;
  } };
}

test('browser readiness preserves sandbox mode, excludes secrets, and removes its temporary profile', async () => {
  const fixture = fakeProbeSpawn();
  const result = await probeBrowser({ PUPPETEER_EXECUTABLE_PATH: '/fixture/chromium', INTELLIGENCE_WORKER_TOKEN: token }, { spawnImpl: fixture.spawnImpl });
  assert.deepEqual(result, { verified: true, sandboxDisabled: false });
  assert.equal(fixture.state.executable, '/fixture/chromium');
  assert.ok(!fixture.state.args.includes('--no-sandbox'));
  assert.equal('INTELLIGENCE_WORKER_TOKEN' in fixture.state.env, false);
  const profile = fixture.state.args.find(value => value.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  assert.equal(existsSync(profile), false);
  const failing = fakeProbeSpawn({ rendered: false });
  await assert.rejects(probeBrowser({}, { spawnImpl: failing.spawnImpl }), /did not render/);
  const failedProfile = failing.state.args.find(value => value.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  assert.equal(existsSync(failedProfile), false);
});

function fakeTor() {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.exitCode = null; child.signalCode = null;
  child.kill = signal => { setImmediate(() => { child.signalCode = signal; child.emit('close', null, signal); }); return true; };
  return child;
}

test('real HTTP supervisor separates health, startup readiness and authenticated action forwarding', { timeout: 5000 }, async t => {
  let completeBrowser; let progress = 20; let operations = 0; let bootstrapChecks = 0;
  const tor = fakeTor();
  const runtime = await startContainerRuntime({ INTELLIGENCE_WORKER_TOKEN: token, INTELLIGENCE_WORKER_HOST: '127.0.0.1' }, {
    frontPort: 0, backendPort: 0, spawnTor: () => tor, createDataDirectory: async () => {},
    browserProbe: () => new Promise(resolve => { completeBrowser = resolve; }),
    bootstrapCheck: async () => { bootstrapChecks++; return { progress, ready: progress === 100 }; },
    log: () => {}, onFatal: () => assert.fail('Unexpected startup failure'),
    workerFactory: ({ token: workerToken, env }) => createIntelligenceWorker({ token: workerToken, env,
      dispatch: async (action, input) => { operations++; return { action, input, fixture: true }; } }),
  });
  t.after(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  assert.equal((await fetch(`${base}/health`)).status, 401);
  let response = await fetch(`${base}/health`, { headers });
  assert.equal(response.status, 200); assert.equal((await response.json()).data.ready, false);
  response = await fetch(`${base}/ready`, { headers });
  assert.equal(response.status, 202); await response.json(); assert.equal(bootstrapChecks, 0);
  completeBrowser({ verified: true, sandboxDisabled: false });
  await new Promise(resolve => setImmediate(resolve));
  response = await fetch(`${base}/ready`, { headers });
  assert.equal(response.status, 202); assert.equal(response.headers.get('retry-after'), '5'); await response.json();
  const body = JSON.stringify({ action: 'profile', input: { username: 'fixture' } });
  response = await fetch(`${base}/intelligence`, { method: 'POST', headers, body });
  assert.equal(response.status, 202); await response.json(); assert.equal(operations, 0);
  progress = 100;
  response = await fetch(`${base}/ready`, { headers });
  assert.equal(response.status, 200); assert.equal((await response.json()).data.torBootstrap, 100);
  response = await fetch(`${base}/intelligence`, { method: 'POST', headers, body });
  assert.equal(response.status, 200); assert.equal((await response.json()).data.fixture, true); assert.equal(operations, 1);
});

test('startup deadline shuts down owned services instead of advertising permanent readiness', { timeout: 5000 }, async () => {
  let fatalReady;
  const fatal = new Promise(resolve => { fatalReady = resolve; });
  const runtime = await startContainerRuntime({ INTELLIGENCE_WORKER_TOKEN: token, INTELLIGENCE_WORKER_HOST: '127.0.0.1' }, {
    frontPort: 0, backendPort: 0, spawnTor: () => fakeTor(), createDataDirectory: async () => {},
    browserProbe: async () => ({ verified: true, sandboxDisabled: false }),
    bootstrapCheck: async () => ({ progress: 0, ready: false }), startupTimeoutMs: 20,
    log: () => {}, onFatal: code => fatalReady(code),
  });
  assert.equal(await fatal, 'STARTUP_TIMEOUT');
  assert.equal(runtime.server.listening, false); assert.equal(runtime.backend.listening, false);
  await runtime.close();
});

test('missing worker token cannot launch Tor or Chromium', async () => {
  let started = false;
  await assert.rejects(startContainerRuntime({}, { spawnTor: () => { started = true; }, browserProbe: async () => { started = true; } }), /INTELLIGENCE_WORKER_TOKEN/);
  assert.equal(started, false);
});

test('supervisor shutdown waits for an aborted browser probe to finish cleanup', { timeout: 5000 }, async () => {
  let browserStopped = false;
  const runtime = await startContainerRuntime({ INTELLIGENCE_WORKER_TOKEN: token, INTELLIGENCE_WORKER_HOST: '127.0.0.1' }, {
    frontPort: 0, backendPort: 0, spawnTor: () => fakeTor(), createDataDirectory: async () => {},
    browserProbe: (_env, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => setTimeout(() => { browserStopped = true; reject(new Error('Expected cancellation')); }, 20), { once: true });
    }),
    bootstrapCheck: async () => ({ progress: 0, ready: false }), log: () => {}, onFatal: () => assert.fail('Intentional shutdown must not be reported as a startup failure'),
  });
  await runtime.close();
  assert.equal(browserStopped, true);
  assert.equal(runtime.server.listening, false);
});
