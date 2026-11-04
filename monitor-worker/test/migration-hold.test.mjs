// Synthetic SQLite and controlled request fixtures only; no deployed state/provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { sqliteFacade } from '../src/sqlite-facade.js';
import { initializeMigrationControl, configureMigrationHold, migrationState, migrationSession } from '../src/migration-hold.js';
import { handleApi } from '../src/api.js';
import { checkJob } from '../src/engine.js';
import { armNextCheck, runAlarm } from '../src/alarms.js';
import { createFeed, createRule, ingestPosition } from '../src/positions.js';

// Load the exact production class with only Wrangler's SQL-as-text import emulated.
const schemaUrl = new URL('../migrations/0001_monitors.sql', import.meta.url).href;
const hooks = registerHooks({ load(url, context, nextLoad) {
  return url === schemaUrl ? { format: 'module', source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))};`, shortCircuit: true } : nextLoad(url, context);
} });
const { MonitorStore } = await import('../src/worker.js');
hooks.deregister();

const USER = '11111111-1111-4111-8111-111111111111';
const env = { APP_ORIGIN: 'https://app.example.test', SUPABASE_URL: 'https://owned-backend.example.test', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key', MONITOR_ALLOWED_HOSTS: 'app.example.test' };
const hold = db => configureMigrationHold(db, { MONITOR_MIGRATION_HOLD: 'true' });
const resume = db => configureMigrationHold(db, { MONITOR_MIGRATION_HOLD: 'false' });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  let alarm = null;
  const storage = {
    sql: { exec(query, ...values) {
      if (!values.length && query.split(';').filter(x => x.trim()).length > 1) { sqlite.exec(query); return { toArray: () => [], one: () => undefined }; }
      const statement = sqlite.prepare(query);
      const rows = statement.columns().length ? statement.all(...values) : (statement.run(...values), []);
      return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('Expected one row'); return rows[0]; } };
    } },
    transactionSync(operation) { sqlite.exec('BEGIN'); try { const result = operation(); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
    async getAlarm() { return alarm; }, async setAlarm(value) { alarm = value; }, async deleteAlarm() { alarm = null; },
  };
  const db = sqliteFacade(storage);
  await db.exec(await readFile(new URL('../migrations/0001_monitors.sql', import.meta.url), 'utf8'));
  await initializeMigrationControl(db);
  return { db, storage };
}
async function job(db, kind = 'social_account', params = { platform: 'github', username: 'octocat' }) {
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO monitor_jobs(id,user_id,kind,label,params_json,interval_seconds,next_due,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id, USER, kind, 'Synthetic hold fixture', JSON.stringify(params), 300, 0, 0, 0).run();
  return id;
}
async function retained(db) {
  const result = {};
  for (const table of ['monitor_jobs', 'monitor_checks', 'monitor_alerts', 'position_feeds', 'geofence_rules', 'position_receipts', 'scheduler_ticks']) result[table] = (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
  return JSON.parse(JSON.stringify(result));
}
const github = () => Response.json({ id: 1, login: 'octocat', html_url: 'https://github.com/octocat', followers: 1 });
function request(path, method = 'GET', body = undefined) {
  return new Request(`https://worker.example.test${path}`, { method, headers: { Authorization: `Bearer ${'x'.repeat(30)}`, Origin: env.APP_ORIGIN, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test('hold latches across missing config/reinitialization, invalid config fails closed and explicit resume advances the fence', async t => {
  const { db } = await fixture(t); const id = await job(db);
  await checkJob(db, id, env, { now: 1000, fetcher: async () => github() });
  await checkJob(db, id, env, { now: 1300, fetcher: async () => Response.json({ id: 1, login: 'octocat', html_url: 'https://github.com/octocat', followers: 2 }) });
  const feed = await createFeed(db, USER, { label: 'Synthetic feed', authorization_confirmed: true }, env, env.APP_ORIGIN);
  await createRule(db, USER, { feed_id: feed.id, label: 'Synthetic rule', entity_label: 'Synthetic device', polygon: [[0, 0], [2, 0], [2, 2], [0, 2]], authorization_confirmed: true });
  await ingestPosition(db, new Request(`https://worker.example.test/v1/feeds/${feed.id}/positions`, { method: 'POST', headers: { Authorization: `Feed ${feed.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ event_id: 'synthetic-baseline', observed_at: new Date().toISOString(), latitude: 1, longitude: 1, accuracy_m: 5 }) }), feed.id);
  await db.prepare('INSERT INTO scheduler_ticks(scheduled_at,started_at,completed_at,checked,failed) VALUES(1,1,2,1,0)').run();
  const before = await retained(db); const oldSession = await migrationSession(db);
  assert.ok(Object.values(before).every(rows => rows.length > 0));
  assert.deepEqual({ ...await hold(db) }, { held: 1, generation: 1 });
  await initializeMigrationControl(db);
  assert.equal((await configureMigrationHold(db, {})).held, 1);
  assert.equal((await configureMigrationHold(db, { MONITOR_MIGRATION_HOLD: '' })).held, 1);
  assert.equal((await hold(db)).generation, 1);
  assert.deepEqual({ ...await resume(db) }, { held: 0, generation: 2 });
  assert.throws(() => oldSession.assertGuard(), error => error.code === 'migration_generation_changed');
  assert.equal((await configureMigrationHold(db, { MONITOR_MIGRATION_HOLD: 'FALSE' })).held, 1);
  assert.deepEqual(await retained(db), before);
  assert.equal((await db.prepare('SELECT token_hash FROM position_feeds WHERE id=?').bind(feed.id).first()).token_hash.length, 64);
});

test('missing persisted control row never bootstraps an existing namespace back to active', async t => {
  const { db, storage } = await fixture(t); await hold(db);
  await db.prepare('DELETE FROM monitor_runtime_control WHERE id=1').run();
  await assert.rejects(initializeMigrationControl(db), error => error.code === 'migration_state_unavailable');
  await storage.setAlarm(1234);
  assert.equal(await armNextCheck(db, storage), null);
  assert.equal(await storage.getAlarm(), null);
  const response = await handleApi(request('/v1/status'), db, env);
  assert.equal(response.status, 503); assert.equal((await response.json()).code, 'migration_state_unavailable');
});

test('held APIs including position-feed ingestion return truthful503 before auth/network and preserve existing rows', async t => {
  const { db } = await fixture(t); const id = await job(db);
  const feed = await createFeed(db, USER, { label: 'Synthetic feed', authorization_confirmed: true }, env, env.APP_ORIGIN);
  const before = await retained(db); await hold(db);
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No external request permitted'); }; t.after(() => { globalThis.fetch = oldFetch; });
  for (const [path, method] of [['/v1/status', 'GET'], ['/v1/jobs', 'GET'], ['/v1/jobs', 'POST'], [`/v1/jobs/${id}`, 'PATCH'], [`/v1/jobs/${id}`, 'DELETE'], [`/v1/jobs/${id}/check`, 'POST'], ['/v1/feeds', 'POST'], [`/v1/feeds/${feed.id}/positions`, 'POST'], [`/v1/feeds/${feed.id}`, 'DELETE'], ['/v1/rules', 'POST'], [`/v1/rules/${id}`, 'DELETE'], [`/v1/alerts/${id}/ack`, 'POST']]) {
    const response = await handleApi(request(path, method, method === 'GET' ? undefined : {}), db, env);
    const result = await response.json();
    assert.equal(response.status, 503); assert.equal(result.code, 'migration_hold'); assert.equal(result.scheduler.enabled, false); assert.equal(result.retry_safe, false);
    assert.match(result.notice, /already have dispatched a request or committed an earlier write/);
  }
  assert.equal(calls, 0); assert.deepEqual(await retained(db), before);
});

test('held alarm disarms without a provider attempt, new tick, backoff or automatic retry', async t => {
  const { db, storage } = await fixture(t); await job(db); await storage.setAlarm(1234); await hold(db);
  const before = await retained(db); const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No provider request permitted'); }; t.after(() => { globalThis.fetch = oldFetch; });
  const outcome = await runAlarm(db, storage, env);
  assert.equal(outcome.paused, true); assert.equal(outcome.completed, false); assert.equal(await storage.getAlarm(), null);
  assert.equal(calls, 0); assert.deepEqual(await retained(db), before);
});

test('held alarm deletion failure is reported without throwing into platform retry or polling', async t => {
  const { db, storage } = await fixture(t); await job(db); await hold(db);
  const before = await retained(db); const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No source call permitted'); }; t.after(() => { globalThis.fetch = oldFetch; });
  storage.deleteAlarm = async () => { throw new Error('Controlled storage failure'); };
  const outcome = await runAlarm(db, storage, env);
  assert.equal(outcome.paused, true); assert.equal(outcome.alarm_disarm_verified, false); assert.equal(outcome.next_alarm_state, 'unverified');
  assert.equal(calls, 0); assert.deepEqual(await retained(db), before);
});

for (const release of [false, true]) test(`in-flight source completion is fenced after hold${release ? ' and explicit resume' : ''}`, async t => {
  const { db } = await fixture(t); const id = await job(db); const started = deferred(); const reply = deferred();
  const pending = checkJob(db, id, env, { now: 1000, fetcher: async () => { started.resolve(); return reply.promise; } });
  const rejected = assert.rejects(pending, error => error.code === (release ? 'migration_generation_changed' : 'migration_hold'));
  await started.promise; const atPause = await retained(db); await hold(db); if (release) await resume(db);
  reply.resolve(github()); await rejected;
  assert.deepEqual(await retained(db), atPause); // Claim predates hold; no later history, success, failure or lease write.
});

test('in-flight failure during alarm remains incomplete and cannot record failure/backoff or rearm after hold', async t => {
  const { db, storage } = await fixture(t); await job(db); const started = deferred(); const reply = deferred();
  const oldFetch = globalThis.fetch; globalThis.fetch = async () => { started.resolve(); return reply.promise; }; t.after(() => { globalThis.fetch = oldFetch; });
  const pending = runAlarm(db, storage, env); await started.promise; const atPause = await retained(db); await hold(db);
  reply.reject(new Error('Controlled provider failure after hold')); const result = await pending;
  assert.equal(result.paused, true); assert.equal(result.completed, false); assert.equal(await storage.getAlarm(), null);
  assert.deepEqual(await retained(db), atPause); assert.equal(atPause.scheduler_ticks[0].completed_at, null);
});

test('hold during a response body blocks subsequent contributing-source requests and writes', async t => {
  const { db } = await fixture(t); const id = await job(db, 'cve', { keyword: 'fixture' });
  const bodyReady = deferred(); let controller; let calls = 0;
  const pending = checkJob(db, id, env, { now: 1000, fetcher: async () => {
    calls++;
    return new Response(new ReadableStream({ start(value) { controller = value; }, pull() { bodyReady.resolve(); } }));
  } });
  const rejected = assert.rejects(pending, error => error.code === 'migration_hold');
  await bodyReady.promise; const atPause = await retained(db); await hold(db);
  controller.enqueue(new TextEncoder().encode(JSON.stringify({ totalResults: 1, vulnerabilities: [{ cve: { id: 'CVE-2026-12345' } }] }))); controller.close();
  await rejected; assert.equal(calls, 1); assert.deepEqual(await retained(db), atPause);
});

test('feed ingestion paused during body read cannot update the position, receipt, alerts or token hash', async t => {
  const { db } = await fixture(t);
  const feed = await createFeed(db, USER, { label: 'Synthetic feed', authorization_confirmed: true }, env, env.APP_ORIGIN);
  const bodyStarted = deferred(); const body = deferred();
  const req = { method: 'POST', url: `https://worker.example.test/v1/feeds/${feed.id}/positions`, headers: new Headers({ Authorization: `Feed ${feed.token}`, 'Content-Type': 'application/json' }), body: { getReader: () => { bodyStarted.resolve(); let delivered = false; return { async read() { if (delivered) return { done: true }; delivered = true; return { done: false, value: new TextEncoder().encode(await body.promise) }; }, async cancel() {}, releaseLock() {} }; } } };
  const pending = handleApi(req, db, env); await bodyStarted.promise; const before = await retained(db); await hold(db);
  body.resolve(JSON.stringify({ event_id: 'synthetic-one', observed_at: new Date().toISOString(), latitude: 1, longitude: 1, accuracy_m: 10 }));
  const response = await pending; assert.equal(response.status, 503); assert.deepEqual(await retained(db), before);
});

test('hold while checking an existing alarm prevents a stale arm from setting a later alarm', async t => {
  const { db, storage } = await fixture(t); await job(db); const started = deferred(); const gate = deferred(); let sets = 0;
  storage.getAlarm = async () => { started.resolve(); await gate.promise; return null; };
  storage.setAlarm = async () => { sets++; };
  const pending = armNextCheck(db, storage, 1000000); await started.promise; await hold(db); gate.resolve();
  assert.equal(await pending, null); assert.equal(sets, 0);
});

test('hold during an already-dispatched alarm write deletes that alarm after the write settles', async t => {
  const { db, storage } = await fixture(t); await job(db); const started = deferred(); const gate = deferred(); let alarm = null;
  storage.getAlarm = async () => alarm;
  storage.setAlarm = async value => { started.resolve(); await gate.promise; alarm = value; };
  storage.deleteAlarm = async () => { alarm = null; };
  const pending = armNextCheck(db, storage, 1000000); await started.promise; await hold(db); await storage.deleteAlarm(); gate.resolve();
  assert.equal(await pending, null); assert.equal(alarm, null);
});

test('guarded batch rollback is atomic and stale sessions cannot write after release', async t => {
  const { db } = await fixture(t); const id = await job(db); const session = await migrationSession(db);
  await assert.rejects(session.batch([session.prepare('UPDATE monitor_jobs SET label=? WHERE id=?').bind('Must roll back', id), session.prepare('INSERT INTO no_such_table VALUES(1)')]));
  assert.equal((await db.prepare('SELECT label FROM monitor_jobs WHERE id=?').bind(id).first()).label, 'Synthetic hold fixture');
  await hold(db); await resume(db);
  await assert.rejects(session.prepare('UPDATE monitor_jobs SET enabled=0').run(), error => error.code === 'migration_generation_changed');
  const fresh = await migrationSession(db); await fresh.prepare('UPDATE monitor_jobs SET label=? WHERE id=?').bind('Explicitly resumed', id).run();
  assert.equal((await db.prepare('SELECT enabled FROM monitor_jobs WHERE id=?').bind(id).first()).enabled, 1);
});

for (const alarmDeletionFails of [false, true]) test(`actual Worker class resolves corrupt-state startup to503 with alarm disarm ${alarmDeletionFails ? 'unverified' : 'verified'}`, async t => {
  const { db, storage } = await fixture(t); await job(db); await hold(db);
  await db.prepare('DELETE FROM monitor_runtime_control WHERE id=1').run();
  await storage.setAlarm(1234);
  if (alarmDeletionFails) storage.deleteAlarm = async () => { throw new Error('Controlled storage failure'); };
  let initializing;
  const ctx = { storage, blockConcurrencyWhile(operation) { initializing = operation(); return initializing; } };
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No outbound startup request permitted'); }; t.after(() => { globalThis.fetch = oldFetch; });
  const worker = new MonitorStore(ctx, env); await initializing;
  const response = await worker.fetch(request('/v1/status'));
  assert.equal(response.status, 503); assert.equal(response.headers.get('X-Monitor-Alarm-Disarm-Verified'), String(!alarmDeletionFails));
  assert.equal((await response.json()).scheduler.enabled, null);
  assert.deepEqual(await worker.alarm(), { interrupted: true, completed: false, code: 'migration_state_unavailable', alarm_disarm_verified: !alarmDeletionFails });
  assert.equal(calls, 0);
  if (!alarmDeletionFails) assert.equal(await storage.getAlarm(), null);
});

test('actual Worker construction applies hold without changing retained state and normal fetch/alarm stay paused', async t => {
  const { db, storage } = await fixture(t); await job(db); const before = await retained(db); await storage.setAlarm(1234);
  let initializing;
  const worker = new MonitorStore({ storage, blockConcurrencyWhile(operation) { initializing = operation(); return initializing; } }, { ...env, MONITOR_MIGRATION_HOLD: 'true' });
  await initializing;
  assert.equal((await worker.fetch(request('/v1/status'))).status, 503);
  assert.equal((await worker.alarm()).paused, true); assert.equal(await storage.getAlarm(), null);
  assert.deepEqual(await retained(db), before);
});

test('an API interrupted by hold then resume reports only stale operation state, not a globally paused scheduler', async t => {
  const { db } = await fixture(t); const started = deferred(); const reply = deferred();
  const oldFetch = globalThis.fetch; globalThis.fetch = async () => { started.resolve(); return reply.promise; }; t.after(() => { globalThis.fetch = oldFetch; });
  const pending = handleApi(request('/v1/jobs'), db, env); await started.promise; await hold(db); await resume(db);
  reply.resolve(Response.json({ id: USER })); const response = await pending; const result = await response.json();
  assert.equal(response.status, 503); assert.equal(result.code, 'migration_generation_changed');
  assert.equal(result.scheduler.enabled, null); assert.equal(result.scheduler.state, 'migration_state_changed_or_unverified');
  assert.equal((await migrationState(db)).held, 0);
});
