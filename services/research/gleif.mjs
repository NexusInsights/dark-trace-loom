export class RegistryError extends Error {
  constructor(code, message, status = 502, retryAfter) { super(message); this.name = 'RegistryError'; this.code = code; this.status = status; if (retryAfter !== undefined) this.retryAfter = retryAfter; }
}

export function validateLEI(value) {
  if (typeof value !== 'string' || value.length > 30) throw new RegistryError('INVALID_INPUT', 'Enter a 20-character Legal Entity Identifier.', 400);
  const lei = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{18}[0-9]{2}$/.test(lei)) throw new RegistryError('INVALID_INPUT', 'Enter a 20-character Legal Entity Identifier.', 400);
  let remainder = 0;
  for (const char of lei) {
    const digits = char >= 'A' && char <= 'Z' ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  if (remainder !== 1) throw new RegistryError('INVALID_INPUT', 'The LEI check digits are invalid.', 400);
  return lei;
}

function field(value, { required = false, limit = 500 } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new RegistryError('INVALID_RESPONSE', 'GLEIF returned an incomplete legal-entity record.');
    return null;
  }
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) throw new RegistryError('INVALID_RESPONSE', 'GLEIF returned an invalid legal-entity field.');
  return value;
}

async function responseJSON(response) {
  if (!response.body?.getReader) throw new RegistryError('INVALID_RESPONSE', 'GLEIF returned no readable record.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 524288) throw new RegistryError('RESPONSE_TOO_LARGE', 'The registry response exceeded its size limit.'); chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new RegistryError('INVALID_RESPONSE', 'GLEIF returned invalid JSON.'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function lookupLegalEntity(input, { fetchImpl = globalThis.fetch, signal, now = () => new Date().toISOString() } = {}) {
  const lei = validateLEI(input); const controller = new AbortController(); let timedOut = false;
  const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
  const sourceUrl = `https://search.gleif.org/#/record/${lei}`;
  try {
    const response = await fetchImpl(`https://api.gleif.org/api/v1/lei-records/${lei}`, { headers: { Accept: 'application/vnd.api+json' }, credentials: 'omit', redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) { void response.body?.cancel().catch(() => {}); throw new RegistryError('PROVIDER_UNAVAILABLE', 'GLEIF returned a redirect. No redirected lookup or legal-entity finding was made.'); }
    if (response.status === 404) { await response.body?.cancel().catch(() => {}); return { provider: 'GLEIF', status: 'no_match', lei, sourceUrl, capturedAt: now(), coverage: 'GLEIF legal entities with an LEI only; no match does not establish that a business does not exist.' }; }
    if (response.status === 429) {
      const raw = response.headers.get('retry-after'); const retry = /^\d+$/.test(raw || '') ? Math.max(1, Math.min(3600, Number(raw))) : undefined;
      await response.body?.cancel().catch(() => {}); throw new RegistryError('RATE_LIMITED', 'GLEIF rate limited this lookup. No retry was attempted.', 429, retry);
    }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new RegistryError('PROVIDER_UNAVAILABLE', `GLEIF returned HTTP ${response.status}. No legal-entity finding was established.`); }
    const payload = await responseJSON(response); const record = payload?.data; const attributes = record?.attributes;
    if (record?.type !== 'lei-records' || record?.id !== lei || attributes?.lei !== lei || !attributes.entity || !attributes.registration) throw new RegistryError('INVALID_RESPONSE', 'The registry record did not match the requested LEI.');
    const entity = { lei, legalName: field(attributes.entity.legalName?.name, { required: true }), jurisdiction: field(attributes.entity.jurisdiction), entityStatus: field(attributes.entity.status), registrationStatus: field(attributes.registration.status), registryUpdatedAt: field(attributes.registration.lastUpdateDate), nextRenewalDate: field(attributes.registration.nextRenewalDate) };
    const capturedAt = now(); const entityId = `gleif-entity:${lei}`;
    const source = { id: `gleif:${lei}`, label: 'GLEIF official LEI record', url: sourceUrl, provider: 'GLEIF', publisher: 'Global Legal Entity Identifier Foundation', independence: 'unknown', independenceGroup: 'gleif-register' };
    const evidenceInput = {
      source,
      entities: [{ id: entityId, type: 'Organization', label: entity.legalName, identifiers: [{ type: 'LEI', value: lei }] }],
      observations: Object.entries(entity).filter(([, value]) => value !== null).map(([property, value]) => ({ id: `gleif:${lei}:${property}:${capturedAt.replace(/[^0-9]/g, '')}`, entityId, property, value, capturedAt, eventTime: null })),
      claims: [],
    };
    return { provider: 'GLEIF', status: 'found', entity, sourceUrl, capturedAt, evidenceInput, dataLicence: 'CC0; GLEIF access-service terms also apply.', coverage: 'This identifies a legal-entity record, not a natural person, current employment, beneficial ownership or eligibility. Addresses and contact fields are excluded.' };
  } catch (error) {
    if (timedOut) throw new RegistryError('TIMEOUT', 'The GLEIF lookup timed out. No finding was established.', 504);
    if (signal?.aborted) throw new RegistryError('CANCELLED', 'The GLEIF lookup was cancelled.', 499);
    if (error instanceof RegistryError) throw error;
    throw new RegistryError('PROVIDER_UNAVAILABLE', 'The GLEIF registry could not be reached. No finding was established.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
