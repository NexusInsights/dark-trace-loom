import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { z } from "npm:zod@3.23.8";
import { safeFetch } from "../_shared/safeFetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const Body = z.object({ bssid: z.string().min(11).max(32) });
const BSSID_RE = /^[0-9A-Fa-f]{2}([-:][0-9A-Fa-f]{2}){5}$/;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ status: "error", reason: "invalid_body" }, 400);
  const raw = parsed.data.bssid.trim();
  if (!BSSID_RE.test(raw)) return json({ status: "error", reason: "invalid_bssid_format" }, 400);

  const normalized = raw.replace(/-/g, ":").toUpperCase();

  const name = Deno.env.get("WIGLE_API_NAME") ?? "";
  const key = Deno.env.get("WIGLE_API_KEY") ?? "";
  if (!name || !key) {
    return json({
      status: "not_configured",
      reason: "WIGLE_API_NAME or WIGLE_API_KEY not set in edge function secrets",
    });
  }

  const auth = "Basic " + btoa(`${name}:${key}`);
  const url = `https://api.wigle.net/api/v2/network/detail?netid=${encodeURIComponent(normalized)}`;

  try {
    const r = await safeFetch(url, { headers: { Authorization: auth, Accept: "application/json" } });
    if (!r.ok) {
      return json({ status: "error", reason: `WiGLE HTTP ${r.status}` });
    }
    const body = await r.json();
    const net = Array.isArray(body?.results) ? body.results[0] : body;
    return json({
      status: "success",
      result: {
        bssid: normalized,
        ssid: net?.ssid ?? null,
        encryption: net?.encryption ?? null,
        trilat: net?.trilat ?? null,
        trilong: net?.trilong ?? null,
        country: net?.country ?? null,
        region: net?.region ?? null,
        city: net?.city ?? null,
        lastupdt: net?.lastupdt ?? null,
        qos: net?.qos ?? null,
        transid: net?.transid ?? null,
      },
    });
  } catch (e) {
    return json({ status: "error", reason: e instanceof Error ? e.message : String(e) });
  }
});