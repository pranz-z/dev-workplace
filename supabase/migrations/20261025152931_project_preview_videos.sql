-- Video bytes live only in Vercel Private Blob. No Storage bucket changes.
create table private.project_preview_video_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  blob_pathname text not null unique check (blob_pathname ~ '^portfolio-previews/[a-f0-9]{48}\.mp4$'),
  file_name text not null check (length(file_name) between 1 and 255 and file_name ~* '\.mp4$'),
  mime_type text not null check (mime_type = 'video/mp4'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  expires_at timestamptz not null,
  verified boolean not null default false
);
alter table private.project_preview_video_uploads enable row level security;
revoke all on private.project_preview_video_uploads from public, anon, authenticated, service_role;

create table public.project_preview_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null unique references public.projects(id) on delete cascade,
  blob_pathname text not null unique check (blob_pathname ~ '^portfolio-previews/[a-f0-9]{48}\.mp4$'),
  file_name text not null check (length(file_name) between 1 and 255 and file_name ~* '\.mp4$'),
  mime_type text not null check (mime_type = 'video/mp4'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (isfinite(created_at) and isfinite(updated_at) and updated_at >= created_at)
);
alter table public.project_preview_videos enable row level security;
revoke all on public.project_preview_videos from public, anon;
grant select, insert, update, delete on public.project_preview_videos to authenticated;

create policy "manage own project preview videos" on public.project_preview_videos
  for all to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())
  ))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())
  ));

-- RLS alone cannot prove that a pathname was uploaded/HEAD-verified for this project.
-- Require a server-verified binding, including for direct Data API writes.
create function private.check_project_preview_video()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.projects p where p.id = new.project_id and p.user_id = new.user_id for update;
  if not found or not exists (
    select 1 from private.project_preview_video_uploads u
    where u.project_id = new.project_id and u.user_id = new.user_id
      and u.blob_pathname = new.blob_pathname and u.verified
      and u.mime_type = new.mime_type and u.size_bytes = new.size_bytes and u.file_name = new.file_name
  ) then raise exception 'Unverified preview video association' using errcode = '23514'; end if;
  return new;
end;
$$;
revoke all on function private.check_project_preview_video() from public, anon, authenticated, service_role;
create trigger project_preview_videos_check before insert or update on public.project_preview_videos
  for each row execute function private.check_project_preview_video();
create trigger project_preview_videos_updated before update on public.project_preview_videos
  for each row execute function private.set_updated_at();

-- Server-only upload authority and atomic replacement/removal. Explicit user ownership
-- is checked even though only the server's service role can call this function.
create function public.manage_project_preview_video(p_user_id uuid, p_project_id uuid, p_action text, p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  upload private.project_preview_video_uploads;
  current_video public.project_preview_videos;
  old_path text;
begin
  perform 1 from public.projects where id = p_project_id and user_id = p_user_id for update;
  if not found then raise exception 'Project unavailable' using errcode = '42501'; end if;
  select * into current_video from public.project_preview_videos where project_id = p_project_id;
  if p_action = 'begin' then
    delete from private.project_preview_video_uploads where project_id = p_project_id and not verified and expires_at <= now();
    insert into private.project_preview_video_uploads(user_id, project_id, blob_pathname, file_name, mime_type, size_bytes, expires_at)
    values (p_user_id, p_project_id, p_input->>'pathname', p_input->>'name', p_input->>'type', (p_input->>'size')::bigint, now() + interval '10 minutes')
    returning * into upload;
    return jsonb_build_object('uploadId', upload.id);
  elsif p_action in ('intent', 'finalize') then
    select * into upload from private.project_preview_video_uploads
      where id = (p_input->>'uploadId')::uuid and user_id = p_user_id and project_id = p_project_id;
    if not found then raise exception 'Upload unavailable' using errcode = '22023'; end if;
    if upload.verified then
      if current_video.blob_pathname = upload.blob_pathname then
        return jsonb_build_object('video', to_jsonb(current_video), 'oldPath', null);
      end if;
      raise exception 'Upload already finalized' using errcode = '22023';
    end if;
    if upload.expires_at <= now() then raise exception 'Upload expired' using errcode = '22023'; end if;
    if p_action = 'intent' then return to_jsonb(upload); end if;
    if p_input->>'pathname' is distinct from upload.blob_pathname
      or p_input->>'mimeType' is distinct from upload.mime_type
      or (p_input->>'sizeBytes')::bigint is distinct from upload.size_bytes then
      raise exception 'Uploaded metadata mismatch' using errcode = '23514';
    end if;
    old_path := current_video.blob_pathname;
    update private.project_preview_video_uploads set verified = true where id = upload.id;
    insert into public.project_preview_videos(user_id, project_id, blob_pathname, file_name, mime_type, size_bytes)
      values (p_user_id, p_project_id, upload.blob_pathname, upload.file_name, upload.mime_type, upload.size_bytes)
      on conflict (project_id) do update set
        blob_pathname = excluded.blob_pathname, file_name = excluded.file_name,
        mime_type = excluded.mime_type, size_bytes = excluded.size_bytes, enabled = false
      returning * into current_video;
    -- New uploads always need explicit opt-in. Replaced paths cannot be reattached.
    delete from private.project_preview_video_uploads where project_id = p_project_id and blob_pathname = old_path;
    return jsonb_build_object('video', to_jsonb(current_video), 'oldPath', old_path);
  elsif p_action = 'remove' then
    delete from public.project_preview_videos where project_id = p_project_id returning blob_pathname into old_path;
    delete from private.project_preview_video_uploads where project_id = p_project_id and blob_pathname = old_path;
    return jsonb_build_object('oldPath', old_path);
  elsif p_action = 'enabled' then
    if jsonb_typeof(p_input->'enabled') is distinct from 'boolean' then raise exception 'Invalid visibility' using errcode = '22023'; end if;
    update public.project_preview_videos set enabled = (p_input->>'enabled')::boolean
      where project_id = p_project_id returning * into current_video;
    return jsonb_build_object('video', to_jsonb(current_video));
  end if;
  raise exception 'Invalid preview operation' using errcode = '22023';
end;
$$;
revoke all on function public.manage_project_preview_video(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.manage_project_preview_video(uuid, uuid, text, jsonb) to service_role;

create function public.public_project_preview_video(p_slug text)
returns table (project_slug text, blob_pathname text, mime_type text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.slug, v.blob_pathname, v.mime_type, v.updated_at
  from public.projects p join public.project_preview_videos v on v.project_id = p.id and v.user_id = p.user_id
  where p.slug = p_slug and p.visibility = 'Public' and v.enabled
    and p.user_id = private.canonical_portfolio_owner_id()
    and length(p_slug) between 1 and 80 and p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$';
$$;
revoke all on function public.public_project_preview_video(text) from public;
grant execute on function public.public_project_preview_video(text) to anon, authenticated;
