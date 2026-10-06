-- Google Drive file metadata and connection credentials.
--
-- Invariants:
--   * A file row is owned by the authenticated Supabase user; user_id is never
--     accepted from another user's context by RLS.
--   * Project and task associations reference the existing internal UUIDs. A
--     task association always includes that task's project, and both belong to
--     the same owner.
--   * This table contains private Drive metadata only. It has no public
--     projection and is not a replacement for project_screenshots.
--   * Refresh tokens are stored separately in private schema as application-
--     encrypted ciphertext. No access token is persisted. Only the service-role
--     server can call the public RPC wrappers; private is not API-exposed.

create table if not exists public.external_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null default 'google_drive' check (provider = 'google_drive'),
  provider_file_id text not null check (length(btrim(provider_file_id)) > 0),
  name text not null check (length(btrim(name)) > 0),
  mime_type text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  modified_at timestamptz,
  status text not null default 'active' check (status in ('active', 'trashed', 'unavailable')),
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_files_task_requires_project_check check (task_id is null or project_id is not null),
  constraint external_files_provider_file_key unique (user_id, provider, provider_file_id)
);

create index if not exists external_files_user_updated_idx
  on public.external_files (user_id, updated_at desc);
create index if not exists external_files_project_updated_idx
  on public.external_files (project_id, updated_at desc) where project_id is not null;
create index if not exists external_files_task_updated_idx
  on public.external_files (task_id, updated_at desc) where task_id is not null;

alter table public.external_files enable row level security;
revoke all on public.external_files from anon;
grant select, insert, update, delete on public.external_files to authenticated;

drop policy if exists "own external files" on public.external_files;
create policy "own external files" on public.external_files
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and (project_id is null or private.owns_project(project_id))
    and (
      task_id is null
      or exists (
        select 1 from public.tasks t
        where t.id = task_id
          and t.user_id = (select auth.uid())
          and t.project_id = external_files.project_id
          and private.owns_project(t.project_id)
      )
    )
  )
  with check (
    user_id = (select auth.uid())
    and (project_id is null or private.owns_project(project_id))
    and (
      task_id is null
      or exists (
        select 1 from public.tasks t
        where t.id = task_id
          and t.user_id = (select auth.uid())
          and t.project_id = external_files.project_id
          and private.owns_project(t.project_id)
      )
    )
  );

create or replace function private.assert_external_file_task_project()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  task_project_id uuid;
begin
  if new.task_id is null then return new; end if;

  select t.project_id into task_project_id
  from public.tasks t
  where t.id = new.task_id and t.user_id = new.user_id;

  if task_project_id is null then
    raise exception 'external_files task must belong to the file owner' using errcode = '23503';
  end if;
  if task_project_id is distinct from new.project_id then
    raise exception 'external_files project_id must match the associated task project' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.assert_external_file_task_project() from public, anon, authenticated, service_role;
drop trigger if exists external_files_check_task_project on public.external_files;
create trigger external_files_check_task_project
  before insert or update of user_id, project_id, task_id on public.external_files
  for each row execute function private.assert_external_file_task_project();

drop trigger if exists external_files_set_updated_at on public.external_files;
create trigger external_files_set_updated_at before update on public.external_files
  for each row execute function private.set_updated_at();

comment on table public.external_files is
  'Private Google Drive file metadata and optional owner-checked project/task associations. No public projection; project screenshots remain in project_screenshots.';

-- OAuth credentials are intentionally outside the exposed Data API schemas.
-- ciphertext is an application-level authenticated-encryption envelope encoded
-- as base64url; the key remains in server-only environment configuration.
create table if not exists private.google_drive_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token_ciphertext text not null check (length(refresh_token_ciphertext) > 0),
  encryption_key_version smallint not null check (encryption_key_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.google_drive_connections enable row level security;
revoke all on private.google_drive_connections from public, anon, authenticated, service_role;
create trigger google_drive_connections_set_updated_at before update on private.google_drive_connections
  for each row execute function private.set_updated_at();
comment on table private.google_drive_connections is
  'Server-only Google Drive OAuth credentials. Refresh tokens must be encrypted by the application before storage; access tokens are not persisted.';
comment on column private.google_drive_connections.refresh_token_ciphertext is
  'Base64url-encoded authenticated-encryption envelope; never plaintext. Decryption key is server-only and selected by encryption_key_version.';

-- PostgREST exposes public but not private. These narrow wrappers are the only
-- Data API path to Drive credentials and can be executed only with service_role.
create or replace function public.upsert_google_drive_connection(
  p_user_id uuid,
  p_refresh_token_ciphertext text,
  p_encryption_key_version smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null
    or p_refresh_token_ciphertext is null
    or length(p_refresh_token_ciphertext) = 0
    or p_encryption_key_version is null
    or p_encryption_key_version <= 0 then
    raise exception 'Invalid Google Drive connection data' using errcode = '22023';
  end if;

  insert into private.google_drive_connections (user_id, refresh_token_ciphertext, encryption_key_version)
  values (p_user_id, p_refresh_token_ciphertext, p_encryption_key_version)
  on conflict (user_id) do update
    set refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        encryption_key_version = excluded.encryption_key_version,
        updated_at = now();
end;
$$;

create or replace function public.get_google_drive_connection(p_user_id uuid)
returns table (
  user_id uuid,
  refresh_token_ciphertext text,
  encryption_key_version smallint,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select c.user_id, c.refresh_token_ciphertext, c.encryption_key_version, c.created_at, c.updated_at
  from private.google_drive_connections c
  where p_user_id is not null and c.user_id = p_user_id;
$$;

create or replace function public.delete_google_drive_connection(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.google_drive_connections c where p_user_id is not null and c.user_id = p_user_id;
$$;

revoke all on function public.upsert_google_drive_connection(uuid, text, smallint) from public, anon, authenticated;
revoke all on function public.get_google_drive_connection(uuid) from public, anon, authenticated;
revoke all on function public.delete_google_drive_connection(uuid) from public, anon, authenticated;
grant execute on function public.upsert_google_drive_connection(uuid, text, smallint) to service_role;
grant execute on function public.get_google_drive_connection(uuid) to service_role;
grant execute on function public.delete_google_drive_connection(uuid) to service_role;

comment on function public.upsert_google_drive_connection(uuid, text, smallint) is
  'Stores an application-encrypted Google Drive refresh token for a user. Callable only by the server service role.';
comment on function public.get_google_drive_connection(uuid) is
  'Returns encrypted Google Drive refresh-token data to the server service role only.';
comment on function public.delete_google_drive_connection(uuid) is
  'Deletes Google Drive connection credentials. Callable only by the server service role.';
