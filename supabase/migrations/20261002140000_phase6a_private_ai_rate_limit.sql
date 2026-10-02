-- Phase 6A: persistent, per-user limits for the private workspace AI endpoint.
-- Prompt and response content is never stored here.

create table if not exists private.private_ai_rate_limit_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket_kind text not null check (bucket_kind in ('user_minute', 'user_day')),
  bucket_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, bucket_kind, bucket_start)
);

alter table private.private_ai_rate_limit_buckets enable row level security;
revoke all on private.private_ai_rate_limit_buckets from public, anon, authenticated, service_role;
create index if not exists private_ai_rate_limit_buckets_bucket_start_idx
  on private.private_ai_rate_limit_buckets (bucket_start);

-- Phase 5D cleanup is request-driven; timestamp indexes avoid full scans when
-- pruning expired public visitor buckets and leases.
create index if not exists public_ai_rate_limit_buckets_bucket_start_idx
  on private.public_ai_rate_limit_buckets (bucket_start);
create index if not exists public_ai_active_leases_expires_at_idx
  on private.public_ai_active_leases (expires_at);

create or replace function public.consume_private_ai_rate_limit(
  p_user_id uuid,
  p_minute_limit integer,
  p_daily_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_minute_start timestamptz;
  v_day_start timestamptz;
  v_count integer;
begin
  if p_user_id is null
    or p_minute_limit is null or p_minute_limit < 1 or p_minute_limit > 20
    or p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 1000 then
    raise exception 'Invalid private AI rate limit parameters' using errcode = '22023';
  end if;

  v_minute_start := date_trunc('minute', v_now at time zone 'UTC') at time zone 'UTC';
  v_day_start := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';

  -- Every request prunes all users' expired buckets. At most the current and
  -- previous UTC day's counters remain, even for users who stop making requests.
  delete from private.private_ai_rate_limit_buckets
  where bucket_start < v_day_start - interval '1 day';

  insert into private.private_ai_rate_limit_buckets (user_id, bucket_kind, bucket_start, request_count, updated_at)
  values (p_user_id, 'user_minute', v_minute_start, 1, v_now)
  on conflict (user_id, bucket_kind, bucket_start) do update
    set request_count = private.private_ai_rate_limit_buckets.request_count + 1,
        updated_at = excluded.updated_at
    where private.private_ai_rate_limit_buckets.request_count < p_minute_limit
  returning request_count into v_count;

  if not found then
    return false;
  end if;

  insert into private.private_ai_rate_limit_buckets (user_id, bucket_kind, bucket_start, request_count, updated_at)
  values (p_user_id, 'user_day', v_day_start, 1, v_now)
  on conflict (user_id, bucket_kind, bucket_start) do update
    set request_count = private.private_ai_rate_limit_buckets.request_count + 1,
        updated_at = excluded.updated_at
    where private.private_ai_rate_limit_buckets.request_count < p_daily_limit
  returning request_count into v_count;

  return found;
end;
$$;

revoke all on function public.consume_private_ai_rate_limit(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_private_ai_rate_limit(uuid, integer, integer) to service_role;

comment on table private.private_ai_rate_limit_buckets is 'Private AI request counters only; no prompt, response, or secret content is stored.';
comment on function public.consume_private_ai_rate_limit(uuid, integer, integer) is 'Atomically enforces authenticated-user minute and UTC-day AI request limits; callable only by the server service role.';

notify pgrst, 'reload schema';
