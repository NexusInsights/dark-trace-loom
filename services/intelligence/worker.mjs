import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { dispatchAction, IntelligenceError, toErrorResult } from './service.mjs';

function send(response, status, body, retryAfter) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...(retryAfter !== undefined ? { 'Retry-After': String(retryAfter) } : {}) });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw new IntelligenceError('INVALID_CONTENT_TYPE', 'Send application/json.', 415);
  return new Promise((resolve, reject) => {
    let length = 0;
    const chunks = [];
    const cleanup = () => { request.off('data', onData); request.off('end', onEnd); request.off('error', onError); request.off('aborted', onAborted); };
    const onError = error => { cleanup(); reject(error); };
    const onAborted = () => onError(new IntelligenceError('REQUEST_ABORTED', 'The request was interrupted.'));
    const onData = chunk => {
      length += chunk.length;
      if (length > 16384) { cleanup(); request.resume(); reject(new IntelligenceError('REQUEST_TOO_LARGE', 'The request exceeds 16 KiB.', 413)); }
      else chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new IntelligenceError('INVALID_JSON', 'The request body must contain valid JSON.')); }
    };
    request.on('data', onData); request.once('end', onEnd); request.once('error', onError); request.once('aborted', onAborted);
  });
}

export function createIntelligenceWorker({ token, env = process.env, dispatch = dispatchAction } = {}) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 512) throw new Error('Set INTELLIGENCE_WORKER_TOKEN to a private token of 32–512 characters.');
  const expected = Buffer.from(`Bearer ${token}`);
  let active = 0;
  return createServer({ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (request, response) => {
    try {
      const actual = Buffer.from(request.headers.authorization || '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new IntelligenceError('UNAUTHORIZED', 'Worker authentication is required.', 401);
      if (request.method === 'GET' && request.url === '/health') return send(response, 200, { ok: true, data: { service: 'intelligence-worker', status: 'running' } });
      if (request.method !== 'POST' || request.url !== '/intelligence') throw new IntelligenceError('NOT_FOUND', 'Worker endpoint not found.', 404);
      if (active >= 2) throw new IntelligenceError('BUSY', 'The browser worker is busy. Retry shortly.', 429, 5);
      active++;
      try {
        const body = await readBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new IntelligenceError('INVALID_INPUT', 'Provide an action and input object.');
        const data = await dispatch(body.action, body.input, { env });
        send(response, 200, { ok: true, data });
      }
      finally { active--; }
    } catch (error) {
      if (!response.headersSent) send(response, error instanceof IntelligenceError ? error.status : 500, toErrorResult(error), error.retryAfter);
      else response.destroy();
    }
  });
}

export async function startWorker(env = process.env) {
  const host = env.INTELLIGENCE_WORKER_HOST || '127.0.0.1';
  const port = Number(env.INTELLIGENCE_WORKER_PORT || 43410);
  if (!['127.0.0.1', '::1', '0.0.0.0'].includes(host) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a valid worker host and a port from 1024 through 65535.');
  const server = createIntelligenceWorker({ token: env.INTELLIGENCE_WORKER_TOKEN, env });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  console.log(`Intelligence worker listening at http://${host}:${port}`);
  const shutdown = () => { server.close(); server.closeIdleConnections(); setTimeout(() => { server.closeAllConnections(); }, 4000).unref(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWorker().catch(error => { console.error(error.message); process.exitCode = 1; });
}
