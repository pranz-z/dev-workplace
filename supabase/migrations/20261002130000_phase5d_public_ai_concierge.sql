-- Phase 5D: opt-in public developer AI and persistent public request limits.

alter table public.profiles
  add column if not exists public_ai_assistant_enabled boolean not null default false;

create or replace function public.public_ai_profile()
returns table (
  display_name text,
  headline text,
  bio text,
  public_contact_email text,
  github_url text,
  linkedin_url text,
  website_url text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.display_name,
    p.headline,
    p.bio,
    case when p.show_public_contact_email then p.public_contact_email end,
    p.public_github_url,
    p.public_linkedin_url,
    p.public_website_url
  from public.profiles p
  where p.public_profile_enabled
    and p.public_ai_assistant_enabled
  order by p.created_at, p.id
  limit 1;
$$;

create or replace function public.public_ai_project_list()
returns setof public.public_project_card
language sql
security definer
stable
set search_path = ''
as $$
  with active_profile as (
    select p.id
    from public.profiles p
    where p.public_profile_enabled and p.public_ai_assistant_enabled
    order by p.created_at, p.id
    limit 1
  )
  select projected.*
  from private.public_project_rows(null, false) projected
  join public.projects p on p.slug = projected.slug
  join active_profile on active_profile.id = p.user_id
  order by projected.is_featured desc, projected.updated_at desc
  limit 8;
$$;

revoke all on function public.public_ai_profile() from public;
revoke all on function public.public_ai_project_list() from public;
grant execute on function public.public_ai_profile() to anon, authenticated, service_role;
grant execute on function public.public_ai_project_list() to anon, authenticated, service_role;

create table if not exists private.public_ai_rate_limit_buckets (
  bucket_kind text not null check (bucket_kind in ('visitor_minute', 'global_day')),
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  bucket_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (bucket_kind, subject_hash, bucket_start)
);

alter table private.public_ai_rate_limit_buckets enable row level security;
revoke all on private.public_ai_rate_limit_buckets from public, anon, authenticated, service_role;

create or replace function public.consume_public_ai_rate_limit(
  p_visitor_hash text,
  p_visitor_limit integer,
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
  if p_visitor_hash is null or p_visitor_hash !~ '^[a-f0-9]{64}$'
    or p_visitor_limit < 1 or p_visitor_limit > 20
    or p_daily_limit < 1 or p_daily_limit > 100 then
    raise exception 'Invalid public AI rate limit parameters' using errcode = '22023';
  end if;

  v_minute_start := date_trunc('minute', v_now at time zone 'UTC') at time zone 'UTC';
  v_day_start := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';

  -- Logical expiry: old visitor buckets and previous daily counters are removed
  -- as requests arrive. Stored visitor identifiers are HMAC digests only.
  delete from private.public_ai_rate_limit_buckets
  where bucket_start < v_day_start - interval '1 day';

  insert into private.public_ai_rate_limit_buckets (bucket_kind, subject_hash, bucket_start, request_count, updated_at)
  values ('visitor_minute', p_visitor_hash, v_minute_start, 1, v_now)
  on conflict (bucket_kind, subject_hash, bucket_start) do update
    set request_count = private.public_ai_rate_limit_buckets.request_count + 1,
        updated_at = excluded.updated_at
    where private.public_ai_rate_limit_buckets.request_count < p_visitor_limit
  returning request_count into v_count;

  if not found then
    return false;
  end if;

  -- The all-zero key represents the aggregate counter, not a visitor.
  insert into private.public_ai_rate_limit_buckets (bucket_kind, subject_hash, bucket_start, request_count, updated_at)
  values ('global_day', repeat('0', 64), v_day_start, 1, v_now)
  on conflict (bucket_kind, subject_hash, bucket_start) do update
    set request_count = private.public_ai_rate_limit_buckets.request_count + 1,
        updated_at = excluded.updated_at
    where private.public_ai_rate_limit_buckets.request_count < p_daily_limit
  returning request_count into v_count;

  return found;
end;
$$;

revoke all on function public.consume_public_ai_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_ai_rate_limit(text, integer, integer) to service_role;

create table if not exists private.public_ai_active_leases (
  visitor_hash text primary key check (visitor_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null
);
alter table private.public_ai_active_leases enable row level security;
revoke all on private.public_ai_active_leases from public, anon, authenticated, service_role;

create or replace function public.acquire_public_ai_lease(p_visitor_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acquired boolean;
begin
  if p_visitor_hash is null or p_visitor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid public AI visitor identifier' using errcode = '22023';
  end if;
  delete from private.public_ai_active_leases where expires_at <= now();
  insert into private.public_ai_active_leases (visitor_hash, expires_at)
  values (p_visitor_hash, now() + interval '5 minutes')
  on conflict (visitor_hash) do update
    set expires_at = excluded.expires_at
    where private.public_ai_active_leases.expires_at <= now()
  returning true into v_acquired;
  return coalesce(v_acquired, false);
end;
$$;

create or replace function public.release_public_ai_lease(p_visitor_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_visitor_hash is null or p_visitor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid public AI visitor identifier' using errcode = '22023';
  end if;
  delete from private.public_ai_active_leases where visitor_hash = p_visitor_hash;
end;
$$;

revoke all on function public.acquire_public_ai_lease(text) from public, anon, authenticated;
revoke all on function public.release_public_ai_lease(text) from public, anon, authenticated;
grant execute on function public.acquire_public_ai_lease(text) to service_role;
grant execute on function public.release_public_ai_lease(text) to service_role;

comment on function public.public_ai_profile() is 'Public AI profile projection; returns a row only while the public profile and AI assistant are both enabled.';
comment on function public.public_ai_project_list() is 'Bounded public project evidence for the public developer assistant; never includes private or unlisted projects.';
comment on function public.consume_public_ai_rate_limit(text, integer, integer) is 'Atomically enforces visitor-minute and global-day limits; callable only with the server service role.';
comment on function public.acquire_public_ai_lease(text) is 'Acquires a five-minute single-flight lease for one HMAC visitor; callable only with the server service role.';
comment on function public.release_public_ai_lease(text) is 'Releases a public AI single-flight lease; callable only with the server service role.';

notify pgrst, 'reload schema';
