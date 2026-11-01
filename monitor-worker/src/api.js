import { HttpError, LIMITS, text, integer, plain, readJson, sourceRequest, json, nowSeconds, timestamp } from "./core.js";
import { KINDS, validateParams, needsBridge } from "./pollers.js";
import { checkJob, publicJob, coveredJob } from "./engine.js";
import { createFeed, createRule, ingestPosition } from "./positions.js";

async function owner(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new HttpError("Monitor authentication configuration is unavailable", 503);
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9._-]{20,5000}$/.test(authorization)) throw new HttpError("A verified sign-in session is required", 401);
  const { response, body } = await sourceRequest(`${String(env.SUPABASE_URL).replace(/\/$/, "")}/auth/v1/user`, { headers: { Authorization: authorization, apikey: env.SUPABASE_PUBLISHABLE_KEY } });
  if (!response.ok) throw new HttpError("Sign-in session could not be verified", response.status === 401 || response.status === 403 ? 401 : 502);
  let user; try { user = JSON.parse(body); } catch { throw new HttpError("Authentication provider returned invalid JSON", 502); }
  if (!plain(user) || !/^[a-f0-9-]{36}$/i.test(user.id || "")) throw new HttpError("Authentication provider supplied no valid account identity", 401);
  return user;
}
async function verifyPlan(request, env, kind, verifiedUserId) {
  const { response, body } = await sourceRequest(`${String(env.SUPABASE_URL).replace(/\/$/, "")}/functions/v1/check-subscription`, { headers: { Authorization: request.headers.get("authorization"), apikey: env.SUPABASE_PUBLISHABLE_KEY } });
  if (!response.ok) throw new HttpError("Account plan could not be verified; monitor mutation was blocked", 502);
  let data; try { data = JSON.parse(body); } catch { throw new HttpError("Account plan provider returned invalid JSON", 502); }
  const plans = ["free", "professional", "team", "enterprise"];
  if (!plain(data) || !plans.includes(data.plan) || typeof data.subscribed !== "boolean") throw new HttpError("Account plan is unknown; monitor mutation was blocked", 502);
  const required = ["geofence", "telegram"].includes(kind) ? "team" : ["adsb", "dark_web", "social_account", "threat_feed"].includes(kind) ? "professional" : "free";
  if (plans.indexOf(data.plan) < plans.indexOf(required)) throw new HttpError(`This monitor requires ${required} account access`, 403);
  const toolId = { geofence: "geofence-alert", cve: "cve-tracker", threat_feed: "threat-feed", telegram: "telegram-monitor", adsb: "flight-tracking", social_account: "social-media-scanner", dark_web: "dark-web-monitor" }[kind];
  if (!toolId) return;
  // Use only the identity returned by the authentication server, never a request-body owner.
  if (!verifiedUserId) throw new HttpError("Account identity is unavailable for the tool-permission check", 502);
  const url = new URL(`${String(env.SUPABASE_URL).replace(/\/$/, "")}/rest/v1/tool_permissions`);
  url.searchParams.set("user_id", `eq.${verifiedUserId}`); url.searchParams.set("tool_id", `eq.${toolId}`); url.searchParams.set("select", "allowed"); url.searchParams.set("limit", "1");
  const permission = await sourceRequest(url.href, { headers: { Authorization: request.headers.get("authorization"), apikey: env.SUPABASE_PUBLISHABLE_KEY } });
  if (!permission.response.ok) throw new HttpError("Admin tool permissions could not be verified; the monitor operation was blocked", 502);
  let rows; try { rows = JSON.parse(permission.body); } catch { throw new HttpError("Admin tool-permission response was invalid; the monitor operation was blocked", 502); }
  if (!Array.isArray(rows) || rows.length > 1 || rows.some(row => !plain(row) || typeof row.allowed !== "boolean")) throw new HttpError("Admin tool-permission response was invalid; the monitor operation was blocked", 502);
  if (rows[0]?.allowed === false) throw new HttpError("This tool has been disabled for your account by an administrator", 403);
}
function headers(request, env) {
  const origin = request.headers.get("origin");
  if (origin && origin !== env.APP_ORIGIN) throw new HttpError("This monitor API does not permit that browser origin", 403);
  return origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Authorization,Content-Type", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS", Vary: "Origin" } : {};
}
function parseRow(row) { const stored = row.snapshot_json ? JSON.parse(row.snapshot_json) : undefined; const failure = stored?.receipt_kind === "source_failure"; return { ...row, evidence: row.evidence_json ? JSON.parse(row.evidence_json) : undefined, snapshot: failure ? undefined : stored, failure_receipt: failure ? stored : undefined, evidence_json: undefined, snapshot_json: undefined, delivery_state: row.read_at ? "read_by_client" : row.received_at ? "received_by_client" : "stored" }; }
export async function handleApi(request, db, env, runtime = {}) {
  let cors = {};
  try {
    cors = headers(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url); const path = url.pathname.replace(/\/$/, "");
    const positionMatch = path.match(/^\/v1\/feeds\/([a-f0-9-]{36})\/positions$/i);
    if (positionMatch && request.method === "POST") return json(await ingestPosition(db, request, positionMatch[1]), 200, cors);
    const user = await owner(request, env); const id = user.id;
    if (path === "/v1/status" && request.method === "GET") {
      const tick = await db.prepare("SELECT * FROM scheduler_ticks ORDER BY scheduled_at DESC LIMIT 1").first();
      const nextAlarm = runtime.getNextAlarm ? await runtime.getNextAlarm() : null;
      return json({ configured: true, storage: "sqlite_durable_object", scheduler: { enabled: true, mechanism: "durable_object_alarm", min_interval_seconds: 300, next_alarm_at: nextAlarm === null ? null : Math.floor(nextAlarm / 1000), last_tick: tick }, kinds: KINDS, public_kinds: ["cve", "threat_feed", "telegram", "rss", "page", "social_account", "adsb"], licensed_bridge_configured: Boolean(env.MONITOR_BRIDGE_URL && env.MONITOR_BRIDGE_SECRET), authorized_page_hosts: String(env.MONITOR_ALLOWED_HOSTS || "").split(",").filter(Boolean), delivery_channels: ["in_app_with_client_ack"], limits: { ...LIMITS, max_due_jobs_per_tick: Math.min(10, Number(env.MAX_DUE_JOBS) || 10), min_interval_seconds: 300 }, timestamp_format: "Unix seconds on list and next_alarm_at timestamps; source metadata retains original timestamps", notice: "A completed durable scheduler tick proves observed execution. The next alarm is read from runtime storage. Configuration does not establish provider entitlement or notification delivery. Poll intervals are minimums; bounded queue/backoff can delay checks. No cron quota, email or external-message delivery is claimed." }, 200, cors);
    }
    if (path === "/v1/jobs" && request.method === "GET") return json({ jobs: await Promise.all((await db.prepare("SELECT * FROM monitor_jobs WHERE user_id=? AND archived=0 ORDER BY created_at DESC,id LIMIT 100").bind(id).all()).results.map(row => coveredJob(db, row))) }, 200, cors);
    if (path === "/v1/jobs" && request.method === "POST") {
      const body = await readJson(request);
      if (body.polling_authorized !== true) throw new HttpError("Explicit authorization for continuing source polling is required");
      const kind = text(body.kind, "monitor kind", 30); if (!KINDS.includes(kind)) throw new HttpError("Monitor kind is unsupported");
      await verifyPlan(request, env, kind, id);
      const params = validateParams(kind, body.params, env);
      const interval = integer(body.interval_seconds, "interval_seconds", 300, 604800, 3600);
      const allowance = integer(body.paid_daily_budget, "approved daily provider allowance", 0, 24, 0);
      if (needsBridge(kind, params) && interval < 3600) throw new HttpError("Licensed-provider polling must be at least one hour apart");
      if (kind === "geofence") {
        const rule = await db.prepare("SELECT id FROM geofence_rules WHERE id=? AND feed_id=? AND user_id=? AND enabled=1").bind(params.rule_id, params.feed_id, id).first();
        if (!rule) throw new HttpError("Geofence rule is unavailable to this account", 404);
      }
      const count = await db.prepare("SELECT COUNT(*) AS count FROM monitor_jobs WHERE user_id=? AND archived=0").bind(id).first("count");
      if (count >= LIMITS.jobs_per_user) throw new HttpError("The account monitor limit was reached", 409);
      const jobId = crypto.randomUUID(); const now = nowSeconds(); const label = text(body.label, "monitor label", 100);
      await db.prepare("INSERT INTO monitor_jobs(id,user_id,kind,label,params_json,interval_seconds,paid_daily_budget,next_due,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(jobId, id, kind, label, JSON.stringify(params), interval, allowance, now, now, now).run();
      const job = await db.prepare("SELECT * FROM monitor_jobs WHERE id=?").bind(jobId).first();
      return json({ ...publicJob(job), configuration_required: needsBridge(kind, params) && (!env.MONITOR_BRIDGE_SECRET || !allowance) }, 201, cors);
    }
    const jobMatch = path.match(/^\/v1\/jobs\/([a-f0-9-]{36})(?:\/(check|history))?$/i);
    if (jobMatch) {
      const job = await db.prepare("SELECT * FROM monitor_jobs WHERE id=? AND user_id=? AND archived=0").bind(jobMatch[1], id).first();
      if (!job) throw new HttpError("Monitor job was not found", 404);
      if (jobMatch[2] === "check" && request.method === "POST") { await verifyPlan(request, env, job.kind, id); return json(await checkJob(db, job.id, env, { userId: id, force: true }), 200, cors); }
      if (jobMatch[2] === "history" && request.method === "GET") {
        const summary = await coveredJob(db, job);
        const limit = integer(url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined, "history limit", 1, 100, 100);
        return json({ job: summary, history: (await db.prepare("SELECT * FROM monitor_checks WHERE job_id=? AND user_id=? ORDER BY observed_at DESC,rowid DESC LIMIT ?").bind(job.id, id, limit).all()).results.map(parseRow),
          latest_verified: job.last_snapshot_json ? { snapshot: JSON.parse(job.last_snapshot_json), content_hash: job.last_hash, observed_at: summary.coverage.last_success } : null,
          comparison_policy: "SHA-256 over sorted JSON source data (object keys and collection order). Polling timestamps are excluded. CVE comparisons use explicitly timestamped retained optional-source components. Page text is retained; rotating banners are not automatically removed.", history_limit: limit }, 200, cors);
      }
      if (!jobMatch[2] && request.method === "GET") return json(await coveredJob(db, job), 200, cors);
      if (!jobMatch[2] && request.method === "PATCH") {
        const body = await readJson(request); if (typeof body.enabled !== "boolean") throw new HttpError("PATCH requires enabled:true or enabled:false");
        if (body.enabled) await verifyPlan(request, env, job.kind, id);
        const now = nowSeconds();
        await db.prepare("UPDATE monitor_jobs SET enabled=?,revision=revision+1,lease_token=NULL,lease_until=0,next_due=?,updated_at=? WHERE id=? AND user_id=?").bind(body.enabled ? 1 : 0, now, now, job.id, id).run();
        return json({ id: job.id, enabled: body.enabled }, 200, cors);
      }
      if (!jobMatch[2] && request.method === "DELETE") { await db.prepare("UPDATE monitor_jobs SET archived=1,enabled=0,revision=revision+1,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND user_id=?").bind(nowSeconds(), job.id, id).run(); return json({ id: job.id, removed_from_scheduler: true, history_preserved: true }, 200, cors); }
    }
    if (path === "/v1/alerts" && request.method === "GET") {
      const unread = url.searchParams.get("unread") === "true";
      return json({ alerts: (await db.prepare(`SELECT * FROM monitor_alerts WHERE user_id=?${unread ? " AND read_at IS NULL" : ""} ORDER BY created_at DESC,id DESC LIMIT 100`).bind(id).all()).results.map(parseRow) }, 200, cors);
    }
    const alertMatch = path.match(/^\/v1\/alerts\/([a-f0-9-]{36})\/ack$/i);
    if (alertMatch && request.method === "POST") {
      const body = await readJson(request); if (!["received", "read"].includes(body.state)) throw new HttpError("Acknowledgment state must be received or read");
      const now = nowSeconds();
      const result = await db.prepare("UPDATE monitor_alerts SET received_at=COALESCE(received_at,?),read_at=CASE WHEN ?='read' THEN COALESCE(read_at,?) ELSE read_at END WHERE id=? AND user_id=?").bind(now, body.state, now, alertMatch[1], id).run();
      if (!result.meta.changes) throw new HttpError("Alert was not found", 404);
      return json({ id: alertMatch[1], delivery_state: body.state === "read" ? "read_by_client" : "received_by_client" }, 200, cors);
    }
    if (path === "/v1/feeds" && request.method === "GET") return json({ feeds: (await db.prepare("SELECT id,label,enabled,last_observed_at,last_received_at,created_at FROM position_feeds WHERE user_id=? ORDER BY created_at DESC").bind(id).all()).results }, 200, cors);
    if (path === "/v1/feeds" && request.method === "POST") { await verifyPlan(request, env, "geofence", id); return json(await createFeed(db, id, await readJson(request), env, request.url), 201, cors); }
    const feedMatch = path.match(/^\/v1\/feeds\/([a-f0-9-]{36})$/i);
    if (feedMatch && request.method === "DELETE") { const revoked = await db.prepare("UPDATE position_feeds SET enabled=0,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND user_id=?").bind(nowSeconds(), feedMatch[1], id).run(); if (!revoked.meta.changes) throw new HttpError("Feed was not found", 404); return json({ id: feedMatch[1], revoked: true }, 200, cors); }
    if (path === "/v1/rules" && request.method === "GET") return json({ rules: (await db.prepare("SELECT * FROM geofence_rules WHERE user_id=? ORDER BY created_at DESC").bind(id).all()).results.map(row => ({ ...row, enabled: Boolean(row.enabled), polygon: JSON.parse(row.polygon_json), polygon_json: undefined })) }, 200, cors);
    if (path === "/v1/rules" && request.method === "POST") { await verifyPlan(request, env, "geofence", id); return json(await createRule(db, id, await readJson(request)), 201, cors); }
    const ruleMatch = path.match(/^\/v1\/rules\/([a-f0-9-]{36})$/i);
    if (ruleMatch && request.method === "DELETE") { const disabled = await db.prepare("UPDATE geofence_rules SET enabled=0,updated_at=? WHERE id=? AND user_id=?").bind(nowSeconds(), ruleMatch[1], id).run(); if (!disabled.meta.changes) throw new HttpError("Geofence rule was not found", 404); return json({ id: ruleMatch[1], enabled: false }, 200, cors); }
    throw new HttpError("Monitor API route was not found", 404);
  } catch (error) {
    return json({ error: error instanceof HttpError ? error.message : "Monitor operation failed; stored data was preserved. Check the runtime configuration and retry." }, error instanceof HttpError ? error.status : 502, cors);
  }
}
