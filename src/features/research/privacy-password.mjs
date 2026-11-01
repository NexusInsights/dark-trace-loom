export class ResearchClientError extends Error {
  constructor(code, message, retryAfter) {
    super(message); this.name = 'ResearchClientError'; this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

function requiredCrypto(value) {
  if (!value?.subtle?.digest) throw new ResearchClientError('UNSUPPORTED', 'This tool needs Web Crypto in a secure browser context.');
  return value;
}

function hex(bytes) { return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('').toUpperCase(); }

async function boundedText(response, maxBytes) {
  if (!response.body?.getReader) throw new ResearchClientError('INVALID_RESPONSE', 'The range service returned no readable response.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ResearchClientError('RESPONSE_TOO_LARGE', 'The range response exceeded its size limit.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let position = 0;
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function matchPasswordRange(text, suffix) {
  if (typeof text !== 'string' || !/^[0-9A-F]{35}$/.test(suffix)) throw new ResearchClientError('INVALID_RESPONSE', 'The range response could not be checked.');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length || lines.length > 20000) throw new ResearchClientError('INVALID_RESPONSE', 'The range service returned an invalid record count.');
  const records = new Map();
  for (const line of lines) {
    const match = /^([0-9A-Fa-f]{35}):([0-9]{1,15})$/.exec(line);
    if (!match) throw new ResearchClientError('INVALID_RESPONSE', 'The range service returned malformed records.');
    const count = Number(match[2]); const key = match[1].toUpperCase();
    if (!Number.isSafeInteger(count)) throw new ResearchClientError('INVALID_RESPONSE', 'The range service returned an invalid exposure count.');
    if (!count) continue; // HIBP padding records are not observed exposures.
    if (records.has(key) && records.get(key) !== count) throw new ResearchClientError('INVALID_RESPONSE', 'The range service returned inconsistent records.');
    records.set(key, count);
  }
  return records.get(suffix) || 0;
}

export async function checkPrivatePassword(password, { fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto, signal, timeoutMs = 12000 } = {}) {
  if (typeof password !== 'string' || !password.length || new TextEncoder().encode(password).byteLength > 4096) throw new ResearchClientError('INVALID_INPUT', 'Enter a password between 1 and 4,096 UTF-8 bytes.');
  if (typeof fetchImpl !== 'function') throw new ResearchClientError('UNSUPPORTED', 'Network requests are unavailable in this browser.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new ResearchClientError('INVALID_INPUT', 'Invalid request deadline.');
  const cryptoApi = requiredCrypto(cryptoImpl); const encoded = new TextEncoder().encode(password);
  let digest;
  try { digest = hex(await cryptoApi.subtle.digest('SHA-1', encoded)); }
  finally { encoded.fill(0); }
  if (signal?.aborted) throw new ResearchClientError('CANCELLED', 'The password check was cancelled.');
  const prefix = digest.slice(0, 5); const suffix = digest.slice(5);
  const controller = new AbortController(); let timedOut = false;
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      method: 'GET', headers: { 'Add-Padding': 'true', Accept: 'text/plain' }, credentials: 'omit',
      cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
    });
    if (response.status === 429) {
      const raw = response.headers.get('retry-after'); const seconds = /^\d+$/.test(raw || '') ? Math.min(3600, Math.max(1, Number(raw))) : undefined;
      throw new ResearchClientError('RATE_LIMITED', 'The password range service is rate limited. No retry was attempted.', seconds);
    }
    if (!response.ok) throw new ResearchClientError('PROVIDER_UNAVAILABLE', `The password range service returned HTTP ${response.status}. No exposure result was established.`);
    const count = matchPasswordRange(await boundedText(response, 1024 * 1024), suffix);
    return {
      provider: 'HIBP Pwned Passwords', status: count ? 'found' : 'not_found', exposureCount: count,
      checkedAt: new Date().toISOString(), sourceUrl: 'https://haveibeenpwned.com/Passwords',
      privacy: { passwordTransmitted: false, fullHashTransmitted: false, prefixLength: 5, paddingRequested: true, storedByThisTool: false },
      limitation: 'A missing match is not a guarantee that this password is safe. The service sees the hash prefix and your network request.',
    };
  } catch (error) {
    if (timedOut) throw new ResearchClientError('TIMEOUT', 'The password check timed out; no exposure result was established.');
    if (signal?.aborted) throw new ResearchClientError('CANCELLED', 'The password check was cancelled.');
    if (error instanceof ResearchClientError) throw error;
    throw new ResearchClientError('NETWORK_ERROR', 'The password range check could not complete. No exposure result was established.');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); digest = undefined;
  }
}

function safeCount(storage) {
  try { return { status: 'observed', keyCount: storage.length, valuesCollected: false }; }
  catch { return { status: 'unavailable', keyCount: null, valuesCollected: false }; }
}

