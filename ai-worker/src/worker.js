// Existing Cloudflare Workers AI binding, authenticated only against the new
// owned Supabase project. No API key, service role, paid provider or fallback.
export const AI_AUTH_BACKEND = "https://ocliymtdvtxfxczxgbjr.supabase.co";
export const AI_FIXED_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const AI_TOOLS = new Set(["analyze-case", "social-profile-scrape", "sentiment-analysis", "translation"]);
const AI_PERMISSION_IDS = { "social-profile-scrape": "social-scrape" };
const AI_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class AiWorkerError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}
const aiResponse = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
async function aiReadBody(body, declared, limit, timeout = 5000) {
  if (Number(declared) > limit) { await body?.cancel().catch(() => {}); throw new AiWorkerError("body_size_limit", 413); }
  const reader = body?.getReader(); if (!reader) throw new AiWorkerError("empty_body", 400);
  const chunks = []; let total = 0, timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new AiWorkerError("body_timeout", 408)), timeout); });
  try {
    for (;;) { const part = await Promise.race([reader.read(), deadline]); if (part.done) break; total += part.value.byteLength; if (total > limit) throw new AiWorkerError("body_size_limit", 413); chunks.push(part.value); }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new AiWorkerError("invalid_utf8_body", 400); }
    try { return JSON.parse(text); } catch { throw new AiWorkerError("invalid_json_body", 400); }
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function aiAuthRequest(path, authorization, publishableKey) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(AI_AUTH_BACKEND + path, { redirect: "manual", signal: controller.signal, headers: { Authorization: authorization, apikey: publishableKey } });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      throw new AiWorkerError("authorization_service_redirect_rejected");
    }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); if (response.status === 401 || response.status === 403) throw new AiWorkerError("session_or_data_access_rejected", response.status === 401 ? 401 : 403); throw new AiWorkerError("authorization_service_http_" + response.status); }
    return await aiReadBody(response.body, response.headers.get("content-length"), 32 * 1024, 10000);
  } catch (error) {
    if (error instanceof AiWorkerError) throw error;
    const name = error instanceof Error ? error.name : "UnknownError";
    const detail = error instanceof Error ? error.message : "";
    const category = /illegal invocation/i.test(detail) ? "binding" : /redirect/i.test(detail) ? "redirect" : /cancel|locked|stream/i.test(detail) ? "stream" : /fetch|network|dns|resolve/i.test(detail) ? "network" : /tls|ssl|certificate/i.test(detail) ? "tls" : "unknown";
    const kind = (["TypeError", "ReferenceError", "RangeError", "SyntaxError", "AbortError"].includes(name) ? name : "Error") + "_" + category;
    throw new AiWorkerError(controller.signal.aborted ? "authorization_service_timeout" : "authorization_service_unavailable_" + kind);
  }
  finally { clearTimeout(timer); }
}
function aiValidateInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiWorkerError("invalid_request_object", 400);
  const keys = ["tool_id", "model", "messages", "temperature", "max_tokens", "stream", "response_format"];
  if (Object.keys(value).some(key => !keys.includes(key)) || !AI_TOOLS.has(value.tool_id) || value.model !== AI_FIXED_MODEL || value.stream !== false || value.temperature !== 0) throw new AiWorkerError("unsupported_request_options", 400);
  if (!Array.isArray(value.messages) || !value.messages.length || value.messages.length > 16 || !value.messages.every(message => message && typeof message === "object" && !Array.isArray(message) && Object.keys(message).every(key => ["role", "content"].includes(key)) && ["system", "user", "assistant"].includes(message.role) && typeof message.content === "string" && message.content.length <= 200000)) throw new AiWorkerError("invalid_or_oversized_messages", 400);
  if (!Number.isInteger(value.max_tokens) || value.max_tokens < 1 || value.max_tokens > 4096) throw new AiWorkerError("output_token_limit", 400);
  if (!value.response_format || typeof value.response_format !== "object" || Array.isArray(value.response_format) || value.response_format.type !== "json_object" || Object.keys(value.response_format).some(key => key !== "type")) throw new AiWorkerError("structured_json_output_required", 400);
  return value;
}
async function aiAuthorizeUser(authorization, key, tool) {
  // An actual Auth service response establishes identity; no decoded claims.
  const user = await aiAuthRequest("/auth/v1/user", authorization, key);
  if (!user || typeof user !== "object" || !AI_UUID.test(user.id || "")) throw new AiWorkerError("verified_user_required", 401);
  const subscriptionQuery = new URLSearchParams({ select: "user_id,plan,status,current_period_end", user_id: "eq." + user.id, limit: "2" });
  const permissionId = AI_PERMISSION_IDS[tool] || tool;
  const permissionQuery = new URLSearchParams({ select: "user_id,tool_id,allowed", user_id: "eq." + user.id, tool_id: "eq." + permissionId, limit: "2" });
  const [subscriptions, permissions] = await Promise.all([aiAuthRequest("/rest/v1/subscriptions?" + subscriptionQuery, authorization, key), aiAuthRequest("/rest/v1/tool_permissions?" + permissionQuery, authorization, key)]);
  if (!Array.isArray(subscriptions) || subscriptions.length > 1) throw new AiWorkerError("subscription_state_not_verified");
  const row = subscriptions[0];
  if (!row || row.user_id !== user.id || row.status !== "active" || !["professional", "team", "enterprise"].includes(row.plan)) throw new AiWorkerError("active_professional_team_or_enterprise_required", 403);
  if (row.current_period_end !== null && (typeof row.current_period_end !== "string" || !Number.isFinite(Date.parse(row.current_period_end)) || Date.parse(row.current_period_end) <= Date.now())) throw new AiWorkerError("subscription_expired_or_invalid", 403);
  if (!Array.isArray(permissions) || permissions.length > 1 || permissions.some(row => !row || row.user_id !== user.id || row.tool_id !== permissionId || typeof row.allowed !== "boolean")) throw new AiWorkerError("tool_permission_state_not_verified");
  if (permissions.some(row => row.allowed === false)) throw new AiWorkerError("tool_disabled_for_user", 403);
  // No row means the existing app's default entitlement: no administrator
  // override. The successful RLS query and active paid-tier override are required.
}
function aiValidatedCompletion(value, input) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.error || value instanceof ReadableStream) throw new AiWorkerError("invalid_workers_ai_completion");
  if (Array.isArray(value.choices) && value.choices.length) {
    const choice = value.choices[0]; const message = choice?.message;
    if (!message || typeof message.content !== "string" || !message.content.trim() || message.content.length > 200000 || message.refusal || choice.finish_reason === "length" || choice.finish_reason === "content_filter") throw new AiWorkerError("workers_ai_completion_missing_refused_or_truncated");
    try { JSON.parse(message.content); } catch { throw new AiWorkerError("workers_ai_structured_output_invalid"); }
    const output = { choices: [{ message: { role: "assistant", content: message.content }, finish_reason: typeof choice.finish_reason === "string" ? choice.finish_reason : null }], model: typeof value.model === "string" && value.model.length <= 200 ? value.model : AI_FIXED_MODEL, id: typeof value.id === "string" && value.id.length <= 200 ? value.id : null, provider: "Cloudflare Workers AI", configured_model: AI_FIXED_MODEL, source_transport: "ai_binding", retrieved_at: new Date().toISOString() };
    return output;
  }
  // Some Workers AI models return {response,usage}. Preserve actual content;
  // never invent a model response ID or a successful finish_reason.
  const response = typeof value.response === "string" ? value.response : value.response && typeof value.response === "object" && !Array.isArray(value.response) ? JSON.stringify(value.response) : null;
  if (!response || response.length > 200000 || Number(value.usage?.completion_tokens) >= input.max_tokens) throw new AiWorkerError("workers_ai_completion_missing_or_potentially_truncated");
  try { JSON.parse(response); } catch { throw new AiWorkerError("workers_ai_structured_output_invalid"); }
  return { choices: [{ message: { role: "assistant", content: response }, finish_reason: null }], model: AI_FIXED_MODEL, id: typeof value.id === "string" && value.id.length <= 200 ? value.id : null, provider: "Cloudflare Workers AI", configured_model: AI_FIXED_MODEL, source_transport: "ai_binding", finish_reason_available: false, retrieved_at: new Date().toISOString() };
}
export async function handleAiRequest(req, env) {
  const started = Date.now();
  if (new URL(req.url).pathname !== "/v1/chat/completions") return aiResponse({ error: { code: "not_found" } }, 404);
  if (req.method !== "POST") return aiResponse({ error: { code: "post_required" } }, 405);
  try {
    const authorization = req.headers.get("Authorization") || "";
    if (authorization.length > 8192 || !/^Bearer \S+$/i.test(authorization)) throw new AiWorkerError("sign_in_required", 401);
    if (env.WORKERS_AI_ENABLED !== "true" || env.WORKERS_AI_ZERO_SPEND_VERIFIED !== "true" || env.WORKERS_AI_VERIFIED_PLAN !== "free") throw new AiWorkerError("verified_free_workers_ai_configuration_required", 424);
    const attested = env.WORKERS_AI_VERIFIED_AT || "", expires = env.WORKERS_AI_VERIFICATION_EXPIRES_AT || "";
    if (attested || expires) {
      const date = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
      const verifiedAt = Date.parse(attested), expiresAt = Date.parse(expires);
      if (!date.test(attested) || !date.test(expires) || !Number.isFinite(verifiedAt) || !Number.isFinite(expiresAt) || new Date(verifiedAt).toISOString().slice(0,19) !== attested.slice(0,19) || new Date(expiresAt).toISOString().slice(0,19) !== expires.slice(0,19) || verifiedAt > Date.now() + 60000 || expiresAt <= Date.now() || expiresAt <= verifiedAt || expiresAt - verifiedAt > 86400000) throw new AiWorkerError("free_plan_attestation_expired_or_invalid", 424);
    }
    if (env.SUPABASE_URL !== AI_AUTH_BACKEND || !env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY.length > 8192 || /[\r\n]/.test(env.SUPABASE_PUBLISHABLE_KEY) || !env.AI || typeof env.AI.run !== "function") throw new AiWorkerError("independent_backend_or_ai_binding_not_configured", 424);
    const input = aiValidateInput(await aiReadBody(req.body, req.headers.get("content-length"), 256 * 1024));
    await aiAuthorizeUser(authorization, env.SUPABASE_PUBLISHABLE_KEY, input.tool_id);
    const inferenceDeadline = Math.min(25000, 28000 - (Date.now() - started));
    if (inferenceDeadline < 1000) throw new AiWorkerError("authorization_time_budget_exhausted_no_inference", 504);
    let timer;
    try {
      const result = await Promise.race([env.AI.run(AI_FIXED_MODEL, { messages: input.messages, max_completion_tokens: input.max_tokens, temperature: 0, stream: false, store: false, response_format: { type: "json_object" } }), new Promise((_, reject) => { timer = setTimeout(() => reject(new AiWorkerError("workers_ai_timeout_no_retry", 504)), inferenceDeadline); })]);
      return aiResponse(aiValidatedCompletion(result, input));
    } catch (error) { if (error instanceof AiWorkerError) throw error; throw new AiWorkerError("workers_ai_inference_failed_no_retry"); }
    finally { clearTimeout(timer); }
  } catch (error) { return aiResponse({ error: { code: error instanceof AiWorkerError ? error.code : "ai_request_failed_no_retry" } }, error instanceof AiWorkerError ? error.status : 502); }
}
export default { fetch: handleAiRequest };
