-- Server-only state for Drive resumable uploads. Session URIs are bearer-like
-- capabilities and must never be returned to browser clients.
-- Invariants: owner comes from the verified Supabase session; the authenticated
-- server validates project/task ownership before creating a session; task_id
-- always belongs to project_id; file bytes stay in Drive, not Postgres; only a
-- verified completed Drive file is inserted into public.external_files.
create table if not exists private.google_drive_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  expected_name text not null check (length(btrim(expected_name)) between 1 and 255),
  expected_mime_type text not null,
  expected_size_bytes bigint not null check (expected_size_bytes > 0),
  google_account_sub text not null,
  google_account_email text not null,
  app_folder_id text not null,
  session_uri text not null,
  expires_at timestamptz not null,
  next_offset bigint not null default 0 check (next_offset >= 0),
  chunk_claim_id uuid,
  chunk_claim_expires_at timestamptz,
  status text not null default 'uploading' check (status in ('uploading', 'completed', 'expired')),
  drive_file_id text,
  external_file_id uuid references public.external_files(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_drive_upload_task_requires_project check (task_id is null or project_id is not null),
  constraint google_drive_upload_offset_within_size check (next_offset <= expected_size_bytes)
);
alter table private.google_drive_upload_sessions enable row level security;
revoke all on private.google_drive_upload_sessions from public, anon, authenticated, service_role;
create index if not exists google_drive_upload_sessions_owner_created_idx
  on private.google_drive_upload_sessions (user_id, created_at desc);
create index if not exists google_drive_upload_sessions_expiry_idx
  on private.google_drive_upload_sessions (expires_at) where status = 'uploading';
drop trigger if exists google_drive_upload_sessions_set_updated_at on private.google_drive_upload_sessions;
create trigger google_drive_upload_sessions_set_updated_at before update on private.google_drive_upload_sessions
  for each row execute function private.set_updated_at();
comment on table private.google_drive_upload_sessions is
  'Server-only Drive resumable upload state, including the secret session URI; no file bytes are stored.';
comment on column private.google_drive_upload_sessions.session_uri is
  'Google Drive resumable upload capability. Returned only through service-role RPC to server code; never to browser clients.';

