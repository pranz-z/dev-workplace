-- Phase 5D public AI projection and persistent limiter security checks.
-- Run with: supabase test db
begin;

select no_plan();

select ok(
  (select relrowsecurity from pg_class where oid = 'private.public_ai_rate_limit_buckets'::regclass),
  'public AI rate buckets have RLS enabled');
select ok(not has_table_privilege('anon', 'private.public_ai_rate_limit_buckets', 'select'), 'anon cannot read rate buckets');
select ok(not has_table_privilege('anon', 'private.public_ai_rate_limit_buckets', 'insert'), 'anon cannot write rate buckets');
select ok(not has_table_privilege('authenticated', 'private.public_ai_rate_limit_buckets', 'select'), 'authenticated users cannot read rate buckets');
select ok(not has_table_privilege('service_role', 'private.public_ai_rate_limit_buckets', 'select'), 'service role uses only the controlled limiter function');
select ok((select relrowsecurity from pg_class where oid = 'private.public_ai_active_leases'::regclass), 'active visitor leases have RLS enabled');
select ok(not has_table_privilege('anon', 'private.public_ai_active_leases', 'select'), 'anon cannot read active visitor leases');
select ok(has_function_privilege('service_role', 'public.consume_public_ai_rate_limit(text,integer,integer)', 'execute'), 'service role can consume the limiter RPC');
select ok(not has_function_privilege('anon', 'public.consume_public_ai_rate_limit(text,integer,integer)', 'execute'), 'anon cannot call the limiter RPC');
select ok(not has_function_privilege('authenticated', 'public.consume_public_ai_rate_limit(text,integer,integer)', 'execute'), 'authenticated users cannot call the limiter RPC');
select ok(has_function_privilege('service_role', 'public.acquire_public_ai_lease(text)', 'execute'), 'service role can acquire a visitor lease');
select ok(has_function_privilege('service_role', 'public.release_public_ai_lease(text)', 'execute'), 'service role can release a visitor lease');
select ok(not has_function_privilege('anon', 'public.acquire_public_ai_lease(text)', 'execute'), 'anon cannot acquire a visitor lease');
select ok(has_function_privilege('anon', 'public.public_ai_profile()', 'execute'), 'anon can call the safe public AI profile projection');
select ok(has_function_privilege('anon', 'public.public_ai_project_list()', 'execute'), 'anon can call the safe public AI project projection');
select is(
  (select pg_get_expr(d.adbin, d.adrelid)
   from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.profiles'::regclass and a.attname = 'public_ai_assistant_enabled'),
  'false', 'the owner assistant setting defaults to off');

set local role service_role;
select set_config('public_ai.first_request', public.consume_public_ai_rate_limit(repeat('a', 64), 1, 100)::text, true);
select set_config('public_ai.visitor_limit', public.consume_public_ai_rate_limit(repeat('a', 64), 1, 100)::text, true);
select set_config('public_ai.daily_limit', public.consume_public_ai_rate_limit(repeat('b', 64), 5, 1)::text, true);
select set_config('public_ai.lease_acquired', public.acquire_public_ai_lease(repeat('c', 64))::text, true);
select set_config('public_ai.lease_contended', public.acquire_public_ai_lease(repeat('c', 64))::text, true);
select public.release_public_ai_lease(repeat('c', 64));
select set_config('public_ai.lease_released', public.acquire_public_ai_lease(repeat('c', 64))::text, true);
select public.release_public_ai_lease(repeat('c', 64));
reset role;
select ok(current_setting('public_ai.first_request') = 'true', 'first request fits the visitor and daily limits');
select ok(current_setting('public_ai.visitor_limit') = 'false', 'visitor limit rejects the next request');
select ok(current_setting('public_ai.daily_limit') = 'false', 'global daily limit rejects another visitor');
select ok(current_setting('public_ai.lease_acquired') = 'true', 'first request acquires the visitor lease');
select ok(current_setting('public_ai.lease_contended') = 'false', 'concurrent request cannot acquire an active visitor lease');
select ok(current_setting('public_ai.lease_released') = 'true', 'released visitor lease can be acquired again');

select * from finish();
rollback;
