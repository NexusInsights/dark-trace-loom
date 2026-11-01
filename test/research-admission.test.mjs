import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Executes the exact owning base migrations and the exact additive research migration.
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
    '20261101120000_research_execution_actions.sql',
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

test('all eight exact actions use the same journal and the intended usage names', async () => {
  await subscription();
  const names = ['ipinfo','breach','profile','onion','research-privacy','research-password','research-email','research-gleif'];
  for (const action of names) await successful(alice, action);
  const rows = (await db.query('select tool_name,executions from public.usage_metrics order by tool_name')).rows;
  assert.deepEqual(rows.map(row => row.tool_name), names.map(action => action.startsWith('research-') ? action : `intelligence-${action}`).sort());
  assert.ok(rows.every(row => row.executions === 1)); assert.equal(await usage(), 8);
  assert.equal((await db.query('select count(*)::int as count from public.intelligence_executions')).rows[0].count, 8);
  assert.deepEqual(await reserve(alice,'research-other'), {allowed:false,code:'INVALID_INPUT'});
  assert.deepEqual(await reserve(alice,null), {allowed:false,code:'INVALID_INPUT'});
});

test('old and research actions share one five-per-day limit without double-counting successful metrics', async () => {
  await successful(alice,'ipinfo'); await successful(alice,'research-privacy');
  await successful(alice,'research-password'); await successful(alice,'research-email');
  await successful(alice,'research-gleif');
  assert.equal((await reserve(alice,'breach')).code,'DAILY_LIMIT');
  assert.equal((await reserve(alice,'research-privacy')).code,'DAILY_LIMIT');
  assert.equal(await usage(),5);
});

test('research denials use exact tool/workbench IDs and preserve independent intelligence denials', async () => {
  await subscription();
  await db.query("insert into public.tool_permissions(user_id,tool_id,allowed) values($1,'research-email',false)",[alice]);
  assert.equal((await reserve(alice,'research-email')).code,'FORBIDDEN');
  assert.equal((await reserve(alice,'research-password')).allowed,true);
  await db.query("insert into public.tool_permissions(user_id,tool_id,allowed) values($1,'research-workbench',false)",[alice]);
  assert.equal((await reserve(alice,'research-gleif')).code,'FORBIDDEN');
  assert.equal((await reserve(alice,'ipinfo')).allowed,true);
  await db.query("insert into public.tool_permissions(user_id,tool_id,allowed) values($1,'intelligence-lab',false)",[alice]);
  assert.equal((await reserve(alice,'profile')).code,'FORBIDDEN');
});

test('research pending reservations, failure release, expiry, cross-user settlement and idempotence retain prior semantics', async () => {
  const pending=[];
  for(let index=0;index<5;index++)pending.push((await reserve(alice,'research-password')).id);
  assert.equal((await reserve(alice,'ipinfo')).code,'DAILY_LIMIT');
  assert.deepEqual(await finish(bob,pending[0],true),{ok:false});
  await finish(alice,pending[0],false);
  const next=await reserve(alice,'research-privacy');assert.equal(next.allowed,true);
  await finish(alice,next.id,true);await finish(alice,next.id,true);await finish(alice,next.id,false);
  assert.equal(await usage(),1);
  await db.query("update public.intelligence_executions set started_at=now()-interval '3 minutes' where id=$1",[pending[1]]);
  assert.deepEqual(await finish(alice,pending[1],true),{ok:false});
  assert.equal((await reserve(alice,'research-email')).allowed,true);
});

test('idempotent reapplication preserves customer journal/usage rows and private table ACLs', async () => {
  const id=await successful(alice,'research-gleif');
  await db.exec(await ddl('20261101120000_research_execution_actions.sql'));
  assert.equal(await usage(),1);
  assert.equal((await db.query('select state from public.intelligence_executions where id=$1',[id])).rows[0].state,'succeeded');
  await assert.rejects(asUser(alice,()=>db.query('select * from public.intelligence_executions')),error=>error.code==='42501');
  await assert.rejects(asUser(null,()=>db.query("select public.reserve_intelligence_execution('research-privacy')"),'anon'),error=>error.code==='42501');
});

