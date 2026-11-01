import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Execute the exact new policy SQL in embedded PostgreSQL with synthetic rows.
// Minimal dependency tables isolate policies; this does not prove live schema,
// deployed migration state, service-role access or cross-connection concurrency.
test('restrictive execution ownership policies prevent permissive-OR bypasses', async () => {
  const db=new PGlite(); await db.waitReady;
  const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
  const own='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',foreign='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const sql=await readFile(new URL('../supabase/migrations/20261101220000_tool_execution_ownership_guards.sql',import.meta.url),'utf8');
  try {
    await db.exec(`create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table cases(id uuid primary key,owner_id uuid,collaborator_id uuid);
      create function public.is_case_owner(actor uuid,cid uuid) returns boolean language sql stable security definer as $$select exists(select 1 from cases where id=cid and owner_id=actor)$$;
      create function public.is_case_collaborator(actor uuid,cid uuid) returns boolean language sql stable security definer as $$select exists(select 1 from cases where id=cid and collaborator_id=actor)$$;
      create table tool_results(id text primary key,user_id uuid,case_id uuid);
      create table pipelines(id uuid primary key,user_id uuid,target_case_id uuid);
      create table pipeline_runs(id text primary key,user_id uuid,pipeline_id uuid);
      create table agent_runs(id text primary key,user_id uuid,case_id uuid);
      insert into cases values('${own}','${alice}',null),('${foreign}','${bob}','${alice}');
      insert into pipelines values('${own}','${alice}','${own}'),('${foreign}','${bob}','${foreign}');
      insert into tool_results values('collaborator-readable','${bob}','${foreign}'),('legacy-null-actor',null,'${own}');
      grant usage on schema public,auth to authenticated;
      grant select,insert,update,delete on tool_results,pipelines,pipeline_runs,agent_runs to authenticated;
      alter table tool_results enable row level security; alter table pipelines enable row level security;
      alter table pipeline_runs enable row level security; alter table agent_runs enable row level security;
      create policy legacy_tool_actor on tool_results for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
      create policy legacy_tool_owner on tool_results for all to authenticated using(is_case_owner(auth.uid(),case_id)) with check(is_case_owner(auth.uid(),case_id));
      create policy legacy_tool_collaborator on tool_results for select to authenticated using(is_case_collaborator(auth.uid(),case_id));
      create policy legacy_pipeline on pipelines for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
      create policy legacy_pipeline_run on pipeline_runs for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
      create policy legacy_agent_run on agent_runs for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
      set role authenticated; select set_config('request.jwt.claim.sub','${alice}',false);`);
    // Reproduce the known source-policy gap before the corrective migration.
    await db.exec(`insert into tool_results values('baseline-foreign','${alice}','${foreign}'); reset role;`);
    await db.exec(sql);
    // An unrelated permissive policy must not defeat the restrictive guard.
    await db.exec(`create policy extra_permissive on tool_results for all to authenticated using(true) with check(true);
      set role authenticated;`);
    for(const statement of [
      `insert into tool_results values('foreign','${alice}','${foreign}')`,
      `insert into tool_results values('forged','${bob}','${own}')`,
      `insert into tool_results values('null-actor',null,'${own}')`,
      `insert into pipelines values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','${alice}','${foreign}')`,
      `insert into pipeline_runs values('foreign-pipeline','${alice}','${foreign}')`,
      `insert into agent_runs values('foreign-case','${alice}','${foreign}')`,
    ]) await assert.rejects(db.exec(statement),/row-level security/);
    await db.exec(`insert into tool_results values('own','${alice}','${own}'),('standalone','${alice}',null);
      insert into pipeline_runs values('own-run','${alice}','${own}'); insert into agent_runs values('own-agent','${alice}','${own}');
      update tool_results set user_id='${alice}' where id='legacy-null-actor';`);
    assert.equal((await db.query(`select id from tool_results where id='collaborator-readable'`)).rows.length,1);
    await assert.rejects(db.exec(`update tool_results set case_id='${foreign}' where id='own'`),/row-level security/);
    assert.equal((await db.query(`delete from tool_results where id='collaborator-readable' returning id`)).rows.length,0);
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${bob}',false); set role authenticated;`);
    assert.equal((await db.query(`select id from tool_results where id='standalone'`)).rows.length,0);
    assert.equal((await db.query(`update pipeline_runs set id='stolen' where id='own-run' returning id`)).rows.length,0);
    assert.equal((await db.query(`update agent_runs set id='stolen' where id='own-agent' returning id`)).rows.length,0);
    await db.exec('reset role');
    const before=(await db.query('select count(*) as count from tool_results')).rows[0].count;
    await db.exec(await readFile(new URL('../docs/repairs/rollback-tool-execution-ownership.sql',import.meta.url),'utf8'));
    assert.equal((await db.query('select count(*) as count from tool_results')).rows[0].count,before);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${alice}',false);
      insert into tool_results values('rollback-restores-baseline','${alice}','${foreign}');`);
  } finally { await db.close(); }
});
