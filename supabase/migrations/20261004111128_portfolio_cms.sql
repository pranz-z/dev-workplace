-- Extend the existing owner-only profile; projects and their projections are unchanged.
alter table public.profiles add column portfolio_content jsonb;
alter table public.profiles add column portfolio_revision integer not null default 0;

-- Strict document validation also applies to direct authenticated table writes.
create function private.validate_portfolio_value(v jsonb, s jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; child jsonb; t text := s->>'type'; f text := s->>'format'; txt text;
begin
  if v is null then return false; end if;
  if t = 'object' then
    if jsonb_typeof(v) <> 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(v)) <> (select count(*) from jsonb_object_keys(s->'properties')) then return false; end if;
    for k in select jsonb_object_keys(s->'properties') loop
      if not private.validate_portfolio_value(v->k, s->'properties'->k) then return false; end if;
    end loop;
  elsif t = 'array' then
    if jsonb_typeof(v) <> 'array' then return false; end if;
    if jsonb_array_length(v) > (s->>'max')::integer then return false; end if;
    for child in select value from jsonb_array_elements(v) loop
      if not private.validate_portfolio_value(child, s->'items') then return false; end if;
    end loop;
    if s->'items'->'properties' ? 'id' then
      if (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(v)) <> jsonb_array_length(v) then return false; end if;
    end if;
  elsif t = 'integer' then
    if jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]+$' then return false; end if;
    if v::numeric > (s->>'max')::numeric then return false; end if;
  elsif t = 'boolean' then
    if jsonb_typeof(v) <> 'boolean' then return false; end if;
  elsif t = 'string' then
    if jsonb_typeof(v) <> 'string' then return false; end if;
    txt := v #>> '{}';
    if length(btrim(txt)) < coalesce((s->>'min')::integer, 0) then return false; end if;
    if length(txt) > (s->>'max')::integer or txt ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then return false; end if;
    if f = 'uuid' and txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
    if txt <> '' then
      if f = 'url' and (txt !~* '^https?://[^[:space:]/@?#]+([/?#][^[:space:]]*)?$') then return false; end if;
      if f = 'email' and txt !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return false; end if;
      if f = 'month' and txt !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then return false; end if;
      if f = 'phone' and txt !~ '^[+0-9 ()-]+$' then return false; end if;
    end if;
  else return false;
  end if;
  return true;
end;
$$;
revoke all on function private.validate_portfolio_value(jsonb, jsonb) from public;

