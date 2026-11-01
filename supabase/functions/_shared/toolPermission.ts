import { boundedRawBody, RequestAuthenticationError } from "./authenticateUser.ts";

declare const Deno: { env: { get(name: string): string | undefined } };

/** Use only after authenticateUser verified this request against this backend. */
export async function authorizeTool(req: Request, userId: string, toolId: string): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key || key.startsWith("sb_secret_")) throw new RequestAuthenticationError(503, "permission_not_configured");
  const query = new URLSearchParams({ select: "allowed", user_id: "eq." + userId, tool_id: "eq." + toolId, limit: "1" });
  let rows: unknown;
  try {
    const response = await fetch(new URL("/rest/v1/tool_permissions?" + query, url).href, {
      headers: { Authorization: req.headers.get("Authorization")!, apikey: key, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new Error("Permission read failed"); }
    rows = JSON.parse(await boundedRawBody(response, 64 * 1024, 10000));
  } catch { throw new RequestAuthenticationError(503, "permission_unavailable"); }
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row) || typeof row.allowed !== "boolean")) throw new RequestAuthenticationError(503, "invalid_permission_response");
  if (rows.some(row => row.allowed === false)) throw new RequestAuthenticationError(403, "tool_disabled");
}
