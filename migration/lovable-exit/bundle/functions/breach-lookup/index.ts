import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { z } from "npm:zod@3.23.8";

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
  case_id: z.string().uuid().nullable().optional(),
  identifiers: z.array(z.string().min(1).max(320)).min(1).max(50),
});

const HIBP_KEY = Deno.env.get("HIBP_API_KEY") ?? "";
const DEHASHED_USERNAME = Deno.env.get("DEHASHED_USERNAME") ?? "";
const DEHASHED_KEY = Deno.env.get("DEHASHED_API_KEY") ?? "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function detectField(identifier: string): "email" | "username" | "phone" | "ip" | "name" {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) return "email";
  if (/^\+?\d[\d\s\-()]{6,}$/.test(identifier)) return "phone";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(identifier)) return "ip";
  if (/^[a-zA-Z0-9_.\-]{2,64}$/.test(identifier)) return "username";
  return "name";
}

async function queryHIBP(identifier: string) {
  if (!HIBP_KEY) {
    return { status: "not_configured", source: "HIBP", reason: "HIBP_API_KEY not set", identifier };
  }
  const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(identifier)}?truncateResponse=false`;
  const headers = {
    "hibp-api-key": HIBP_KEY,
    "User-Agent": "InsightNexus-OSINT",
  };
  let res = await fetch(url, { headers });
  if (res.status === 429) {
    await sleep(6000);
    res = await fetch(url, { headers });
  }
  if (res.status === 404) {
    return { status: "no_exposure", source: "HIBP", identifier, breaches: [] as unknown[] };
  }
  if (res.status === 401 || res.status === 403) {
    return { status: "error", source: "HIBP", reason: "HIBP authentication failed", identifier };
  }
  if (res.status === 429) {
    return { status: "error", source: "HIBP", reason: "HIBP rate limit exceeded", identifier };
  }
  if (res.status >= 500) {
    return { status: "error", source: "HIBP", reason: "HIBP unavailable", identifier };
  }
  if (!res.ok) {
    return { status: "error", source: "HIBP", reason: `HIBP HTTP ${res.status}`, identifier };
  }
  const breaches = await res.json();
  return { status: "exposure", source: "HIBP", identifier, breaches };
}

async function queryDeHashed(identifier: string) {
  if (!DEHASHED_KEY || !DEHASHED_USERNAME) {
    return { status: "not_configured", source: "DeHashed", reason: "DEHASHED_USERNAME or DEHASHED_API_KEY not set", identifier };
  }
  const field = detectField(identifier);
  const auth = "Basic " + btoa(`${DEHASHED_USERNAME}:${DEHASHED_KEY}`);
  const url = `https://api.dehashed.com/search?query=${encodeURIComponent(`${field}:${identifier}`)}`;
  const res = await fetch(url, { headers: { Authorization: auth, Accept: "application/json", "User-Agent": "InsightNexus-OSINT" } });
  if (res.status === 401 || res.status === 403) {
    return { status: "error", source: "DeHashed", reason: "DeHashed authentication failed", identifier };
  }
  if (res.status >= 500) {
    return { status: "error", source: "DeHashed", reason: "DeHashed unavailable", identifier };
  }
  if (!res.ok) {
    return { status: "error", source: "DeHashed", reason: `DeHashed HTTP ${res.status}`, identifier };
  }
  const body = await res.json();
  const entries = Array.isArray(body?.entries) ? body.entries : [];
  if (entries.length === 0) {
    return { status: "no_exposure", source: "DeHashed", identifier, entries: [] };
  }
  return { status: "exposure", source: "DeHashed", identifier, entries };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Auth: require a logged-in user.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
  if (!parsed.success) {
    return json({ error: parsed.error.flatten().fieldErrors }, 400);
  }
  const { case_id = null, identifiers } = parsed.data;

  // Both keys missing → not_configured at the call level; write nothing.
  if (!HIBP_KEY && !DEHASHED_KEY) {
    return json({
      status: "not_configured",
      reason: "HIBP_API_KEY and DEHASHED_API_KEY both unset",
      results: [],
    });
  }

  const persisted: unknown[] = [];
  const results: unknown[] = [];

  for (const identifier of identifiers) {
    for (const lookup of [queryHIBP(identifier), queryDeHashed(identifier)]) {
      const r = await lookup;
      results.push(r);

      // Persistence rules: do NOT persist auth errors. Persist exposure / no_exposure / not_configured.
      if (r.status === "error" && (r as { reason?: string }).reason?.includes("authentication failed")) {
        continue;
      }

      if (r.status === "exposure" && r.source === "HIBP") {
        for (const b of (r as { breaches: any[] }).breaches) {
          const { data, error } = await admin.from("breach_records").insert({
            user_id: userId,
            status: "exposure",
            source: "HIBP",
            identifier,
            breach_source: b?.Name ?? "HIBP",
            breach_name: b?.Name ?? null,
            breach_date: b?.BreachDate ?? null,
            data_classes: b?.DataClasses ?? null,
            data_exposed: Array.isArray(b?.DataClasses) ? b.DataClasses : [],
            severity: b?.IsSensitive ? "critical" : "high",
            credential_leaked: Array.isArray(b?.DataClasses) && b.DataClasses.includes("Passwords"),
            password_reuse_detected: false,
            raw_response: b,
            metadata: { case_id },
          }).select("id").single();
          if (!error && data) persisted.push(data.id);
        }
      } else if (r.status === "exposure" && r.source === "DeHashed") {
        for (const e of (r as { entries: any[] }).entries) {
          const { data, error } = await admin.from("breach_records").insert({
            user_id: userId,
            status: "exposure",
            source: "DeHashed",
            identifier,
            breach_source: e?.database_name ?? "DeHashed",
            breach_name: e?.database_name ?? null,
            breach_date: null,
            data_classes: null,
            data_exposed: Object.keys(e ?? {}).filter((k) => e[k]),
            severity: e?.password ? "critical" : "medium",
            credential_leaked: !!e?.password,
            password_reuse_detected: false,
            raw_response: e,
            metadata: { case_id },
          }).select("id").single();
          if (!error && data) persisted.push(data.id);
        }
      } else if (r.status === "no_exposure" || r.status === "not_configured") {
        const { data, error } = await admin.from("breach_records").insert({
          user_id: userId,
          status: r.status,
          source: r.source,
          identifier,
          breach_source: r.source,
          severity: "medium",
          data_exposed: [],
          credential_leaked: false,
          password_reuse_detected: false,
          raw_response: r,
          metadata: { case_id, reason: (r as { reason?: string }).reason ?? null },
        }).select("id").single();
        if (!error && data) persisted.push(data.id);
      }
    }
  }

  return json({ status: "ok", persisted_count: persisted.length, results });
});