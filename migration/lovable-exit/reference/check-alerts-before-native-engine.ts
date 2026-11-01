import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // Scheduler credentials are intentionally absent from browser CORS headers.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const alertsResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
class AlertsCheckError extends Error { constructor(public readonly code: string, public readonly status = 502) { super(code); } }
type AlertsDbClient = ReturnType<typeof createClient>;
type AlertsRow = { id: string; user_id: string; alert_type: string; frequency: string; last_checked: string | null; created_at: string; subjects: { name: string; case_id: string } | null };
type AlertsResult = { triggered: boolean; title: string; message: string; severity: string; metadata: Record<string, unknown> };
const alertsUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const alertsFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) });

// SHA-256 yields equal-size buffers. Every byte is compared, without early exit.
export async function alertsSecretEqual(candidate: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(candidate)), crypto.subtle.digest("SHA-256", encoder.encode(expected))]);
  const a = new Uint8Array(left), b = new Uint8Array(right); let difference = 0;
  for (let index = 0; index < 32; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}
async function alertsSchedulerAuthorized(req: Request): Promise<boolean> {
  const candidate = req.headers.get("x-alerts-scheduler-key");
  if (candidate === null) return false;
  const expected = Deno.env.get("ALERTS_SCHEDULER_SECRET") || "";
  if (candidate.length < 32 || candidate.length > 512 || expected.length < 32 || expected.length > 512 || /[\r\n]/.test(candidate + expected)) throw new AlertsCheckError("scheduler_authentication_rejected", 401);
  if (!await alertsSecretEqual(candidate, expected)) throw new AlertsCheckError("scheduler_authentication_rejected", 401);
  const expiry = Deno.env.get("ALERTS_SCHEDULER_EXPIRES_AT");
  if (expiry !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(expiry) || !Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now() || new Date(Date.parse(expiry)).toISOString().slice(0,19) !== expiry.slice(0,19))) throw new AlertsCheckError("scheduler_credential_expired_or_invalid", 401);
  return true;
}
function alertsInterval(frequency: string): number {
  const intervals: Record<string, number> = { realtime: 300000, hourly: 3600000, daily: 86400000, weekly: 604800000 };
  if (!Object.prototype.hasOwnProperty.call(intervals, frequency)) throw new AlertsCheckError("invalid_alert_frequency");
  return intervals[frequency];
}
function alertsValidateRow(value: unknown): AlertsRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AlertsCheckError("invalid_alert_record");
  const row = value as Record<string, unknown>; const subject = row.subjects;
  if (!alertsUuid(row.id) || !alertsUuid(row.user_id) || typeof row.alert_type !== "string" || typeof row.frequency !== "string" || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at)) || row.last_checked !== null && (typeof row.last_checked !== "string" || !Number.isFinite(Date.parse(row.last_checked)))) throw new AlertsCheckError("invalid_alert_record");
  if (!subject || typeof subject !== "object" || Array.isArray(subject) || !alertsUuid((subject as Record<string, unknown>).case_id) || typeof (subject as Record<string, unknown>).name !== "string" || String((subject as Record<string, unknown>).name).length > 1000) throw new AlertsCheckError("subject_unavailable_or_not_authorized");
  alertsInterval(row.frequency);
  return row as unknown as AlertsRow;
}
async function alertsRows(query: PromiseLike<{ data: unknown; error: unknown; count?: number | null }>, code: string, requireCount = true) {
  const result = await query;
  if (result.error || !Array.isArray(result.data) || result.data.length > 250 || requireCount && (typeof result.count !== "number" || !Number.isInteger(result.count) || result.count < result.data.length)) throw new AlertsCheckError(code);
  return { rows: result.data as Record<string, unknown>[], count: requireCount ? result.count as number : result.data.length };
}
async function alertsReadSince(client: AlertsDbClient, table: string, fields: string, alert: AlertsRow, now: string, extra?: [string, string]) {
  let query = client.from(table).select(fields, { count: "exact" }).eq("case_id", alert.subjects!.case_id).gt("created_at", alert.last_checked || alert.created_at).lte("created_at", now);
  if (extra) query = query.eq(extra[0], extra[1]);
  return alertsRows(query.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(25), "source_query_failed_" + table);
}
function alertsEvidenceIds(rows: Record<string, unknown>[]) {
  if (rows.some(row => !alertsUuid(row.id))) throw new AlertsCheckError("invalid_source_record_id");
  return rows.map(row => row.id as string).sort();
}
async function alertsCheck(alert: AlertsRow, client: AlertsDbClient, now: string): Promise<AlertsResult> {
  const subject = alert.subjects!; const empty: AlertsResult = { triggered: false, title: "", message: "", severity: "info", metadata: {} };
  // Even a global scheduler cannot send cross-case evidence to an alert owner
  // merely because a user-controlled alert subject_id points at that case.
  const access = await client.rpc("can_access_case", { _user_id: alert.user_id, _case_id: subject.case_id });
  if (access.error || access.data !== true) throw new AlertsCheckError("subject_case_access_not_verified", 403);
  switch (alert.alert_type) {
    case "domain_registration": {
      const result = await alertsReadSince(client, "artifacts", "id, created_at", alert, now, ["artifact_type", "domain"]);
      if (!result.count) return empty;
      return { triggered: true, title: 'New domain activity for "' + subject.name + '"', message: result.count + " new stored domain artifact(s) detected since the last check. This does not query new domain registrations.", severity: "warning", metadata: { artifact_count: result.count, sampled_evidence_ids: alertsEvidenceIds(result.rows), evidence_sample_truncated: result.count > result.rows.length } };
    }
    case "username_appearance": {
      const result = await alertsReadSince(client, "tool_results", "id, tool_name, created_at", alert, now);
      if (!result.count) return empty;
      return { triggered: true, title: 'New stored tool results for "' + subject.name + '"', message: result.count + " new case tool result(s) were stored. A tool result alone does not verify a username match.", severity: "info", metadata: { result_count: result.count, sampled_evidence_ids: alertsEvidenceIds(result.rows), evidence_sample_truncated: result.count > result.rows.length } };
    }
    case "data_change": {
      const [artifacts, events] = await Promise.all([alertsReadSince(client, "artifacts", "id, created_at", alert, now), alertsReadSince(client, "events", "id, created_at", alert, now)]);
      const count = artifacts.count + events.count; if (!count) return empty;
      return { triggered: true, title: 'Stored case changes for "' + subject.name + '"', message: count + " new stored records: " + artifacts.count + " artifacts and " + events.count + " events.", severity: count > 5 ? "warning" : "info", metadata: { artifacts: artifacts.count, events: events.count, sampled_evidence_ids: [...alertsEvidenceIds(artifacts.rows), ...alertsEvidenceIds(events.rows)], evidence_sample_truncated: count > artifacts.rows.length + events.rows.length } };
    }
    case "mention_monitoring": {
      const result = await alertsReadSince(client, "entities", "id, label, entity_type", alert, now); if (!result.count) return empty;
      return { triggered: true, title: 'New stored entity references for "' + subject.name + '"', message: result.count + " new case entity record(s) were stored. This does not search external mentions.", severity: "info", metadata: { entity_count: result.count, sampled_evidence_ids: alertsEvidenceIds(result.rows), evidence_sample_truncated: result.count > result.rows.length } };
    }
    case "breach_detection": {
      const entities = await alertsRows(client.from("identity_entities").select("entity_value", { count: "exact" }).eq("source_case_id", subject.case_id).in("entity_type", ["email", "username", "phone", "domain"]).limit(250), "source_query_failed_identity_entities");
      if (entities.count > 250 || entities.rows.some(row => typeof row.entity_value !== "string" || !row.entity_value.trim() || row.entity_value.length > 512)) throw new AlertsCheckError("breach_identifiers_unbounded_or_invalid");
      const identifiers = [...new Set(entities.rows.map(row => row.entity_value as string))]; if (!identifiers.length) return empty;
      const result = await alertsRows(client.from("breach_records").select("id, breach_name, breach_source, severity", { count: "exact" }).eq("user_id", alert.user_id).in("identifier", identifiers).gt("created_at", alert.last_checked || alert.created_at).lte("created_at", now).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(25), "source_query_failed_breach_records");
      if (!result.count) return empty;
      const names = [...new Set(result.rows.map(row => row.breach_name || row.breach_source).filter((name): name is string => typeof name === "string" && name.length <= 250))];
      return { triggered: true, title: 'New stored breach records for "' + subject.name + '"', message: result.count + " new previously collected breach record(s) were stored. No breach provider was queried by this check.", severity: result.rows.some(row => row.severity === "critical") ? "critical" : "warning", metadata: { breach_count: result.count, sampled_breach_names: names, sampled_evidence_ids: alertsEvidenceIds(result.rows), evidence_sample_truncated: result.count > result.rows.length, severity_coverage: "sampled_records_only" } };
    }
    default: throw new AlertsCheckError("unsupported_alert_type");
  }
}
async function alertsNotificationId(alert: AlertsRow, result: AlertsResult): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([alert.id, alert.last_checked || alert.created_at, result.metadata]))));
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes.slice(0,16)].map(value => value.toString(16).padStart(2,"0")).join("");
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join("-");
}
serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return alertsResponse({ error: "Use POST." }, 405);
  try {
    const scheduler = await alertsSchedulerAuthorized(req);
    const authorization = req.headers.get("Authorization");
    // No backend client, global query or mutation before caller authentication.
    if (!scheduler && (!authorization?.startsWith("Bearer ") || authorization.length > 8192 || !authorization.slice(7).trim())) return alertsResponse({ error: "Unauthorized" }, 401);
    const backend = Deno.env.get("SUPABASE_URL"), key = Deno.env.get(scheduler ? "SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_ANON_KEY");
    if (!backend || !key) throw new AlertsCheckError("independent_backend_configuration_missing", 424);
    const client = createClient(backend, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: alertsFetch, ...(!scheduler ? { headers: { Authorization: authorization! } } : {}) } });
    let userId: string | null = null;
    if (!scheduler) {
      const auth = await client.auth.getUser(authorization!.slice(7));
      if (auth.error || !alertsUuid(auth.data?.user?.id)) return alertsResponse({ error: "Unauthorized" }, 401);
      userId = auth.data.user.id;
    }
    // Optional small JSON body contains no user/owner override. Unknown fields
    // and credentials in the body cannot broaden this operation's scope.
    const length = Number(req.headers.get("content-length")); if (length > 1024) throw new AlertsCheckError("request_exceeds_1_KiB", 413);
    const reader = req.body?.getReader(); let body = ""; let size = 0;
    if (reader) {
      const decoder = new TextDecoder(); let bodyTimer: ReturnType<typeof setTimeout>;
      const deadline = new Promise<never>((_resolve, reject) => { bodyTimer = setTimeout(() => reject(new AlertsCheckError("request_body_timeout", 408)), 5000); });
      try { for (;;) { const part = await Promise.race([reader.read(), deadline]); if (part.done) break; size += part.value.byteLength; if (size > 1024) throw new AlertsCheckError("request_exceeds_1_KiB", 413); body += decoder.decode(part.value, { stream: true }); } body += decoder.decode(); } finally { clearTimeout(bodyTimer!); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    if (body.trim()) { let input: unknown; try { input = JSON.parse(body); } catch { throw new AlertsCheckError("request_body_invalid", 400); } if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new AlertsCheckError("request_body_must_be_empty_object", 400); }
    // Bound each run to 100 alerts and expose continuation honestly; no claim
    // that a single response checked the complete global/user collection.
    const now = new Date(), nowIso = now.toISOString();
    const due = ["last_checked.is.null", ...Object.entries({ realtime: 300000, hourly: 3600000, daily: 86400000, weekly: 604800000 }).map(([frequency, interval]) => "and(frequency.eq." + frequency + ",last_checked.lte." + new Date(now.getTime() - interval).toISOString() + ")")].join(",");
    let query = client.from("alerts").select("*, subjects(name, type, case_id)").eq("enabled", true).or(due);
    if (userId) query = query.eq("user_id", userId);
    const enabled = await alertsRows(query.order("last_checked", { ascending: true, nullsFirst: true }).order("id", { ascending: true }).limit(101), "alert_selection_failed", false);
    const records = enabled.rows.slice(0,100); let checked = 0, triggered = 0, skipped = 0, failed = 0, notificationsCreated = 0;
    const failures: { code: string; count: number }[] = []; const started = Date.now(); let remaining = 0;
    for (let index = 0; index < records.length; index++) {
      if (Date.now() - started > 45000) { remaining = records.length - index; break; }
      try {
        const alert = alertsValidateRow(records[index]);
        if (userId && alert.user_id !== userId) throw new AlertsCheckError("alert_owner_mismatch", 403);
        if (Date.parse(alert.created_at) > now.getTime() + 300000 || alert.last_checked && Date.parse(alert.last_checked) > now.getTime() + 300000) throw new AlertsCheckError("invalid_future_alert_timestamp");
        if (alert.last_checked && now.getTime() - Date.parse(alert.last_checked) < alertsInterval(alert.frequency)) { skipped++; continue; }
        const result = await alertsCheck(alert, client, nowIso);
        if (result.triggered) {
          // Stable ID prevents duplicate notifications after a failed watermark
          // update when the same stored evidence is checked again.
          const notificationId = await alertsNotificationId(alert, result);
          const notice = await client.from("alert_notifications").upsert({ id: notificationId, alert_id: alert.id, user_id: alert.user_id, title: result.title, message: result.message, severity: result.severity, metadata: { ...result.metadata, coverage: "Changes in existing stored case records only; no external source polling." } }, { onConflict: "id", ignoreDuplicates: true }).select("id");
          if (notice.error || !Array.isArray(notice.data) || notice.data.length > 1 || notice.data.length === 1 && notice.data[0]?.id !== notificationId) throw new AlertsCheckError("notification_write_failed");
          notificationsCreated += notice.data.length;
        }
        let update = client.from("alerts").update({ last_checked: nowIso, ...(result.triggered ? { last_triggered: nowIso } : {}) }).eq("id", alert.id).eq("user_id", alert.user_id).eq("enabled", true);
        update = alert.last_checked === null ? update.is("last_checked", null) : update.eq("last_checked", alert.last_checked);
        const written = await update.select("id");
        if (written.error || !Array.isArray(written.data) || written.data.length !== 1 || written.data[0].id !== alert.id) throw new AlertsCheckError("alert_watermark_write_failed_or_conflicted");
        checked++; if (result.triggered) triggered++;
      } catch (error) { failed++; const code = error instanceof AlertsCheckError ? error.code : "alert_check_failed"; const previous = failures.find(item => item.code === code); if (previous) previous.count++; else failures.push({ code, count: 1 }); }
    }
    return alertsResponse({ checked, triggered, skipped, failed, notifications_created: notificationsCreated, examined: checked + skipped + failed, has_more: enabled.rows.length > 100 || remaining > 0, remaining_in_batch: remaining, failures, scope: scheduler ? "authorized_scheduler" : "authenticated_user", coverage: "Changes in stored case records only; this endpoint does not poll external sources or prove notification delivery." }, failed ? 502 : 200);
  } catch (error) { return alertsResponse({ error: error instanceof AlertsCheckError ? error.code : "alert_check_request_failed" }, error instanceof AlertsCheckError ? error.status : 502); }
});
