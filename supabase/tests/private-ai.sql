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
select ok((select relrowsecurity from pg_class where oid = 'private.private_ai_active_leases'::regclass), 'private AI active leases have RLS enabled');
select ok(not has_table_privilege('anon', 'private.private_ai_active_leases', 'select'), 'anon cannot read private AI leases');
select ok(not has_table_privilege('authenticated', 'private.private_ai_active_leases', 'select'), 'users cannot read private AI leases');
select ok(not has_table_privilege('service_role', 'private.private_ai_active_leases', 'select'), 'service role uses only the lease RPCs');
select ok(exists (select 1 from pg_indexes where schemaname = 'private' and indexname = 'private_ai_active_leases_expires_at_idx'), 'private AI leases can prune expired records by index');
select ok(has_function_privilege('service_role', 'public.acquire_private_ai_lease(uuid,uuid,integer)', 'execute'), 'service role can acquire a private AI lease');
select ok(has_function_privilege('service_role', 'public.release_private_ai_lease(uuid,uuid)', 'execute'), 'service role can release a private AI lease');
select ok(not has_function_privilege('anon', 'public.acquire_private_ai_lease(uuid,uuid,integer)', 'execute'), 'anon cannot acquire private AI leases');
select ok(not has_function_privilege('authenticated', 'public.acquire_private_ai_lease(uuid,uuid,integer)', 'execute'), 'users cannot acquire private AI leases directly');
select ok(not has_function_privilege('anon', 'public.release_private_ai_lease(uuid,uuid)', 'execute'), 'anon cannot release private AI leases');
select ok(not has_function_privilege('authenticated', 'public.release_private_ai_lease(uuid,uuid)', 'execute'), 'users cannot release private AI leases directly');

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
select set_config('private_ai.lease_first', public.acquire_private_ai_lease('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 90)::text, true);
select set_config('private_ai.lease_duplicate', public.acquire_private_ai_lease('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 90)::text, true);
select set_config('private_ai.lease_other_user', public.acquire_private_ai_lease('aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000003', 90)::text, true);
select set_config('private_ai.lease_wrong_release', public.release_private_ai_lease('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002')::text, true);
select set_config('private_ai.lease_release', public.release_private_ai_lease('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001')::text, true);
select set_config('private_ai.lease_after_release', public.acquire_private_ai_lease('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000004', 90)::text, true);
reset role;

select ok(current_setting('private_ai.first_user_request') = 'true', 'first request fits both user limits');
select ok(current_setting('private_ai.minute_limit') = 'false', 'per-user minute limit rejects an excess request');
select ok(current_setting('private_ai.other_user') = 'true', 'limits are isolated between authenticated users');
select ok(current_setting('private_ai.daily_first') = 'true', 'first request fits the per-user daily limit');
select ok(current_setting('private_ai.daily_limit') = 'false', 'per-user daily limit rejects an excess request');
select ok(current_setting('private_ai.lease_first') = 'true', 'first active lease is acquired');
select ok(current_setting('private_ai.lease_duplicate') = 'false', 'same user cannot acquire a second unexpired lease');
select ok(current_setting('private_ai.lease_other_user') = 'true', 'active leases are isolated between users');
select ok(current_setting('private_ai.lease_wrong_release') = 'false', 'a stale or mismatched lease ID cannot release the active lease');
select ok(current_setting('private_ai.lease_release') = 'true', 'matching lease ID releases the active lease');
select ok(current_setting('private_ai.lease_after_release') = 'true', 'a released lease allows the next request');

select * from finish();
rollback;
