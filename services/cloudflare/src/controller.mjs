export const CONTAINER_NAME = 'insightnexus-intelligence-v1';
export const CONTAINER_PORT = 43410;
export const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
export const STARTUP_LIMIT_MS = 150000;
const ALLOWED_ACTIONS = new Set(['profile', 'onion']);

export class GatewayError extends Error {
  constructor(code, message, status = 400, retryAfter) {
    super(message); this.code = code; this.status = status; this.retryAfter = retryAfter;
  }
}

export function jsonResponse(status, value, retryAfter) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...(retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) }),
  } });
}

export function errorResponse(error) {
  const known = error instanceof GatewayError;
  const code = known ? error.code : 'GATEWAY_UNAVAILABLE';
  const message = known ? error.message : 'The intelligence container could not be reached.';
  const retryAfter = known ? error.retryAfter : undefined;
  return jsonResponse(known ? error.status : 502, { ok: false, error: { code, message,
    ...(retryAfter === undefined ? {} : { retryAfter }) } }, retryAfter);
}

export function startingResponse() {
  return errorResponse(new GatewayError('WORKER_STARTING', 'The intelligence browser and Tor client are starting. Retry this unchanged request after the indicated delay.', 202, 5));
}

export async function requireAuthorization(headers, token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 512 || /[\r\n]/.test(token)) {
    throw new GatewayError('CONFIGURATION_REQUIRED', 'The intelligence worker token is not configured.', 503);
  }
  const actual = headers.get('authorization') || '';
  if (actual.length > 1024) throw new GatewayError('UNAUTHORIZED', 'Worker authentication is required.', 401);
  const encoder = new TextEncoder();
  const [provided, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
    crypto.subtle.digest('SHA-256', encoder.encode(`Bearer ${token}`)),
  ]);
  const left = new Uint8Array(provided); const right = new Uint8Array(expected);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  if (difference !== 0) throw new GatewayError('UNAUTHORIZED', 'Worker authentication is required.', 401);
}

