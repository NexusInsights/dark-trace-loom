import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { dkimSign } from 'mailauth/lib/dkim/sign';
import { createDkimResolver, EmailAuthError, verifyEmailAuthenticity } from './email-auth.mjs';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const time = new Date('2026-11-01T12:00:00Z');
const message = Buffer.concat([Buffer.from('From: Sender <sender@example.com>\r\nTo: private-recipient@example.net\r\nSubject: private-fixture-subject\r\nDate: Sun, 1 Nov 2026 12:00:00 +0000\r\nContent-Type: application/octet-stream\r\n\r\n'), Buffer.from([0x68, 0x69, 0x00, 0xff, 0x0d, 0x0a])]);
async function signed({ pair = rsa, algorithm = 'rsa-sha256', body = message, maxBodyLength, signingDomain = 'example.com' } = {}) {
  const result = await dkimSign(body, { strict: true, signTime: time, headerList: 'from:to:subject:date:content-type', signatureData: [{ signingDomain, selector: 'fixture', privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), algorithm, ...(maxBodyLength === undefined ? {} : { maxBodyLength }) }] });
  assert.equal(result.errors.length, 0);
  return Buffer.concat([Buffer.from(result.signatures), body]);
}
function dns(pair = rsa, algorithm = 'rsa') {
  const der = pair.publicKey.export({ type: 'spki', format: 'der' });
  const key = algorithm === 'ed25519' ? der.subarray(-32) : der;
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ Status: 0, Answer: [{ type: 16, data: `"v=DKIM1; k=${algorithm}; p=" "${key.toString('base64')}"` }] }); };
  return { fetchImpl, calls };
}

