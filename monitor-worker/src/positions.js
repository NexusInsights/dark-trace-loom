import { HttpError, text, number, readJson, nowSeconds, timestamp, canonical, sha256 } from "./core.js";
import { pointInPolygon, validatePolygon } from "./geometry.js";
import { migrationSession } from './migration-hold.js';

export async function createFeed(db, userId, body, env, requestUrl) {
  db = await migrationSession(db);
  if (body.authorization_confirmed !== true) throw new HttpError("Explicit authorization for this device/entity position feed is required");
  const label = text(body.label, "feed label", 100); const id = crypto.randomUUID();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM position_feeds WHERE user_id=? AND enabled=1").bind(userId).first("count");
  if (count >= 20) throw new HttpError("The account limit of 20 active position feeds was reached", 409);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  const hash = await sha256(token); const now = nowSeconds();
  await db.prepare("INSERT INTO position_feeds(id,user_id,label,token_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(id, userId, label, hash, now, now).run();
  const base = env.FEED_INGRESS_BASE || env.PUBLIC_API_BASE || `${env.APP_ORIGIN || new URL(requestUrl).origin}/api/marketplace-monitor`;
  return { id, label, token, receiver_url: `${base.replace(/\/$/, "")}/v1/feeds/${id}/positions`, authorization_header_format: "Feed <one-time token>", token_storage: "Only a SHA-256 hash is stored; this token is shown once. Revoking the feed stops ingestion.", position_contract: { event_id: "unique source event ID", observed_at: "ISO UTC timestamp", latitude: "number", longitude: "number", accuracy_m: "reported accuracy in meters" } };
}
export async function createRule(db, userId, body) {
  db = await migrationSession(db);
  if (body.authorization_confirmed !== true) throw new HttpError("Explicit authorization for tracking this entity through the selected feed is required");
  const feedId = text(body.feed_id, "position feed ID", 80);
  const feed = await db.prepare("SELECT id FROM position_feeds WHERE id=? AND user_id=? AND enabled=1").bind(feedId, userId).first();
  if (!feed) throw new HttpError("The selected position feed is unavailable to this account", 404);
  const label = text(body.label, "geofence label", 100); const entity = text(body.entity_label, "tracked entity label", 100);
  const polygon = validatePolygon(body.polygon); const accuracy = number(body.max_accuracy_m, "maximum position accuracy", 0, 5000, 100);
  const count = await db.prepare("SELECT COUNT(*) AS count FROM geofence_rules WHERE user_id=? AND enabled=1").bind(userId).first("count");
  if (count >= 100) throw new HttpError("The account limit of 100 active geofence rules was reached", 409);
  const id = crypto.randomUUID(); const now = nowSeconds();
  await db.prepare("INSERT INTO geofence_rules(id,user_id,feed_id,label,entity_label,polygon_json,max_accuracy_m,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id, userId, feedId, label, entity, JSON.stringify(polygon), accuracy, now, now).run();
  return { id, feed_id: feedId, label, entity_label: entity, polygon, max_accuracy_m: accuracy, boundary_rule: "inside", baseline: "The first valid position establishes inside/outside state without claiming a prior crossing. Later observed transitions create enter/exit alerts." };
}
export async function ingestPosition(db, request, feedId) {
  db = await migrationSession(db);
  const authorization = request.headers.get("authorization") || "";
  if (!/^Feed [a-f0-9]{64}$/.test(authorization)) throw new HttpError("A valid authorized feed token is required", 401);
  const tokenHash = await sha256(authorization.slice(5));
  const feed = await db.prepare("SELECT * FROM position_feeds WHERE id=? AND token_hash=? AND enabled=1").bind(feedId, tokenHash).first();
  if (!feed) throw new HttpError("Position feed credentials are invalid or revoked", 401);
  const body = await readJson(request); const eventId = text(body.event_id, "position event ID", 80);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(eventId)) throw new HttpError("Position event ID contains unsupported characters");
  const observedInput = text(body.observed_at, "position observation time", 40); const observed = Date.parse(observedInput); const now = nowSeconds();
  if (!Number.isFinite(observed) || observed < (now - 900) * 1000 || observed > (now + 120) * 1000) throw new HttpError("Position time must be within the previous 15 minutes and no more than 2 minutes in the future");
  const latitude = number(body.latitude, "reported latitude", -90, 90); const longitude = number(body.longitude, "reported longitude", -180, 180);
  const accuracy = number(body.accuracy_m, "reported position accuracy", 0, 5000);
  const payloadHash = await sha256(canonical({ eventId, observed, latitude, longitude, accuracy }));
  const existing = await db.prepare("SELECT payload_hash,result_json FROM position_receipts WHERE feed_id=? AND event_id=?").bind(feedId, eventId).first();
  if (existing) { if (existing.payload_hash !== payloadHash) throw new HttpError("Position event ID was already used for different source data", 409); return { ...JSON.parse(existing.result_json), duplicate: true }; }
  const lease = crypto.randomUUID();
  const acquired = await db.prepare("UPDATE position_feeds SET lease_token=?,lease_until=? WHERE id=? AND enabled=1 AND lease_until<=?").bind(lease, now + 30, feedId, now).run();
  if (!acquired.meta.changes) throw new HttpError("Position feed is processing another event; retry this same event ID shortly", 409);
  try {
    const current = await db.prepare("SELECT * FROM position_feeds WHERE id=? AND lease_token=?").bind(feedId, lease).first();
    if (!current) throw new HttpError("Feed event processing was superseded", 409);
    if (current.last_observed_at !== null && observed <= current.last_observed_at) throw new HttpError("Position observation is older than or equal to the last accepted source time", 409);
    const rules = (await db.prepare("SELECT * FROM geofence_rules WHERE feed_id=? AND user_id=? AND enabled=1 ORDER BY id").bind(feedId, feed.user_id).all()).results;
    const statements = []; const transitions = []; const ruleStates = [];
    const guard = "EXISTS(SELECT 1 FROM position_feeds WHERE id=? AND lease_token=? AND enabled=1)";
    for (const rule of rules) {
      if (accuracy > rule.max_accuracy_m) { ruleStates.push({ rule_id: rule.id, state: "uncertain", reason: "reported accuracy exceeds rule threshold" }); continue; }
      const state = pointInPolygon(longitude, latitude, JSON.parse(rule.polygon_json)) ? "inside" : "outside";
      ruleStates.push({ rule_id: rule.id, state, previous_state: rule.last_state });
      if (rule.last_state && rule.last_state !== state) {
        const kind = state === "inside" ? "geofence_enter" : "geofence_exit";
        const evidence = { source: "authorized_position_feed", feed_id: feedId, rule_id: rule.id, entity_label: rule.entity_label, observed_at: new Date(observed).toISOString(), reported_position: { latitude, longitude, accuracy_m: accuracy }, previous_state: rule.last_state, state, boundary_rule: "inside", note: "This records the source-reported position and observed polygon transition; it does not independently verify a person's identity or physical location." };
        statements.push(db.prepare(`INSERT OR IGNORE INTO monitor_alerts(id,user_id,rule_id,event_key,kind,message,evidence_json,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`).bind(crypto.randomUUID(), feed.user_id, rule.id, `${feedId}:${eventId}:${rule.id}`, kind, `${rule.entity_label} ${state === "inside" ? "entered" : "exited"} ${rule.label}`, JSON.stringify(evidence), now, feedId, lease));
        transitions.push({ rule_id: rule.id, kind });
      }
      statements.push(db.prepare(`UPDATE geofence_rules SET last_state=?,last_observed_at=?,updated_at=? WHERE id=? AND user_id=? AND ${guard}`).bind(state, observed, now, rule.id, feed.user_id, feedId, lease));
    }
    const result = { accepted: true, event_id: eventId, observed_at: new Date(observed).toISOString(), rule_states: ruleStates, transitions, alerts_stored: transitions.length, delivery_state: "stored_in_app; awaiting client receipt acknowledgment" };
    statements.push(db.prepare(`INSERT INTO position_receipts(feed_id,event_id,user_id,observed_at,received_at,payload_hash,result_json) SELECT ?,?,?,?,?,?,? WHERE ${guard}`).bind(feedId, eventId, feed.user_id, observed, now, payloadHash, JSON.stringify(result), feedId, lease));
    statements.push(db.prepare("UPDATE position_feeds SET last_observed_at=?,last_latitude=?,last_longitude=?,last_accuracy=?,last_received_at=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND lease_token=? AND enabled=1").bind(observed, latitude, longitude, accuracy, now, now, feedId, lease));
    const committed = await db.batch(statements);
    if (!committed.at(-1).meta.changes) throw new HttpError("Position feed was revoked or superseded before commit", 409);
    return result;
  } finally { await db.prepare("UPDATE position_feeds SET lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?").bind(feedId, lease).run(); }
}
