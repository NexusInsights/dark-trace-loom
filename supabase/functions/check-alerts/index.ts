import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { authenticateUser, boundedRawBody, RequestAuthenticationError } from "../_shared/authenticateUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const coverage = "Changes in stored case records only; this endpoint does not poll external sources or prove notification delivery.";
type AlertSummary = { checked: number; triggered: number; skipped: number; failed: number; notifications_created: number; examined: number; has_more: boolean; remaining_in_batch: number; failures: { code: string; count: number }[]; scope: string; busy?: boolean };
function validSummary(value: unknown): value is AlertSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  for (const field of ["checked", "triggered", "skipped", "failed", "notifications_created", "examined", "remaining_in_batch"]) {
    if (!Number.isInteger(row[field]) || (row[field] as number) < 0 || (row[field] as number) > 100) return false;
  }
  return row.scope === "authenticated_user" && typeof row.has_more === "boolean"
    && (row.busy === undefined || typeof row.busy === "boolean")
    && (row.triggered as number) <= (row.checked as number)
    && (row.notifications_created as number) <= (row.triggered as number)
    && row.examined === (row.checked as number) + (row.skipped as number) + (row.failed as number)
    && Array.isArray(row.failures) && row.failures.length <= 100
    && row.failures.every(item => item && typeof item === "object" && typeof item.code === "string" && /^[a-z_]{1,100}$/.test(item.code) && Number.isInteger(item.count) && item.count > 0 && item.count <= 100);
}
serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Use POST." }, 405);
  try {
    await authenticateUser(req);
    // Native cron uses the internal postgres-only engine; HTTP scheduler keys
    // cannot turn a user invocation into a global privileged check.
    if (req.headers.has("x-alerts-scheduler-key")) return respond({ error: "native_scheduler_required" }, 424);
    if (req.body) {
      const raw = await boundedRawBody(req, 1024, 5000);
      if (raw.trim()) {
        let input: unknown; try { input = JSON.parse(raw); } catch { return respond({ error: "request_body_invalid" }, 400); }
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) return respond({ error: "request_body_must_be_empty_object" }, 400);
      }
    }
    const backend = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!backend || !key) return respond({ error: "independent_backend_configuration_missing" }, 424);
    const origin = new URL(backend).origin;
    const checkedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(input instanceof Request ? input.url : String(input));
      if (target.origin !== origin) throw new Error("Unexpected backend origin");
      return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(55000) });
    };
    const client = createClient(backend, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: checkedFetch, headers: { Authorization: req.headers.get("Authorization")! } } });
    // The no-input SQL wrapper derives actual Auth identity again and invokes
    // the same atomic owner-filtered engine as native cron. No separate writer.
    const result = await client.rpc("check_owned_stored_alerts");
    if (result.error) {
      const code = result.error.code;
      return respond({ error: code === "PGRST202" || code === "42883" ? "native_alert_engine_not_configured" : code === "42501" ? "alert_owner_access_rejected" : "native_alert_check_failed" }, code === "PGRST202" || code === "42883" ? 424 : code === "42501" ? 403 : 502);
    }
    if (!validSummary(result.data)) return respond({ error: "invalid_native_alert_response" }, 502);
    const data = result.data;
    const body = { checked: data.checked, triggered: data.triggered, skipped: data.skipped, failed: data.failed, notifications_created: data.notifications_created, examined: data.examined, has_more: data.has_more, remaining_in_batch: data.remaining_in_batch, failures: data.failures.map(item => ({ code: item.code, count: item.count })), scope: "authenticated_user", coverage };
    if (data.busy) return respond({ ...body, error: "alert_checks_already_running" }, 409);
    return respond(body, data.failed ? 502 : 200);
  } catch (error) {
    if (error instanceof RequestAuthenticationError) return respond({ error: error.status === 408 ? "request_body_timeout" : error.status === 413 ? "request_exceeds_1_KiB" : error.code }, error.status);
    return respond({ error: "alert_check_request_failed" }, 502);
  }
});
