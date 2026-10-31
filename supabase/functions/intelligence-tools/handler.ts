type Environment = (name: string) => string | undefined;
type Dependencies = { getEnv: Environment; fetchImpl?: typeof fetch };
type Action = "ipinfo" | "breach" | "profile" | "onion";
type RequestBody = { action: Action; input: Record<string, string> };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function readJson(response: Response, maxBytes = 1_200_000): Promise<Record<string, unknown>> {
  if (!response.body) throw new HttpError(502, "INVALID_RESPONSE", "The service returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new HttpError(502, "RESPONSE_TOO_LARGE", "The service response exceeded the size limit.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(buffer));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(502, "INVALID_RESPONSE", "The service returned invalid JSON."); }
}

async function parseBody(req: Request): Promise<RequestBody> {
  const length = Number(req.headers.get("content-length"));
  if (length > 8192) throw new HttpError(400, "INVALID_INPUT", "The request is too large.");
  let body: Record<string, unknown>;
  try { body = await readJson(new Response(req.body), 8192); }
  catch { throw new HttpError(400, "INVALID_INPUT", "Provide a JSON action and input object (at most 8 KB)."); }
  const action = body.action as Action;
  if (!["ipinfo", "breach", "profile", "onion"].includes(action)) throw new HttpError(400, "INVALID_INPUT", "Choose a supported intelligence action.");
  if (!body.input || typeof body.input !== "object" || Array.isArray(body.input)) throw new HttpError(400, "INVALID_INPUT", "An input object is required.");
  const input = body.input as Record<string, unknown>;
  const allowed = action === "ipinfo" ? ["ip"] : action === "breach" ? ["email"] : action === "profile" ? ["username", "url"] : ["url"];
  if (Object.keys(input).some((key) => !allowed.includes(key)) || Object.values(input).some((value) => typeof value !== "string" || value.length > 2048)) {
    throw new HttpError(400, "INVALID_INPUT", "The action contains unsupported input fields.");
  }
  const clean = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, (value as string).trim()]));
  const value = action === "ipinfo" ? clean.ip : action === "breach" ? clean.email : action === "profile" ? clean.username || clean.url : clean.url;
  if (!value) throw new HttpError(400, "INVALID_INPUT", "The lookup input is required.");
  if (action === "breach" && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 320)) throw new HttpError(400, "INVALID_INPUT", "Enter a valid email address.");
  return { action, input: clean };
}

function workerConfiguration(getEnv: Environment) {
  const raw = getEnv("INTELLIGENCE_WORKER_URL");
  const token = getEnv("INTELLIGENCE_WORKER_TOKEN");
  if (!raw || !token || token.length < 32) throw new HttpError(503, "CONFIGURATION_REQUIRED", "Configure the intelligence worker URL and its server-side token.");
  let url: URL;
  try { url = new URL(raw); } catch { throw new HttpError(503, "CONFIGURATION_REQUIRED", "The intelligence worker URL is invalid."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  let localBackend = false;
  try { localBackend = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(getEnv("SUPABASE_URL") || "").hostname); } catch { /* Missing configuration is handled by authentication. */ }
  const localAllowed = local && localBackend && getEnv("INTELLIGENCE_ALLOW_LOOPBACK") === "true";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && localAllowed)) || (local && !localAllowed) || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new HttpError(503, "CONFIGURATION_REQUIRED", "Use an HTTPS worker origin. Loopback is allowed only for an explicitly configured local backend.");
  }
  return { url: new URL("/intelligence", url).href, token };
}

