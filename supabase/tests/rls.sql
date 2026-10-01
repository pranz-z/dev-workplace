-- Phase 2B row level security suite.
--
-- Run locally with:  supabase test db
-- (requires the pgtap extension, which ships with the local Supabase database;
--  the whole file runs inside one transaction and rolls back at the end).
--
-- It checks three layers:
--   1. structural: RLS is enabled and every policy is scoped to `authenticated`
--   2. privilege:  `anon` has no table privileges at all
--   3. behavioural: two impersonated users cannot see or modify each other's
--      rows, a task cannot be attached to somebody else's project, and the public
--      projection exposes exactly the intended rows and columns.
begin;

select no_plan();

-- ---------------------------------------------------------------------------
-- 1. structural
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.projects'::regclass), 'projects has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.project_settings'::regclass), 'project_settings has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.milestones'::regclass), 'milestones has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.tasks'::regclass), 'tasks has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.plans'::regclass), 'plans has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.project_plan_items'::regclass), 'project_plan_items has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.notes'::regclass), 'notes has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.technologies'::regclass), 'technologies has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.project_technologies'::regclass), 'project_technologies has RLS enabled');

select is(
  (select count(*)::int from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('profiles', 'projects', 'project_settings', 'milestones', 'tasks', 'plans', 'project_plan_items', 'notes', 'technologies', 'project_technologies')
     and c.relrowsecurity),
  10, 'all ten application tables have RLS enabled');

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and tablename in ('profiles', 'projects', 'project_settings', 'milestones', 'tasks', 'plans', 'project_plan_items', 'notes', 'technologies', 'project_technologies')
     and 'anon' = any(roles)),
  0, 'no policy on an application table grants access to anon');

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and tablename in ('profiles', 'projects', 'project_settings', 'milestones', 'tasks', 'plans', 'project_plan_items', 'notes', 'technologies', 'project_technologies')
     and 'authenticated' = any(roles)),
  10, 'every application table has an authenticated owner policy');

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'projects' and policyname = 'public projects are readable'),
  0, 'the Phase 1 public read policy has been removed');

-- ---------------------------------------------------------------------------
-- 2. privileges
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.projects', 'select'), 'anon cannot select from projects');
select ok(not has_table_privilege('anon', 'public.tasks', 'select'), 'anon cannot select from tasks');
select ok(not has_table_privilege('anon', 'public.notes', 'select'), 'anon cannot select from notes');
select ok(not has_table_privilege('anon', 'public.milestones', 'select'), 'anon cannot select from milestones');
select ok(not has_table_privilege('anon', 'public.plans', 'select'), 'anon cannot select from plans');
select ok(not has_table_privilege('anon', 'public.technologies', 'select'), 'anon cannot select from technologies');
select ok(not has_table_privilege('anon', 'public.project_settings', 'select'), 'anon cannot select from project_settings');
select ok(not has_table_privilege('anon', 'public.project_technologies', 'select'), 'anon cannot select from project_technologies');
select ok(not has_table_privilege('anon', 'public.project_plan_items', 'select'), 'anon cannot select from project_plan_items');
select ok(not has_table_privilege('anon', 'public.profiles', 'select'), 'anon cannot select from profiles');

select ok(has_table_privilege('authenticated', 'public.projects', 'select'), 'authenticated can select from projects (RLS still filters rows)');
select ok(has_function_privilege('anon', 'public.public_project_list()', 'execute'), 'anon can execute the public portfolio list');
select ok(has_function_privilege('anon', 'public.public_project_by_slug(text)', 'execute'), 'anon can execute the public share-link lookup');
select ok(not has_function_privilege('anon', 'private.public_project_rows(text,boolean)', 'execute'), 'anon cannot call the private projection core directly');
select ok(not has_function_privilege('anon', 'private.owns_project(uuid)', 'execute'), 'anon cannot call the ownership helper');

select is(
  (select count(*)::int from pg_attribute
   where attrelid = 'public.public_project_card'::regclass
     and attname in ('user_id', 'current_objective', 'next_action', 'github_repository_id', 'github_repository_owner', 'github_repository_name')),
  0, 'the public project card exposes no internal columns');

select is(
  (select count(*)::int from pg_attribute
   where attrelid = 'public.public_project_card'::regclass and attnum > 0 and not attisdropped),
  37, 'the public project card keeps its documented 37 safe columns');

-- ---------------------------------------------------------------------------
-- 3. behavioural fixtures (rolled back at the end of the file)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rls-user-a@example.com'),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rls-user-b@example.com');

insert into public.projects (id, user_id, slug, title, description, status, workflow_stage, visibility)
values
  ('aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000001', 'rls-user-a-public', 'User A Public', 'owned by A', 'In Development', 'development', 'Public'),
  ('aaaaaaaa-0000-4000-8000-000000000102', 'aaaaaaaa-0000-4000-8000-000000000001', 'rls-user-a-private', 'User A Private', 'owned by A', 'Planning', 'planning', 'Private'),
  ('aaaaaaaa-0000-4000-8000-000000000103', 'aaaaaaaa-0000-4000-8000-000000000001', 'rls-user-a-unlisted', 'User A Unlisted', 'owned by A', 'Testing', 'testing', 'Unlisted'),
  ('bbbbbbbb-0000-4000-8000-000000000201', 'bbbbbbbb-0000-4000-8000-000000000002', 'rls-user-b-private', 'User B Private', 'owned by B', 'Planning', 'planning', 'Private'),
  ('bbbbbbbb-0000-4000-8000-000000000202', 'bbbbbbbb-0000-4000-8000-000000000002', 'rls-user-b-public', 'User B Public', 'owned by B', 'Planning', 'planning', 'Public');

