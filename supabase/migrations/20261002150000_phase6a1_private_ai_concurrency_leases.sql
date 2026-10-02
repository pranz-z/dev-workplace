-- Phase 6A.1: one bounded active private chat request per authenticated user.
-- No prompt, response, or uploaded file data is stored in this table.

create table if not exists private.private_ai_active_leases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lease_id uuid not null,
  expires_at timestamptz not null
);

alter table private.private_ai_active_leases enable row level security;
revoke all on private.private_ai_active_leases from public, anon, authenticated, service_role;
create index if not exists private_ai_active_leases_expires_at_idx
  on private.private_ai_active_leases (expires_at);

create or replace function public.acquire_private_ai_lease(
  p_user_id uuid,
  p_lease_id uuid,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acquired boolean := false;
  v_now timestamptz := now();
begin
  if p_user_id is null or p_lease_id is null
    or p_ttl_seconds is null or p_ttl_seconds < 30 or p_ttl_seconds > 180 then
    raise exception 'Invalid private AI lease parameters' using errcode = '22023';
  end if;

  delete from private.private_ai_active_leases where expires_at <= v_now;

  insert into private.private_ai_active_leases (user_id, lease_id, expires_at)
  values (p_user_id, p_lease_id, v_now + make_interval(secs => p_ttl_seconds))
  on conflict (user_id) do update
    set lease_id = excluded.lease_id,
        expires_at = excluded.expires_at
    where private.private_ai_active_leases.expires_at <= v_now
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

create or replace function public.release_private_ai_lease(
  p_user_id uuid,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_lease_id is null then
    raise exception 'Invalid private AI lease parameters' using errcode = '22023';
  end if;

  delete from private.private_ai_active_leases
  where user_id = p_user_id and lease_id = p_lease_id;
  return found;
end;
$$;

revoke all on function public.acquire_private_ai_lease(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_private_ai_lease(uuid, uuid) from public, anon, authenticated;
grant execute on function public.acquire_private_ai_lease(uuid, uuid, integer) to service_role;
grant execute on function public.release_private_ai_lease(uuid, uuid) to service_role;

comment on table private.private_ai_active_leases is 'Short-lived private AI request leases only; no prompt, response, or uploaded file data is stored.';
