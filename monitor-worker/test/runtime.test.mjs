// Isolated test fixtures only. These tests never write to a deployed account or provider.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { sqliteFacade } from "../src/sqlite-facade.js";
import { checkJob, runDueJobs, coveredJob } from "../src/engine.js";
import { validateParams, pollSnapshot } from "../src/pollers.js";
import { validatePolygon, pointInPolygon } from "../src/geometry.js";
import { createFeed, createRule, ingestPosition } from "../src/positions.js";
import { handleApi } from "../src/api.js";
import { sha256, canonical, backoff, sourceRequest, MONITOR_USER_AGENT } from "../src/core.js";
import { armNextCheck, runAlarm } from "../src/alarms.js";
import { snapshotHashData } from "../src/snapshot-model.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const env = { APP_ORIGIN: "https://app.example.com", SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "test-publishable-key", MONITOR_ALLOWED_HOSTS: "app.example.com", MAX_DUE_JOBS: "10" };

async function database() {
  const sqlite = new DatabaseSync(":memory:");
  const storage = {
    sql: { exec(query, ...values) {
      if (!values.length && query.split(";").filter(part => part.trim()).length > 1) { sqlite.exec(query); return { toArray: () => [], one: () => undefined, rowsRead: 0, rowsWritten: 0 }; }
      const statement = sqlite.prepare(query); let rows; let writes = 0;
      if (statement.columns().length) rows = statement.all(...values); else { const result = statement.run(...values); writes = Number(result.changes); rows = []; }
      return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error("Expected one row"); return rows[0]; }, rowsRead: rows.length, rowsWritten: writes };
    } },
    transactionSync(callback) { sqlite.exec("BEGIN"); try { const value = callback(); sqlite.exec("COMMIT"); return value; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } },
  };
  const db = sqliteFacade(storage); await db.exec(await readFile(new URL("../migrations/0001_monitors.sql", import.meta.url), "utf8"));
  return db;
}
async function job(db, kind = "social_account", params = { platform: "github", username: "octocat" }, owner = USER) {
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO monitor_jobs(id,user_id,kind,label,params_json,interval_seconds,next_due,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id, owner, kind, "Isolated test monitor", JSON.stringify(params), 300, 0, 0, 0).run();
  return id;
}
const github = followers => async () => Response.json({ id: 1, login: "octocat", html_url: "https://github.com/octocat", followers, updated_at: "2026-10-13T12:00:00Z" });

test("durable baseline, meaningful changes, history and alert idempotency", async () => {
  const db = await database(); const id = await job(db);
  const baseline = await checkJob(db, id, env, { now: 1000, fetcher: github(10) });
  assert.equal(baseline.state, "baseline");
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM monitor_alerts").first("count"), 0);
  const unchanged = await checkJob(db, id, env, { now: 1300, fetcher: github(10) });
  assert.equal(unchanged.state, "unchanged"); // fetched_at changes do not create an alert.
  const changed = await checkJob(db, id, env, { now: 1600, fetcher: github(11) });
  assert.equal(changed.state, "changed");
  const alerts = (await db.prepare("SELECT * FROM monitor_alerts").all()).results;
  assert.equal(alerts.length, 1); assert.equal(alerts[0].received_at, null); assert.equal(alerts[0].read_at, null);
  assert.equal((await checkJob(db, id, env, { now: 1600, fetcher: github(11) })).state, "not_due");
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM monitor_checks").first("count"), 3);
  assert.equal(JSON.parse((await db.prepare("SELECT last_snapshot_json FROM monitor_jobs WHERE id=?").bind(id).first()).last_snapshot_json).data.profile.followers, 11);
});

test("leases prevent concurrent polling and a paused in-flight job cannot commit results", async () => {
  const db = await database(); const id = await job(db); let resolve;
  const pending = checkJob(db, id, env, { now: 1000, fetcher: () => new Promise(done => { resolve = done; }) });
  await new Promise(done => setTimeout(done, 0));
  assert.equal((await checkJob(db, id, env, { now: 1000, fetcher: github(100) })).state, "leased");
  await db.prepare("UPDATE monitor_jobs SET enabled=0,revision=revision+1,lease_token=NULL,lease_until=0 WHERE id=?").bind(id).run();
  resolve(Response.json({ id: 1, login: "octocat", followers: 99 }));
  assert.equal((await pending).state, "superseded");
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM monitor_checks").first("count"), 0);
});

