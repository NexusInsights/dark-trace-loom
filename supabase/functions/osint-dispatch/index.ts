import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { z } from "npm:zod@3.23.8";
import { safeFetch } from "../_shared/safeFetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const BodySchema = z.object({
  tool: z.string().min(1).max(64),
  params: z.record(z.string(), z.unknown()).default({}),
  case_id: z.string().uuid().nullable().optional(),
});

type DispatchOutcome =
  | { status: "success"; result: unknown }
  | { status: "not_configured"; reason: string }
  | { status: "error"; reason: string }
  | { status: "unknown_tool"; reason: string };

const env = (k: string) => Deno.env.get(k) ?? "";

// ─── Tool implementations ───────────────────────────────────────────────────

async function domainWhois(params: Record<string, unknown>): Promise<DispatchOutcome> {
  const domain = String(params.domain ?? params.target ?? "").trim();
  if (!domain) return { status: "error", reason: "missing 'domain' parameter" };
  const r = await safeFetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
  if (!r.ok) return { status: "error", reason: `RDAP HTTP ${r.status}` };
  return { status: "success", result: await r.json() };
}

async function dnsLookup(params: Record<string, unknown>): Promise<DispatchOutcome> {
  const domain = String(params.domain ?? params.target ?? "").trim();
  if (!domain) return { status: "error", reason: "missing 'domain' parameter" };
  const out: Record<string, unknown> = { domain };
  for (const t of ["A", "AAAA", "MX", "TXT", "NS"]) {
    const r = await safeFetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${t}`,
      { headers: { Accept: "application/dns-json" } },
    );
    if (!r.ok) return { status: "error", reason: `Cloudflare DoH HTTP ${r.status} for ${t}` };
    const j = await r.json();
    out[t.toLowerCase()] = (j.Answer ?? []).map((a: { data: string }) => a.data);
  }
  return { status: "success", result: out };
}

async function subdomainEnum(params: Record<string, unknown>): Promise<DispatchOutcome> {
  const domain = String(params.domain ?? params.target ?? "").trim();
  if (!domain) return { status: "error", reason: "missing 'domain' parameter" };
  const r = await safeFetch(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`);
  if (!r.ok) return { status: "error", reason: `crt.sh HTTP ${r.status}` };
  const text = await r.text();
  let entries: Array<{ name_value: string }> = [];
  try { entries = JSON.parse(text); } catch { return { status: "error", reason: "crt.sh returned non-JSON" }; }
  const subs = new Set<string>();
  for (const e of entries) {
    for (const n of (e.name_value ?? "").split(/\s+/)) {
      if (n && n.endsWith(domain)) subs.add(n.toLowerCase());
    }
  }
  return { status: "success", result: { domain, subdomains: [...subs] } };
}

async function ipGeo(params: Record<string, unknown>): Promise<DispatchOutcome> {
  const ip = String(params.ip ?? params.target ?? "").trim();
  if (!ip) return { status: "error", reason: "missing 'ip' parameter" };
  const r = await safeFetch(`http://ip-api.com/json/${encodeURIComponent(ip)}`, { allowHttp: true });
  if (!r.ok) return { status: "error", reason: `ip-api HTTP ${r.status}` };
  const d = await r.json();
  if (d.status && d.status !== "success") return { status: "error", reason: d.message || "ip-api lookup failed" };
  return { status: "success", result: d };
}

async function asnLookup(params: Record<string, unknown>): Promise<DispatchOutcome> {
  const ip = String(params.ip ?? params.target ?? "").trim();
  if (!ip) return { status: "error", reason: "missing 'ip' parameter" };
  const r = await safeFetch(`https://api.bgpview.io/ip/${encodeURIComponent(ip)}`);
  if (!r.ok) return { status: "error", reason: `BGPView HTTP ${r.status}` };
  return { status: "success", result: await r.json() };
}

async function sslInspect(params: Record<string, unknown>): Promise<DispatchOutcome> {
  const domain = String(params.domain ?? params.target ?? "").trim();
  if (!domain) return { status: "error", reason: "missing 'domain' parameter" };
  const r = await safeFetch(`https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(domain)}`);
  if (!r.ok) return { status: "error", reason: `SSL Labs HTTP ${r.status}` };
  return { status: "success", result: await r.json() };
}

async function httpProbe(params: Record<string, unknown>): Promise<DispatchOutcome> {
  const url = String(params.url ?? params.target ?? "").trim();
  if (!url) return { status: "error", reason: "missing 'url' parameter" };
  const r = await safeFetch(url, { allowHttp: true, method: "HEAD" });
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => { headers[k] = v; });
  return { status: "success", result: { url, status: r.status, headers } };
}