export async function readAction(request, { timeoutMs = 10000 } = {}) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) {
    throw new GatewayError('INVALID_CONTENT_TYPE', 'Send application/json.', 415);
  }
  if (Number(request.headers.get('content-length')) > 16384) {
    await request.body?.cancel().catch(() => {});
    throw new GatewayError('REQUEST_TOO_LARGE', 'The request exceeds 16 KiB.', 413);
  }
  if (!request.body) throw new GatewayError('INVALID_JSON', 'Provide an action and input object.');
  const reader = request.body.getReader();
  let timeout;
  let finished = false;
  try {
    const body = await Promise.race([
      (async () => {
        const chunks = []; let length = 0;
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          length += result.value.byteLength;
          if (length > 16384) throw new GatewayError('REQUEST_TOO_LARGE', 'The request exceeds 16 KiB.', 413);
          chunks.push(result.value);
        }
        const buffer = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
        return new TextDecoder().decode(buffer);
      })(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new GatewayError('REQUEST_TIMEOUT', 'The request body did not arrive in time.', 408)), timeoutMs); }),
    ]);
    let parsed;
    try { parsed = JSON.parse(body); } catch { throw new GatewayError('INVALID_JSON', 'The request body must contain valid JSON.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !ALLOWED_ACTIONS.has(parsed.action) ||
      !parsed.input || typeof parsed.input !== 'object' || Array.isArray(parsed.input)) {
      throw new GatewayError('INVALID_INPUT', 'This browser worker accepts profile or onion actions with an input object.');
    }
    if (parsed.action === 'profile') {
      const username = typeof parsed.input.username === 'string' ? parsed.input.username.trim().replace(/^@/, '') : '';
      if (!/^[a-z0-9_]{1,15}$/i.test(username)) throw new GatewayError('INVALID_INPUT', 'Enter a valid X username.');
      finished = true; return { action: 'profile', input: { username } };
    }
    let url;
    try { url = new URL(parsed.input.url); } catch { throw new GatewayError('INVALID_INPUT', 'Enter a valid v3 onion URL.'); }
    if (typeof parsed.input.url !== 'string' || parsed.input.url.length > 2048 ||
      !['http:', 'https:'].includes(url.protocol) || !/^[a-z2-7]{56}\.onion$/i.test(url.hostname) ||
      url.username || url.password || (url.port && !['80', '443'].includes(url.port))) {
      throw new GatewayError('INVALID_INPUT', 'Use a v3 onion HTTP/HTTPS URL without credentials on port 80 or 443.');
    }
    url.hash = ''; finished = true; return { action: 'onion', input: { url: url.href } };
  } finally {
    clearTimeout(timeout);
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function handleGatewayRequest(request, env) {
  try {
    await requireAuthorization(request.headers, env.INTELLIGENCE_WORKER_TOKEN);
    const url = new URL(request.url);
    if (url.search) throw new GatewayError('NOT_FOUND', 'Worker endpoint not found.', 404);
    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse(200, { ok: true, data: { service: 'intelligence-frontdoor', status: 'running', containerState: 'not_checked' } });
    }
    let forwarded = request;
    if (request.method === 'POST' && url.pathname === '/intelligence') {
      const payload = await readAction(request);
      forwarded = new Request('https://intelligence.internal/intelligence', { method: 'POST',
        headers: { Authorization: request.headers.get('authorization'), 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: request.signal });
    } else if (request.method !== 'GET' || url.pathname !== '/ready') {
      throw new GatewayError('NOT_FOUND', 'Worker endpoint not found.', 404);
    }
    if (typeof env.INTELLIGENCE_CONTAINER?.getByName !== 'function') throw new GatewayError('CONFIGURATION_REQUIRED', 'The intelligence container binding is missing.', 503);
    return await env.INTELLIGENCE_CONTAINER.getByName(CONTAINER_NAME).fetch(forwarded);
  } catch (error) { return errorResponse(error); }
}

export function createContainerController({ container, env, now = Date.now, log = () => {} }) {
  let startIssued = false;
  let startedAt = 0;
  let startPromise;
  let monitorAttached = false;
  let failureAt = null;
  function observe() {
    if (monitorAttached || typeof container.monitor !== 'function') return;
    monitorAttached = true;
    Promise.resolve().then(() => container.monitor()).then(() => {
      startIssued = false; monitorAttached = false;
    }, error => {
      startIssued = false; monitorAttached = false; failureAt = now();
      log({ event: 'container_exit', exitCode: Number.isInteger(error?.exitCode) ? error.exitCode : null });
    });
  }
  async function ensureStarted() {
    if (!container) throw new GatewayError('CONFIGURATION_REQUIRED', 'The intelligence container is not configured.', 503);
    if (failureAt !== null && now() - failureAt < 60000) throw new GatewayError('CONTAINER_START_FAILED', 'The intelligence container stopped unexpectedly. Check deployment diagnostics before retrying.', 503, 60);
    // Arm sleep-to-zero before starting any billable process. A failed lifecycle
    // configuration must not leave a newly started instance without its timer.
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    if (!container.running && !startIssued) {
      startIssued = true; startedAt = now();
      startPromise = (async () => {
        try {
          // The default scheduling policy supplies the image/size and enforces
          // max_instances=1. Runtime secrets still use the direct Container API.
          container.start({ enableInternet: true, env: {
            INTELLIGENCE_WORKER_TOKEN: env.INTELLIGENCE_WORKER_TOKEN,
            INTELLIGENCE_WORKER_HOST: '0.0.0.0', INTELLIGENCE_WORKER_PORT: String(CONTAINER_PORT),
            PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium', TOR_SOCKS_PROXY: 'socks5://127.0.0.1:9050',
          } });
          observe();
        } catch (error) { startIssued = false; throw error; }
      })();
    } else if (container.running) observe();
    if (startPromise) await startPromise;
    if (startedAt && now() - startedAt > STARTUP_LIMIT_MS) {
      throw new GatewayError('CONTAINER_START_FAILED', 'The container did not become ready within its startup window.', 503, 60);
    }
  }
  return {
    async fetch(request) {
      try {
        await requireAuthorization(request.headers, env.INTELLIGENCE_WORKER_TOKEN);
        const url = new URL(request.url);
        if (!((request.method === 'GET' && url.pathname === '/ready') || (request.method === 'POST' && url.pathname === '/intelligence'))) {
          throw new GatewayError('NOT_FOUND', 'Container endpoint not found.', 404);
        }
        await ensureStarted();
        const port = container.getTcpPort(CONTAINER_PORT);
        let readiness;
        try { readiness = await port.fetch('http://container/ready', { headers: { Authorization: `Bearer ${env.INTELLIGENCE_WORKER_TOKEN}` }, signal: AbortSignal.timeout(3000) }); }
        catch { return startingResponse(); }
        if (readiness.status === 202) { await readiness.body?.cancel().catch(() => {}); return startingResponse(); }
        if (!readiness.ok) {
          await readiness.body?.cancel().catch(() => {});
          throw new GatewayError('CONTAINER_START_FAILED', 'The container reported a failed readiness check. Inspect its deployment diagnostics.', 503, 60);
        }
        let result;
        try { result = await readiness.json(); } catch { throw new GatewayError('INVALID_CONTAINER_RESPONSE', 'The container returned invalid readiness data.', 502); }
        if (result?.ok !== true || result?.data?.torBootstrap !== 100 || result?.data?.browserVerified !== true || result?.data?.status !== 'ready') return startingResponse();
        startedAt = 0;
        if (request.method === 'GET') return jsonResponse(200, result);
        const forwarded = new Request('http://container/intelligence', request);
        forwarded.headers.delete('host');
        const response = await port.fetch(forwarded, { signal: AbortSignal.timeout(90000) });
        const headers = new Headers(response.headers); headers.set('Cache-Control', 'no-store'); headers.set('X-Content-Type-Options', 'nosniff');
        return new Response(response.body, { status: response.status, headers });
      } catch (error) { return errorResponse(error); }
    },
  };
}