test("scheduler ticks are persisted and duplicate delivery does not repoll", async () => {
  const db = await database(); await job(db); let requests = 0;
  const fetcher = async (...args) => { requests++; return github(1)(...args); };
  assert.equal((await runDueJobs(db, env, { now: 1000, scheduledAt: 900, fetcher })).checked, 1);
  assert.equal((await runDueJobs(db, env, { now: 1000, scheduledAt: 900, fetcher })).duplicate_tick, true);
  assert.equal(requests, 1);
  assert.equal((await db.prepare("SELECT checked FROM scheduler_ticks WHERE scheduled_at=900").first()).checked, 1);
});

test("provider failures preserve baseline and back off without becoming negative findings", async () => {
  const db = await database(); const id = await job(db);
  await checkJob(db, id, env, { now: 1000, fetcher: github(5) });
  const before = await db.prepare("SELECT last_hash FROM monitor_jobs WHERE id=?").bind(id).first("last_hash");
  const failure = () => Promise.resolve(new Response("denied", { status: 403 }));
  await checkJob(db, id, env, { now: 1300, fetcher: failure });
  await checkJob(db, id, env, { now: 1600, fetcher: failure });
  const third = await checkJob(db, id, env, { now: 2200, fetcher: failure });
  assert.equal(third.state, "failed"); assert.match(third.error, /HTTP 403/);
  assert.equal(await db.prepare("SELECT last_hash FROM monitor_jobs WHERE id=?").bind(id).first("last_hash"), before);
  const alert = await db.prepare("SELECT kind FROM monitor_alerts").first(); assert.equal(alert.kind, "monitor_failure");
  assert.equal(backoff(300, 3), 1200);
});

test("licensed monitoring remains blocked without bridge and approved provider budget", async () => {
  const db = await database(); const id = await job(db, "dark_web", { domain: "example.com" }); let calls = 0;
  const result = await checkJob(db, id, env, { now: 1000, fetcher: async () => { calls++; throw new Error("No provider call should occur"); } });
  assert.equal(result.state, "failed"); assert.match(result.error, /bridge is not configured/); assert.equal(calls, 0);
});

test("NVD records correlate exact source EPSS and KEV without inventing failed-source values", async () => {
  const requests = [];
  const fetcher = async url => { requests.push(String(url)); if (String(url).includes("nvd.nist.gov")) return Response.json({ totalResults: 1, vulnerabilities: [{ cve: { id: "CVE-2024-3094", descriptions: [{ lang: "en", value: "Supplied NVD test record" }] } }] }); if (String(url).includes("api.first.org")) return new Response("temporarily unavailable", { status: 503 }); return Response.json({ vulnerabilities: [{ cveID: "CVE-2024-3094", vulnerabilityName: "Supplied KEV test record" }] }); };
  const result = await pollSnapshot({ kind: "cve", params_json: JSON.stringify({ cpe: "cpe:2.3:a:vendor:product:1.0:*:*:*:*:*:*:*" }) }, env, fetcher);
  assert.equal(result.data.coverage_state, "partial"); assert.equal(result.data.correlations[0].epss, null); assert.equal(result.data.correlations[0].is_in_cisa_kev, true);
  assert.match(result.data.source_errors[0].error, /HTTP 503/);
  assert.ok(requests[0].includes("cpeName=")); assert.equal(requests.length, 3);
});

