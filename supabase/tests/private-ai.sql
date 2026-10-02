-- Phase 6A private-AI limiter security and behavior checks.
-- Run with: supabase test db
begin;

select no_plan();

select ok((select relrowsecurity from pg_class where oid = 'private.private_ai_rate_limit_buckets'::regclass), 'private AI rate buckets have RLS enabled');
select ok(not has_table_privilege('anon', 'private.private_ai_rate_limit_buckets', 'select'), 'anon cannot read private AI counters');
select ok(not has_table_privilege('authenticated', 'private.private_ai_rate_limit_buckets', 'select'), 'users cannot read private AI counters');
select ok(not has_table_privilege('service_role', 'private.private_ai_rate_limit_buckets', 'select'), 'service role uses only the controlled limiter RPC');
select ok(exists (select 1 from pg_indexes where schemaname = 'private' and indexname = 'private_ai_rate_limit_buckets_bucket_start_idx'), 'private AI expiry cleanup has a timestamp index');
select ok(exists (select 1 from pg_indexes where schemaname = 'private' and indexname = 'public_ai_rate_limit_buckets_bucket_start_idx'), 'public AI expiry cleanup has a timestamp index');
select ok(exists (select 1 from pg_indexes where schemaname = 'private' and indexname = 'public_ai_active_leases_expires_at_idx'), 'public AI lease cleanup has an expiry index');
select ok(has_function_privilege('service_role', 'public.consume_private_ai_rate_limit(uuid,integer,integer)', 'execute'), 'service role can consume the private limiter RPC');
select ok(not has_function_privilege('anon', 'public.consume_private_ai_rate_limit(uuid,integer,integer)', 'execute'), 'anon cannot consume the private limiter RPC');
select ok(not has_function_privilege('authenticated', 'public.consume_private_ai_rate_limit(uuid,integer,integer)', 'execute'), 'authenticated users cannot consume the private limiter RPC');

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'private-ai-user-a@example.com'),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'private-ai-user-b@example.com'),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'private-ai-user-c@example.com');

set local role service_role;
select set_config('private_ai.first_user_request', public.consume_private_ai_rate_limit('aaaaaaaa-0000-4000-8000-000000000001', 1, 100)::text, true);
select set_config('private_ai.minute_limit', public.consume_private_ai_rate_limit('aaaaaaaa-0000-4000-8000-000000000001', 1, 100)::text, true);
select set_config('private_ai.other_user', public.consume_private_ai_rate_limit('aaaaaaaa-0000-4000-8000-000000000002', 1, 100)::text, true);
select set_config('private_ai.daily_first', public.consume_private_ai_rate_limit('aaaaaaaa-0000-4000-8000-000000000003', 20, 1)::text, true);
select set_config('private_ai.daily_limit', public.consume_private_ai_rate_limit('aaaaaaaa-0000-4000-8000-000000000003', 20, 1)::text, true);
reset role;

select ok(current_setting('private_ai.first_user_request') = 'true', 'first request fits both user limits');
select ok(current_setting('private_ai.minute_limit') = 'false', 'per-user minute limit rejects an excess request');
select ok(current_setting('private_ai.other_user') = 'true', 'limits are isolated between authenticated users');
select ok(current_setting('private_ai.daily_first') = 'true', 'first request fits the per-user daily limit');
select ok(current_setting('private_ai.daily_limit') = 'false', 'per-user daily limit rejects an excess request');

select * from finish();
rollback;