create function private.validate_portfolio_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare schema_spec jsonb := '{"type":"object","properties":{"hero":{"type":"object","properties":{"name":{"type":"string","max":120},"headline":{"type":"string","max":240},"description":{"type":"string","max":1000},"tagline":{"type":"string","max":300},"avatar":{"type":"string","max":2048,"format":"url"}}},"bio":{"type":"string","max":2000},"about":{"type":"object","properties":{"title":{"type":"string","max":160},"body":{"type":"string","max":4000},"secondary":{"type":"string","max":4000}}},"projects":{"type":"object","properties":{"title":{"type":"string","max":160},"intro":{"type":"string","max":1000}}},"stack":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"name":{"type":"string","max":80,"min":1}}},"max":40},"experience":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"company":{"type":"string","max":240},"role":{"type":"string","max":240},"employmentType":{"type":"string","max":80},"start":{"type":"string","max":7,"format":"month"},"end":{"type":"string","max":7,"format":"month"},"current":{"type":"boolean"},"location":{"type":"string","max":240},"summary":{"type":"string","max":2000},"bullets":{"type":"array","items":{"type":"string","max":1000,"min":1},"max":30},"technologies":{"type":"array","items":{"type":"string","max":80},"max":40}}},"max":25},"education":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"institution":{"type":"string","max":240},"degree":{"type":"string","max":240},"field":{"type":"string","max":240},"honors":{"type":"string","max":240},"start":{"type":"string","max":7,"format":"month"},"graduation":{"type":"string","max":7,"format":"month"},"location":{"type":"string","max":240},"coursework":{"type":"array","items":{"type":"string","max":1000,"min":1},"max":30},"activities":{"type":"array","items":{"type":"string","max":1000,"min":1},"max":30},"notes":{"type":"string","max":2000}}},"max":25},"toolkit":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"label":{"type":"string","max":100,"min":1},"items":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"name":{"type":"string","max":80,"min":1}}},"max":60}}},"max":20},"focus":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"title":{"type":"string","max":160,"min":1},"description":{"type":"string","max":2000},"icon":{"type":"string","max":60}}},"max":20},"contact":{"type":"object","properties":{"email":{"type":"string","max":254,"format":"email"},"showEmail":{"type":"boolean"},"phone":{"type":"string","max":40,"format":"phone"},"showPhone":{"type":"boolean"},"location":{"type":"string","max":240},"showLocation":{"type":"boolean"},"cta":{"type":"string","max":160},"note":{"type":"string","max":1000}}},"links":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"type":{"type":"string","max":60,"min":1},"label":{"type":"string","max":80,"min":1},"url":{"type":"string","max":2048,"format":"url","min":1}}},"max":20},"sections":{"type":"object","properties":{"hero":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"projects":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"about":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"experience":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"toolkit":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"education":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"focus":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"contact":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}}}}}}'::jsonb; entry jsonb;
begin
  if tg_op = 'UPDATE' and old.portfolio_content is not null and new.portfolio_content is null then
    raise exception 'Initialized portfolio content cannot be cleared' using errcode = '22023';
  end if;
  if new.portfolio_content is not null then
    if octet_length(new.portfolio_content::text) > 250000 or not private.validate_portfolio_value(new.portfolio_content, schema_spec) then
      raise exception 'Invalid portfolio content' using errcode = '22023';
    end if;
    for entry in select value from jsonb_array_elements(new.portfolio_content->'experience') loop
      if btrim(entry->>'company') = '' or btrim(entry->>'role') = '' or entry->>'start' = '' or
        (not (entry->>'current')::boolean and entry->>'end' <> '' and entry->>'end' < entry->>'start') then
        raise exception 'Invalid experience fields or dates' using errcode = '22023';
      end if;
    end loop;
    for entry in select value from jsonb_array_elements(new.portfolio_content->'education') loop
      if btrim(entry->>'institution') = '' or btrim(entry->>'degree') = '' or
        (entry->>'start' <> '' and entry->>'graduation' <> '' and entry->>'graduation' < entry->>'start') then
        raise exception 'Invalid education fields or dates' using errcode = '22023';
      end if;
    end loop;
  end if;
  if tg_op = 'INSERT' then new.portfolio_revision := 0;
  elsif new.portfolio_content is distinct from old.portfolio_content or new.public_profile_enabled is distinct from old.public_profile_enabled or new.public_ai_assistant_enabled is distinct from old.public_ai_assistant_enabled then new.portfolio_revision := old.portfolio_revision + 1;
  else new.portfolio_revision := old.portfolio_revision;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_portfolio_profile() from public;
create trigger validate_portfolio_profile before insert or update on public.profiles
  for each row execute function private.validate_portfolio_profile();

-- Profiles are editable by their owner, but identity and creation time are
-- system-managed metadata and must not be client-controlled.
create function private.protect_profile_system_metadata()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'Profile id and created_at are system-managed' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_profile_system_metadata() from public;
create trigger profiles_protect_system_metadata before update on public.profiles
  for each row execute function private.protect_profile_system_metadata();

-- The public site has one operator-designated owner. A NULL owner intentionally
-- disables all canonical profile and project projections until configured.
create table private.portfolio_site_config (
  singleton boolean primary key default true check (singleton),
  owner_id uuid references public.profiles(id) on delete set null
);
alter table private.portfolio_site_config enable row level security;
revoke all on table private.portfolio_site_config from public, anon, authenticated, service_role;
insert into private.portfolio_site_config (singleton, owner_id) values (true, null);

create function private.canonical_portfolio_owner_id()
returns uuid language sql stable security invoker set search_path = '' as $$
  select config.owner_id
  from private.portfolio_site_config config
  where config.singleton;
$$;
revoke all on function private.canonical_portfolio_owner_id() from public, anon, authenticated, service_role;
comment on table private.portfolio_site_config is
  'Trusted single-owner public site configuration. Set owner_id with an administrative database role; NULL disables public portfolio projections.';
comment on column private.portfolio_site_config.owner_id is
  'Canonical profile owner. References public.profiles and becomes NULL if that profile is deleted.';