test("ADSB monitoring ignores fetch-time metadata while retaining actual flight positions", async () => {
  const db = await database(); const id = await job(db, "adsb", { latitude: 30.2672, longitude: -97.7431, radius_nm: 25 });
  const aircraft = latitude => async () => Response.json({ now: Date.now(), ctime: Math.random(), ac: [{ hex: "abcdef", flight: "TST1", lat: latitude, lon: -97.74, gs: 120, seen_pos: Math.random() }] });
  assert.equal((await checkJob(db, id, env, { now: 1000, fetcher: aircraft(30.2) })).state, "baseline");
  assert.equal((await checkJob(db, id, env, { now: 1300, fetcher: aircraft(30.2) })).state, "unchanged");
  assert.equal((await checkJob(db, id, env, { now: 1600, fetcher: aircraft(30.3) })).state, "changed");
});

test("an EPSS outage stays unknown and does not produce a false deleted-score change alert", async () => {
  const db = await database(); const id = await job(db, "cve", { keyword: "CVE-2024-3094" });
  const source = (epss, fail = false) => async url => String(url).includes("nvd.nist.gov") ? Response.json({ totalResults: 1, vulnerabilities: [{ cve: { id: "CVE-2024-3094" } }] }) : String(url).includes("api.first.org") ? fail ? new Response("unavailable", { status: 503 }) : Response.json({ data: [{ cve: "CVE-2024-3094", epss, percentile: "0.9", date: "2026-10-13" }] }) : Response.json({ vulnerabilities: [] });
  assert.equal((await checkJob(db, id, env, { now: 1000, fetcher: source("0.5") })).state, "baseline");
  const outage = await checkJob(db, id, env, { now: 1300, fetcher: source(null, true) }); assert.equal(outage.state, "unchanged"); assert.equal(outage.coverage_state, "partial");
  const snapshot = JSON.parse(await db.prepare("SELECT last_snapshot_json FROM monitor_jobs WHERE id=?").bind(id).first("last_snapshot_json"));
  assert.equal(snapshot.data.correlations[0].epss, null); assert.equal(snapshot.last_verified_optional_sources.epss.records[0].epss.epss, "0.5");
  assert.equal((await checkJob(db, id, env, { now: 1600, fetcher: source("0.5") })).state, "unchanged");
  assert.equal((await checkJob(db, id, env, { now: 1900, fetcher: source("0.8") })).state, "changed");
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM monitor_alerts").first("count"), 1);
});

test("page/RSS sources enforce an exact public-host allowlist and reject credentials/private URLs", () => {
  assert.throws(() => validateParams("page", { url: "https://127.0.0.1/" }, env), /public HTTPS/);
  assert.throws(() => validateParams("page", { url: "https://unapproved.example.com/" }, env), /not authorized/);
  assert.throws(() => validateParams("page", { url: "https://app.example.com/?token=private" }, env), /credential parameters/);
  assert.equal(validateParams("page", { url: "https://app.example.com/" }, env).url, "https://app.example.com/");
});

test("polygons validate boundaries and reject self-intersection", () => {
  const square = validatePolygon([[-98, 30], [-97, 30], [-97, 31], [-98, 31]]);
  assert.equal(pointInPolygon(-97.5, 30.5, square), true); assert.equal(pointInPolygon(-98, 30.5, square), true); assert.equal(pointInPolygon(-99, 30.5, square), false);
  assert.throws(() => validatePolygon([[0, 0], [1, 1], [0, 1], [1, 0]]), /self-intersect/);
});

