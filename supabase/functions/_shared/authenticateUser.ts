declare const Deno: { env: { get(name: string): string | undefined } };

export class RequestAuthenticationError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export type VerifiedRequestUser = { id: string };
export type VerifiedRequestEmailUser = VerifiedRequestUser & { email: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function boundedStreamText(stream: ReadableStream<Uint8Array> | null, maxBytes: number, timeoutMs: number): Promise<string> {
  if (!stream) throw new RequestAuthenticationError(400, "invalid_body");
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0; let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => undefined);
      reject(new RequestAuthenticationError(408, "request_timed_out"));
    }, timeoutMs);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (timedOut) throw new RequestAuthenticationError(408, "request_timed_out");
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new RequestAuthenticationError(413, "request_too_large");
      }
      chunks.push(value);
    }
  } finally { if (timer !== undefined) clearTimeout(timer); reader.releaseLock(); }
  const all = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(all);
}

// Verify modern or legacy bearer tokens remotely, rather than trusting decoded
// JWT claims. Only the configured public project key is used for this endpoint.
export function authenticateUser(req: Request, options: { requireEmail: true }): Promise<VerifiedRequestEmailUser>;
export function authenticateUser(req: Request): Promise<VerifiedRequestUser>;
export async function authenticateUser(req: Request, options?: { requireEmail: true }): Promise<VerifiedRequestUser | VerifiedRequestEmailUser> {
  const authorization = req.headers.get("Authorization");
  if (!authorization || authorization.length > 8192 || !/^Bearer [^\s]+$/i.test(authorization)) throw new RequestAuthenticationError(401, "unauthenticated");
  const backendUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!backendUrl || !publicKey || publicKey.startsWith("sb_secret_")) throw new RequestAuthenticationError(503, "authentication_not_configured");
  let endpoint: URL;
  try {
    const configured = new URL(backendUrl);
    if (configured.protocol !== "https:" || configured.username || configured.password || configured.search || configured.hash
      || (configured.pathname !== "/" && configured.pathname !== "")) throw new Error("Invalid configured backend");
    endpoint = new URL("/auth/v1/user", configured);
  } catch { throw new RequestAuthenticationError(503, "authentication_not_configured"); }
  try {
    const response = await fetch(endpoint.href, { headers: { Authorization: authorization, apikey: publicKey, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15000) });
    if (response.status === 401 || response.status === 403) throw new RequestAuthenticationError(401, "unauthenticated");
    if (!response.ok) throw new RequestAuthenticationError(503, "authentication_unavailable");
    const text = await boundedStreamText(response.body, 64 * 1024, 15000);
    let user: unknown;
    try { user = JSON.parse(text); } catch { throw new RequestAuthenticationError(502, "invalid_authentication_response"); }
    if (!user || typeof user !== "object" || Array.isArray(user) || typeof (user as { id?: unknown }).id !== "string"
      || !UUID.test((user as { id: string }).id)) throw new RequestAuthenticationError(502, "invalid_authentication_response");
    const verified = user as { id: string; email?: unknown; is_anonymous?: boolean; role?: unknown };
    if (verified.is_anonymous === true) throw new RequestAuthenticationError(403, "anonymous_session_not_allowed");
    if (verified.role !== undefined && verified.role !== "authenticated") throw new RequestAuthenticationError(401, "unauthenticated");
    if (options?.requireEmail) {
      if (typeof verified.email !== "string" || verified.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verified.email)) throw new RequestAuthenticationError(401, "verified_email_required");
      return { id: verified.id, email: verified.email };
    }
    return { id: verified.id };
  } catch (error) {
    if (error instanceof RequestAuthenticationError && [401,403,502,503].includes(error.status)) throw error;
    throw new RequestAuthenticationError(503, "authentication_unavailable");
  }
}

export async function boundedRawBody(req: Request, maxBytes = 16 * 1024, timeoutMs = 15000): Promise<string> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw new RequestAuthenticationError(500, "invalid_body_deadline_configuration");
  const declared = req.headers.get("Content-Length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) throw new RequestAuthenticationError(413, "request_too_large");
  return boundedStreamText(req.body, maxBytes, timeoutMs);
}

export async function boundedJsonBody(req: Request, maxBytes = 16 * 1024): Promise<unknown> {
  try { return JSON.parse(await boundedRawBody(req, maxBytes)); }
  catch (error) { if (error instanceof RequestAuthenticationError) throw error; throw new RequestAuthenticationError(400, "invalid_body"); }
}