function primitive(value) { return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' ? value : null; }

async function observationDeadline(operation, timeoutMs = 1500) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new ResearchClientError('OBSERVATION_TIMEOUT', 'The browser observation did not complete.')), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

export async function capturePrivacySnapshot({ scope = globalThis, fingerprintCapture } = {}) {
  const nav = scope.navigator;
  if (!nav || !scope.document || !scope.location) throw new ResearchClientError('UNSUPPORTED', 'Browser privacy inspection is unavailable in this environment.');
  const permissions = {};
  for (const name of ['geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read', 'persistent-storage']) {
    try {
      if (!nav.permissions?.query) { permissions[name] = 'unsupported'; continue; }
      const result = await observationDeadline(nav.permissions.query({ name }));
      permissions[name] = ['granted', 'denied', 'prompt'].includes(result.state) ? result.state : 'unknown';
    } catch (error) { permissions[name] = error?.code === 'OBSERVATION_TIMEOUT' ? 'unavailable' : 'unsupported'; }
  }
  let cookieCount = null;
  try { cookieCount = scope.document.cookie ? scope.document.cookie.split(';').length : 0; } catch { /* Origin storage can be denied. */ }
  const storage = {};
  for (const name of ['localStorage', 'sessionStorage']) {
    try { storage[name] = safeCount(scope[name]); } catch { storage[name] = { status: 'unavailable', keyCount: null, valuesCollected: false }; }
  }
  let persistence = 'unsupported';
  try { if (nav.storage?.persisted) persistence = await observationDeadline(nav.storage.persisted()) ? 'persistent' : 'best_effort'; } catch { persistence = 'unavailable'; }
  const origins = new Map();
  try {
    for (const entry of (scope.performance?.getEntriesByType?.('resource') || []).slice(-2000)) {
      let url; try { url = new URL(entry.name, scope.location.origin); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      const key = url.origin; origins.set(key, (origins.get(key) || 0) + 1);
    }
  } catch { /* An unavailable resource timeline is represented below. */ }
  const resources = Array.from(origins, ([origin, observedCount]) => ({ origin, observedCount, relationship: origin === scope.location.origin ? 'same_origin' : 'external_origin' })).sort((a, b) => a.origin.localeCompare(b.origin));
  let fingerprint = { status: 'not_requested' };
  if (fingerprintCapture) {
    try {
      const result = await observationDeadline(fingerprintCapture(), 12000);
      if (!result || !/^[a-f0-9]{32}$/i.test(result.visitorId || '')) throw new Error('Unsupported fingerprint result');
      fingerprint = { status: 'captured', visitorId: result.visitorId, version: String(result.version || '').slice(0, 32), confidence: result.confidence?.score ?? null };
    } catch { fingerprint = { status: 'unavailable' }; }
  }
  return {
    schema: 'browser-privacy/v1', capturedAt: new Date().toISOString(), scope: 'current_app_origin',
    origin: scope.location.origin, permissions, fingerprint,
    signals: { viewportWidth: primitive(scope.innerWidth), viewportHeight: primitive(scope.innerHeight), devicePixelRatio: primitive(scope.devicePixelRatio), language: String(nav.language || '').slice(0, 64), languages: Array.from(nav.languages || []).slice(0, 8).map(x => String(x).slice(0, 64)), cookiesEnabled: primitive(nav.cookieEnabled), doNotTrack: primitive(nav.doNotTrack), globalPrivacyControl: primitive(nav.globalPrivacyControl) },
    storage: { ...storage, readableCookieCount: cookieCount, httpOnlyCookies: 'not_observable', persistence, valuesCollected: false },
    resources, resourceAuditScope: 'Performance API visible resources for this app only; not a complete network or tracker audit. URLs, paths, query strings and storage values are not collected.',
  };
}

export function comparePrivacySnapshots(before, after) {
  if (before?.schema !== 'browser-privacy/v1' || after?.schema !== before.schema || before.origin !== after.origin) throw new ResearchClientError('INVALID_INPUT', 'Compare snapshots captured by this tool on the same origin.');
  const changes = [];
  function compare(left, right, path) {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      for (const key of Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort()) compare(left[key], right[key], path ? `${path}.${key}` : key);
    } else changes.push({ signal: path, before: left ?? null, after: right ?? null });
  }
  for (const key of ['permissions', 'signals', 'storage', 'fingerprint']) compare(before[key], after[key], key);
  const beforeOrigins = before.resources.map(x => x.origin).sort(); const afterOrigins = after.resources.map(x => x.origin).sort();
  compare(beforeOrigins, afterOrigins, 'visibleResourceOrigins');
  return { changed: changes.length > 0, changes, limitation: 'Differences describe these observations. They do not establish why a signal changed or whether a resource is a tracker.' };
}