create or replace function public.create_google_drive_upload_session(
  p_id uuid, p_user_id uuid, p_project_id uuid, p_task_id uuid,
  p_expected_name text, p_expected_mime_type text, p_expected_size_bytes bigint,
  p_google_account_sub text, p_google_account_email text,
  p_app_folder_id text, p_session_uri text, p_expires_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null or p_user_id is null or length(btrim(p_expected_name)) not between 1 and 255
    or p_expected_mime_type is null or p_expected_size_bytes is null or p_expected_size_bytes <= 0
    or p_google_account_sub is null or p_google_account_email is null
    or p_app_folder_id is null or p_session_uri is null or p_expires_at <= now()
    or (p_task_id is not null and p_project_id is null) then
    raise exception 'Invalid Google Drive upload session' using errcode = '22023';
  end if;
  update private.google_drive_upload_sessions s set status = 'expired', session_uri = '',
    chunk_claim_id = null, chunk_claim_expires_at = null
  where s.status = 'uploading' and s.expires_at <= now();
  insert into private.google_drive_upload_sessions (
    id, user_id, project_id, task_id, expected_name, expected_mime_type,
    expected_size_bytes, google_account_sub, google_account_email,
    app_folder_id, session_uri, expires_at
  ) values (
    p_id, p_user_id, p_project_id, p_task_id, p_expected_name, p_expected_mime_type,
    p_expected_size_bytes, p_google_account_sub, p_google_account_email,
    p_app_folder_id, p_session_uri, p_expires_at
  );
end;
$$;

create or replace function public.get_google_drive_upload_session(p_user_id uuid, p_id uuid)
returns table (
  id uuid, user_id uuid, project_id uuid, task_id uuid, expected_name text,
  expected_mime_type text, expected_size_bytes bigint, google_account_sub text,
  google_account_email text, app_folder_id text, session_uri text,
  expires_at timestamptz, next_offset bigint, status text,
  drive_file_id text, external_file_id uuid
) language plpgsql security definer set search_path = '' as $$
begin
  update private.google_drive_upload_sessions s set status = 'expired', session_uri = '',
    chunk_claim_id = null, chunk_claim_expires_at = null
  where p_user_id is not null and p_id is not null and s.user_id = p_user_id and s.id = p_id
    and s.status = 'uploading' and s.expires_at <= now();
  return query select s.id, s.user_id, s.project_id, s.task_id, s.expected_name,
    s.expected_mime_type, s.expected_size_bytes, s.google_account_sub,
    s.google_account_email, s.app_folder_id, s.session_uri, s.expires_at,
    s.next_offset, s.status, s.drive_file_id, s.external_file_id
  from private.google_drive_upload_sessions s
  where p_user_id is not null and p_id is not null and s.user_id = p_user_id and s.id = p_id;
end;
$$;

create or replace function public.claim_google_drive_upload_chunk(
  p_user_id uuid, p_id uuid, p_expected_offset bigint, p_claim_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_id is null or p_expected_offset is null or p_claim_id is null then
    raise exception 'Invalid Google Drive upload chunk claim' using errcode = '22023';
  end if;
  update private.google_drive_upload_sessions s
    set chunk_claim_id = p_claim_id, chunk_claim_expires_at = now() + interval '2 minutes'
  where s.user_id = p_user_id and s.id = p_id and s.status = 'uploading'
    and s.expires_at > now() and s.next_offset = p_expected_offset
    and (s.chunk_claim_expires_at is null or s.chunk_claim_expires_at <= now());
  return found;
end;
$$;

create or replace function public.finish_google_drive_upload_chunk(
  p_user_id uuid, p_id uuid, p_claim_id uuid, p_next_offset bigint
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_id is null or p_claim_id is null or p_next_offset is null then
    raise exception 'Invalid Google Drive upload chunk result' using errcode = '22023';
  end if;
  update private.google_drive_upload_sessions s
    set next_offset = p_next_offset, chunk_claim_id = null, chunk_claim_expires_at = null
  where s.user_id = p_user_id and s.id = p_id and s.status = 'uploading'
    and s.chunk_claim_id = p_claim_id and p_next_offset between s.next_offset and s.expected_size_bytes;
  return found;
end;
$$;

create or replace function public.mark_google_drive_upload_completed(
  p_user_id uuid, p_id uuid, p_drive_file_id text, p_external_file_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_id is null or p_drive_file_id is null or p_external_file_id is null then
    raise exception 'Invalid Google Drive completed upload' using errcode = '22023';
  end if;
  update private.google_drive_upload_sessions s set status = 'completed',
    drive_file_id = p_drive_file_id, external_file_id = p_external_file_id,
    session_uri = '', chunk_claim_id = null, chunk_claim_expires_at = null
  where s.user_id = p_user_id and s.id = p_id and s.status = 'uploading'
    and s.next_offset = s.expected_size_bytes and s.expires_at > now();
  return found;
end;
$$;

revoke all on function public.create_google_drive_upload_session(uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_google_drive_upload_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_google_drive_upload_chunk(uuid, uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.finish_google_drive_upload_chunk(uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.mark_google_drive_upload_completed(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.create_google_drive_upload_session(uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, text, timestamptz) to service_role;
grant execute on function public.get_google_drive_upload_session(uuid, uuid) to service_role;
grant execute on function public.claim_google_drive_upload_chunk(uuid, uuid, bigint, uuid) to service_role;
grant execute on function public.finish_google_drive_upload_chunk(uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.mark_google_drive_upload_completed(uuid, uuid, text, uuid) to service_role;