async function githubRecon(params: Record<string, unknown>): Promise<DispatchOutcome> {
  const username = String(params.username ?? params.target ?? "").trim();
  if (!username) return { status: "error", reason: "missing 'username' parameter" };
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const tok = env("GITHUB_TOKEN");
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const u = await safeFetch(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers });
  if (u.status === 404) return { status: "error", reason: "GitHub user not found" };
  if (!u.ok) return { status: "error", reason: `GitHub HTTP ${u.status}` };
  const user = await u.json();
  const repoRes = await safeFetch(`https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100`, { headers });
  const repos = repoRes.ok ? await repoRes.json() : [];
  return { status: "success", result: { user, repos } };
}

async function dtlProxy(toolPath: string, params: Record<string, unknown>): Promise<DispatchOutcome> {
  const endpoint = env("DTL_ENDPOINT");
  const key = env("DTL_API_KEY");
  if (!endpoint || !key) {
    return { status: "not_configured", reason: "DTL_ENDPOINT or DTL_API_KEY not set in edge function secrets" };
  }
  const r = await safeFetch(`${endpoint.replace(/\/$/, "")}/${toolPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": key },
    body: JSON.stringify(params),
  });
  if (!r.ok) return { status: "error", reason: `DTL HTTP ${r.status}` };
  return { status: "success", result: await r.json() };
}

async function pdlEnrich(params: Record<string, unknown>): Promise<DispatchOutcome> {
  const key = env("PDL_API_KEY");
  if (!key) return { status: "not_configured", reason: "PDL_API_KEY not set in edge function secrets" };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" || typeof v === "number") qs.set(k, String(v));
  }
  const r = await safeFetch(`https://api.peopledatalabs.com/v5/person/enrich?${qs.toString()}`, {
    headers: { "X-Api-Key": key },
  });
  if (!r.ok) return { status: "error", reason: `PDL enrich HTTP ${r.status}` };
  return { status: "success", result: await r.json() };
}

async function pdlSearch(params: Record<string, unknown>): Promise<DispatchOutcome> {
  const key = env("PDL_API_KEY");
  if (!key) return { status: "not_configured", reason: "PDL_API_KEY not set in edge function secrets" };
  const r = await safeFetch("https://api.peopledatalabs.com/v5/person/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": key },
    body: JSON.stringify(params),
  });
  if (!r.ok) return { status: "error", reason: `PDL search HTTP ${r.status}` };
  return { status: "success", result: await r.json() };
}

async function breachSearchDelegate(
  params: Record<string, unknown>,
  caseId: string | null,
  authHeader: string,
): Promise<DispatchOutcome> {
  const ids = Array.isArray(params.identifiers)
    ? params.identifiers
    : params.identifier
      ? [params.identifier]
      : params.target
        ? [params.target]
        : [];
  if (ids.length === 0) return { status: "error", reason: "missing 'identifiers' parameter" };
  const supabaseUrl = env("SUPABASE_URL");
  const r = await fetch(`${supabaseUrl}/functions/v1/breach-lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({ case_id: caseId, identifiers: ids }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return { status: "error", reason: `breach-lookup HTTP ${r.status}` };
  if (body?.status === "not_configured") {
    return { status: "not_configured", reason: body.reason ?? "breach lookup not configured" };
  }
  return { status: "success", result: body };
}

async function dispatch(
  tool: string,
  params: Record<string, unknown>,
  caseId: string | null,
  authHeader: string,
): Promise<DispatchOutcome> {
  try {
    switch (tool) {
      case "domain_whois": return await domainWhois(params);
      case "dns_lookup": return await dnsLookup(params);
      case "subdomain_enum":
      case "subdomain_finder": return await subdomainEnum(params);
      case "ip_geolocation": return await ipGeo(params);
      case "asn_lookup": return await asnLookup(params);
      case "ssl_inspection": return await sslInspect(params);
      case "http_port_probe": return await httpProbe(params);
      case "github_recon": return await githubRecon(params);
      case "username_search": return await dtlProxy("username", params);
      case "social_profile_scrape": return await dtlProxy("social", params);
      case "person_enrichment_pdl": return await pdlEnrich(params);
      case "person_search_pdl": return await pdlSearch(params);
      case "breach_search": return await breachSearchDelegate(params, caseId, authHeader);
      default:
        return { status: "unknown_tool", reason: `Tool '${tool}' is not implemented` };
    }
  } catch (err) {
    return { status: "error", reason: err instanceof Error ? err.message : String(err) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Missing Authorization" }, 401);

  const supabaseUrl = env("SUPABASE_URL");
  const anonKey = env("SUPABASE_ANON_KEY");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
  const userId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);

  const { tool, params, case_id = null } = parsed.data;
  const outcome = await dispatch(tool, params, case_id ?? null, authHeader);

  // Persist every outcome — honest provenance.
  const payload =
    outcome.status === "success"
      ? { status: "success", result: outcome.result }
      : { status: outcome.status, reason: outcome.reason };

  await admin.from("tool_results").insert({
    tool_name: tool,
    case_id: case_id ?? null,
    user_id: userId,
    status: outcome.status,
    result_data: payload,
  });

  return json({ tool, ...payload });
});