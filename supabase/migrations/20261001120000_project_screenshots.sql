-- Project Health screenshots: private Storage objects and project-scoped metadata.
create table if not exists public.project_screenshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  storage_path text not null unique,
  caption text not null default '' check (char_length(caption) <= 200),
  created_at timestamptz not null default now(),
  check (storage_path = user_id::text || '/' || project_id::text || '/' || split_part(storage_path, '/', 3))
);

create index if not exists project_screenshots_project_created_idx
  on public.project_screenshots(project_id, created_at desc);

alter table public.project_screenshots enable row level security;

drop policy if exists "read own project screenshots" on public.project_screenshots;
create policy "read own project screenshots" on public.project_screenshots
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "add own project screenshots" on public.project_screenshots;
create policy "add own project screenshots" on public.project_screenshots
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
    and split_part(storage_path, '/', 1) = (select auth.uid())::text
    and split_part(storage_path, '/', 2) = project_id::text
  );

drop policy if exists "remove own project screenshots" on public.project_screenshots;
create policy "remove own project screenshots" on public.project_screenshots
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );

grant select, insert, delete on public.project_screenshots to authenticated;
revoke all on public.project_screenshots from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-screenshots', 'project-screenshots', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "read own project screenshot files" on storage.objects;
create policy "read own project screenshot files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[2] and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "upload own project screenshot files" on storage.objects;
create policy "upload own project screenshot files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[2] and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "delete own project screenshot files" on storage.objects;
create policy "delete own project screenshot files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-screenshots'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[2] and p.user_id = (select auth.uid())
    )
  );
