-- Phase 2B RLS + public visibility verification (plain SQL, no extensions needed).
--
-- HOW TO RUN
--   Paste this whole file into the Supabase dashboard SQL editor and run it.
--   The script creates two throw-away auth users, runs the checks, prints a
--   PASS/FAIL table and then rolls everything back - nothing is left behind.
--   (Local alternative: `supabase test db`, which runs tests/rls.sql with pgtap.)
--
-- It proves, on the real database:
--   * anon has no table access at all
--   * an authenticated user can only reach their own rows ("User A" / "User B")
--   * a task cannot be attached to somebody else's project
--   * Public projects appear in the portfolio list, Unlisted only by exact slug,
--     Private never
--   * the public projection exposes no internal columns

begin;

-- ---------------------------------------------------------------------------
-- fixtures: two accounts, five projects across all three visibility states
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rls-check-a@example.com'),
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rls-check-b@example.com');

insert into public.projects (id, user_id, slug, title, description, status, workflow_stage, visibility, current_objective, next_action)
values
  ('cccccccc-0000-4000-8000-000000000101', 'cccccccc-0000-4000-8000-000000000001', 'rls-check-a-public', 'RLS check A public', 'a', 'In Development', 'development', 'Public', 'internal objective', 'internal next action'),
  ('cccccccc-0000-4000-8000-000000000102', 'cccccccc-0000-4000-8000-000000000001', 'rls-check-a-private', 'RLS check A private', 'a', 'Planning', 'planning', 'Private', 'internal objective', 'internal next action'),
  ('cccccccc-0000-4000-8000-000000000103', 'cccccccc-0000-4000-8000-000000000001', 'rls-check-a-unlisted', 'RLS check A unlisted', 'a', 'Testing', 'testing', 'Unlisted', 'internal objective', 'internal next action'),
  ('dddddddd-0000-4000-8000-000000000201', 'dddddddd-0000-4000-8000-000000000002', 'rls-check-b-private', 'RLS check B private', 'b', 'Planning', 'planning', 'Private', 'internal objective', 'internal next action'),
  ('dddddddd-0000-4000-8000-000000000202', 'dddddddd-0000-4000-8000-000000000002', 'rls-check-b-public', 'RLS check B public', 'b', 'Planning', 'planning', 'Public', 'internal objective', 'internal next action');

insert into public.tasks (user_id, project_id, title, status)
values ('dddddddd-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000201', 'RLS check B task', 'Planned');

insert into public.notes (user_id, project_id, title, content)
values ('cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000102', 'RLS check A private note', 'client sensitive');

-- ---------------------------------------------------------------------------
-- user A
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000001","role":"authenticated"}';

select set_config('rls.a_own_projects', (select count(*)::text from public.projects), false);
select set_config('rls.a_sees_b_private', (select count(*)::text from public.projects where id = 'dddddddd-0000-4000-8000-000000000201'), false);
select set_config('rls.a_sees_b_tasks', (select count(*)::text from public.tasks), false);
select set_config('rls.a_cannot_update_b', (
  with updated as (update public.projects set title = 'hacked' where id = 'dddddddd-0000-4000-8000-000000000202' returning 1)
  select count(*)::text from updated), false);
select set_config('rls.a_cannot_delete_b', (
  with removed as (delete from public.projects where id = 'dddddddd-0000-4000-8000-000000000202' returning 1)
  select count(*)::text from removed), false);

do $$
begin
  begin
    insert into public.tasks (user_id, project_id, title)
    values ('cccccccc-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000202', 'sneaky task');
    perform set_config('rls.a_cannot_cross_attach', 'false', false);
  exception when insufficient_privilege then
    perform set_config('rls.a_cannot_cross_attach', 'true', false);
  end;
  begin
    insert into public.projects (user_id, slug, title) values ('dddddddd-0000-4000-8000-000000000002', 'rls-check-forged', 'Forged');
    perform set_config('rls.a_cannot_forge_owner', 'false', false);
  exception when insufficient_privilege then
    perform set_config('rls.a_cannot_forge_owner', 'true', false);
  end;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- user B (symmetric isolation)
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claims = '{"sub":"dddddddd-0000-4000-8000-000000000002","role":"authenticated"}';

select set_config('rls.b_own_projects', (select count(*)::text from public.projects), false);
select set_config('rls.b_sees_a_private', (select count(*)::text from public.projects where id = 'cccccccc-0000-4000-8000-000000000102'), false);
select set_config('rls.b_sees_a_notes', (select count(*)::text from public.notes), false);
select set_config('rls.b_cannot_publish_a', (
  with updated as (update public.projects set visibility = 'Public' where id = 'cccccccc-0000-4000-8000-000000000102' returning 1)
  select count(*)::text from updated), false);

reset role;

-- ---------------------------------------------------------------------------
-- anonymous visitor
-- ---------------------------------------------------------------------------
select set_config('rls.public_total', (select count(*)::text from public.projects where visibility = 'Public'), false);

