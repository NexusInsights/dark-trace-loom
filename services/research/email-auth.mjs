import { Buffer } from 'node:buffer';
import { dkimVerify } from './vendor/mailauth-8.0.4/verify.mjs';
import { getAuthorDomain } from 'mailauth/lib/dmarc/author-domain';

export const MAX_EMAIL_BYTES = 256 * 1024;
export class EmailAuthError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const domain = value => typeof value === 'string' && value.length <= 253 && value.split('.').length >= 2
  && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ? value.toLowerCase() : null;
const selector = value => typeof value === 'string' && value.length <= 253 && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ? value.toLowerCase() : null;
function dnsError(code) { const error = new Error('DKIM DNS resolution unavailable.'); error.code = code; return error; }

// DNS JSON represents each TXT RR as one or more quoted character strings.
// Decode those strings, not JSON/mail content, and preserve RR boundaries.
function txtRecord(value) {
  if (typeof value !== 'string' || value.length > 16384) throw dnsError('EBADRESP');
  let index = 0; let output = ''; let count = 0;
  while (index < value.length) {
    while (/\s/.test(value[index] || '') && index < value.length) index++;
    if (index === value.length) break;
    if (value[index++] !== '"') throw dnsError('EBADRESP');
    let closed = false;
    while (index < value.length) {
      let char = value[index++];
      if (char === '"') { closed = true; break; }
      if (char === '\\') {
        if (/^\d{3}/.test(value.slice(index))) { const code = Number(value.slice(index, index + 3)); if (code > 255) throw dnsError('EBADRESP'); char = String.fromCharCode(code); index += 3; }
        else { char = value[index++]; if (char !== '"' && char !== '\\') throw dnsError('EBADRESP'); }
      }
      if (!char || char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126) throw dnsError('EBADRESP');
      output += char;
    }
    if (!closed) throw dnsError('EBADRESP');
    count++;
  }
  if (!count) throw dnsError('EBADRESP');
  return [output];
}

async function boundedDnsJson(response) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 65536) throw dnsError('ESERVFAIL');
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > 65536) throw dnsError('EBADRESP'); chunks.push(value); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw dnsError('EBADRESP'); }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export function createDkimResolver({ fetchImpl = fetch, signal, maxQueries = 20 } = {}) {
  const limit = Number.isInteger(maxQueries) ? Math.min(20, Math.max(1, maxQueries)) : 20;
  const cache = new Map(); const stats = { queries: 0, unavailable: false };
  const resolver = async (name, type) => {
    const parts = typeof name === 'string' ? name.toLowerCase().replace(/\.$/, '').split('._domainkey.') : [];
    if (type !== 'TXT' || parts.length !== 2 || !selector(parts[0]) || !domain(parts[1]) || name.length > 253) throw dnsError('ENODATA');
    const canonical = `${parts[0]}._domainkey.${parts[1]}`;
    if (signal?.aborted) throw dnsError('ETIMEOUT');
    if (!cache.has(canonical)) {
      if (stats.queries >= limit) { stats.unavailable = true; throw dnsError('EQUERYLIMIT'); }
      stats.queries++;
      cache.set(canonical, (async () => {
        try {
          const url = new URL('https://cloudflare-dns.com/dns-query');
          url.searchParams.set('name', canonical); url.searchParams.set('type', 'TXT');
          const response = await fetchImpl(url.href, { headers: { Accept: 'application/dns-json' }, redirect: 'manual', signal });
          const json = await boundedDnsJson(response);
          if (json.Status === 3) throw dnsError('ENOTFOUND');
          if (json.Status !== 0) throw dnsError('ESERVFAIL');
          const records = (Array.isArray(json.Answer) ? json.Answer : []).filter(answer => answer.type === 16);
          if (!records.length) throw dnsError('ENODATA');
          if (records.length > 20) throw dnsError('EBADRESP');
          return records.map(answer => txtRecord(answer.data));
        } catch (error) {
          if (!['ENOTFOUND', 'ENODATA'].includes(error?.code)) stats.unavailable = true;
          throw dnsError(['ENOTFOUND', 'ENODATA'].includes(error?.code) ? error.code : 'ESERVFAIL');
        }
      })());
    }
    return cache.get(canonical);
  };
  return { resolver, stats };
}

