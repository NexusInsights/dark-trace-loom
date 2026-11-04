-- Additive extension of the existing protected journal; no customer rows are rewritten.
-- Known base: 20261031234500_intelligence_execution_gate.sql (retained rollback definitions).
-- Normalized-LF base file SHA-256: 7d41c30202bb3b7536aff2699d544b98df070e21fc9ed5d48fef0384db0161fa
-- Exact known function-body MD5s below detect source drift; they are not data integrity claims.
-- Reapplication accepts only the exact completed new state. Unexpected or partial drift aborts.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
declare
  v_reserve text; v_finish text; v_action text; v_columns text[]; v_base boolean; v_new boolean;
begin
  if to_regclass('public.intelligence_executions') is null
    or to_regprocedure('public.reserve_intelligence_execution(text)') is null
    or to_regprocedure('public.finish_intelligence_execution(uuid,boolean)') is null then
    raise exception 'Research admission requires the known intelligence admission migration first' using errcode='55000';
  end if;
  select array_agg(attname::text || ':' || format_type(atttypid,atttypmod) || ':' || attnotnull::text order by attnum)
    into v_columns from pg_attribute where attrelid='public.intelligence_executions'::regclass and attnum>0 and not attisdropped;
  if v_columns is distinct from array['id:uuid:true','user_id:uuid:true','action:text:true','state:text:true','started_at:timestamp with time zone:true','completed_at:timestamp with time zone:false']::text[]
    or not (select relrowsecurity from pg_class where oid='public.intelligence_executions'::regclass)
    or (select relforcerowsecurity from pg_class where oid='public.intelligence_executions'::regclass)
    or (select pg_get_userbyid(relowner) from pg_class where oid='public.intelligence_executions'::regclass) is distinct from 'postgres'
    or exists(select 1 from pg_policy where polrelid='public.intelligence_executions'::regclass) then
    raise exception 'Research admission journal schema or RLS drifted; review before changing it' using errcode='55000';
  end if;
  if (select count(*) from pg_attrdef where adrelid='public.intelligence_executions'::regclass) <> 3
    or not exists(select 1 from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.intelligence_executions'::regclass and a.attname='id' and pg_get_expr(d.adbin,d.adrelid)='gen_random_uuid()')
    or not exists(select 1 from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.intelligence_executions'::regclass and a.attname='state' and pg_get_expr(d.adbin,d.adrelid)='''pending''::text')
    or not exists(select 1 from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.intelligence_executions'::regclass and a.attname='started_at' and pg_get_expr(d.adbin,d.adrelid)='now()')
    or (select count(*) from pg_constraint where conrelid='public.intelligence_executions'::regclass and contype in ('c','f','p','u','x')) <> 4 then
    raise exception 'Research admission journal defaults or constraints drifted' using errcode='55000';
  end if;
  if exists(select 1 from pg_proc where oid in ('public.reserve_intelligence_execution(text)'::regprocedure,'public.finish_intelligence_execution(uuid,boolean)'::regprocedure)
    and (pg_get_userbyid(proowner)<>'postgres' or not prosecdef or prorettype<>'jsonb'::regtype or proconfig is distinct from array['search_path=public, pg_temp']::text[]
      or prolang<>(select oid from pg_language where lanname='plpgsql'))) then
    raise exception 'Research admission function security configuration drifted' using errcode='55000';
  end if;
  if has_table_privilege('anon','public.intelligence_executions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_table_privilege('authenticated','public.intelligence_executions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_function_privilege('anon','public.reserve_intelligence_execution(text)','EXECUTE')
    or has_function_privilege('anon','public.finish_intelligence_execution(uuid,boolean)','EXECUTE')
    or not has_function_privilege('authenticated','public.reserve_intelligence_execution(text)','EXECUTE')
    or not has_function_privilege('authenticated','public.finish_intelligence_execution(uuid,boolean)','EXECUTE') then
    raise exception 'Research admission ACLs drifted; permissions were not broadened' using errcode='55000';
  end if;
  select md5(replace(prosrc,chr(13),'')) into v_reserve from pg_proc where oid='public.reserve_intelligence_execution(text)'::regprocedure;
  select md5(replace(prosrc,chr(13),'')) into v_finish from pg_proc where oid='public.finish_intelligence_execution(uuid,boolean)'::regprocedure;
  select pg_get_constraintdef(oid) into v_action from pg_constraint where conrelid='public.intelligence_executions'::regclass and conname='intelligence_executions_action_check' and contype='c';
  v_base := v_reserve='dd3b2bc08e0db98c7c387a9742950b86' and v_finish='63b0b79e49e0dfc0ecd33e75d3fe5fa0' and v_action='CHECK ((action = ANY (ARRAY[''ipinfo''::text, ''breach''::text, ''profile''::text, ''onion''::text])))';
  v_new := v_reserve='bad7133f8547a2af77037e2c4a3dec47' and v_finish='b6c9631d88bd2cbde312d6428bbf578f' and v_action='CHECK ((action = ANY (ARRAY[''ipinfo''::text, ''breach''::text, ''profile''::text, ''onion''::text, ''research-privacy''::text, ''research-password''::text, ''research-email''::text, ''research-gleif''::text])))';
  if not coalesce(v_base or v_new,false) then
    raise exception 'Research admission base bodies/action constraint drifted or are partially applied; no change made' using errcode='55000';
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.intelligence_executions'::regclass and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (id)')
    or not exists(select 1 from pg_constraint where conrelid='public.intelligence_executions'::regclass and contype='f' and pg_get_constraintdef(oid)='FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE')
    or not exists(select 1 from pg_constraint where conrelid='public.intelligence_executions'::regclass and conname='intelligence_executions_state_check' and pg_get_constraintdef(oid)='CHECK ((state = ANY (ARRAY[''pending''::text, ''succeeded''::text, ''failed''::text])))') then
    raise exception 'Research admission journal constraints drifted' using errcode='55000';
  end if;
  if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid='public.intelligence_executions'::regclass and c.relname='intelligence_executions_daily' and i.indisvalid and not i.indisunique and i.indkey::text='2 5') then
    raise exception 'Research admission journal daily index drifted' using errcode='55000';
  end if;
end;
$guard$;

alter table public.intelligence_executions drop constraint intelligence_executions_action_check;
alter table public.intelligence_executions add constraint intelligence_executions_action_check check(action in ('ipinfo', 'breach', 'profile', 'onion', 'research-privacy', 'research-password', 'research-email', 'research-gleif'));

create or replace function public.reserve_intelligence_execution(p_action text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_day timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_plan text := 'free';
  v_total bigint;
  v_tool text;
  v_lab text;
begin
  if v_user is null then return jsonb_build_object('allowed', false, 'code', 'UNAUTHORIZED'); end if;
  if p_action is null or p_action not in ('ipinfo', 'breach', 'profile', 'onion', 'research-privacy', 'research-password', 'research-email', 'research-gleif') then
    return jsonb_build_object('allowed', false, 'code', 'INVALID_INPUT');
  end if;
  v_tool := case when p_action like 'research-%' then p_action else 'intelligence-' || p_action end;
  v_lab := case when p_action like 'research-%' then 'research-workbench' else 'intelligence-lab' end;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 91734));
  if exists (
    select 1 from public.tool_permissions
    where user_id = v_user and tool_id in (v_lab, v_tool) and allowed = false
  ) then return jsonb_build_object('allowed', false, 'code', 'FORBIDDEN'); end if;

  select s.plan into v_plan from public.subscriptions s
  where s.user_id = v_user
    and (s.stripe_customer_id = 'admin_override_enterprise'
      or (s.status = 'active' and s.current_period_end > now()))
  limit 1;
  if coalesce(v_plan, 'free') not in ('professional', 'team', 'enterprise') then
    -- Count all eight admitted actions from the existing protected journal.
    select coalesce(sum(executions), 0) into v_total from public.usage_metrics
    where user_id = v_user and period_start = v_day
      and tool_name not in ('intelligence-ipinfo', 'intelligence-breach', 'intelligence-profile', 'intelligence-onion', 'research-privacy', 'research-password', 'research-email', 'research-gleif');
    select v_total + count(*) into v_total from public.intelligence_executions
    where user_id = v_user and started_at >= v_day
      and (state = 'succeeded' or (state = 'pending' and started_at > now() - interval '2 minutes'));
    if v_total >= 5 then
      return jsonb_build_object('allowed', false, 'code', 'DAILY_LIMIT',
        'retryAfter', greatest(1, extract(epoch from (v_day + interval '1 day' - now()))::integer));
    end if;
  end if;
  insert into public.intelligence_executions(user_id, action) values(v_user, p_action) returning id into v_id;
  return jsonb_build_object('allowed', true, 'id', v_id);
end;
$$;

create or replace function public.finish_intelligence_execution(p_execution_id uuid, p_success boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_execution public.intelligence_executions%rowtype;
  v_day timestamptz;
begin
  if v_user is null then return jsonb_build_object('ok', false); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 91734));
  select * into v_execution from public.intelligence_executions
    where id = p_execution_id and user_id = v_user for update;
  if not found then return jsonb_build_object('ok', false); end if;
  -- Idempotent settlement prevents retries from counting a request twice.
  if v_execution.state <> 'pending' then return jsonb_build_object('ok', true); end if;
  if v_execution.started_at <= now() - interval '2 minutes' then
    update public.intelligence_executions set state = 'failed', completed_at = now() where id = p_execution_id;
    return jsonb_build_object('ok', not p_success);
  end if;
  update public.intelligence_executions set state = case when p_success then 'succeeded' else 'failed' end,
    completed_at = now() where id = p_execution_id;
  if p_success then
    v_day := date_trunc('day', v_execution.started_at at time zone 'UTC') at time zone 'UTC';
    insert into public.usage_metrics(user_id, tool_name, executions, period_start, period_end)
    values (v_user, case when v_execution.action like 'research-%' then v_execution.action else 'intelligence-' || v_execution.action end, 1, v_day, v_day + interval '1 day')
    on conflict (user_id, tool_name, period_start)
    do update set executions = public.usage_metrics.executions + 1;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Retain the existing authenticated-only RPC boundary. Journal rows remain private.
revoke all on function public.reserve_intelligence_execution(text) from public, anon;
revoke all on function public.finish_intelligence_execution(uuid, boolean) from public, anon;
grant execute on function public.reserve_intelligence_execution(text) to authenticated;
grant execute on function public.finish_intelligence_execution(uuid, boolean) to authenticated;
commit;
