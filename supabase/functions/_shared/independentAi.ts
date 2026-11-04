// Provider-neutral, non-streaming Chat Completions. No implicit model, provider,
// paid fallback, or retry. The operator must independently verify the allowance.
type IndependentAiMessage = { role: "system" | "user" | "assistant"; content: string };
type IndependentAiInput = { messages: IndependentAiMessage[]; max_tokens?: number; json?: boolean };
type IndependentAiInvocationContext = { authorization?: string; tool_id?: string };
type IndependentAiObject = Record<string, unknown>;
export class IndependentAiError extends Error {
  constructor(message: string, public readonly httpStatus = 502) { super(message); this.name = "IndependentAiError"; }
}
function independentAiEnv(name: string): string {
  const runtime = globalThis as unknown as { Deno?: { env: { get(key: string): string | undefined } } };
  return runtime.Deno?.env.get(name)?.trim() || "";
}
function independentAiBuilderEndpoint(value: string): boolean {
  let host: string;
  try { host = new URL(value).hostname.toLowerCase().replace(/\.+$/, ""); } catch { return false; }
  const excluded = ["lovable.dev", "lovable.app", "lovableproject.com", "lovableproject-dev.com", "gptengineer.app", "gptengineer.run", "gpt-eng.com"];
  return excluded.some(domain => host === domain || host.endsWith(`.${domain}`));
}
export function independentAiConfiguration() {
  const mode = independentAiEnv("AI_AUTH_MODE") || "api_key";
  const validMode = ["api_key", "supabase_user"].includes(mode);
  const required = ["AI_CHAT_COMPLETIONS_URL", "AI_MODEL", ...(mode === "supabase_user" ? [] : ["AI_API_KEY"])];
  const missing = required.filter(name => !independentAiEnv(name));
  if (!validMode) missing.push("AI_AUTH_MODE");
  const enabled = independentAiEnv("AI_ENABLED") === "true";
  const zeroSpendVerified = independentAiEnv("AI_ZERO_SPEND_VERIFIED") === "true";
  const excludedBuilderEndpoint = independentAiBuilderEndpoint(independentAiEnv("AI_CHAT_COMPLETIONS_URL"));
  return { ready: !missing.length && enabled && zeroSpendVerified && !excludedBuilderEndpoint, required, missing, enabled, excluded_builder_endpoint: excludedBuilderEndpoint, authentication_mode: mode, requires_caller_authorization: mode === "supabase_user", zero_spend_verified: zeroSpendVerified, cost_policy: "No requests unless the account allowance and absence of paid overage have been independently verified." };
}
function independentAiObject(value: unknown): IndependentAiObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new IndependentAiError("The AI provider returned an invalid completion object.");
  return value as IndependentAiObject;
}
async function independentAiRead(response: Response, limit: number): Promise<string> {
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel().catch(() => {}); throw new IndependentAiError("AI provider response exceeded the size limit."); }
  const reader = response.body?.getReader(); if (!reader) throw new IndependentAiError("The AI provider returned an empty response.");
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > limit) throw new IndependentAiError("AI provider response exceeded the size limit."); chunks.push(next.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return new TextDecoder().decode(bytes);
}
export async function independentAiChat(input: IndependentAiInput, context: IndependentAiInvocationContext = {}) {
  // Check the destination before reading a provider key or forwarding caller authorization.
  if (independentAiBuilderEndpoint(independentAiEnv("AI_CHAT_COMPLETIONS_URL"))) throw new IndependentAiError("Lovable-hosted AI endpoints are disabled for this independent deployment. No provider request was sent.", 424);
  const config = independentAiConfiguration();
  if (!config.ready) throw new IndependentAiError(`Independent AI is not configured or authorized under the zero-new-spend policy. Required: ${config.missing.join(", ") || "AI_ENABLED=true and AI_ZERO_SPEND_VERIFIED=true after account/overage verification"}. No provider request was sent.`, 424);
  let endpoint: URL;
  try { endpoint = new URL(independentAiEnv("AI_CHAT_COMPLETIONS_URL")); } catch { throw new IndependentAiError("AI_CHAT_COMPLETIONS_URL must be a complete HTTPS Chat Completions endpoint.", 424); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new IndependentAiError("The AI endpoint must use HTTPS and contain no credentials, query, or fragment.", 424);
  const model = independentAiEnv("AI_MODEL"), key = config.requires_caller_authorization ? "" : independentAiEnv("AI_API_KEY");
  if (model.length > 200 || key.length > 4096 || /[\r\n]/.test(model + key)) throw new IndependentAiError("AI model or credential configuration is invalid.", 424);
  let authorization = `Bearer ${key}`;
  if (config.requires_caller_authorization) {
    if (typeof context.authorization !== "string" || context.authorization.length > 8192 || !/^Bearer \S+$/i.test(context.authorization) || /[\r\n]/.test(context.authorization)) throw new IndependentAiError("A verified caller session must be forwarded to the independent AI worker. No provider request was sent.", 401);
    if (typeof context.tool_id !== "string" || !["analyze-case", "social-profile-scrape", "sentiment-analysis", "translation"].includes(context.tool_id)) throw new IndependentAiError("The independent AI worker requires a supported operation identifier. No provider request was sent.", 400);
    authorization = context.authorization;
  }
  if (!input || !Array.isArray(input.messages) || !input.messages.length || input.messages.length > 16 || !input.messages.every(message => message && ["system", "user", "assistant"].includes(message.role) && typeof message.content === "string" && message.content.length <= 200000)) throw new IndependentAiError("AI messages are invalid or exceed the input limits.", 400);
  const maxTokens = input.max_tokens ?? 3000;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096) throw new IndependentAiError("AI output token limit must be 1–4096.", 400);
  const payload = JSON.stringify({ model, messages: input.messages, temperature: 0, max_tokens: maxTokens, stream: false, ...(config.requires_caller_authorization ? { tool_id: context.tool_id } : {}), ...(input.json ? { response_format: { type: "json_object" } } : {}) });
  if (new TextEncoder().encode(payload).byteLength > 256 * 1024) throw new IndependentAiError("AI request exceeds 256 KiB.", 400);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(endpoint.toString(), { method: "POST", redirect: "error", signal: controller.signal, headers: { Authorization: authorization, "Content-Type": "application/json" }, body: payload });
    if (!response.ok) {
      // Discard error bodies: provider diagnostics can contain private input or keys.
      await response.body?.cancel().catch(() => {});
      const reason = response.status === 401 ? "Authentication was rejected; the exact account cause is unverified." : response.status === 402 ? "The provider reported a credit or payment requirement; no purchase was made." : response.status === 429 ? "The provider reported a rate or quota limit." : "The provider rejected this request; the precise cause is unverified.";
      throw new IndependentAiError(`AI provider returned HTTP ${response.status}. ${reason} No automatic retry was made.`);
    }
    let decoded: unknown; try { decoded = JSON.parse(await independentAiRead(response, 2 * 1024 * 1024)); } catch (error) { if (error instanceof IndependentAiError) throw error; throw new IndependentAiError("The AI provider returned invalid JSON."); }
    const data = independentAiObject(decoded);
    if (data.error || !Array.isArray(data.choices) || data.choices.length < 1) throw new IndependentAiError("The AI provider returned no successful completion.");
    const choice = independentAiObject(data.choices[0]); const message = independentAiObject(choice.message);
    if (choice.finish_reason === "length") throw new IndependentAiError("The AI completion was truncated at its token limit; no partial result was accepted.");
    if (typeof message.content !== "string" || !message.content.trim() || message.content.length > 200000 || message.refusal) throw new IndependentAiError("The AI provider returned no usable text completion.");
    return { text: message.content, source: endpoint.toString(), model: typeof data.model === "string" && data.model.length <= 200 ? data.model : model, configured_model: model, provider_response_id: typeof data.id === "string" && data.id.length <= 200 ? data.id : null, retrieved_at: new Date().toISOString() };
  } catch (error) {
    if (error instanceof IndependentAiError) throw error;
    throw new IndependentAiError(controller.signal.aborted ? "The AI provider timed out after 30 seconds. No automatic retry was made." : "The AI provider request failed. No automatic retry or substitute response was generated.");
  } finally { clearTimeout(timer); }
}
