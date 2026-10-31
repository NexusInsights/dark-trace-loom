-- Scoped admission/accounting for the new intelligence-tools function only.
-- Existing tools and subscription/billing rules are unchanged.
create table public.intelligence_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('ipinfo', 'breach', 'profile', 'onion')),
  state text not null default 'pending' check (state in ('pending', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index intelligence_executions_daily on public.intelligence_executions(user_id, started_at);
alter table public.intelligence_executions enable row level security;
revoke all on table public.intelligence_executions from anon, authenticated;

create or replace function public.reserve_intelligence_execution(p_action text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_day timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_plan text := 'free';
  v_total bigint;
begin
  if v_user is null then return jsonb_build_object('allowed', false, 'code', 'UNAUTHORIZED'); end if;
  if p_action not in ('ipinfo', 'breach', 'profile', 'onion') then
    return jsonb_build_object('allowed', false, 'code', 'INVALID_INPUT');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 91734));
  if exists (
    select 1 from public.tool_permissions
    where user_id = v_user and tool_id in ('intelligence-lab', 'intelligence-' || p_action) and allowed = false
  ) then return jsonb_build_object('allowed', false, 'code', 'FORBIDDEN'); end if;

  select s.plan into v_plan from public.subscriptions s
  where s.user_id = v_user
    and (s.stripe_customer_id = 'admin_override_enterprise'
      or (s.status = 'active' and s.current_period_end > now()))
  limit 1;
  if coalesce(v_plan, 'free') not in ('professional', 'team', 'enterprise') then
    -- Count new server actions from this protected journal, not editable client metrics.
    select coalesce(sum(executions), 0) into v_total from public.usage_metrics
    where user_id = v_user and period_start = v_day
      and tool_name not in ('intelligence-ipinfo', 'intelligence-breach', 'intelligence-profile', 'intelligence-onion');
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
    values (v_user, 'intelligence-' || v_execution.action, 1, v_day, v_day + interval '1 day')
    on conflict (user_id, tool_name, period_start)
    do update set executions = public.usage_metrics.executions + 1;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.reserve_intelligence_execution(text) from public, anon;
revoke all on function public.finish_intelligence_execution(uuid, boolean) from public, anon;
grant execute on function public.reserve_intelligence_execution(text) to authenticated;
grant execute on function public.finish_intelligence_execution(uuid, boolean) to authenticated;