insert into public.tasks (user_id, project_id, title, status)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000102', 'User A task', 'Planned');

insert into public.notes (user_id, project_id, title, content)
values ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000201', 'User B note', 'secret');

-- ---------------------------------------------------------------------------
-- 3a. user A: own rows only, and no cross-account writes
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select is((select count(*)::int from public.projects), 3, 'User A sees exactly their own three projects');
select is((select count(*)::int from public.projects where id = 'bbbbbbbb-0000-4000-8000-000000000201'), 0, 'User A cannot read User B private project by uuid');
select is((select count(*)::int from public.tasks where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'), 0, 'User A cannot read User B tasks');
select is((select count(*)::int from public.notes where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'), 0, 'User A cannot read User B notes');
select is((select count(*)::int from public.tasks), 1, 'User A sees exactly their own task');

select is(
  (with updated as (update public.projects set title = 'hacked' where id = 'bbbbbbbb-0000-4000-8000-000000000202' returning 1)
   select count(*)::int from updated),
  0, 'User A cannot update User B project');

select is(
  (with removed as (delete from public.projects where id = 'bbbbbbbb-0000-4000-8000-000000000202' returning 1)
   select count(*)::int from removed),
  0, 'User A cannot delete User B project');

select lives_ok(
  $$insert into public.projects (user_id, slug, title) values ('aaaaaaaa-0000-4000-8000-000000000001', 'rls-user-a-created', 'A created this')$$,
  'User A can create their own project');

select throws_ok(
  $$insert into public.projects (user_id, slug, title) values ('bbbbbbbb-0000-4000-8000-000000000002', 'rls-user-a-forged', 'Forged')$$,
  '42501', null, 'User A cannot create a project owned by User B');

select throws_ok(
  $$insert into public.tasks (user_id, project_id, title) values ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000202', 'sneaky task')$$,
  '42501', null, 'User A cannot attach a task to User B project');

select lives_ok(
  $$insert into public.tasks (user_id, project_id, title) values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000102', 'A own task')$$,
  'User A can attach a task to their own project');

select throws_ok(
  $$insert into public.tasks (user_id, project_id, title) values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000102', '')$$,
  '23514', null, 'blank task titles are rejected by the database');

-- ---------------------------------------------------------------------------
-- 3b. user B: symmetric isolation
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

select is((select count(*)::int from public.projects), 2, 'User B sees exactly their own two projects');
select is((select count(*)::int from public.projects where id = 'aaaaaaaa-0000-4000-8000-000000000102'), 0, 'User B cannot read User A private project by uuid');
select is((select count(*)::int from public.milestones), 0, 'User B cannot read User A milestones');
select is(
  (with updated as (update public.projects set visibility = 'Public' where id = 'aaaaaaaa-0000-4000-8000-000000000102' returning 1)
   select count(*)::int from updated),
  0, 'User B cannot publish User A private project');

-- Baseline visibility counts, captured before impersonating anon, so the public
-- assertions stay valid whether or not the local database has been seeded.
reset role;
select set_config('test.public_projects', (select count(*)::text from public.projects where visibility = 'Public'), true);
select set_config('test.unlisted_projects', (select count(*)::text from public.projects where visibility = 'Unlisted'), true);

-- ---------------------------------------------------------------------------
-- 3c. anonymous visitor: no table access, curated projection only
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{}';

select throws_ok('select count(*)::int from public.projects', '42501', null, 'anon cannot read the projects table');
select throws_ok('select count(*)::int from public.tasks', '42501', null, 'anon cannot read the tasks table');
select throws_ok('select count(*)::int from public.notes', '42501', null, 'anon cannot read the notes table');

select is((select count(*)::int from public.public_project_list()), current_setting('test.public_projects')::int, 'the public list returns exactly the Public projects');
select is((select count(*)::int from public.public_project_list() where visibility <> 'Public'), 0, 'the public list never contains non-public rows');
select is((select count(*)::int from public.public_project_list() where slug = 'rls-user-a-unlisted'), 0, 'an unlisted project is not listed');
select is((select count(*)::int from public.public_project_by_slug('rls-user-a-unlisted')), 1, 'an unlisted project resolves through its exact share slug');
select is((select count(*)::int from public.public_project_by_slug('rls-user-a')), 0, 'share lookups require an exact slug match');
select is((select count(*)::int from public.public_project_by_slug('rls-user-a-private')), 0, 'a private project never resolves publicly');
select is((select count(*)::int from public.public_project_by_slug('rls-user-b-private')), 0, 'another account private project never resolves publicly');
select is((select count(*)::int from public.public_project_list() where technologies is null), 0, 'technologies is always an array, never null');
select is((select progress from public.public_project_by_slug('rls-user-a-public') limit 1), 43, 'progress is derived deterministically from the workflow stage');
select is(
  (select count(*)::int from public.public_project_by_slug('rls-user-a-unlisted')),
  least(current_setting('test.unlisted_projects')::int, 1), 'exactly one unlisted row is reachable through its slug');

reset role;

select * from finish();
rollback;


