import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// This is a real embedded PostgreSQL engine with a single connection. It tests
// migration semantics and role ACLs, not cross-connection lock contention.
const migrationRoot = new URL('../supabase/migrations/', import.meta.url);
const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const ddl = name => readFile(new URL(name, migrationRoot), 'utf8');
function prefixUntil(sql, marker) {
  const index = sql.indexOf(marker);
  assert.ok(index > 0, `Expected dependency-DDL boundary was not found: ${marker}`);
  return sql.slice(0, index);
}

before(async () => {
  await db.waitReady;
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  // Use the owning project's helper and table definitions, rather than a
  // hand-reimplemented model of the new functions.
  const base = await ddl('20260308235733_8c32bbec-c442-41be-882c-5cfa31c1731f.sql');
  const roles = await ddl('20260310093740_a8a7afe3-98bc-455d-a3ae-1e44061b4fff.sql');
  await db.exec(prefixUntil(base, '-- Profiles'));
  await db.exec(prefixUntil(roles, '-- Only admins can read all roles'));
  for (const name of [
    '20260310100911_9560f2f7-cd5a-49de-b32f-b082903fe8aa.sql',
    '20260310101849_7728c3ba-b18e-458e-8ab2-16f85d97c935.sql',
    '20260508231625_59130861-ce5b-4ef2-abee-79f05cd74774.sql',
    '20261031234500_intelligence_execution_gate.sql',
  ]) await db.exec(await ddl(name));
  await db.query('insert into auth.users(id) values($1),($2)', [alice, bob]);
}, { timeout: 30000 });

beforeEach(async () => {
  await db.exec('reset role; truncate public.intelligence_executions, public.usage_metrics, public.subscriptions, public.tool_permissions;');
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
});
after(async () => { await db.close(); });

async function asUser(id, operation, role = 'authenticated') {
  assert.ok(['authenticated', 'anon'].includes(role));
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id || '']);
  await db.exec(`set role ${role}`);
  try { return await operation(); }
  finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', '', false)"); }
}
async function reserve(id = alice, action = 'ipinfo') {
  return asUser(id, async () => (await db.query('select public.reserve_intelligence_execution($1) as result', [action])).rows[0].result);
}
async function finish(id, executionId, success) {
  return asUser(id, async () => (await db.query('select public.finish_intelligence_execution($1, $2) as result', [executionId, success])).rows[0].result);
}
async function successful(id = alice, action = 'ipinfo') {
  const result = await reserve(id, action);
  assert.equal(result.allowed, true);
  assert.deepEqual(await finish(id, result.id, true), { ok: true });
  return result.id;
}
async function usage(id = alice) {
  return Number((await db.query('select coalesce(sum(executions),0) as count from public.usage_metrics where user_id=$1', [id])).rows[0].count);
}
async function subscription({ plan = 'professional', status = 'active', days = 1, customer = 'test_customer' } = {}) {
  await db.query(`insert into public.subscriptions(user_id,stripe_customer_id,plan,status,current_period_end)
    values($1,$2,$3,$4,now()+$5::integer*interval '1 day')`, [alice, customer, plan, status, days]);
}

test('the exact migration runs on PostgreSQL and executes the real advisory-lock function', async () => {
  const version = (await db.query('select version() as version')).rows[0].version;
  assert.match(version, /PostgreSQL/);
  assert.match(version, /PGlite/);
  await db.query("select pg_advisory_xact_lock(hashtextextended('sql-regression', 91734))");
  assert.equal((await reserve()).allowed, true);
});

test('anonymous execution ACLs and a missing authenticated claim both deny admission', async () => {
  await assert.rejects(asUser(null, () => db.query("select public.reserve_intelligence_execution('ipinfo')"), 'anon'), error => error.code === '42501');
  assert.deepEqual(await reserve(null), { allowed: false, code: 'UNAUTHORIZED' });
  assert.equal((await db.query('select count(*)::int as count from public.intelligence_executions')).rows[0].count, 0);
});

