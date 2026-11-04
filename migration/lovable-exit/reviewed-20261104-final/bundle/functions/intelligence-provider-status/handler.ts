import { getProviderReadiness } from "../_shared/provider-readiness.mjs";
import { checkHIBPSubscription, ProviderError } from "../_shared/provider-http.mjs";

type Environment = (name: string) => string | undefined;
type Dependencies = { getEnv: Environment; fetchImpl?: typeof fetch };
type StatusBody = { checkHibpSubscription?: boolean };
type SafeError = { code: string; message: string; retryAfter?: number };

class RequestError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function reply(body: unknown, status = 200, retryAfter?: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json", "Cache-Control": "no-store",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
}

async function serviceAuthorized(req: Request, getEnv: Environment): Promise<boolean> {
  try {
    const secret = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const header = req.headers.get("authorization") || "";
    const match = /^Bearer ([^\s]+)$/i.exec(header);
    if (!secret || secret.trim() !== secret || secret.length > 8192 || header.length > 8192 || !match) return false;
    // Comparing fixed-size SHA-256 digests avoids a token-length-dependent or
    // early-exit string comparison. JWT role claims are never trusted here.
    const encoder = new TextEncoder();
    const [expected, supplied] = await Promise.all([
      crypto.subtle.digest("SHA-256", encoder.encode(secret)),
      crypto.subtle.digest("SHA-256", encoder.encode(match[1])),
    ]);
    const left = new Uint8Array(expected);
    const right = new Uint8Array(supplied);
    let difference = 0;
    for (let index = 0; index < 32; index++) difference |= left[index] ^ right[index];
    return difference === 0;
  } catch { return false; }
}

async function parseBody(req: Request): Promise<StatusBody> {
  const invalid = () => new RequestError(400, "INVALID_INPUT", "Provide only an optional boolean checkHibpSubscription in a JSON object (at most 4 KiB).");
  if (Number(req.headers.get("content-length")) > 4096) throw invalid();
  if (!req.body) return {};
  if (req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw invalid();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 5000);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (timedOut) throw invalid();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) throw invalid();
      chunks.push(value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => key !== "checkHibpSubscription")
      || (Object.prototype.hasOwnProperty.call(value, "checkHibpSubscription") && typeof value.checkHibpSubscription !== "boolean")) throw invalid();
    return value;
  } catch { throw invalid(); }
  finally { clearTimeout(timeout); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

function configuration(getEnv: Environment) {
  const names = ["IPINFO_API_MODE", "IPINFO_TOKEN", "INTELLIGENCE_IPINFO_ALLOWANCE_VERIFIED", "HIBP_API_KEY",
    "MARKETPLACE_HIBP_FREE_ALLOWANCE_VERIFIED", "X_API_MODE", "X_API_BEARER_TOKEN", "X_INCLUDED_ACCESS_VERIFIED"];
  const readiness = getProviderReadiness(Object.fromEntries(names.map((name) => [name, getEnv(name)])));
  const present = (name: string) => Boolean(getEnv(name)?.trim());
  // Local Tor/browser settings on this Edge runtime do not describe the remote
  // browser worker. Report that worker's configuration presence separately.
  return {
    metadataOnly: true, liveChecksPerformed: false,
    ipinfo: readiness.ipinfo, hibp: readiness.hibp, x: readiness.x,
    runtime: {
      httpProviders: "supabase_edge", browserProviders: "external_browser_worker",
      browserWorker: { urlConfigured: present("INTELLIGENCE_WORKER_URL"), tokenConfigured: present("INTELLIGENCE_WORKER_TOKEN") },
    },
  };
}

function safeProviderError(error: unknown): { status: number; error: SafeError } {
  const known: Record<string, [number, string]> = {
    CONFIGURATION_REQUIRED: [503, "The HIBP subscription check is not configured."],
    PROVIDER_ACCESS_DENIED: [503, "HIBP rejected the configured credentials or account access."],
    RATE_LIMITED: [429, "HIBP rate limited the subscription check. No retry was attempted."],
    UPSTREAM_ERROR: [502, "HIBP returned an unsuccessful subscription response."],
    INVALID_PROVIDER_RESPONSE: [502, "HIBP returned invalid subscription metadata."],
    RESPONSE_TOO_LARGE: [502, "HIBP subscription metadata exceeded the response size limit."],
    TIMEOUT: [504, "HIBP did not respond to the subscription check in time."],
    UPSTREAM_UNAVAILABLE: [502, "HIBP could not be reached for the subscription check."],
  };
  if (error instanceof ProviderError) {
    const provider = error as { code?: unknown; retryAfter?: unknown };
    if (typeof provider.code === "string" && Object.prototype.hasOwnProperty.call(known, provider.code)) {
      const [status, message] = known[provider.code];
      const retry = provider.code === "RATE_LIMITED" && typeof provider.retryAfter === "number" && Number.isFinite(provider.retryAfter)
        ? Math.ceil(Math.max(1, Math.min(3600, provider.retryAfter))) : undefined;
      return { status, error: { code: provider.code, message, ...(retry ? { retryAfter: retry } : {}) } };
    }
  }
  return { status: 502, error: { code: "SUBSCRIPTION_CHECK_UNAVAILABLE", message: "The HIBP subscription check could not be completed." } };
}

export function createProviderStatusHandler({ getEnv, fetchImpl = fetch }: Dependencies) {
  return async function providerStatusHandler(req: Request): Promise<Response> {
    // No metadata, request-body parsing, provider configuration or network work
    // occurs before exact service credential authentication.
    if (!await serviceAuthorized(req, getEnv)) return reply({ ok: false, error: { code: "UNAUTHORIZED", message: "A trusted service credential is required." } }, 401);
    if (req.method !== "POST") return reply({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);
    try {
      const body = await parseBody(req);
      const metadata = configuration(getEnv);
      const requested = body.checkHibpSubscription === true;
      if (!requested) return reply({ ok: true, data: { configuration: metadata, accountChecks: { hibpSubscription: { requested: false, performed: false } } } });
      let performed = false;
      try {
        const result = await checkHIBPSubscription({ getEnv, fetchImpl: async (url, init) => { performed = true; return fetchImpl(url, init); } });
        // Return an explicit allowlist, never the vendor's original response.
        const subscription = {
          provider: "hibp", scope: "account_metadata", subscriptionName: result.subscriptionName,
          subscribedUntil: result.subscribedUntil, rpm: result.rpm, allowanceVerifiedByCheck: false, checkedAt: result.checkedAt,
        };
        return reply({ ok: true, data: { configuration: metadata, accountChecks: { hibpSubscription: { requested: true, performed, result: subscription } } } });
      } catch (error) {
        const safe = safeProviderError(error);
        return reply({ ok: false, error: safe.error, data: { configuration: metadata, accountChecks: { hibpSubscription: { requested: true, performed } } } }, safe.status, safe.error.retryAfter);
      }
    } catch (error) {
      const known = error instanceof RequestError ? error : new RequestError(503, "STATUS_UNAVAILABLE", "Provider configuration metadata could not be read.");
      return reply({ ok: false, error: { code: known.code, message: known.message } }, known.status);
    }
  };
}