do $$
begin
  begin
    perform 1 from public.projects limit 1;
    perform set_config('rls.anon_blocked_projects', 'false', false);
  exception when insufficient_privilege then
    perform set_config('rls.anon_blocked_projects', 'true', false);
  end;
  begin
    perform 1 from public.tasks limit 1;
    perform set_config('rls.anon_blocked_tasks', 'false', false);
  exception when insufficient_privilege then
    perform set_config('rls.anon_blocked_tasks', 'true', false);
  end;
  begin
    perform 1 from public.notes limit 1;
    perform set_config('rls.anon_blocked_notes', 'false', false);
  exception when insufficient_privilege then
    perform set_config('rls.anon_blocked_notes', 'true', false);
  end;
end $$;

set role anon;
set request.jwt.claims = '{}';

select set_config('rls.anon_list_total', (select count(*)::text from public.public_project_list()), false);
select set_config('rls.anon_list_non_public', (select count(*)::text from public.public_project_list() where visibility <> 'Public'), false);
select set_config('rls.anon_list_unlisted', (select count(*)::text from public.public_project_list() where slug = 'rls-check-a-unlisted'), false);
select set_config('rls.anon_unlisted_by_slug', (select count(*)::text from public.public_project_by_slug('rls-check-a-unlisted')), false);
select set_config('rls.anon_unlisted_by_prefix', (select count(*)::text from public.public_project_by_slug('rls-check-a')), false);
select set_config('rls.anon_private_by_slug', (select count(*)::text from public.public_project_by_slug('rls-check-a-private')), false);
select set_config('rls.anon_other_private_by_slug', (select count(*)::text from public.public_project_by_slug('rls-check-b-private')), false);
select set_config('rls.anon_null_tech', (select count(*)::text from public.public_project_list() where technologies is null), false);
select set_config('rls.anon_progress', (select progress::text from public.public_project_by_slug('rls-check-a-public') limit 1), false);

reset role;

-- ---------------------------------------------------------------------------
-- results (single result set so the dashboard prints one PASS/FAIL table)
-- ---------------------------------------------------------------------------
with checks(name, expected, observed) as (
  values
    ('anon: no select on public.projects',                    'true',   coalesce(current_setting('rls.anon_blocked_projects', true), '<unset>')),
    ('anon: no select on public.tasks',                       'true',   coalesce(current_setting('rls.anon_blocked_tasks', true), '<unset>')),
    ('anon: no select on public.notes',                       'true',   coalesce(current_setting('rls.anon_blocked_notes', true), '<unset>')),
    ('user A: sees exactly their own 3 projects',             '3',      coalesce(current_setting('rls.a_own_projects', true), '<unset>')),
    ('user A: cannot read user B private project by uuid',    '0',      coalesce(current_setting('rls.a_sees_b_private', true), '<unset>')),
    ('user A: cannot read user B tasks',                      '0',      coalesce(current_setting('rls.a_sees_b_tasks', true), '<unset>')),
    ('user A: cannot update user B project',                  '0',      coalesce(current_setting('rls.a_cannot_update_b', true), '<unset>')),
    ('user A: cannot delete user B project',                  '0',      coalesce(current_setting('rls.a_cannot_delete_b', true), '<unset>')),
    ('user A: cannot attach a task to user B project',         'true',  coalesce(current_setting('rls.a_cannot_cross_attach', true), '<unset>')),
    ('user A: cannot create a project owned by user B',       'true',   coalesce(current_setting('rls.a_cannot_forge_owner', true), '<unset>')),
    ('user B: sees exactly their own 2 projects',             '2',      coalesce(current_setting('rls.b_own_projects', true), '<unset>')),
    ('user B: cannot read user A private project by uuid',    '0',      coalesce(current_setting('rls.b_sees_a_private', true), '<unset>')),
    ('user B: cannot read user A notes',                      '0',      coalesce(current_setting('rls.b_sees_a_notes', true), '<unset>')),
    ('user B: cannot publish user A private project',         '0',      coalesce(current_setting('rls.b_cannot_publish_a', true), '<unset>')),
    ('anon list: returns every Public project',               coalesce(current_setting('rls.public_total', true), '<unset>'), coalesce(current_setting('rls.anon_list_total', true), '<unset>')),
    ('anon list: contains no non-public row',                 '0',      coalesce(current_setting('rls.anon_list_non_public', true), '<unset>')),
    ('anon list: unlisted project is not listed',             '0',      coalesce(current_setting('rls.anon_list_unlisted', true), '<unset>')),
    ('anon detail: unlisted resolves by exact slug',          '1',      coalesce(current_setting('rls.anon_unlisted_by_slug', true), '<unset>')),
    ('anon detail: slug prefix does not resolve',             '0',      coalesce(current_setting('rls.anon_unlisted_by_prefix', true), '<unset>')),
    ('anon detail: private project never resolves',           '0',      coalesce(current_setting('rls.anon_private_by_slug', true), '<unset>')),
    ('anon detail: other account private never resolves',      '0',     coalesce(current_setting('rls.anon_other_private_by_slug', true), '<unset>')),
    ('anon detail: technologies is always an array',          '0',      coalesce(current_setting('rls.anon_null_tech', true), '<unset>')),
    ('anon detail: progress is derived from the workflow',    '43',     coalesce(current_setting('rls.anon_progress', true), '<unset>'))
)
select
  case when expected = observed then 'PASS' else 'FAIL' end as result,
  name,
  expected,
  observed
from checks
order by (expected = observed), name;

rollback;


