import { HttpError, LIMITS, nowSeconds, timestamp, canonical, sha256, boundedSnapshot, changeSummary, backoff, plain } from "./core.js";
import { needsBridge, pollSnapshot } from "./pollers.js";
import { coverageForJob, failureReceipt } from "./snapshot-model.js";
import { migrationSession, migrationFetch, MigrationHoldError } from './migration-hold.js';

export function publicJob(row, now = nowSeconds()) {
  const used = row.paid_day === timestamp(now).slice(0, 10) ? row.paid_used || 0 : 0;
  return { id: row.id, kind: row.kind, label: row.label, params: JSON.parse(row.params_json), interval_seconds: row.interval_seconds, enabled: Boolean(row.enabled), paid_daily_budget: row.paid_daily_budget, next_due: row.next_due, last_checked: row.last_checked, last_changed: row.last_changed, failures: row.failures, last_error: row.last_error, has_baseline: Boolean(row.last_hash), created_at: row.created_at,
    coverage: coverageForJob(row, now), budget: { day: timestamp(now).slice(0, 10), approved_daily_limit: row.paid_daily_budget || 0, used, remaining: Math.max(0, (row.paid_daily_budget || 0) - used), requires_licensed_bridge: needsBridge(row.kind, JSON.parse(row.params_json)), notice: "This allowance limits licensed-provider polling; it is not a hosting cost cap or a provider-wide remaining quota." } };
}
export async function coveredJob(db, row, now = nowSeconds()) {
  const latest = await db.prepare("SELECT state AS latest_state,CASE WHEN state IN ('baseline','changed','unchanged') THEN NULL ELSE snapshot_json END AS latest_receipt_json FROM monitor_checks WHERE job_id=? AND user_id=? ORDER BY observed_at DESC,rowid DESC LIMIT 1").bind(row.id, row.user_id).first();
  const lastSuccess = await db.prepare("SELECT MAX(observed_at) AS value FROM monitor_checks WHERE job_id=? AND user_id=? AND state IN ('baseline','changed','unchanged')").bind(row.id, row.user_id).first("value");
  return publicJob({ ...row, ...latest, last_success: lastSuccess }, now);
}
function comparableData(kind, snapshot, previous) {
  if (kind !== "cve") return snapshot.data;
  const errors = snapshot.data.source_errors || [];
  const correlations = snapshot.data.correlations || [];
  const baseline = previous?.last_verified_optional_sources || {};
  const epss = errors.some(error => error.source === "FIRST EPSS") ? baseline.epss || null : { verified_at: snapshot.fetched_at, records: correlations.map(row => ({ cve_id: row.cve_id, epss: row.epss })) };
  const kev = errors.some(error => error.source === "CISA KEV") ? baseline.cisa_kev || null : { verified_at: snapshot.fetched_at, records: correlations.map(row => ({ cve_id: row.cve_id, is_in_cisa_kev: row.is_in_cisa_kev, cisa_kev: row.cisa_kev })) };
  snapshot.last_verified_optional_sources = { epss, cisa_kev: kev, notice: "Retained source components are used for comparisons through temporary outages. Their verified_at timestamps establish provenance; current source failures remain explicitly unknown in data.correlations/source_errors." };
  return { total_results: snapshot.data.total_results, vulnerabilities: snapshot.data.vulnerabilities, epss: epss?.records || null, cisa_kev: kev?.records || null };
}
export async function checkJob(db, id, env, options = {}) {
  db = await migrationSession(db);
  const now = options.now ?? nowSeconds(); const lease = crypto.randomUUID();
  const params = options.userId ? [id, options.userId] : [id];
  const row = await db.prepare(`SELECT * FROM monitor_jobs WHERE id=?${options.userId ? " AND user_id=?" : ""}`).bind(...params).first();
  if (!row) throw new HttpError("Monitor job was not found", 404);
  if (!row.enabled) throw new HttpError("Monitor is paused", 409);
  if (!options.force && row.next_due > now) return { checked: false, state: "not_due" };
  const claim = await db.prepare("UPDATE monitor_jobs SET lease_token=?,lease_until=? WHERE id=? AND enabled=1 AND revision=? AND lease_until<=?").bind(lease, now + LIMITS.lease_seconds, id, row.revision, now).run();
  if (!claim.meta.changes) return { checked: false, state: "leased" };
  const attempt = `${id}:${lease}`;
  try {
    const p = JSON.parse(row.params_json);
    if (needsBridge(row.kind, p)) {
      if (!env.MONITOR_BRIDGE_URL || !env.MONITOR_BRIDGE_SECRET) throw new HttpError("Licensed monitoring bridge is not configured; no provider request was made", 424);
      if (!row.paid_daily_budget) throw new HttpError("No approved daily provider allowance is recorded; no paid polling was made", 424);
      const day = timestamp(now).slice(0, 10);
      const budget = await db.prepare("UPDATE monitor_jobs SET paid_day=?,paid_used=CASE WHEN paid_day=? THEN paid_used+1 ELSE 1 END WHERE id=? AND lease_token=? AND (paid_day IS NULL OR paid_day<>? OR paid_used<paid_daily_budget)").bind(day, day, id, lease, day).run();
      if (!budget.meta.changes) throw new HttpError("Approved daily provider allowance is exhausted; polling was deferred", 429);
    }
    let snapshot;
    if (row.kind === "geofence") {
      const rule = await db.prepare("SELECT * FROM geofence_rules WHERE id=? AND feed_id=? AND user_id=? AND enabled=1").bind(p.rule_id, p.feed_id, row.user_id).first();
      const feed = await db.prepare("SELECT * FROM position_feeds WHERE id=? AND user_id=? AND enabled=1").bind(p.feed_id, row.user_id).first();
      if (!rule || !feed) throw new HttpError("The authorized position feed or geofence rule is unavailable", 424);
      snapshot = { source: "authorized_position_feed", fetched_at: timestamp(now), coverage: "Reported positions from the account-authorized feed. Alerts arise only from observed polygon state transitions, not a guessed location.", data: { feed_id: feed.id, rule_id: rule.id, entity_label: rule.entity_label, state: rule.last_state, last_position_time: feed.last_observed_at ? new Date(feed.last_observed_at).toISOString() : null, reported_position: feed.last_observed_at ? { latitude: feed.last_latitude, longitude: feed.last_longitude, accuracy_m: feed.last_accuracy } : null } };
    } else snapshot = await pollSnapshot({ ...row, attempt_key: attempt }, env, migrationFetch(db, options.fetcher || fetch));
    const previous = row.last_snapshot_json ? JSON.parse(row.last_snapshot_json) : null;
    const comparison = comparableData(row.kind, snapshot, previous);
    const serialized = boundedSnapshot(snapshot); const hash = await sha256(canonical(comparison));
    const changed = Boolean(row.last_hash && row.last_hash !== hash); const state = !row.last_hash ? "baseline" : changed ? "changed" : "unchanged";
    const checkId = crypto.randomUUID(); const guard = "EXISTS(SELECT 1 FROM monitor_jobs WHERE id=? AND lease_token=? AND revision=? AND enabled=1)";
    const partialError = Array.isArray(snapshot.data.source_errors) && snapshot.data.source_errors.length ? snapshot.data.source_errors.map(error => `${error.source}: ${error.error}`).join("; ").slice(0, 1000) : null;
    const statements = [db.prepare(`INSERT INTO monitor_checks(id,job_id,user_id,attempt_key,observed_at,state,content_hash,source,snapshot_json,error) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(checkId, id, row.user_id, attempt, now, state, hash, snapshot.source, state === "unchanged" ? null : serialized, partialError, id, lease, row.revision)];
    if (changed && row.kind !== "geofence") {
      statements.push(db.prepare(`INSERT OR IGNORE INTO monitor_alerts(id,user_id,job_id,event_key,kind,message,evidence_json,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`).bind(crypto.randomUUID(), row.user_id, id, `${attempt}:changed`, "source_change", `${row.label}: sourced content changed`, JSON.stringify({ source: snapshot.source, previous_hash: row.last_hash, content_hash: hash, observed_at: timestamp(now), ...changeSummary(previous, snapshot), coverage: snapshot.coverage, history_check_id: checkId }), now, id, lease, row.revision));
    }
    statements.push(db.prepare("UPDATE monitor_jobs SET last_hash=?,last_snapshot_json=?,last_checked=?,last_changed=CASE WHEN ? THEN ? ELSE last_changed END,failures=0,last_error=?,next_due=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND lease_token=? AND revision=? AND enabled=1").bind(hash, serialized, now, changed ? 1 : 0, now, partialError, now + row.interval_seconds, now, id, lease, row.revision));
    const result = await db.batch(statements);
    if (!result.at(-1).meta.changes) return { checked: false, state: "superseded" };
    return { checked: true, state, changed, check_id: checkId, source: snapshot.source, content_hash: hash, ...(partialError ? { coverage_state: "partial", source_error: partialError } : {}) };
  } catch (error) {
    if (error instanceof MigrationHoldError) throw error;
    const message = error instanceof HttpError ? error.message : "Source polling or monitor storage failed; the previous verified snapshot was preserved";
    const budgetDeferred = error instanceof HttpError && error.status === 429 && /allowance/.test(error.message);
    const failures = budgetDeferred ? row.failures : row.failures + 1;
    const delay = budgetDeferred ? (Math.floor(now / 86400) + 1) * 86400 - now : backoff(row.interval_seconds, failures);
    const guard = "EXISTS(SELECT 1 FROM monitor_jobs WHERE id=? AND lease_token=? AND revision=?)";
    const receipt = failureReceipt(error, message);
    const statements = [db.prepare(`INSERT INTO monitor_checks(id,job_id,user_id,attempt_key,observed_at,state,error,snapshot_json) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`).bind(crypto.randomUUID(), id, row.user_id, attempt, now, budgetDeferred ? "allowance_deferred" : "failed", message, JSON.stringify(receipt), id, lease, row.revision)];
    // Persist a service-failure alert only when the third consecutive check fails.
    if (!budgetDeferred && failures === 3) statements.push(db.prepare(`INSERT OR IGNORE INTO monitor_alerts(id,user_id,job_id,event_key,kind,message,evidence_json,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`).bind(crypto.randomUUID(), row.user_id, id, `${attempt}:failure`, "monitor_failure", `${row.label}: three consecutive checks failed`, JSON.stringify({ error: message, failures, next_retry: timestamp(now + delay), note: "Missing access is not a negative finding; the previous baseline remains intact." }), now, id, lease, row.revision));
    statements.push(db.prepare("UPDATE monitor_jobs SET failures=?,last_error=?,last_checked=?,next_due=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND lease_token=? AND revision=?").bind(failures, message, now, now + delay, now, id, lease, row.revision));
    await db.batch(statements);
    return { checked: true, state: budgetDeferred ? "allowance_deferred" : "failed", coverage_state: receipt.coverage_state, error: message, next_retry: timestamp(now + delay) };
  } finally {
    await db.prepare("UPDATE monitor_jobs SET lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?").bind(id, lease).run();
  }
}
export async function runDueJobs(db, env, options = {}) {
  db = await migrationSession(db);
  const now = options.now ?? nowSeconds(); const scheduled = options.scheduledAt ?? Math.floor(now / 300) * 300;
  const tick = await db.prepare("INSERT OR IGNORE INTO scheduler_ticks(scheduled_at,started_at) VALUES(?,?)").bind(scheduled, now).run();
  if (!tick.meta.changes) return { checked: 0, failed: 0, duplicate_tick: true };
  const max = Math.max(1, Math.min(10, Number(env.MAX_DUE_JOBS) || 10));
  const rows = (await db.prepare("SELECT id FROM monitor_jobs WHERE enabled=1 AND next_due<=? AND lease_until<=? ORDER BY next_due,id LIMIT ?").bind(now, now, max).all()).results;
  let checked = 0, failed = 0;
  for (const row of rows) {
    try { const result = await checkJob(db, row.id, env, { ...(options.now !== undefined ? { now } : {}), fetcher: options.fetcher }); if (result.checked) checked++; if (result.state === "failed") failed++; }
    catch (error) { if (error instanceof MigrationHoldError) throw error; failed++; } // A migration pause is not a provider failure or a completed scheduler tick.
  }
  await db.prepare("UPDATE scheduler_ticks SET completed_at=?,checked=?,failed=? WHERE scheduled_at=?").bind(nowSeconds(), checked, failed, scheduled).run();
  return { checked, failed, due_jobs_selected: rows.length, max_due_jobs_per_tick: max };
}