test('a free account can complete five requests and the sixth is denied without double counting', async () => {
  for (let index = 0; index < 5; index++) await successful();
  const denied = await reserve();
  assert.equal(denied.allowed, false);
  assert.equal(denied.code, 'DAILY_LIMIT');
  assert.ok(denied.retryAfter >= 1 && denied.retryAfter <= 86400);
  assert.equal(await usage(), 5);
  assert.equal((await db.query("select count(*)::int as count from public.intelligence_executions where state='succeeded'")).rows[0].count, 5);
});

test('pending reservations count toward admission, failed requests release them, and old pending entries expire', async () => {
  const pending = [];
  for (let index = 0; index < 5; index++) pending.push((await reserve()).id);
  assert.equal((await reserve()).code, 'DAILY_LIMIT');
  assert.deepEqual(await finish(alice, pending[0], false), { ok: true });
  const replacement = await reserve();
  assert.equal(replacement.allowed, true);
  assert.equal(await usage(), 0);
  assert.equal((await reserve()).code, 'DAILY_LIMIT');
  await db.query("update public.intelligence_executions set started_at=now()-interval '3 minutes' where id=$1", [pending[1]]);
  assert.equal((await reserve()).allowed, true);
});

test('the daily limit includes existing tools while ignoring previous UTC days', async () => {
  await db.query(`insert into public.usage_metrics(user_id,tool_name,executions,period_start,period_end)
    values($1,'existing-tool',2,date_trunc('day',now() at time zone 'UTC') at time zone 'UTC',
      (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')+interval '1 day'),
    ($1,'existing-tool',100,(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')-interval '1 day',
      date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')`, [alice]);
  for (let index = 0; index < 3; index++) await successful();
  assert.equal((await reserve()).code, 'DAILY_LIMIT');
});

test('an active recognized paid subscription admits requests beyond the free limit', async () => {
  await subscription();
  for (let index = 0; index < 7; index++) await successful();
  assert.equal((await reserve()).allowed, true);
  assert.equal(await usage(), 7);
});

test('an expired paid subscription is limited as free', async () => {
  await subscription({ days: -1 });
  for (let index = 0; index < 5; index++) await successful();
  assert.equal((await reserve()).code, 'DAILY_LIMIT');
});

test('a specific tool denial and the lab-wide denial take precedence over paid access', async () => {
  await subscription();
  await db.query("insert into public.tool_permissions(user_id,tool_id,allowed) values($1,'intelligence-breach',false)", [alice]);
  assert.deepEqual(await reserve(alice, 'breach'), { allowed: false, code: 'FORBIDDEN' });
  assert.equal((await reserve(alice, 'profile')).allowed, true);
  await db.query("insert into public.tool_permissions(user_id,tool_id,allowed) values($1,'intelligence-lab',false)", [alice]);
  assert.deepEqual(await reserve(alice, 'profile'), { allowed: false, code: 'FORBIDDEN' });
});

test('successful settlement is idempotent and cannot be reversed into a free retry', async () => {
  const id = await successful();
  assert.deepEqual(await finish(alice, id, true), { ok: true });
  assert.deepEqual(await finish(alice, id, false), { ok: true });
  assert.equal(await usage(), 1);
  assert.equal((await db.query('select state from public.intelligence_executions where id=$1', [id])).rows[0].state, 'succeeded');
});

test('another authenticated user cannot settle a reservation or read the private journal', async () => {
  const { id } = await reserve();
  assert.deepEqual(await finish(bob, id, true), { ok: false });
  assert.equal(await usage(bob), 0);
  assert.equal((await db.query('select state from public.intelligence_executions where id=$1', [id])).rows[0].state, 'pending');
  await assert.rejects(asUser(bob, () => db.query('select * from public.intelligence_executions')), error => error.code === '42501');
  assert.deepEqual(await finish(alice, id, true), { ok: true });
  assert.equal(await usage(alice), 1);
});

test('an expired reservation cannot be settled as a successful billable operation', async () => {
  const { id } = await reserve();
  await db.query("update public.intelligence_executions set started_at=now()-interval '3 minutes' where id=$1", [id]);
  assert.deepEqual(await finish(alice, id, true), { ok: false });
  assert.equal(await usage(), 0);
  assert.equal((await db.query('select state from public.intelligence_executions where id=$1', [id])).rows[0].state, 'failed');
});
