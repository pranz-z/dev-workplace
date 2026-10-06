-- Local pgTAP suite only; all fixtures roll back. Apply folder-browser migration first.
begin;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='private.google_drive_folder_registry'::regclass), 'folder registry has RLS');
select ok(not has_table_privilege('authenticated','private.google_drive_folder_registry','SELECT'), 'browser cannot read registry');
select ok(not has_function_privilege('authenticated','public.reserve_google_drive_folder(uuid,text,text,text,text,text)','EXECUTE'), 'browser cannot reserve folders');
select ok(not has_function_privilege('anon','public.reserve_google_drive_folder(uuid,text,text,text,text,text)','EXECUTE'), 'anon cannot reserve folders');
select ok(has_function_privilege('service_role','public.reserve_google_drive_folder(uuid,text,text,text,text,text)','EXECUTE'), 'server can reserve folders');
insert into auth.users(instance_id,id,aud,role,email) values
 ('00000000-0000-0000-0000-000000000000','dddddddd-0000-4000-8000-000000000001','authenticated','authenticated','drive-folders-a@example.com'),
 ('00000000-0000-0000-0000-000000000000','eeeeeeee-0000-4000-8000-000000000002','authenticated','authenticated','drive-folders-b@example.com');
insert into public.projects(id,user_id,slug,title,status,workflow_stage,visibility) values
 ('dddddddd-0000-4000-8000-000000000101','dddddddd-0000-4000-8000-000000000001','drive-folder-a','Project A','Planning','planning','Private');
insert into public.external_files(id,user_id,provider_file_id,name,mime_type,project_id,is_project_folder) values
 ('dddddddd-0000-4000-8000-000000000201','dddddddd-0000-4000-8000-000000000001','project-folder-a','Project A','application/vnd.google-apps.folder','dddddddd-0000-4000-8000-000000000101',true),
 ('eeeeeeee-0000-4000-8000-000000000202','eeeeeeee-0000-4000-8000-000000000002','custom-folder-b','Folder B','application/vnd.google-apps.folder',null,false);
select is((select drive_file_id from public.reserve_google_drive_folder('dddddddd-0000-4000-8000-000000000001','account-a','project:test','candidate-one','root')),'candidate-one','first reservation wins');
select is((select drive_file_id from public.reserve_google_drive_folder('dddddddd-0000-4000-8000-000000000001','account-a','project:test','candidate-two','root')),'candidate-one','retry cannot change canonical ID');
select is((select count(*)::integer from public.reserve_google_drive_folder('eeeeeeee-0000-4000-8000-000000000002','account-a','project:test',null,null)),0,'registry lookup is owner scoped');
set local role authenticated;
set local request.jwt.claims='{"sub":"dddddddd-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$insert into public.external_files(id,provider_file_id,name,mime_type,project_id,parent_id) values('dddddddd-0000-4000-8000-000000000203','assets-a','Assets','application/vnd.google-apps.folder','dddddddd-0000-4000-8000-000000000101','dddddddd-0000-4000-8000-000000000201')$$,'same-owner/project custom folder allowed');
select throws_ok($$insert into public.external_files(provider_file_id,name,mime_type,parent_id) values('forged-parent','Bad','text/plain','eeeeeeee-0000-4000-8000-000000000202')$$,'23514',null,'foreign owner folder cannot be parent');
select throws_ok($$insert into public.external_files(provider_file_id,name,mime_type,parent_id) values('wrong-project','Bad','text/plain','dddddddd-0000-4000-8000-000000000201')$$,'23514',null,'parent and child projects must match');
select throws_ok($$update public.external_files set parent_id=id where id='dddddddd-0000-4000-8000-000000000203'$$,'23514',null,'self-parent cycle rejected');
reset role;
select * from finish();
rollback;