test("authorized feed tokens are hashed; actual reported transitions create idempotent enter/exit alerts", async () => {
  const db = await database(); const created = await createFeed(db, USER, { label: "Isolated test feed", authorization_confirmed: true }, env, "https://worker.example.com/v1/feeds");
  const stored = await db.prepare("SELECT token_hash FROM position_feeds WHERE id=?").bind(created.id).first(); assert.equal(stored.token_hash, await sha256(created.token)); assert.notEqual(stored.token_hash, created.token);
  const rule = await createRule(db, USER, { feed_id: created.id, label: "Isolated test polygon", entity_label: "Test device", polygon: [[-98, 30], [-97, 30], [-97, 31], [-98, 31]], authorization_confirmed: true }, env);
  const time = Date.now() - 4000;
  const request = (event, lat, lon, index) => new Request(`https://worker.example.com/v1/feeds/${created.id}/positions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Feed ${created.token}` }, body: JSON.stringify({ event_id: event, observed_at: new Date(time + index * 1000).toISOString(), latitude: lat, longitude: lon, accuracy_m: 5 }) });
  assert.equal((await ingestPosition(db, request("one", 30.5, -99, 0), created.id)).alerts_stored, 0);
  const inside = await ingestPosition(db, request("two", 30.5, -97.5, 1), created.id); assert.equal(inside.transitions[0].kind, "geofence_enter");
  assert.equal((await ingestPosition(db, request("two", 30.5, -97.5, 1), created.id)).duplicate, true);
  assert.equal((await ingestPosition(db, request("three", 30.5, -99, 2), created.id)).transitions[0].kind, "geofence_exit");
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM monitor_alerts WHERE rule_id=?").bind(rule.id).first("count"), 2);
  await assert.rejects(ingestPosition(db, request("two", 31, -96, 1), created.id), /different source data/);
  await db.prepare("UPDATE position_feeds SET enabled=0 WHERE id=?").bind(created.id).run();
  await assert.rejects(ingestPosition(db, request("four", 30.5, -97.5, 3), created.id), /invalid or revoked/);
});

