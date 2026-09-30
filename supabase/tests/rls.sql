-- Run with the Supabase database test workflow after applying ../schema.sql.
-- These assertions verify that every Phase 1 table has RLS enabled and that
-- the ownership/public policies exist before adding fixture-specific tests.

begin;

select plan(18);

select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.projects'::regclass), 'projects has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.tasks'::regclass), 'tasks has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.milestones'::regclass), 'milestones has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.plans'::regclass), 'plans has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.project_plan_items'::regclass), 'project plan items have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.notes'::regclass), 'notes have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.technologies'::regclass), 'technologies have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.project_technologies'::regclass), 'project technologies have RLS enabled');

select ok((select count(*) > 0 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'own profile'), 'profiles has owner policy');
select ok((select count(*) > 0 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'own projects'), 'projects has owner policy');
select ok((select count(*) > 0 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'public projects are readable'), 'projects has public read policy');
select ok((select count(*) > 0 from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'own tasks'), 'tasks has owner policy');
select ok((select count(*) > 0 from pg_policies where schemaname = 'public' and tablename = 'milestones' and policyname = 'own milestones'), 'milestones have owner policy');
select ok((select count(*) > 0 from pg_policies where schemaname = 'public' and tablename = 'plans' and policyname = 'own plans'), 'plans have owner policy');
select ok((select count(*) > 0 from pg_policies where schemaname = 'public' and tablename = 'notes' and policyname = 'own notes'), 'notes have owner policy');
select ok((select count(*) > 0 from pg_policies where schemaname = 'public' and tablename = 'project_plan_items' and policyname = 'own project plan items'), 'plan items have owner policy');
select ok((select count(*) > 0 from pg_policies where schemaname = 'public' and tablename = 'technologies' and policyname = 'own technologies'), 'technologies have owner policy');

select * from finish();
rollback;
