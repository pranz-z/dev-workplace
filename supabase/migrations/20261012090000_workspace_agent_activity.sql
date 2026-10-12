-- Read-only access to existing private audit history. No new retention or browser grants.
create function private.agent_activity_run(p_user_id uuid,p_run_id uuid,p_detail boolean default false)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'createdAt',r.created_at,'completedAt',r.completed_at,
 'actionCount',(select count(*) from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id),
 'primaryEntityLabel',(select a.title from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id order by a.created_at,a.id limit 1),
 'counts',(select jsonb_build_object('pending',count(*) filter(where a.status='pending'),'applied',count(*) filter(where a.status='applied'),'cancelled',count(*) filter(where a.status='cancelled'),'conflict',count(*) filter(where a.status='conflict'),'failed',count(*) filter(where a.status='failed')) from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id))
 || case when p_detail then jsonb_build_object('actions',coalesce((select jsonb_agg(jsonb_build_object(
 'id',a.id,'runId',a.run_id,'actionType',a.action_type,'entityId',a.entity_id,'projectId',a.project_id,
 'title',a.title,'status',a.status,'createdAt',a.created_at,'approvedAt',a.approved_at,'executedAt',a.executed_at,
 'errorCode',case when a.error_code in ('STALE_ENTITY','TIME_BLOCK_OVERLAP','FORBIDDEN','INVALID_INPUT','TIME_BLOCK_SAVE_FAILED','TASK_SAVE_FAILED') then a.error_code else null end,
 'diff',coalesce((select jsonb_agg(jsonb_build_object('field',d->>'field',
 'before',case when jsonb_typeof(d->'before')='string' then left(d->>'before',4000) end,
 'after',case when jsonb_typeof(d->'after')='string' then left(d->>'after',4000) end))
 from jsonb_array_elements(a.diff) d where d->>'field' in ('title','description','priority','status','dueDate','milestoneId','targetDate','startAt','endAt','projectId','taskId','kind')),'[]'::jsonb)
 ) order by a.created_at,a.id) from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id),'[]'::jsonb)) else '{}'::jsonb end
 from private.agent_runs r where r.id=p_run_id and r.user_id=p_user_id;
$$;
revoke all on function private.agent_activity_run(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function public.list_agent_activity(p_user_id uuid,p_limit integer default 20,p_cursor_created timestamptz default null,p_cursor_id uuid default null,p_status text default null,p_from timestamptz default null,p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_user_id is null or p_limit is null or p_limit not between 1 and 30 or
 (p_cursor_created is null)<>(p_cursor_id is null) or
 (p_cursor_created is not null and not isfinite(p_cursor_created)) or
 (p_from is not null and not isfinite(p_from)) or (p_to is not null and not isfinite(p_to)) or
 (p_from is not null and p_to is not null and p_to<=p_from) or
 (p_status is not null and p_status not in ('pending','applied','cancelled','conflict','failed')) then raise exception 'Invalid history query' using errcode='22023';end if;
 with candidates as (
 select r.id,r.created_at from private.agent_runs r where r.user_id=p_user_id
 and (p_from is null or r.created_at>=p_from) and (p_to is null or r.created_at<p_to)
 and (p_cursor_created is null or (r.created_at,r.id)<(p_cursor_created,p_cursor_id))
 and (p_status is null or exists(select 1 from private.agent_actions a where a.run_id=r.id and a.user_id=p_user_id and a.status=p_status))
 order by r.created_at desc,r.id desc limit p_limit+1
 ), page as (select * from candidates order by created_at desc,id desc limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(private.agent_activity_run(p_user_id,id,false) order by created_at desc,id desc) from page),'[]'::jsonb),
 'nextCursor',case when (select count(*) from candidates)>p_limit then (select jsonb_build_object('createdAt',created_at,'id',id) from page order by created_at,id limit 1) else null end) into result;
 return result;
end;$$;

create function public.get_agent_activity_run(p_user_id uuid,p_run_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select private.agent_activity_run(p_user_id,p_run_id,true);
$$;
revoke all on function public.list_agent_activity(uuid,integer,timestamptz,uuid,text,timestamptz,timestamptz),public.get_agent_activity_run(uuid,uuid) from public,anon,authenticated;
grant execute on function public.list_agent_activity(uuid,integer,timestamptz,uuid,text,timestamptz,timestamptz),public.get_agent_activity_run(uuid,uuid) to service_role;
