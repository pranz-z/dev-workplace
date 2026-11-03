-- Adds an owner-editable Services collection to the portfolio CMS document.
-- The embedded schema mirrors lib/portfolio/content.ts and is checked by cms-database.test.mjs.
create or replace function private.validate_portfolio_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare schema_spec jsonb := '{"type":"object","properties":{"hero":{"type":"object","properties":{"name":{"type":"string","max":120},"headline":{"type":"string","max":240},"description":{"type":"string","max":1000},"tagline":{"type":"string","max":300},"avatar":{"type":"string","max":2048,"format":"url"}}},"bio":{"type":"string","max":2000},"about":{"type":"object","properties":{"title":{"type":"string","max":160},"body":{"type":"string","max":4000},"secondary":{"type":"string","max":4000}}},"projects":{"type":"object","properties":{"title":{"type":"string","max":160},"intro":{"type":"string","max":1000}}},"stack":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"name":{"type":"string","max":80,"min":1}}},"max":40},"experience":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"company":{"type":"string","max":240},"role":{"type":"string","max":240},"employmentType":{"type":"string","max":80},"start":{"type":"string","max":7,"format":"month"},"end":{"type":"string","max":7,"format":"month"},"current":{"type":"boolean"},"location":{"type":"string","max":240},"summary":{"type":"string","max":2000},"bullets":{"type":"array","items":{"type":"string","max":1000,"min":1},"max":30},"technologies":{"type":"array","items":{"type":"string","max":80},"max":40}}},"max":25},"education":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"institution":{"type":"string","max":240},"degree":{"type":"string","max":240},"field":{"type":"string","max":240},"honors":{"type":"string","max":240},"start":{"type":"string","max":7,"format":"month"},"graduation":{"type":"string","max":7,"format":"month"},"location":{"type":"string","max":240},"coursework":{"type":"array","items":{"type":"string","max":1000,"min":1},"max":30},"activities":{"type":"array","items":{"type":"string","max":1000,"min":1},"max":30},"notes":{"type":"string","max":2000}}},"max":25},"toolkit":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"label":{"type":"string","max":100,"min":1},"items":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"name":{"type":"string","max":80,"min":1}}},"max":60}}},"max":20},"focus":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"title":{"type":"string","max":160,"min":1},"description":{"type":"string","max":2000},"icon":{"type":"string","max":60}}},"max":20},"servicesPage":{"type":"object","properties":{"title":{"type":"string","max":160},"intro":{"type":"string","max":1000}}},"services":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"title":{"type":"string","max":160,"min":1},"summary":{"type":"string","max":2000},"icon":{"type":"string","max":60},"highlights":{"type":"array","items":{"type":"string","max":240,"min":1},"max":12}}},"max":30},"contact":{"type":"object","properties":{"email":{"type":"string","max":254,"format":"email"},"showEmail":{"type":"boolean"},"phone":{"type":"string","max":40,"format":"phone"},"showPhone":{"type":"boolean"},"location":{"type":"string","max":240},"showLocation":{"type":"boolean"},"cta":{"type":"string","max":160},"note":{"type":"string","max":1000}}},"links":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"format":"uuid"},"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000},"type":{"type":"string","max":60,"min":1},"label":{"type":"string","max":80,"min":1},"url":{"type":"string","max":2048,"format":"url","min":1}}},"max":20},"sections":{"type":"object","properties":{"hero":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"projects":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"about":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"experience":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"toolkit":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"education":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"focus":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"contact":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}},"services":{"type":"object","properties":{"enabled":{"type":"boolean"},"sort_order":{"type":"integer","max":10000}}}}}}}'::jsonb; entry jsonb;
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

-- Only this server projection removes disabled sections, entries, skills and contacts.
create or replace function private.project_portfolio(d jsonb)
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
      elsif section = 'services' then
        result := jsonb_set(result, '{servicesPage}', '{"title":"","intro":""}');
        result := jsonb_set(result, '{services}', '[]');
      elsif section = 'contact' then
        result := jsonb_set(result, '{contact}', '{"email":"","showEmail":false,"phone":"","showPhone":false,"location":"","showLocation":false,"cta":"","note":""}');
        result := jsonb_set(result, '{links}', '[]');
      else result := jsonb_set(result, array[section], '[]');
      end if;
    end if;
  end loop;
  foreach collection in array array['stack','experience','education','focus','services','links'] loop
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

-- Existing documents gain an empty Services collection so they stay valid under the new schema.
update public.profiles
set portfolio_content = jsonb_set(
  portfolio_content || '{"servicesPage":{"title":"Services","intro":""},"services":[]}'::jsonb,
  '{sections,services}', '{"enabled":true,"sort_order":8}'::jsonb)
where portfolio_content is not null and not portfolio_content ? 'services';