test('migration aborts on unexpected function-body drift and does not replace the drifted function', async () => {
  const backup=(await db.query("select pg_get_functiondef('public.reserve_intelligence_execution(text)'::regprocedure) as definition")).rows[0].definition;
  try {
    await db.exec("create or replace function public.reserve_intelligence_execution(p_action text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$begin return jsonb_build_object('allowed',false,'code','DRIFT');end;$$;");
    await assert.rejects(db.exec(await ddl('20261101120000_research_execution_actions.sql')),/drifted/);
    await db.exec('rollback');
    assert.equal((await reserve(alice,'ipinfo')).code,'DRIFT');
  } finally { await db.exec('rollback'); await db.exec(backup); }
});

test('migration aborts on unexpected action constraint, defaults and ACL drift', async () => {
  const migration=await ddl('20261101120000_research_execution_actions.sql');
  for(const [change,restore] of [
    ["alter table public.intelligence_executions alter column state set default 'succeeded'", "alter table public.intelligence_executions alter column state set default 'pending'"],
    ['grant select on public.intelligence_executions to authenticated','revoke select on public.intelligence_executions from authenticated'],
    ["alter table public.intelligence_executions add constraint unexpected_research_constraint check(action<>'unexpected')",'alter table public.intelligence_executions drop constraint unexpected_research_constraint'],
  ]){
    try { await db.exec(change); await assert.rejects(db.exec(migration),/drifted/); await db.exec('rollback'); }
    finally { await db.exec('rollback');await db.exec(restore); }
  }
});

test('migration rejects journal/RPC owner, FORCE RLS and policy drift before changing definitions', async () => {
  const migration=await ddl('20261101120000_research_execution_actions.sql');
  const original=(await db.query("select md5(prosrc) as hash from pg_proc where oid='public.reserve_intelligence_execution(text)'::regprocedure")).rows[0].hash;
  for(const [change,restore] of [
    ['alter table public.intelligence_executions owner to service_role','alter table public.intelligence_executions owner to postgres'],
    ['alter function public.reserve_intelligence_execution(text) owner to service_role','alter function public.reserve_intelligence_execution(text) owner to postgres'],
    ['alter function public.finish_intelligence_execution(uuid,boolean) owner to service_role','alter function public.finish_intelligence_execution(uuid,boolean) owner to postgres'],
    ['alter table public.intelligence_executions force row level security','alter table public.intelligence_executions no force row level security'],
    ['create policy unexpected_research_policy on public.intelligence_executions for select to authenticated using(true)','drop policy unexpected_research_policy on public.intelligence_executions'],
  ]){
    try { await db.exec(change);await assert.rejects(db.exec(migration),/drifted/);await db.exec('rollback');assert.equal((await db.query("select md5(prosrc) as hash from pg_proc where oid='public.reserve_intelligence_execution(text)'::regprocedure")).rows[0].hash,original); }
    finally { await db.exec('rollback');await db.exec(restore); }
  }
  await db.exec(migration);
});

test('all seven journal privilege classes remain denied for both public client roles', async () => {
  const migration=await ddl('20261101120000_research_execution_actions.sql');
  for(const role of ['anon','authenticated'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']){
    assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed',[role,'public.intelligence_executions',privilege])).rows[0].allowed,false);
    try { await db.exec(`grant ${privilege} on public.intelligence_executions to ${role}`);await assert.rejects(db.exec(migration),/ACLs drifted/);await db.exec('rollback'); }
    finally { await db.exec('rollback');await db.exec(`revoke ${privilege} on public.intelligence_executions from ${role}`); }
  }
  await db.exec(migration);
});

test('migration timeout limits are transaction-local and exact reapplication remains safe', async () => {
  const before=(await db.query("select current_setting('lock_timeout') as lock,current_setting('statement_timeout') as statement")).rows[0];
  const migration=await ddl('20261101120000_research_execution_actions.sql');
  assert.match(migration,/begin;\s*set local lock_timeout = '5s';\s*set local statement_timeout = '30s';/i);
  await db.exec(migration);await db.exec(migration);
  assert.deepEqual((await db.query("select current_setting('lock_timeout') as lock,current_setting('statement_timeout') as statement")).rows[0],before);
});