test('real strict RSA verifies original binary bytes, domain alignment, and excludes private input from output', async () => {
  const fixture = await signed(); const lookup = dns();
  const result = await verifyEmailAuthenticity(fixture, { ...lookup, now: time });
  assert.equal(result.status, 'aligned_signature');
  assert.equal(result.dkim.cryptographicPass, true);
  assert.equal(result.fromAlignment.status, 'aligned');
  assert.equal(result.dkim.signatures[0].fullBodyCovered, true);
  assert.equal(lookup.calls.length, 1);
  assert.equal(new URL(lookup.calls[0].url).origin, 'https://cloudflare-dns.com');
  assert.equal(new URL(lookup.calls[0].url).searchParams.get('name'), 'fixture._domainkey.example.com');
  assert.equal(lookup.calls[0].init.redirect, 'manual');
  assert.doesNotMatch(JSON.stringify(result), /sender@|recipient@|private-fixture|DKIM-Signature|BEGIN PUBLIC|bodyHash/);
});
test('real Ed25519 verification uses the pinned SDK and raw DNS key', async () => {
  const pair = generateKeyPairSync('ed25519');
  const result = await verifyEmailAuthenticity(await signed({ pair, algorithm: 'ed25519-sha256' }), { ...dns(pair, 'ed25519'), now: time });
  assert.equal(result.status, 'aligned_signature');
  assert.equal(result.dkim.signatures[0].algorithm, 'ed25519-sha256');
});
test('tampered body and signed headers fail actual cryptographic verification', async () => {
  const fixture = await signed();
  for (const changed of [Buffer.concat([fixture, Buffer.from('tamper')]), Buffer.from(fixture.toString('latin1').replace('private-fixture-subject', 'changed-private-subject'), 'latin1')]) {
    const result = await verifyEmailAuthenticity(changed, { ...dns(), now: time });
    assert.equal(result.dkim.cryptographicPass, false);
    assert.equal(result.status, 'verification_failed');
  }
});
test('a valid different signing domain does not establish strict From alignment', async () => {
  const result = await verifyEmailAuthenticity(await signed({ signingDomain: 'sub.example.com' }), { ...dns(), now: time });
  assert.equal(result.dkim.cryptographicPass, true);
  assert.equal(result.status, 'signature_valid_unaligned');
  assert.equal(result.fromAlignment.status, 'not_established');
});
test('forged uploaded receiver pass claims never become independently verified SPF DMARC ARC or DKIM', async () => {
  const forged = Buffer.concat([Buffer.from('Authentication-Results: forged.example; dkim=pass; spf=pass; dmarc=pass\r\nReceived-SPF: pass\r\n'), message]);
  const calls = dns(); const result = await verifyEmailAuthenticity(forged, { ...calls, now: time });
  assert.equal(result.status, 'unsigned'); assert.equal(result.uploadedReceiverClaims.trust, 'untrusted');
  assert.equal(result.uploadedReceiverClaims.authenticationResultsPresent, true);
  assert.equal(result.spf, 'not_verified'); assert.equal(result.dmarc, 'not_verified'); assert.equal(result.arc, 'not_verified');
  assert.equal(calls.calls.length, 0);
});
test('l= signatures with an unsigned body tail cannot establish full-message authenticity', async () => {
  const body = Buffer.from('From: sender@example.com\r\nSubject: fixture\r\n\r\nOriginal body\r\n');
  const fixture = await signed({ body, maxBodyLength: 5 });
  const result = await verifyEmailAuthenticity(Buffer.concat([fixture, Buffer.from('unsigned appended content\r\n')]), { ...dns(), now: time });
  assert.equal(result.dkim.cryptographicPass, true);
  assert.equal(result.status, 'partial_signature');
  assert.equal(result.dkim.signatures[0].unsignedBodyTail, true);
  assert.equal(result.dkim.signatures[0].fullBodyCovered, false);
});
test('duplicate From headers cannot produce an aligned-message conclusion', async () => {
  const result = await verifyEmailAuthenticity(Buffer.concat([Buffer.from('From: other@example.com\r\n'), await signed()]), { ...dns(), now: time });
  assert.equal(result.status, 'inconclusive'); assert.equal(result.fromAlignment.status, 'ambiguous_or_invalid');
});
test('unavailable DNS is unknown/inconclusive, not evidence of forgery; errors disclose no upstream details', async () => {
  const result = await verifyEmailAuthenticity(await signed(), { fetchImpl: async () => { throw new Error('private-upstream-credential'); }, now: time });
  assert.equal(result.status, 'inconclusive'); assert.equal(result.dkim.dnsUnavailable, true);
  assert.doesNotMatch(JSON.stringify(result), /private-upstream/);
});
test('DoH redirects are not followed or parsed as keys, even when the redirect body contains the valid public key', async () => {
  const fixture = await signed();
  const key = rsa.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  for (const status of [301, 302, 303, 307, 308]) {
    const calls = [];
    const response = Response.json({ Status: 0, Answer: [{ type: 16, data: `"v=DKIM1; k=rsa; p=${key}"` }] }, { status, headers: { Location: 'https://unapproved-dns.example/redirected-key' } });
    const result = await verifyEmailAuthenticity(fixture, { now: time, fetchImpl: async (url, init) => {
      calls.push({ url: String(url), redirect: init.redirect }); return response;
    } });
    assert.deepEqual(calls, [{ url: 'https://cloudflare-dns.com/dns-query?name=fixture._domainkey.example.com&type=TXT', redirect: 'manual' }]);
    assert.equal(response.bodyUsed, false, 'Non-2xx responses must be rejected before DNS JSON parsing.');
    assert.equal(result.status, 'inconclusive'); assert.equal(result.dkim.cryptographicPass, false); assert.equal(result.dkim.dnsUnavailable, true);
    assert.equal(result.dkim.dnsQueries, 1);
  }
});
test('a domain testing key does not become an aligned-authenticity conclusion', async () => {
  const lookup = dns();
  const result = await verifyEmailAuthenticity(await signed(), { now: time, fetchImpl: async (url, init) => {
    const response = await lookup.fetchImpl(url, init); const body = await response.json();
    body.Answer[0].data = body.Answer[0].data.replace('v=DKIM1;', 'v=DKIM1; t=y;');
    return Response.json(body);
  } });
  assert.equal(result.dkim.signatures[0].testingKey, true);
  assert.equal(result.status, 'inconclusive');
});
test('strict verification rejects historical rsa-sha1 rather than treating it as an accepted pass', async () => {
  const created = await dkimSign(message, { algorithm: 'rsa-sha1', signTime: time, signatureData: [{ signingDomain: 'example.com', selector: 'fixture', privateKey: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }) }] });
  assert.equal(created.errors.length, 0);
  const result = await verifyEmailAuthenticity(Buffer.concat([Buffer.from(created.signatures), message]), { ...dns(), now: time });
  assert.equal(result.dkim.cryptographicPass, false);
  assert.equal(result.dkim.signatures[0].result, 'policy');
});
test('DNS resolver permits only bounded DKIM TXT names, fixed HTTPS endpoint and twenty queries', async () => {
  let calls = 0;
  const { resolver } = createDkimResolver({ fetchImpl: async () => { calls++; return Response.json({ Status: 0, Answer: [{ type: 16, data: '"v=DKIM1; p=fixture"' }] }); } });
  for (const [name, type] of [['example.com', 'TXT'], ['https://evil.example/x._domainkey.example.com', 'TXT'], ['a._domainkey.example.com', 'A']]) await assert.rejects(resolver(name, type));
  assert.equal(calls, 0);
  for (let index = 0; index < 20; index++) await resolver(`s${index}._domainkey.example.com`, 'TXT');
  await assert.rejects(resolver('last._domainkey.example.com', 'TXT'));
  await resolver('s0._domainkey.example.com', 'TXT');
  assert.equal(calls, 20);
});
test('overall verification deadline aborts resolver work and reports no authentication conclusion', async () => {
  await assert.rejects(verifyEmailAuthenticity(message, { verifyImpl: () => new Promise(() => undefined), timeoutMs: 10 }), error => error instanceof EmailAuthError && error.code === 'VERIFICATION_TIMEOUT' && error.status === 504);
});

test('external cancellation aborts actual DNS and rejects before a late SDK result', async () => {
  const controller = new AbortController(); let dnsSignal; let started;
  const ready = new Promise(resolve => { started = resolve; });
  const pending = verifyEmailAuthenticity(await signed(), { signal: controller.signal, now: time, fetchImpl: async (_url, init) => {
    dnsSignal = init.signal; started();
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('cancelled fixture')), { once: true }));
  } });
  await ready; controller.abort();
  await assert.rejects(pending, error => error.code === 'RESEARCH_CANCELLED' && error.status === 408);
  assert.equal(dnsSignal.aborted, true);
  let ran = 0;
  await assert.rejects(verifyEmailAuthenticity(message, { signal: controller.signal, verifyImpl: async () => { ran++; } }), error => error.code === 'RESEARCH_CANCELLED');
  assert.equal(ran, 0);
  const handoff = new AbortController();
  await assert.rejects(verifyEmailAuthenticity(message, { signal: handoff.signal, verifyImpl: async () => { handoff.abort(); return {}; } }), error => error.code === 'RESEARCH_CANCELLED');
});
