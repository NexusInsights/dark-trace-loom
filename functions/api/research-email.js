import { executeResearch, ResearchAdmissionError } from '../../services/research/admission.mjs';
import { EmailAuthError, MAX_EMAIL_BYTES, verifyEmailAuthenticity } from '../../services/research/email-auth.mjs';

const json = (body, status = 200, retryAfter) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) } });
const cancelled = () => new ResearchAdmissionError(408, 'RESEARCH_CANCELLED', 'Email verification was cancelled or timed out; no automatic retry was made.');
async function rawEmail(request, signal) {
  if (Number(request.headers.get('content-length')) > MAX_EMAIL_BYTES) throw new EmailAuthError('EMAIL_TOO_LARGE', 'The EML file must be at most 256 KiB.', 413);
  if (!request.body) throw new EmailAuthError('INVALID_EMAIL', 'An original EML file is required.');
  const reader = request.body.getReader(); const chunks = []; let length = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw cancelled();
    for (;;) { const { value, done } = await reader.read(); if (signal.aborted) throw cancelled(); if (done) break; length += value.byteLength; if (length > MAX_EMAIL_BYTES) throw new EmailAuthError('EMAIL_TOO_LARGE', 'The EML file must be at most 256 KiB.', 413); chunks.push(value); }
    if (!length) throw new EmailAuthError('INVALID_EMAIL', 'An original, nonempty EML file is required.');
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
  } finally { signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export function createEmailResearchHandler({ verify = verifyEmailAuthenticity, fetchImpl } = {}) {
  return async ({ request, env }) => {
    try {
      const data = await executeResearch(request, env, 'research-email', ({ input, signal }) => verify(input, { signal }), {
        ...(fetchImpl ? { fetchImpl } : {}),
        prepare: async ({ signal }) => {
          if (request.headers.get('x-email-processing-consent') !== 'true') throw new EmailAuthError('CONSENT_REQUIRED', 'Explicit consent to server processing and DKIM DNS queries is required.');
          if (!['message/rfc822', 'application/octet-stream'].includes((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase())) throw new EmailAuthError('INVALID_CONTENT_TYPE', 'Upload original EML bytes as message/rfc822.', 415);
          return rawEmail(request, signal);
        },
      });
      return json({ ok: true, data });
    } catch (error) {
      const known = error instanceof EmailAuthError || error instanceof ResearchAdmissionError ? error : new EmailAuthError('VERIFICATION_UNAVAILABLE', 'Email verification is unavailable. Check authentication configuration and retry only when ready.', 503);
      return json({ ok: false, error: { code: known.code, message: known.message, ...(known.retryAfter ? { retryAfter: known.retryAfter } : {}), ...(known.operationCompleted ? { operationCompleted: true } : {}) } }, known.status, known.retryAfter);
    }
  };
}
export const onRequestPost = createEmailResearchHandler();
export const onRequestGet = () => json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use an authenticated POST with an original EML file.' } }, 405);