test("authenticated APIs isolate owners and require client acknowledgments for delivered/read status", async () => {
  const db = await database(); const id = await job(db); await checkJob(db, id, env, { now: 1000, fetcher: github(1) }); await checkJob(db, id, env, { now: 1300, fetcher: github(2) });
  const original = globalThis.fetch; let account = USER;
  globalThis.fetch = async url => String(url).endsWith("/auth/v1/user") ? Response.json({ id: account }) : Response.json({ plan: "enterprise", subscribed: true });
  const request = (path, method = "GET", body) => new Request(`https://worker.example.com${path}`, { method, headers: { Authorization: `Bearer ${"x".repeat(30)}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    const alerts = await (await handleApi(request("/v1/alerts"), db, env)).json(); assert.equal(alerts.alerts[0].delivery_state, "stored");
    const alertId = alerts.alerts[0].id;
    const received = await (await handleApi(request(`/v1/alerts/${alertId}/ack`, "POST", { state: "received" }), db, env)).json(); assert.equal(received.delivery_state, "received_by_client");
    const read = await (await handleApi(request(`/v1/alerts/${alertId}/ack`, "POST", { state: "read" }), db, env)).json(); assert.equal(read.delivery_state, "read_by_client");
    account = OTHER;
    assert.deepEqual((await (await handleApi(request("/v1/jobs"), db, env)).json()).jobs, []);
    assert.equal((await handleApi(request(`/v1/jobs/${id}/check`, "POST"), db, env)).status, 404);
    assert.equal((await handleApi(request(`/v1/alerts/${alertId}/ack`, "POST", { state: "read" }), db, env)).status, 404);
  } finally { globalThis.fetch = original; }
});

test("snapshot hashes normalize ordering without replacing record content", async () => {
  assert.equal(await sha256(canonical({ a: [1, 2], b: "value" })), await sha256(canonical({ b: "value", a: [2, 1] })));
  assert.notEqual(await sha256(canonical({ a: [1, 2] })), await sha256(canonical({ a: [1, 3] })));
});

test("durable alarms arm due jobs, respect leases and disarm a paused scheduler", async () => {
  const db = await database(); const id = await job(db); let alarm = null;
  const storage = { async getAlarm() { return alarm; }, async setAlarm(value) { alarm = value; }, async deleteAlarm() { alarm = null; } };
  assert.equal(await armNextCheck(db, storage, 1000000), 1001000);
  await db.prepare("UPDATE monitor_jobs SET lease_until=1090 WHERE id=?").bind(id).run();
  alarm = null; assert.equal(await armNextCheck(db, storage, 1000000), 1090000);
  await db.prepare("UPDATE monitor_jobs SET enabled=0 WHERE id=?").bind(id).run();
  assert.equal(await armNextCheck(db, storage, 1000000), null); assert.equal(alarm, null);
  await db.prepare("UPDATE monitor_jobs SET enabled=1,lease_until=0,next_due=1300 WHERE id=?").bind(id).run();
  assert.equal(await armNextCheck(db, storage, 1000000), 1300000);
});

test("an alarm failure still rearms the next durable retry without needing a cron quota", async () => {
  const db = await database(); await job(db); let alarm = null;
  const storage = { async getAlarm() { return alarm; }, async setAlarm(value) { alarm = value; }, async deleteAlarm() { alarm = null; } };
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("provider unavailable", { status: 503 });
  try {
    const result = await runAlarm(db, storage, env); assert.equal(result.failed, 1);
    assert.ok(alarm > Date.now());
    assert.equal((await db.prepare("SELECT failures FROM monitor_jobs").first()).failures, 1);
  } finally { globalThis.fetch = original; }
});

test("administrator per-tool denial blocks create, resume and manual polling even for Enterprise", async () => {
  const db = await database(); const existingJob = await job(db, "adsb", { latitude: 30.2, longitude: -97.7, radius_nm: 25 });
  await db.prepare("UPDATE monitor_jobs SET enabled=0 WHERE id=?").bind(existingJob).run();
  const original = globalThis.fetch; const permissionRequests = []; let sources = 0;
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/user") return Response.json({ id: USER });
    if (parsed.pathname === "/functions/v1/check-subscription") return Response.json({ plan: "enterprise", subscribed: true });
    if (parsed.pathname === "/rest/v1/tool_permissions") { permissionRequests.push(parsed); return Response.json([{ allowed: false }]); }
    sources++; throw new Error("Provider request must not occur after permission denial");
  };
  const request = (path, body, method = "POST") => new Request(`https://worker.example.com${path}`, { method, headers: { Authorization: `Bearer ${"x".repeat(30)}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    const creation = await handleApi(request("/v1/jobs", { kind: "adsb", label: "Denied creation", params: { latitude: 30.2, longitude: -97.7, radius_nm: 25 }, polling_authorized: true }), db, env);
    assert.equal(creation.status, 403);
    const resume = await handleApi(request(`/v1/jobs/${existingJob}`, { enabled: true }, "PATCH"), db, env); assert.equal(resume.status, 403);
    const check = await handleApi(request(`/v1/jobs/${existingJob}/check`, {}), db, env); assert.equal(check.status, 403);
    assert.equal(sources, 0); assert.equal(permissionRequests.length, 3);
    for (const url of permissionRequests) { assert.equal(url.searchParams.get("user_id"), `eq.${USER}`); assert.equal(url.searchParams.get("tool_id"), "eq.flight-tracking"); }
    assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM monitor_jobs").first("count"), 1);
    assert.equal(await db.prepare("SELECT enabled FROM monitor_jobs WHERE id=?").bind(existingJob).first("enabled"), 0);
  } finally { globalThis.fetch = original; }
});

test("unavailable permission checks fail closed; an absent override permits a verified Enterprise operation", async () => {
  const db = await database(); const original = globalThis.fetch; let unavailable = true;
  globalThis.fetch = async url => String(url).includes("/auth/v1/user") ? Response.json({ id: USER }) : String(url).includes("/functions/v1/check-subscription") ? Response.json({ plan: "enterprise", subscribed: true }) : unavailable ? new Response("permissions unavailable", { status: 503 }) : Response.json([]);
  const request = () => new Request("https://worker.example.com/v1/feeds", { method: "POST", headers: { Authorization: `Bearer ${"x".repeat(30)}`, "Content-Type": "application/json" }, body: JSON.stringify({ label: "Permission test feed", authorization_confirmed: true }) });
  try {
    const blocked = await handleApi(request(), db, env); assert.equal(blocked.status, 502); assert.match((await blocked.json()).error, /permissions could not be verified/);
    assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM position_feeds").first("count"), 0);
    unavailable = false;
    const allowed = await handleApi(request(), db, env); assert.equal(allowed.status, 201);
    assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM position_feeds").first("count"), 1);
  } finally { globalThis.fetch = original; }
});

test("ADSB polling sends the verified contact User-Agent and preserves actual provider fields", async () => {
  let observed;
  const result = await pollSnapshot({ kind: "adsb", params_json: JSON.stringify({ latitude: 30.2672, longitude: -97.7431, radius_nm: 25 }) }, env, async (url, init) => {
    observed = { url: String(url), headers: new Headers(init.headers), redirect: init.redirect };
    return Response.json({ ac: [{ hex: "abcdef", flight: "TST1", lat: 30.2, lon: -97.74, gs: 120 }] });
  });
  assert.equal(observed.url, "https://api.adsb.lol/v2/point/30.2672/-97.7431/25");
  assert.equal(observed.headers.get("User-Agent"), "InsightNexus/1.0 (contact: travis@tjksecurity.com)");
  assert.equal(observed.headers.has("Authorization"), false);
  assert.equal(observed.redirect, "manual");
  assert.equal(result.data.aircraft[0].lat, 30.2);
  assert.equal(result.data.aircraft[0].hex, "abcdef");
});

test("global source identification preserves explicit provider and authentication headers", async () => {
  const captured = [];
  const fetcher = async (_url, init) => { captured.push(new Headers(init.headers)); return Response.json({ supplied: true }); };
  await sourceRequest("https://project.supabase.co/auth/v1/user", { headers: { Authorization: "Bearer isolated-test-only", apikey: "test-public-key", Accept: "application/json" } }, fetcher);
  assert.equal(captured[0].get("User-Agent"), MONITOR_USER_AGENT);
  assert.equal(captured[0].get("Authorization"), "Bearer isolated-test-only");
  assert.equal(captured[0].get("apikey"), "test-public-key");
  assert.equal(captured[0].get("Accept"), "application/json");
  await sourceRequest("https://api.github.com/users/octocat", { headers: { "User-Agent": "InsightNexus-monitor", Accept: "application/vnd.github+json" } }, fetcher);
  assert.equal(captured[1].get("User-Agent"), "InsightNexus-monitor");
  assert.equal(captured[1].get("Accept"), "application/vnd.github+json");
});

test("coverage keeps negative findings, provider blocks, limits and failures distinct without replacing evidence", async () => {
  const db = await database(), id = await job(db);
  await checkJob(db, id, env, { now: 1000, fetcher: async () => new Response("missing", { status: 404 }) });
  let row = await db.prepare("SELECT * FROM monitor_jobs WHERE id=?").bind(id).first();
  const baselineHash = row.last_hash, baselineJson = row.last_snapshot_json;
  assert.equal((await coveredJob(db, row, 1000)).coverage.state, "no_match");
  for (const [status, state] of [[403, "blocked"], [429, "rate_limited"], [503, "failed"]]) {
    const at = 2000 + status;
    const result = await checkJob(db, id, env, { now: at, force: true, fetcher: async () => new Response("fixture", { status }) });
    assert.equal(result.coverage_state, state);
    row = await db.prepare("SELECT * FROM monitor_jobs WHERE id=?").bind(id).first();
    assert.equal(row.last_hash, baselineHash); assert.equal(row.last_snapshot_json, baselineJson);
    const view = (await coveredJob(db, row, at)).coverage;
    assert.equal(view.state, state); assert.equal(view.source_status, status);
    assert.equal(view.last_attempt, at); assert.equal(view.last_success, 1000);
    assert.equal(view.last_verified_state, "no_match"); assert.equal(view.stale, true);
  }
});

test("configuration, unsupported source, stale evidence and provider allowance have honest receipts", async () => {
  const db = await database(); let calls = 0;
  const configured = await job(db, "dark_web", { domain: "example.com" });
  await checkJob(db, configured, env, { now: 1000, fetcher: async () => { calls++; throw new Error("Unexpected provider call"); } });
  const config = await coveredJob(db, await db.prepare("SELECT * FROM monitor_jobs WHERE id=?").bind(configured).first(), 1000);
  assert.equal(config.coverage.state, "config_required"); assert.equal(config.coverage.last_success, null); assert.equal(config.coverage.source_status, null); assert.equal(calls, 0);
  const unsupported = await job(db, "legacy_unavailable_kind", {});
  await checkJob(db, unsupported, env, { now: 1000 });
  assert.equal((await coveredJob(db, await db.prepare("SELECT * FROM monitor_jobs WHERE id=?").bind(unsupported).first(), 1000)).coverage.state, "unsupported");
  const valid = await job(db); await checkJob(db, valid, env, { now: 1000, fetcher: github(1) });
  await db.prepare("UPDATE monitor_jobs SET paid_daily_budget=3,paid_used=2,paid_day='1970-01-01' WHERE id=?").bind(valid).run();
  const stale = await coveredJob(db, await db.prepare("SELECT * FROM monitor_jobs WHERE id=?").bind(valid).first(), 3000);
  assert.equal(stale.coverage.state, "stale"); assert.equal(stale.coverage.last_success, 1000);
  assert.equal(stale.budget.remaining, 1); assert.match(stale.budget.notice, /not a hosting cost cap/);
});

test("RSS snapshots ignore collection order, create one real change and retain hash-verifiable old/new history", async () => {
  const db = await database(), id = await job(db, "rss", { url: "https://app.example.com/feed.xml" });
  const feed = titles => async () => new Response(`<rss><channel>${titles.map(title => `<item><guid>${title}</guid><title>${title}</title></item>`).join("")}</channel></rss>`);
  assert.equal((await checkJob(db, id, env, { now: 1000, fetcher: feed(["Alpha", "Beta"]) })).state, "baseline");
  assert.equal((await checkJob(db, id, env, { now: 1300, fetcher: feed(["Beta", "Alpha"]) })).state, "unchanged");
  assert.equal((await checkJob(db, id, env, { now: 1600, fetcher: feed(["Alpha", "Gamma"]) })).state, "changed");
  assert.equal((await checkJob(db, id, env, { now: 1600, fetcher: feed(["Alpha", "Gamma"]) })).state, "not_due");
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM monitor_alerts").first("count"), 1);
  const rows = (await db.prepare("SELECT * FROM monitor_checks WHERE snapshot_json IS NOT NULL ORDER BY observed_at").all()).results;
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(await sha256(canonical(snapshotHashData("rss", JSON.parse(row.snapshot_json)))), row.content_hash);
});

test("history exposes a retained verified snapshot after failure and enforces auth, ownership, origin and bounds", async () => {
  const db = await database(), id = await job(db);
  await checkJob(db, id, env, { now: 1000, fetcher: github(5) });
  await checkJob(db, id, env, { now: 1300, fetcher: async () => new Response("blocked", { status: 403 }) });
  const original = globalThis.fetch; let account = USER;
  globalThis.fetch = async () => Response.json({ id: account });
  const request = (path, headers = {}) => new Request(`https://worker.example.com${path}`, { headers: { Authorization: `Bearer ${"x".repeat(30)}`, ...headers } });
  try {
    const response = await handleApi(request(`/v1/jobs/${id}/history?limit=1`), db, env), value = await response.json();
    assert.equal(response.status, 200); assert.equal(value.history.length, 1); assert.equal(value.history_limit, 1);
    assert.equal(value.history[0].failure_receipt.coverage_state, "blocked"); assert.equal(value.history[0].snapshot, undefined);
    assert.equal(value.latest_verified.snapshot.data.profile.followers, 5); assert.equal(value.latest_verified.observed_at, 1000);
    assert.equal(await sha256(canonical(snapshotHashData("social_account", value.latest_verified.snapshot))), value.latest_verified.content_hash);
    assert.equal((await handleApi(request(`/v1/jobs/${id}/history?limit=101`), db, env)).status, 400);
    assert.equal((await handleApi(new Request(`https://worker.example.com/v1/jobs/${id}/history`), db, env)).status, 401);
    assert.equal((await handleApi(request(`/v1/jobs/${id}/history`, { Origin: "https://unapproved.example" }), db, env)).status, 403);
    account = OTHER;
    assert.equal((await handleApi(request(`/v1/jobs/${id}/history`), db, env)).status, 404);
    assert.deepEqual((await (await handleApi(request("/v1/jobs"), db, env)).json()).jobs, []);
  } finally { globalThis.fetch = original; }
});
