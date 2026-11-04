import { searchPublicProfiles, normalizeProfileInput } from "../../src/lib/publicProfiles";
import { readResearchJson, readResearchRawBody, ResearchAdmissionError } from "../../services/research/admission.mjs";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
export async function onRequestPost({ request, env }) {
  try {
    const origin = new URL(request.url).origin;
    if (request.headers.get("origin") && request.headers.get("origin") !== origin) return json({ error: "Cross-origin profile searches are not permitted" }, 403);
    let backend; try { backend = new URL(env.SUPABASE_URL); } catch { return json({ error: "Profile lookup authentication is not configured" }, 503); }
    const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
    let publicKey = typeof key === "string" && /^sb_publishable_[a-zA-Z0-9_-]+$/.test(key);
    if (!publicKey && typeof key === "string") try { const parts = key.split("."); const claims = parts.length === 3 ? JSON.parse(atob(parts[1].replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(parts[1].length/4)*4,"="))) : {}; publicKey = claims.role === "anon" && (!backend.hostname.endsWith(".supabase.co") || claims.ref === backend.hostname.split(".")[0]); } catch { publicKey = false; }
    if (backend.protocol !== "https:" || backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash || backend.port || !backend.hostname.includes(".") || /^[\d.]+$/.test(backend.hostname) || /(?:^|\.)(localhost|local|internal|invalid)$/.test(backend.hostname) || !publicKey) return json({ error: "Profile lookup requires a configured HTTPS backend and public key" }, 503);
    const authorization = request.headers.get("authorization");
    if (!authorization || authorization.length > 8192 || !/^Bearer [^\s]+$/i.test(authorization)) return json({ error: "Sign in to search profiles" }, 401);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12000)]);
    const headers = { Authorization: authorization, apikey: key, Accept: "application/json" };
    const auth = await fetch(`${backend.origin}/auth/v1/user`, { headers, signal, redirect: "manual" });
    if (auth.status === 401 || auth.status === 403) return json({ error: "Session could not be verified. Sign in again." }, 401);
    if (!auth.ok) return json({ error: "Profile authentication is unavailable" }, 503);
    let user; try { user = JSON.parse(await readResearchRawBody(auth, 65536, { signal, timeoutMs: 8000 })); } catch { return json({ error: "Profile authentication returned an invalid or oversized response" }, 503); }
    if (!user || typeof user !== "object" || Array.isArray(user) || typeof user.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) return json({ error: "Invalid authenticated account" }, 401);
    if (user.is_anonymous === true || user.role !== undefined && user.role !== "authenticated") return json({ error: "A nonanonymous signed-in account is required" }, 403);
    const body = await readResearchJson(request, 2048, { signal, timeoutMs: 8000 });
    let input; try { const parsed = normalizeProfileInput(body); input = parsed.profileUrl ? { profileUrl: parsed.profileUrl } : parsed.username; } catch (error) { return json({ error: error.message }, 400); }
    const query = new URLSearchParams({ select: "allowed", user_id: `eq.${user.id}`, tool_id: "eq.username-search", limit: "1" });
    const permission = await fetch(`${backend.origin}/rest/v1/tool_permissions?${query}`, { headers, signal, redirect: "manual" });
    if (!permission.ok) return json({ error: "Profile permissions could not be verified" }, 503);
    let rows; try { rows = JSON.parse(await readResearchRawBody(permission, 16384, { signal, timeoutMs: 8000 })); } catch { return json({ error: "Profile permissions could not be verified" }, 503); }
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row) || typeof row.allowed !== "boolean")) return json({ error: "Invalid profile permission response" }, 503);
    if (rows.some(row => row.allowed === false)) return json({ error: "An administrator has disabled this profile lookup" }, 403);
    return json(await searchPublicProfiles(input));
  } catch (error) {
    return json({ error: error instanceof ResearchAdmissionError ? error.message : "Profile lookup failed or timed out" }, error instanceof ResearchAdmissionError ? error.status : 502);
  }
}
export const onRequestGet = () => json({ error: "Use an authenticated POST request" }, 405);
