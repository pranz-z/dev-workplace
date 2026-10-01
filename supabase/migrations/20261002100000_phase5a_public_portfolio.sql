-- Phase 5A: explicitly configured public profile content and screenshot sharing.
-- Existing profile fields and screenshots remain private unless their public
-- parent/profile setting and per-field sharing controls allow disclosure.

alter table public.profiles
  add column if not exists headline text,
  add column if not exists public_contact_email text,
  add column if not exists show_public_contact_email boolean not null default false,
  add column if not exists public_github_url text,
  add column if not exists public_linkedin_url text,
  add column if not exists public_website_url text;

alter table public.project_screenshots
  add column if not exists is_public boolean not null default false;

drop policy if exists "update own project screenshots" on public.project_screenshots;
create policy "update own project screenshots" on public.project_screenshots
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );
grant update (is_public) on public.project_screenshots to authenticated;

create or replace function public.public_profile()
returns table (
  display_name text,
  headline text,
  bio text,
  avatar_url text,
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
    p.avatar_url,
    case when p.show_public_contact_email then p.public_contact_email end,
    p.public_github_url,
    p.public_linkedin_url,
    p.public_website_url
  from public.profiles p
  where p.public_profile_enabled
  order by p.created_at
  limit 1;
$$;

create or replace function public.public_project_screenshots(p_slug text)
returns table (id uuid, project_slug text, storage_path text, caption text, created_at timestamptz)
language sql
security definer
stable
set search_path = ''
as $$
  select s.id, p.slug, s.storage_path, s.caption, s.created_at
  from public.project_screenshots s
  join public.projects p on p.id = s.project_id
  where s.is_public
    and ((p_slug is null and p.visibility = 'Public')
      or (p.slug = p_slug and p.visibility in ('Public', 'Unlisted')))
    and (p_slug is not null or s.id = (
      select cover.id from public.project_screenshots cover
      where cover.project_id = p.id and cover.is_public
      order by cover.created_at desc limit 1
    ))
  order by s.created_at desc;
$$;

revoke all on function public.public_profile() from public;
revoke all on function public.public_project_screenshots(text) from public;
grant execute on function public.public_profile() to anon, authenticated;
grant execute on function public.public_project_screenshots(text) to anon, authenticated;

-- Storage remains private. Anonymous signed-URL issuance/read is permitted only
-- for a specifically shared screenshot belonging to a Public or Unlisted project.
create or replace function private.can_read_public_project_screenshot(p_object_name text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_screenshots s
    join public.projects p on p.id = s.project_id
    where s.storage_path = p_object_name
      and s.is_public
      and p.visibility in ('Public', 'Unlisted')
  );
$$;
revoke all on function private.can_read_public_project_screenshot(text) from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.can_read_public_project_screenshot(text) to anon, authenticated;

drop policy if exists "read explicitly public project screenshots" on storage.objects;
create policy "read explicitly public project screenshots" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'project-screenshots'
    and private.can_read_public_project_screenshot(name)
  );