export async function verifyEmailAuthenticity(raw, { fetchImpl = fetch, now = new Date(), timeoutMs = 12000, maxQueries = 20, verifyImpl = dkimVerify, signal } = {}) {
  const cancelled = () => new EmailAuthError('RESEARCH_CANCELLED', 'Email verification was cancelled; no authentication conclusion is available.', 408);
  if (signal?.aborted) throw cancelled();
  if (!(raw instanceof Uint8Array) || !raw.byteLength) throw new EmailAuthError('INVALID_EMAIL', 'Provide an original, nonempty EML file.');
  if (raw.byteLength > MAX_EMAIL_BYTES) throw new EmailAuthError('EMAIL_TOO_LARGE', 'The EML file must be at most 256 KiB.', 413);
  const bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  let boundary = bytes.indexOf('\r\n\r\n'); if (boundary < 0) boundary = bytes.indexOf('\n\n');
  if (boundary < 0 || boundary > 65536) throw new EmailAuthError('INVALID_EMAIL', 'Provide a complete EML with bounded headers and a message body.');
  const headerNames = bytes.subarray(0, boundary).toString('latin1').split(/\r?\n/).filter(line => !/^[ \t]/.test(line)).map(line => line.slice(0, line.indexOf(':')).toLowerCase());
  const count = name => headerNames.filter(value => value === name).length;
  if (count('dkim-signature') > 20 || count('arc-message-signature') > 20) throw new EmailAuthError('TOO_MANY_SIGNATURES', 'At most 20 signatures per type can be checked.');
  const controller = new AbortController();
  const budget = Number.isFinite(timeoutMs) ? Math.min(12000, Math.max(1, timeoutMs)) : 12000;
  const { resolver, stats } = createDkimResolver({ fetchImpl, signal: controller.signal, maxQueries });
  let timer; let rejectCancelled;
  const cancellation = new Promise((_, reject) => { rejectCancelled = reject; });
  const abort = () => { controller.abort(); rejectCancelled(cancelled()); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw cancelled();
    const checked = await Promise.race([
      verifyImpl(bytes, { resolver, strict: true, minBitLength: 1024, curTime: now }),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new EmailAuthError('VERIFICATION_TIMEOUT', 'Verification exceeded its 12-second maximum budget; no authentication conclusion is available.', 504)); }, budget); }),
      cancellation,
    ]);
    if (signal?.aborted) throw cancelled();
    const author = getAuthorDomain(checked.headerFrom, checked.fromFields, { strict: true, fromSyntax: checked.fromSyntax });
    const fromDomain = count('from') === 1 && author.mailboxes === 1 ? domain(author.authorDomain) : null;
    const signatures = (checked.results || []).slice(0, 20).filter(result => result.signingDomain || result.status?.result !== 'none').map(result => {
      const resultCode = ['pass', 'fail', 'neutral', 'policy', 'temperror', 'none'].includes(result.status?.result) ? result.status.result : 'unknown';
      const signingDomain = domain(result.signingDomain);
      const bodyLengthLimited = result.canonBodyLengthLimited === true;
      const unsignedTail = bodyLengthLimited && (result.status?.underSized > 0 || result.canonBodyLengthTotal > result.canonBodyLength);
      return { signingDomain, selector: selector(result.selector), algorithm: ['rsa-sha256', 'ed25519-sha256', 'rsa-sha1'].includes(result.algo) ? result.algo : 'unsupported',
        result: resultCode, bodyLengthLimited, unsignedBodyTail: Boolean(unsignedTail),
        fullBodyCovered: !bodyLengthLimited && resultCode === 'pass', strictFromAligned: Boolean(fromDomain && signingDomain === fromDomain), testingKey: result.status?.testing === true };
    });
    const pass = signatures.filter(signature => signature.result === 'pass');
    const safeAligned = pass.some(signature => signature.fullBodyCovered && signature.strictFromAligned && !signature.testingKey);
    const status = !signatures.length ? 'unsigned' : !fromDomain ? 'inconclusive' : safeAligned ? 'aligned_signature'
      : pass.some(signature => signature.bodyLengthLimited) ? 'partial_signature' : pass.some(signature => signature.testingKey) ? 'inconclusive' : pass.length ? 'signature_valid_unaligned'
        : signatures.every(signature => ['fail', 'policy'].includes(signature.result)) ? 'verification_failed' : 'inconclusive';
    return { status, dkim: { signatures, cryptographicPass: pass.length > 0, dnsQueries: stats.queries, dnsUnavailable: stats.unavailable },
      fromAlignment: { mode: 'strict', fromDomain, status: !fromDomain ? 'ambiguous_or_invalid' : safeAligned ? 'aligned' : 'not_established' },
      uploadedReceiverClaims: { trust: 'untrusted', authenticationResultsPresent: count('authentication-results') > 0, receivedSpfPresent: count('received-spf') > 0, arcHeadersPresent: count('arc-authentication-results') > 0 || count('arc-seal') > 0 },
      spf: 'not_verified', dmarc: 'not_verified', arc: 'not_verified', checkedAt: now.toISOString(),
      limitations: ['DKIM verifies domain signatures over signed content, not a person or whether a message is safe.', 'Strict From alignment is separate from signature validity and is not a DMARC determination.', 'Uploaded receiver headers are untrusted claims; no trusted SMTP envelope or receiver evidence was supplied.', 'Current DNS keys are used; removed or rotated historical keys can make an old message unverifiable.', 'Body-length-limited signatures do not establish full-message authenticity.'] };
  } catch (error) {
    if (error instanceof EmailAuthError) throw error;
    throw new EmailAuthError('VERIFICATION_UNAVAILABLE', 'The message could not be verified; no authentication conclusion is available.', 502);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
}