-- Atomic save with optimistic concurrency. The caller cannot supply an owner ID.
create function public.save_portfolio(p_content jsonb, p_revision integer, p_enabled boolean, p_ai_enabled boolean)
returns integer language plpgsql security invoker set search_path = '' as $$
declare saved integer;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_content is null or p_enabled is null or p_ai_enabled is null then raise exception 'Portfolio fields are required' using errcode = '22023'; end if;
  update public.profiles set portfolio_content = p_content,
    public_profile_enabled = p_enabled, public_ai_assistant_enabled = p_ai_enabled
    where id = auth.uid() and portfolio_revision = p_revision returning portfolio_revision into saved;
  if saved is null then raise exception 'Profile missing or changed in another editor. Reload before saving.' using errcode = '40001'; end if;
  return saved;
end;
$$;
revoke all on function public.save_portfolio(jsonb, integer, boolean, boolean) from public, anon;
grant execute on function public.save_portfolio(jsonb, integer, boolean, boolean) to authenticated;

-- Only this server projection removes disabled sections, entries, skills and contacts.
create function private.project_portfolio(d jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare result jsonb := d; section text; collection text; items jsonb; category jsonb; cats jsonb := '[]';
begin
  if d is null then return null; end if;
  for section in select jsonb_object_keys(d->'sections') loop
    if not (d->'sections'->section->>'enabled')::boolean then
      if section = 'hero' then
        result := jsonb_set(result, '{hero}', '{"name":"","headline":"","description":"","tagline":"","avatar":""}');
        result := jsonb_set(result, '{bio}', '""'); result := jsonb_set(result, '{stack}', '[]');
      elsif section = 'about' then result := jsonb_set(result, '{about}', '{"title":"","body":"","secondary":""}');
      elsif section = 'projects' then result := jsonb_set(result, '{projects}', '{"title":"","intro":""}');
      elsif section = 'contact' then
        result := jsonb_set(result, '{contact}', '{"email":"","showEmail":false,"phone":"","showPhone":false,"location":"","showLocation":false,"cta":"","note":""}');
        result := jsonb_set(result, '{links}', '[]');
      else result := jsonb_set(result, array[section], '[]');
      end if;
    end if;
  end loop;
  foreach collection in array array['stack','experience','education','focus','links'] loop
    select coalesce(jsonb_agg(value order by (value->>'sort_order')::integer, value->>'id'), '[]') into items
      from jsonb_array_elements(result->collection) where (value->>'enabled')::boolean;
    result := jsonb_set(result, array[collection], items);
  end loop;
  for category in select value from jsonb_array_elements(result->'toolkit')
    where (value->>'enabled')::boolean order by (value->>'sort_order')::integer, value->>'id' loop
    select coalesce(jsonb_agg(value order by (value->>'sort_order')::integer, value->>'id'), '[]') into items
      from jsonb_array_elements(category->'items') where (value->>'enabled')::boolean;
    if jsonb_array_length(items) > 0 then cats := cats || jsonb_build_array(jsonb_set(category, '{items}', items)); end if;
  end loop;
  result := jsonb_set(result, '{toolkit}', cats);
  if not (result->'contact'->>'showEmail')::boolean then result := jsonb_set(result, '{contact,email}', '""'); end if;
  if not (result->'contact'->>'showPhone')::boolean then result := jsonb_set(result, '{contact,phone}', '""'); end if;
  if not (result->'contact'->>'showLocation')::boolean then result := jsonb_set(result, '{contact,location}', '""'); end if;
  return result;
end;
$$;
revoke all on function private.project_portfolio(jsonb) from public;

create function public.public_portfolio()
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.project_portfolio(p.portfolio_content) from public.profiles p
  where p.id = private.canonical_portfolio_owner_id() and p.public_profile_enabled;
$$;
revoke all on function public.public_portfolio() from public;
grant execute on function public.public_portfolio() to anon, authenticated, service_role;

-- Preserve existing RPC contracts while removing all legacy field leaks after CMS setup.
create or replace function public.public_profile()
returns table (display_name text, headline text, bio text, avatar_url text, public_contact_email text, github_url text, linkedin_url text, website_url text)
language sql stable security definer set search_path = '' as $$
  with owner as (select p.* from public.profiles p where p.id = private.canonical_portfolio_owner_id() and p.public_profile_enabled),
  projected as (select p.*, private.project_portfolio(p.portfolio_content) as d from owner p)
  select case when d is null then p.display_name else d->'hero'->>'name' end,
    case when d is null then p.headline else d->'hero'->>'headline' end,
    case when d is null then p.bio else d->>'bio' end,
    case when d is null then p.avatar_url else d->'hero'->>'avatar' end,
    case when d is null then case when p.show_public_contact_email then p.public_contact_email end else d->'contact'->>'email' end,
    case when d is null then p.public_github_url else (select value->>'url' from jsonb_array_elements(d->'links') where lower(value->>'type') = 'github' limit 1) end,
    case when d is null then p.public_linkedin_url else (select value->>'url' from jsonb_array_elements(d->'links') where lower(value->>'type') = 'linkedin' limit 1) end,
    case when d is null then p.public_website_url else (select value->>'url' from jsonb_array_elements(d->'links') where lower(value->>'type') = 'portfolio' limit 1) end
  from projected p;
$$;

create or replace function public.public_ai_profile()
returns table (display_name text, headline text, bio text, public_contact_email text, github_url text, linkedin_url text, website_url text)
language sql stable security definer set search_path = '' as $$
  select p.display_name, p.headline, p.bio, p.public_contact_email, p.github_url, p.linkedin_url, p.website_url
  from public.public_profile() p
  where exists (
    select 1 from public.profiles owner
    where owner.id = private.canonical_portfolio_owner_id()
      and owner.public_profile_enabled and owner.public_ai_assistant_enabled
  );
$$;

create or replace function public.public_ai_project_list()
returns setof public.public_project_card language sql stable security definer set search_path = '' as $$
  with owner as (
    select p.id, p.public_ai_assistant_enabled from public.profiles p
    where p.id = private.canonical_portfolio_owner_id()
      and p.public_profile_enabled and p.public_ai_assistant_enabled
  )
  select projected.* from private.public_project_rows(null, false) projected
  join public.projects p on p.slug = projected.slug join owner on owner.id = p.user_id
  order by projected.is_featured desc, projected.updated_at desc limit 8;
$$;

-- Keep every public project projection scoped to the same configured site owner.
create or replace function public.public_project_list()
returns setof public.public_project_card language sql stable security definer set search_path = '' as $$
  select projected.*
  from private.public_project_rows(null, false) projected
  join public.projects p on p.slug = projected.slug
  where p.user_id = private.canonical_portfolio_owner_id()
  order by projected.is_featured desc, projected.updated_at desc;
$$;
revoke all on function public.public_project_list() from public;
grant execute on function public.public_project_list() to anon, authenticated;

create or replace function public.public_project_by_slug(p_slug text)
returns setof public.public_project_card language sql stable security definer set search_path = '' as $$
  select projected.*
  from private.public_project_rows(p_slug, true) projected
  join public.projects p on p.slug = projected.slug
  where p.user_id = private.canonical_portfolio_owner_id()
    and p_slug is not null and length(btrim(p_slug)) > 0 and length(p_slug) <= 120;
$$;
revoke all on function public.public_project_by_slug(text) from public;
grant execute on function public.public_project_by_slug(text) to anon, authenticated;

create or replace function public.public_project_screenshots(p_slug text)
returns table (id uuid, project_slug text, storage_path text, caption text, created_at timestamptz)
language sql security definer stable set search_path = '' as $$
  select s.id, p.slug, s.storage_path, s.caption, s.created_at
  from public.project_screenshots s
  join public.projects p on p.id = s.project_id
  where p.user_id = private.canonical_portfolio_owner_id()
    and s.is_public
    and ((p_slug is null and p.visibility = 'Public')
      or (p.slug = p_slug and p.visibility in ('Public', 'Unlisted')))
    and (p_slug is not null or s.id = (
      select cover.id from public.project_screenshots cover
      where cover.project_id = p.id and cover.is_public
      order by cover.sort_order, cover.created_at desc, cover.id limit 1
    ))
  order by s.sort_order, s.created_at desc, s.id;
$$;
revoke all on function public.public_project_screenshots(text) from public;
grant execute on function public.public_project_screenshots(text) to anon, authenticated;

create or replace function private.can_read_public_project_screenshot(p_object_name text)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1
    from public.project_screenshots s
    join public.projects p on p.id = s.project_id
    where p.user_id = private.canonical_portfolio_owner_id()
      and s.storage_path = p_object_name
      and s.is_public
      and p.visibility in ('Public', 'Unlisted')
  );
$$;
revoke all on function private.can_read_public_project_screenshot(text) from public;
grant execute on function private.can_read_public_project_screenshot(text) to anon, authenticated;

-- Existing profiles RLS (id = auth.uid() for USING and WITH CHECK) is retained.
-- No anonymous table grants, new owner IDs, or automatic publishing/seeding.
