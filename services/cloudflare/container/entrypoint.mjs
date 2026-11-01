import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createIntelligenceWorker } from '../../intelligence/worker.mjs';
import { requireAuthorization } from '../src/controller.mjs';
import { queryTorBootstrap } from './tor-readiness.mjs';
import { probeBrowser } from './browser-readiness.mjs';

function send(response, status, body, retryAfter) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...(retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) }) });
  response.end(JSON.stringify(body));
}

function starting(response) {
  send(response, 202, { ok: false, error: { code: 'WORKER_STARTING',
    message: 'The intelligence browser and Tor client are starting.', retryAfter: 5 } }, 5);
}

async function listen(server, port, host) {
  await new Promise((resolve, reject) => {
    const ready = () => { server.off('error', failed); resolve(); };
    const failed = error => { server.off('listening', ready); reject(error); };
    server.once('error', failed); server.once('listening', ready); server.listen(port, host);
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  let timer;
  try {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections();
      timer = setTimeout(() => server.closeAllConnections(), 4000);
    });
  } finally { clearTimeout(timer); }
}

export async function startContainerRuntime(env = process.env, {
  workerFactory = createIntelligenceWorker, spawnTor = spawn, browserProbe = probeBrowser,
  bootstrapCheck = queryTorBootstrap, createDataDirectory = () => mkdir('/tmp/intelligence-tor', { recursive: true, mode: 0o700 }),
  frontPort = Number(env.INTELLIGENCE_WORKER_PORT || 43410), backendPort = 43411,
  startupTimeoutMs = 120000, log = event => console.log(JSON.stringify(event)), onFatal = () => { process.exitCode = 1; },
} = {}) {
  if (!Number.isInteger(frontPort) || frontPort < 0 || frontPort > 65535 || !Number.isInteger(backendPort) || backendPort < 0 || backendPort > 65535 ||
    (frontPort !== 0 && frontPort < 1024) || (backendPort !== 0 && backendPort < 1024)) throw new Error('The container HTTP ports are invalid.');
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 150000) throw new Error('The container startup deadline is invalid.');
  const backend = workerFactory({ token: env.INTELLIGENCE_WORKER_TOKEN, env: { ...env,
    INTELLIGENCE_WORKER_HOST: '127.0.0.1', INTELLIGENCE_WORKER_PORT: String(backendPort) } });
  let front;
  let tor;
  let shutdownPromise;
  let startupTimer;
  let bootstrapPromise;
  let browserProbePromise;
  const browserAbort = new AbortController();
  const state = { browserVerified: false, torBootstrap: 0, failure: null };
  async function bootstrap() {
    if (!bootstrapPromise) {
      bootstrapPromise = bootstrapCheck().then(result => { state.torBootstrap = result.progress; return result.ready; }, () => false)
        .finally(() => { bootstrapPromise = undefined; });
    }
    return bootstrapPromise;
  }
  async function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      clearTimeout(startupTimer); browserAbort.abort();
      const torExit = tor && tor.exitCode === null && !tor.signalCode ? new Promise((resolve, reject) => {
        let killTimer; let failureTimer;
        const done = () => { clearTimeout(killTimer); clearTimeout(failureTimer); tor.off('close', done); resolve(); };
        tor.once('close', done);
        try { tor.kill('SIGTERM'); } catch { /* The exit deadline remains authoritative. */ }
        killTimer = setTimeout(() => {
          try { tor.kill('SIGKILL'); } catch { /* The exit deadline remains authoritative. */ }
          failureTimer = setTimeout(() => { tor.off('close', done); reject(new Error('The Tor process did not exit after termination.')); }, 2000);
        }, 3000);
      }) : Promise.resolve();
      await Promise.all([closeServer(front), closeServer(backend), torExit, browserProbePromise?.catch(() => {})]);
    })();
    return shutdownPromise;
  }
  function fatal(code) {
    if (shutdownPromise) return;
    state.failure = code; log({ event: 'container_start_failed', code });
    void shutdown().catch(() => log({ event: 'container_shutdown_failed' })).finally(() => onFatal(code));
  }
  try {
    await createDataDirectory();
    await listen(backend, backendPort, '127.0.0.1');
    const internalPort = backend.address().port;
    front = createServer({ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (request, response) => {
      try {
        await requireAuthorization(new Headers({ authorization: request.headers.authorization || '' }), env.INTELLIGENCE_WORKER_TOKEN);
        if (request.method === 'GET' && request.url === '/health') {
          send(response, 200, { ok: true, data: { service: 'intelligence-container', status: 'running',
            ready: state.browserVerified && state.torBootstrap === 100 && !state.failure } }); return;
        }
        if (!((request.method === 'GET' && request.url === '/ready') || (request.method === 'POST' && request.url === '/intelligence'))) {
          send(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Container endpoint not found.' } }); return;
        }
        if (state.failure) { send(response, 503, { ok: false, error: { code: 'CONTAINER_START_FAILED', message: 'The container failed a startup check.' } }); return; }
        if (!state.browserVerified || !(await bootstrap())) { starting(response); return; }
        clearTimeout(startupTimer);
        if (request.method === 'GET') {
          send(response, 200, { ok: true, data: { service: 'intelligence-container', status: 'ready', torBootstrap: 100, browserVerified: true } }); return;
        }
        if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) {
          send(response, 415, { ok: false, error: { code: 'INVALID_CONTENT_TYPE', message: 'Send application/json.' } }); return;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);
        response.once('close', () => { if (!response.writableFinished) controller.abort(); });
        try {
          const result = await fetch(`http://127.0.0.1:${internalPort}/intelligence`, { method: 'POST',
            headers: { Authorization: `Bearer ${env.INTELLIGENCE_WORKER_TOKEN}`, 'Content-Type': 'application/json' },
            body: request, duplex: 'half', signal: controller.signal });
          response.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            ...(result.headers.has('retry-after') ? { 'Retry-After': result.headers.get('retry-after') } : {}) });
          if (result.body) {
            for await (const chunk of result.body) {
              if (!response.write(chunk)) await new Promise((resolve, reject) => {
                const drained = () => { cleanup(); resolve(); }; const closed = () => { cleanup(); reject(new Error('Client closed during response.')); };
                const cleanup = () => { response.off('drain', drained); response.off('close', closed); };
                response.once('drain', drained); response.once('close', closed);
              });
            }
          }
          response.end();
        } finally { clearTimeout(timeout); }
      } catch (error) {
        if (response.headersSent) { response.destroy(); return; }
        const known = typeof error?.status === 'number' && typeof error?.code === 'string';
        send(response, known ? error.status : 502, { ok: false, error: { code: known ? error.code : 'CONTAINER_UNAVAILABLE',
          message: known ? error.message : 'The intelligence container operation could not be completed.' } });
      }
    });
    await listen(front, frontPort, env.INTELLIGENCE_WORKER_HOST || '0.0.0.0');
    tor = spawnTor(env.TOR_EXECUTABLE_PATH || '/usr/bin/tor', ['-f', env.TOR_CONFIG_PATH || '/app/services/cloudflare/container/torrc'], {
      env: { PATH: env.PATH || process.env.PATH, HOME: env.HOME || process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    tor.once('error', () => fatal('TOR_PROCESS_FAILED'));
    tor.once('close', () => { if (!shutdownPromise) fatal('TOR_PROCESS_EXITED'); });
    // Consume bounded diagnostics without logging target addresses or credentials.
    tor.stdout?.on('data', chunk => {
      const text = chunk.toString('utf8').slice(0, 8192);
      for (const phase of text.matchAll(/Bootstrapped (\d+)%/g)) log({ event: 'tor_bootstrap', progress: Number(phase[1]) });
    });
    tor.stderr?.on('data', () => {});
    browserProbePromise = Promise.resolve().then(() => browserProbe(env, { signal: browserAbort.signal }));
    void browserProbePromise.then(result => {
      if (!shutdownPromise && result?.verified === true && result?.sandboxDisabled === false) {
        state.browserVerified = true; log({ event: 'browser_readiness_verified', sandboxDisabled: false });
      } else if (!shutdownPromise) fatal('BROWSER_PROBE_FAILED');
    }, () => { if (!shutdownPromise) fatal('BROWSER_PROBE_FAILED'); });
    startupTimer = setTimeout(() => {
      void bootstrap().then(ready => {
        if (!state.browserVerified || !ready) fatal('STARTUP_TIMEOUT');
      });
    }, startupTimeoutMs);
    return { server: front, backend, state, close: shutdown };
  } catch (error) { await shutdown().catch(() => {}); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startContainerRuntime().then(runtime => {
    const stop = () => { void runtime.close().catch(() => { console.error('Container shutdown failed.'); process.exitCode = 1; }); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  }, () => { console.error('The intelligence container could not start. Check token, browser, Tor, and port configuration.'); process.exitCode = 1; });
}
