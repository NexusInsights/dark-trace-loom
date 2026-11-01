// Portable Web API boundary for Pages/Node/Deno. Only admission metadata enters
// the existing RPCs; task/prepare inputs and results are never serialized here.
export const EXECUTION_ACTIONS = Object.freeze(["ipinfo", "breach", "profile", "onion", "research-privacy", "research-password", "research-email", "research-gleif"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = value => value && typeof value === "object" && !Array.isArray(value);
export class ResearchAdmissionError extends Error {
  constructor(status, code, message, details = {}) {
    super(message); this.name = "ResearchAdmissionError"; this.status = status; this.code = code;
    if (Number.isInteger(details.retryAfter) && details.retryAfter > 0) this.retryAfter = Math.min(details.retryAfter, 86400);
    this.operationCompleted = details.operationCompleted === true;
  }
}
function configuration(env) {
  let base; try { base = new URL(env.SUPABASE_URL); } catch { throw new ResearchAdmissionError(503, "AUTH_CONFIGURATION", "Research authentication is not configured."); }
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/" || (base.port && base.port !== "443") || !base.hostname.includes(".") || /^[\d.]+$/.test(base.hostname) || /(?:^|\.)(?:localhost|local|internal|invalid)$/.test(base.hostname) || typeof key !== "string") throw new ResearchAdmissionError(503, "AUTH_CONFIGURATION", "Research authentication requires a configured HTTPS backend and public key.");
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publicKey) {
    try {
      const parts = key.split("."); if (parts.length !== 3) throw new Error();
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parts[1].length / 4) * 4, "=")));
      const ref = base.hostname.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1];
      publicKey = payload.role === "anon" && (!ref || payload.ref === ref);
    } catch { publicKey = false; }
  }
  if (!publicKey) throw new ResearchAdmissionError(503, "AUTH_CONFIGURATION", "A privileged or invalid backend key cannot be used for research authentication.");
  return { url: base.origin, key };
}
function abortError() { return new ResearchAdmissionError(408, "RESEARCH_CANCELLED", "Research was cancelled or timed out; no automatic retry was made."); }
async function boundedWork(work, signal, timeoutMs) {
  const controller = new AbortController(); let timer; let rejectAbort;
  const cancelled = new Promise((_, reject) => { rejectAbort = () => { controller.abort(); reject(abortError()); }; });
  const abort = () => rejectAbort();
  signal?.addEventListener("abort", abort, { once: true });
  timer = setTimeout(abort, timeoutMs);
  try {
    if (signal?.aborted) throw abortError();
    return await Promise.race([Promise.resolve().then(() => work(controller.signal)), cancelled]);
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.abort(); }
}
export async function readResearchRawBody(message, maxBytes = 512 * 1024, options = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) throw new ResearchAdmissionError(500, "BODY_CONFIGURATION", "The research body bound is invalid.");
  if (Number(message.headers.get("content-length")) > maxBytes) throw new ResearchAdmissionError(413, "REQUEST_TOO_LARGE", "The research request exceeds its size limit.");
  if (!message.body) throw new ResearchAdmissionError(400, "INVALID_INPUT", "A request body is required.");
  const reader = message.body.getReader(); const chunks = []; let bytes = 0;
  try {
    return await boundedWork(async signal => {
      const cancel = () => { void reader.cancel().catch(() => undefined); };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        for (;;) {
          const part = await reader.read(); if (signal.aborted) throw abortError(); if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > maxBytes) throw new ResearchAdmissionError(413, "REQUEST_TOO_LARGE", "The research request exceeds its size limit.");
          chunks.push(part.value);
        }
        const value = new Uint8Array(bytes); let offset = 0;
        for (const chunk of chunks) { value.set(chunk, offset); offset += chunk.byteLength; }
        try { return new TextDecoder("utf-8", { fatal: true }).decode(value); }
        catch { throw new ResearchAdmissionError(400, "INVALID_INPUT", "The request must contain valid UTF-8 text."); }
      } finally { signal.removeEventListener("abort", cancel); }
    }, options.signal, Math.min(10000, options.timeoutMs || 10000));
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export async function readResearchJson(request, maxBytes = 512 * 1024, options = {}) {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new ResearchAdmissionError(415, "INVALID_INPUT", "Use a JSON research request.");
  let value; try { value = JSON.parse(await readResearchRawBody(request, maxBytes, options)); }
  catch (error) { if (error instanceof ResearchAdmissionError) throw error; throw new ResearchAdmissionError(400, "INVALID_INPUT", "The research request contains invalid JSON."); }
  if (!object(value)) throw new ResearchAdmissionError(400, "INVALID_INPUT", "Provide a JSON object.");
  return value;
}
async function backendJson(url, init, fetchImpl, maxBytes = 16384) {
  try { return await boundedWork(async signal => {
    // Workers supports manual/follow, but rejects the Fetch-standard error mode
    // before sending. Never follow a redirect with account credentials.
    const response = await fetchImpl(url, { ...init, redirect: "manual", signal });
    const redirected = response.status >= 300 && response.status < 400;
    if (redirected || !response.ok) throw new ResearchAdmissionError(response.status === 401 || response.status === 403 ? 401 : 503, "BACKEND_UNAVAILABLE", "Research account access or accounting could not be verified.");
    try { return JSON.parse(await readResearchRawBody(response, maxBytes, { signal })); }
    catch (error) { if (error instanceof ResearchAdmissionError) throw error; throw new ResearchAdmissionError(502, "INVALID_BACKEND_RESPONSE", "The research backend returned an invalid response."); }
  }, undefined, 12000); }
  catch (error) { if (error instanceof ResearchAdmissionError) throw error; throw new ResearchAdmissionError(503, "BACKEND_UNAVAILABLE", "Research account access or accounting could not be verified."); }
}
async function actor(request, env, fetchImpl) {
  let origin; try { origin = new URL(request.url).origin; } catch { throw new ResearchAdmissionError(400, "INVALID_REQUEST", "The research request URL is invalid."); }
  const suppliedOrigin = request.headers.get("origin");
  if (suppliedOrigin && suppliedOrigin !== origin) throw new ResearchAdmissionError(403, "FORBIDDEN_ORIGIN", "Cross-origin research requests are not permitted.");
  if (request.method !== "POST") throw new ResearchAdmissionError(405, "METHOD_NOT_ALLOWED", "Use an authenticated POST request.");
  const authorization = request.headers.get("authorization") || "";
  if (authorization.length > 8192 || !/^Bearer [^\s]+$/i.test(authorization)) throw new ResearchAdmissionError(401, "UNAUTHORIZED", "Sign in before running research tools.");
  const config = configuration(env);
  const user = await backendJson(`${config.url}/auth/v1/user`, { headers: { Authorization: authorization, apikey: config.key, Accept: "application/json" } }, fetchImpl, 65536);
  if (!object(user) || !UUID.test(user.id || "")) throw new ResearchAdmissionError(502, "INVALID_AUTH_RESPONSE", "The authentication service supplied no valid account identity.");
  if (user.is_anonymous === true || (user.role !== undefined && user.role !== "authenticated")) throw new ResearchAdmissionError(403, "UNAUTHORIZED", "A nonanonymous signed-in account is required.");
  return { ...config, id: user.id, authorization };
}
async function rpc(user, name, body, fetchImpl) {
  return backendJson(`${user.url}/rest/v1/rpc/${name}`, { method: "POST", headers: { Authorization: user.authorization, apikey: user.key, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) }, fetchImpl);
}
export function requireReservation(result) {
  if (result?.allowed === true && UUID.test(result.id || "")) return result.id;
  const code = ["UNAUTHORIZED", "FORBIDDEN", "DAILY_LIMIT", "INVALID_INPUT"].includes(result?.code) ? result.code : "ADMISSION_FAILED";
  const status = { UNAUTHORIZED: 401, FORBIDDEN: 403, DAILY_LIMIT: 429, INVALID_INPUT: 400 }[code] || 503;
  throw new ResearchAdmissionError(status, code, code === "DAILY_LIMIT" ? "The daily tool allowance has been reached." : code === "FORBIDDEN" ? "An administrator has disabled this research tool." : "Research execution could not be authorized.", { retryAfter: result?.retryAfter });
}
export async function executeResearch(request, env, action, task, options = {}) {
  if (!EXECUTION_ACTIONS.includes(action) || typeof task !== "function" || (options.prepare !== undefined && typeof options.prepare !== "function")) throw new ResearchAdmissionError(400, "INVALID_INPUT", "Select a supported research operation.");
  const taskTimeoutMs = options.taskTimeoutMs ?? 20000;
  if (!Number.isInteger(taskTimeoutMs) || taskTimeoutMs < 1 || taskTimeoutMs > 20000) throw new ResearchAdmissionError(500, "TIMEOUT_CONFIGURATION", "Research task timeout configuration is invalid.");
  const fetchImpl = options.fetchImpl || fetch;
  const user = await actor(request, env, fetchImpl);
  const input = options.prepare ? await boundedWork(signal => options.prepare({ userId: user.id, signal }), request.signal, 10000) : undefined;
  if (request.signal?.aborted) throw abortError();
  const executionId = requireReservation(await rpc(user, "reserve_intelligence_execution", { p_action: action }, fetchImpl));
  let data;
  try {
    data = await boundedWork(signal => task({ userId: user.id, signal, input }), request.signal, taskTimeoutMs);
  } catch (error) {
    try { const released = await rpc(user, "finish_intelligence_execution", { p_execution_id: executionId, p_success: false }, fetchImpl); if (released?.ok !== true) throw new Error("Unconfirmed release"); }
    catch { throw new ResearchAdmissionError(503, "ACCOUNTING_RELEASE_FAILED", "The operation failed and its admission release could not be confirmed. The pending reservation expires after two minutes; no automatic retry was made."); }
    throw error;
  }
  try { const completed = await rpc(user, "finish_intelligence_execution", { p_execution_id: executionId, p_success: true }, fetchImpl); if (completed?.ok !== true) throw new Error("Unconfirmed settlement"); }
  catch { throw new ResearchAdmissionError(503, "ACCOUNTING_FAILED", "The operation completed but tool accounting could not be confirmed. No successful result or automatic retry was returned.", { operationCompleted: true }); }
  return data;
}
