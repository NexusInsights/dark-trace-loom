import { searchPublicProfiles } from "../../src/lib/publicProfiles";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
export async function onRequestPost({ request, env }) {
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return json({ error: "Profile lookup authentication is not configured" }, 503);
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Sign in to search profiles" }, 401);
    const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: authorization, apikey: env.SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(8000) });
    if (!auth.ok) return json({ error: "Session could not be verified. Sign in again." }, 401);
    const user = await auth.json();
    if (!user.id) return json({ error: "Invalid session" }, 401);
    if (Number(request.headers.get("content-length") || 0) > 2048) return json({ error: "Request is too large" }, 413);
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: "Request is too large" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: "Expected a JSON request" }, 400); }
    if (typeof body.username !== "string" || !/^[a-zA-Z0-9_.-]{1,64}$/.test(body.username)) return json({ error: "Provide an exact valid username" }, 400);
    return json(await searchPublicProfiles(body.username));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Profile lookup failed" }, 502);
  }
}
export const onRequestGet = () => json({ error: "Use an authenticated POST request" }, 405);
