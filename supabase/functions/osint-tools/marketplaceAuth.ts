import { authenticateUser, RequestAuthenticationError } from "../_shared/authenticateUser.ts";

// All marketplace requests use the same strict remote Auth boundary as image tools.
class MarketplaceHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function marketplaceUser(req: Request): Promise<{ id: string; authorization: string; url: string; key: string }> {
  const authorization = req.headers.get("authorization") || "";
  try {
    const user = await authenticateUser(req);
    // authenticateUser validates the origin/public key before any request. Retain
    // that verified actor and the caller token for the existing RLS permission read.
    const url = new URL(Deno.env.get("SUPABASE_URL")!).origin;
    const key = (Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY"))!;
    return { id: user.id, authorization, url, key };
  } catch (error) {
    throw new MarketplaceHttpError(error instanceof RequestAuthenticationError ? error.code : "authentication_unavailable", error instanceof RequestAuthenticationError ? error.status : 503);
  }
}
async function marketplaceRequestBody(req: Request): Promise<Record<string, unknown>> {
  const maximum = 1024 * 1024;
  if (Number(req.headers.get('content-length')) > maximum) throw new MarketplaceHttpError('Request body exceeds 1 MiB.', 413);
  const reader = req.body?.getReader();
  if (!reader) throw new MarketplaceHttpError('A JSON request body is required.', 400);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) throw new MarketplaceHttpError('Request body exceeds 1 MiB.', 413);
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new MarketplaceHttpError('A valid UTF-8 JSON request body is required.', 400); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new MarketplaceHttpError('Request body must be a JSON object.', 400);
    return parsed as Record<string, unknown>;
  };
  try {
    return await Promise.race([read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new MarketplaceHttpError('Request body timed out.', 408)); void reader.cancel().catch(() => {}); }, 5000);
    })]);
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function marketplacePermission(user: { id: string; authorization: string; url: string; key: string }, tool: string): Promise<void> {
  const q = new URLSearchParams({ select: "allowed", user_id: `eq.${user.id}`, tool_id: `eq.${tool}`, limit: "1" });
  const r = await fetch(`${user.url}/rest/v1/tool_permissions?${q}`, { headers: { Authorization: user.authorization, apikey: user.key }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Tool permissions could not be verified (HTTP ${r.status}).`);
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row) || typeof row.allowed !== "boolean")) throw new Error("Invalid tool permission response.");
  if (rows.some(row => row.allowed === false)) throw new MarketplaceHttpError("An administrator has disabled this tool for your account.", 403);
}
