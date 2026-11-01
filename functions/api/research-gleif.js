import { executeResearch, readResearchJson, ResearchAdmissionError } from '../../services/research/admission.mjs';
import { lookupLegalEntity, validateLEI, RegistryError } from '../../services/research/gleif.mjs';

export function createRegistryResearchHandler({ fetchImpl = globalThis.fetch } = {}) {
 return async function handlePost({ request, env }) {
  try {
    let lei;
    const data = await executeResearch(request, env, 'research-gleif', ({ signal }) => lookupLegalEntity(lei, { signal, fetchImpl }), {
      fetchImpl,
      prepare: async () => {
        const input = await readResearchJson(request, 2048);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'lei')) throw new RegistryError('INVALID_INPUT', 'Provide only the legal entity identifier.', 400);
        lei = validateLEI(input.lei);
      },
    });
    return Response.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const known = error instanceof ResearchAdmissionError || error instanceof RegistryError;
    const status = known && Number.isInteger(error.status) ? error.status : 503;
    const retryAfter = known && Number.isInteger(error.retryAfter) ? error.retryAfter : undefined;
    return Response.json({ ok: false, error: { code: known ? error.code : 'REGISTRY_UNAVAILABLE', message: known ? error.message : 'The registry lookup could not be completed.', ...(retryAfter ? { retryAfter } : {}) } }, { status, headers: { 'Cache-Control': 'no-store', ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) } });
  }
 };
}

const handlePost = createRegistryResearchHandler();

export function onRequest(context) {
  const { request } = context;
  if (request.method === 'POST') return handlePost(context);
  return Response.json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } }, { status: 405, headers: { 'Cache-Control': 'no-store', Allow: 'POST' } });
}
