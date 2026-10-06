-- Folder metadata stays in external_files. Root is implicit; project/custom
-- folders use the Drive folder MIME type. Existing files remain in place.
alter table public.external_files
  add column parent_id uuid references public.external_files(id) deferrable initially deferred,
  add column is_project_folder boolean not null default false;
alter table public.external_files add constraint external_files_project_folder_check
  check (not is_project_folder or (mime_type = 'application/vnd.google-apps.folder' and project_id is not null and parent_id is null and task_id is null));
create index external_files_parent_idx on public.external_files(user_id, parent_id);

-- Invoker semantics retain RLS. Serialize hierarchy edits per owner so two
-- concurrent edits cannot create a cycle. Parent must be visible, active,
-- same owner/provider/project, and a folder. Maximum nesting is 20 levels.
create function private.assert_external_file_parent() returns trigger
language plpgsql set search_path = '' as $$
declare parent_row public.external_files; ancestor_id uuid; depth integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 610614));
  if exists(select 1 from public.external_files f where f.parent_id=new.id
    and (f.user_id<>new.user_id or f.provider<>new.provider or f.project_id is distinct from new.project_id
      or new.mime_type<>'application/vnd.google-apps.folder' or new.status<>'active')) then
    raise exception 'Folder children must retain their owner and project' using errcode='23514';
  end if;
  if new.parent_id is null then return new; end if;
  select * into parent_row from public.external_files where id = new.parent_id;
  if parent_row.id is null or parent_row.user_id <> new.user_id
    or parent_row.provider <> new.provider or parent_row.status <> 'active'
    or parent_row.mime_type <> 'application/vnd.google-apps.folder'
    or parent_row.project_id is distinct from new.project_id then
    raise exception 'Invalid external file parent' using errcode = '23514';
  end if;
  ancestor_id := new.parent_id;
  while ancestor_id is not null loop
    depth := depth + 1;
    if ancestor_id = new.id or depth > 20 then
      raise exception 'External file folder cycle or depth limit' using errcode = '23514';
    end if;
    select f.parent_id into ancestor_id from public.external_files f where f.id = ancestor_id;
  end loop;
  return new;
end; $$;
revoke all on function private.assert_external_file_parent() from public, anon, authenticated, service_role;
create trigger external_files_check_parent before insert or update of parent_id, user_id, project_id, provider, mime_type, status
  on public.external_files for each row execute function private.assert_external_file_parent();

-- Reserve a Google-generated ID before files.create. The unique logical key
-- and compare-and-swap replacement make retries/concurrent requests use the
-- same ID (Drive returns 409 instead of making duplicates). Account-bound,
-- service-only proof; user-writable metadata is never sufficient by itself.
create table private.google_drive_folder_registry (
  user_id uuid not null references auth.users(id) on delete cascade,
  google_account_sub text not null,
  logical_key text not null,
  metadata_id uuid not null default gen_random_uuid(),
  drive_file_id text not null,
  parent_drive_id text,
  created_at timestamptz not null default now(),
  primary key(user_id, google_account_sub, logical_key),
  unique(metadata_id),
  unique(user_id, google_account_sub, drive_file_id)
);
alter table private.google_drive_folder_registry enable row level security;
revoke all on private.google_drive_folder_registry from public, anon, authenticated, service_role;
create function public.reserve_google_drive_folder(
  p_user_id uuid, p_google_account_sub text, p_logical_key text,
  p_candidate_id text, p_parent_drive_id text, p_previous_drive_id text default null
) returns table(metadata_id uuid, drive_file_id text, parent_drive_id text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or nullif(p_google_account_sub,'') is null or nullif(p_logical_key,'') is null then
    raise exception 'Invalid folder reservation' using errcode = '22023';
  end if;
  if p_candidate_id is not null then
    insert into private.google_drive_folder_registry(user_id,google_account_sub,logical_key,drive_file_id,parent_drive_id,metadata_id)
      values(p_user_id,p_google_account_sub,p_logical_key,p_candidate_id,p_parent_drive_id,
        case when p_logical_key like 'custom:%' then substr(p_logical_key,8)::uuid else gen_random_uuid() end)
      on conflict(user_id,google_account_sub,logical_key) do nothing;
    if p_previous_drive_id is not null then
      update private.google_drive_folder_registry r set drive_file_id=p_candidate_id, parent_drive_id=p_parent_drive_id
        where r.user_id=p_user_id and r.google_account_sub=p_google_account_sub
          and r.logical_key=p_logical_key and r.drive_file_id=p_previous_drive_id;
    end if;
  end if;
  return query select r.metadata_id,r.drive_file_id,r.parent_drive_id
    from private.google_drive_folder_registry r where r.user_id=p_user_id
      and r.google_account_sub=p_google_account_sub and r.logical_key=p_logical_key;
end; $$;
revoke all on function public.reserve_google_drive_folder(uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.reserve_google_drive_folder(uuid,text,text,text,text,text) to service_role;

-- Destination is preserved alongside the existing server-only session. Old
-- sessions are supported; app_folder_id continues to mean actual Drive parent.
alter table private.google_drive_upload_sessions add column parent_id uuid
  references public.external_files(id) on delete set null;
create function public.set_google_drive_upload_parent(p_user_id uuid,p_id uuid,p_parent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from private.google_drive_upload_sessions s
    join public.external_files f on f.id=p_parent_id
    where s.user_id=p_user_id and s.id=p_id and s.status='uploading'
      and f.user_id=p_user_id and f.status='active' and f.mime_type='application/vnd.google-apps.folder'
      and f.project_id is not distinct from s.project_id) then
    raise exception 'Invalid upload folder' using errcode='23514';
  end if;
  update private.google_drive_upload_sessions s set parent_id=p_parent_id where s.user_id=p_user_id and s.id=p_id;
end; $$;
create function public.get_google_drive_upload_parent(p_user_id uuid,p_id uuid)
returns uuid language sql security definer set search_path = '' as $$
  select s.parent_id from private.google_drive_upload_sessions s where s.user_id=p_user_id and s.id=p_id;
$$;
revoke all on function public.set_google_drive_upload_parent(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.get_google_drive_upload_parent(uuid,uuid) from public, anon, authenticated;
grant execute on function public.set_google_drive_upload_parent(uuid,uuid,uuid) to service_role;
grant execute on function public.get_google_drive_upload_parent(uuid,uuid) to service_role;