export function createIntelligenceHandler({ getEnv, fetchImpl = fetch }: Dependencies) {
  return async function intelligenceHandler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return reply({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);
    let reservation: string | null = null;
    let finish: ((success: boolean) => Promise<void>) | null = null;
    try {
      const authorization = req.headers.get("authorization") || "";
      if (!/^Bearer \S+$/i.test(authorization)) throw new HttpError(401, "UNAUTHORIZED", "Sign in to use intelligence tools.");
      const backend = getEnv("SUPABASE_URL");
      const anonKey = getEnv("SUPABASE_ANON_KEY");
      if (!backend || !anonKey) throw new HttpError(503, "CONFIGURATION_REQUIRED", "Backend authentication is not configured.");
      const authHeaders = { Authorization: authorization, apikey: anonKey, "Content-Type": "application/json" };
      const session = await fetchImpl(`${backend}/auth/v1/user`, { headers: authHeaders, signal: AbortSignal.timeout(10000), redirect: "error" });
      if (session.status === 401 || session.status === 403) throw new HttpError(401, "UNAUTHORIZED", "Your session expired. Sign in again.");
      if (!session.ok) throw new HttpError(503, "AUTH_UNAVAILABLE", "The user session could not be verified.");
      const user = await readJson(session, 65536);
      if (typeof user.id !== "string" || !user.id) throw new HttpError(401, "UNAUTHORIZED", "A verified user session is required.");
      const { action, input } = await parseBody(req);
      const allowanceFlag = action === "breach" ? "MARKETPLACE_HIBP_FREE_ALLOWANCE_VERIFIED" : action === "ipinfo" ? "INTELLIGENCE_IPINFO_ALLOWANCE_VERIFIED" : null;
      if (allowanceFlag && getEnv(allowanceFlag) !== "true") {
        throw new HttpError(503, "ALLOWANCE_REQUIRED", `Verified included provider access is required (${allowanceFlag}). No provider request was made.`);
      }
      const worker = workerConfiguration(getEnv);
      const rpc = async (name: string, payload: Record<string, unknown>) => {
        const response = await fetchImpl(`${backend}/rest/v1/rpc/${name}`, { method: "POST", headers: authHeaders, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000), redirect: "error" });
        if (!response.ok) throw new HttpError(503, "ACCOUNTING_UNAVAILABLE", "Intelligence permissions and usage could not be verified. Apply the intelligence migration before enabling this function.");
        return readJson(response, 65536);
      };
      const admission = await rpc("reserve_intelligence_execution", { p_action: action });
      if (admission.allowed !== true || typeof admission.id !== "string") {
        const limited = admission.code === "DAILY_LIMIT";
        throw new HttpError(limited ? 429 : 403, limited ? "DAILY_LIMIT" : "FORBIDDEN", limited ? "Your daily tool limit has been reached." : "This intelligence tool is disabled for your account.", limited ? Number(admission.retryAfter) || 60 : undefined);
      }
      reservation = admission.id;
      finish = async (success: boolean) => {
        const settled = await rpc("finish_intelligence_execution", { p_execution_id: reservation, p_success: success });
        if (settled.ok !== true) throw new HttpError(503, "ACCOUNTING_UNAVAILABLE", "Tool usage could not be recorded. Try again after two minutes.");
        reservation = null;
      };
      const response = await fetchImpl(worker.url, {
        method: "POST", headers: { Authorization: `Bearer ${worker.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, input }), signal: AbortSignal.timeout(60000), redirect: "error",
      });
      const result = await readJson(response);
      if (!response.ok || result.ok !== true) {
        const error = result.error && typeof result.error === "object" ? result.error as Record<string, unknown> : {};
        const code = typeof error.code === "string" && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : "WORKER_ERROR";
        // Worker messages are deliberately fixed, credential-free user diagnostics.
        const message = typeof error.message === "string" ? error.message.slice(0, 500) : "The intelligence worker could not complete this request.";
        throw new HttpError([400, 401, 403, 429, 502, 503].includes(response.status) ? response.status : 502, code, message, typeof error.retryAfter === "number" ? error.retryAfter : undefined);
      }
      if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new HttpError(502, "INVALID_RESPONSE", "The worker returned an invalid result.");
      await finish(true);
      return reply({ ok: true, data: result.data });
    } catch (error) {
      if (reservation && finish) {
        try { await finish(false); }
        catch { return reply({ ok: false, error: { code: "ACCOUNTING_UNAVAILABLE", message: "Tool usage could not be released. Try again after two minutes." } }, 503); }
      }
      const known = error instanceof HttpError ? error : new HttpError(502, "SERVICE_UNAVAILABLE", "The intelligence service did not respond. Check worker connectivity and retry.");
      return reply({ ok: false, error: { code: known.code, message: known.message, ...(known.retryAfter ? { retryAfter: known.retryAfter } : {}) } }, known.status);
    }
  };
}
