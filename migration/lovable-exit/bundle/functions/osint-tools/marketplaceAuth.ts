// All marketplace requests verify the session at the auth service, not by decoding a token.
class MarketplaceHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function marketplaceUser(req: Request): Promise<{ id: string; authorization: string; url: string; key: string }> {
  const authorization = req.headers.get("authorization") || "";
  if (authorization.length > 8192 || !/^Bearer \S+$/i.test(authorization)) throw new MarketplaceHttpError("Sign in to run tools.", 401);
  const url = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) throw new Error("Backend authentication configuration is unavailable.");
  const r = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: authorization, apikey: key }, signal: AbortSignal.timeout(10000) });
  if (r.status === 401 || r.status === 403) throw new MarketplaceHttpError("Your session expired. Sign in again.", 401);
  if (!r.ok) throw new Error(`Session verification failed (HTTP ${r.status}).`);
  const user = await r.json();
  if (typeof user.id !== "string" || !user.id) throw new MarketplaceHttpError("A verified user session is required.", 401);
  return { id: user.id, authorization, url, key };
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
  if (!Array.isArray(rows)) throw new Error("Invalid tool permission response.");
  if (rows.some(row => row.allowed === false)) throw new MarketplaceHttpError("An administrator has disabled this tool for your account.", 403);
}
