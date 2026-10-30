-- Exact one-shot permission; no persistent AI consent or scheduler settings change.
create table private.agent_pulse_one_shot_authorizations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null, observation_id uuid not null, content_revision bigint not null check(content_revision>0),
 episode bigint not null check(episode>0), family text not null check(family in ('deadline','important_work','quiet_project')),
 source_token text not null check(source_token~'^[0-9a-f]{64}$'), context_fingerprint text not null check(context_fingerprint~'^[0-9a-f]{64}$'),
 natural_slot timestamptz not null check(isfinite(natural_slot) and mod(extract(epoch from natural_slot),14400)=0),
 provider text not null check(provider='gemini'), model text not null check(length(model) between 1 and 120 and model!~'[[:cntrl:]]'),
 authorization_version text not null default 'one-shot-v1' check(authorization_version='one-shot-v1'),
 context_policy_version text not null default 'one-shot-v1' check(context_policy_version='one-shot-v1'),
 max_provider_requests integer not null default 1 check(max_provider_requests=1), settings_revision bigint not null check(settings_revision>0),
 status text not null default 'pending' check(status in ('pending','consumed','completed','blocked','expired','cancelled','failed')),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 consumed_at timestamptz,terminal_at timestamptz,terminal_reason text check(terminal_reason in (
 'PARENT_CHANGED','PARENT_SEEN','PARENT_RESOLVED','SOURCE_CHANGED','EVIDENCE_EXPIRED','MODEL_CHANGED','BUDGET','ATTEMPT_LIMIT',
 'SLOT_INVALID','SLOT_EXPIRED','AUTHORITY_LOST','CANCELLED','SOURCE_CLEARED','NO_NATURAL_DISPATCH','PROVIDER_FAILED',
 'OUTPUT_REJECTED','PUBLICATION_FAILED','TRANSPORT_UNKNOWN','CAPACITY','POLICY_CHANGED')),
 pulse_id uuid,admission_hash text check(admission_hash~'^[0-9a-f]{64}$'),provider_reservation_id uuid unique,
 send_attempted_at timestamptz,transport_state text not null default 'not_started' check(transport_state in ('not_started','unknown','confirmed')),
 response_received_at timestamptz,output_status text not null default 'none' check(output_status in ('none','accepted','rejected')),
 publication_completed_at timestamptz,
 unique(id,user_id),unique(pulse_id),
 check(isfinite(created_at) and isfinite(expires_at) and expires_at>natural_slot and expires_at<=natural_slot+interval '600 seconds'),
 check((pulse_id is null)=(admission_hash is null)),
 check((consumed_at is null)=(provider_reservation_id is null)),
 check((status in ('pending','consumed'))=(terminal_at is null)),
 check(status<>'consumed' or consumed_at is not null),
 check(status<>'completed' or (consumed_at is not null and publication_completed_at is not null))
);
create unique index agent_pulse_one_shot_pending_owner on private.agent_pulse_one_shot_authorizations(user_id) where status='pending';
create index agent_pulse_one_shot_retention on private.agent_pulse_one_shot_authorizations(user_id,terminal_at);
alter table private.agent_pulse_one_shot_authorizations enable row level security;
revoke all on private.agent_pulse_one_shot_authorizations from public,anon,authenticated,service_role;

create function private.agent_pulse_one_shot_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if (new.id,new.user_id,new.project_id,new.observation_id,new.content_revision,new.episode,new.family,new.source_token,new.context_fingerprint,
   new.natural_slot,new.provider,new.model,new.authorization_version,new.context_policy_version,new.max_provider_requests,new.settings_revision,new.created_at,new.expires_at)
   is distinct from (old.id,old.user_id,old.project_id,old.observation_id,old.content_revision,old.episode,old.family,old.source_token,old.context_fingerprint,
   old.natural_slot,old.provider,old.model,old.authorization_version,old.context_policy_version,old.max_provider_requests,old.settings_revision,old.created_at,old.expires_at) then
   raise exception 'Immutable one-shot identity' using errcode='42501';
  end if;
  if old.status not in ('pending','consumed') and new is distinct from old then raise exception 'Terminal one-shot transition' using errcode='42501'; end if;
  if old.status='consumed' and new.status not in ('consumed','completed','failed','blocked') then raise exception 'Invalid one-shot transition' using errcode='42501'; end if;
  if old.status='pending' and new.status='completed' then raise exception 'Invalid one-shot transition' using errcode='42501'; end if;
  if old.pulse_id is not null and (new.pulse_id,new.admission_hash) is distinct from (old.pulse_id,old.admission_hash) then raise exception 'Immutable admission' using errcode='42501'; end if;
  if old.consumed_at is not null and (new.consumed_at,new.provider_reservation_id) is distinct from (old.consumed_at,old.provider_reservation_id) then raise exception 'Immutable consumption' using errcode='42501'; end if;
 end if;
 return new;
end;$$;
create trigger agent_pulse_one_shot_guard before update on private.agent_pulse_one_shot_authorizations for each row execute function private.agent_pulse_one_shot_guard();

-- Shared current-parent proof. Permission is deliberately checked by separate normal/one-shot admission wrappers.
create function private.agent_pulse_parent_current(p_owner uuid,o private.agent_observations,tick timestamptz,p_unseen boolean default true)
returns boolean language plpgsql stable set search_path='' as $$
declare source jsonb; project uuid;
begin
 if o.user_id is distinct from p_owner or o.kind is distinct from 'signal' or o.state is distinct from 'active' or o.evidence_valid_until<=tick
  or o.last_checked_at<=tick-interval '24 hours' or o.evidence->>'complete' is distinct from 'true' or (p_unseen and o.seen_content_revision>=o.content_revision) then return false; end if;
 source:=private.agent_pulse_source_projection(p_owner,(o.evidence->>'evaluatedAt')::timestamptz,
  jsonb_build_array(jsonb_build_object('key',o.condition_key,'target',jsonb_build_object('type',o.target_type,'id',o.target_id))));
 if source->'sourceTokens'->>o.condition_key is distinct from o.source_token then return false; end if;
 if o.target_type='project' then select id into project from public.projects where id=o.target_id and user_id=p_owner;
 elsif o.target_type='task' then select t.project_id into project from public.tasks t join public.projects p on p.id=t.project_id and p.user_id=p_owner where t.id=o.target_id and t.user_id=p_owner;
 elsif o.target_type='milestone' then select m.project_id into project from public.milestones m join public.projects p on p.id=m.project_id and p.user_id=p_owner where m.id=o.target_id;
 else return false; end if;
 return project is not null;
end;$$;

create function private.agent_pulse_one_shot_dto(a private.agent_pulse_one_shot_authorizations,tick timestamptz)
returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('binding',jsonb_build_object('id',a.id,'ownerId',a.user_id,'projectId',a.project_id,'parentId',a.observation_id,
 'contentRevision',a.content_revision,'episode',a.episode,'family',a.family,'sourceToken',a.source_token,'contextFingerprint',a.context_fingerprint,
 'provider',a.provider,'model',a.model,'slot',private.agent_pulse_stamp(a.natural_slot),'expiresAt',private.agent_pulse_stamp(a.expires_at),
 'settingsRevision',a.settings_revision,'authorizationVersion',a.authorization_version,'contextPolicyVersion',a.context_policy_version),
 'status',case when a.status='pending' and tick>=a.expires_at then 'expired' when a.status='consumed' and tick>=a.expires_at then 'failed' else a.status end,
 'reason',case when a.status='pending' and tick>=a.expires_at then 'SLOT_EXPIRED' when a.status='consumed' and tick>=a.expires_at then 'TRANSPORT_UNKNOWN' else a.terminal_reason end,
 'createdAt',private.agent_pulse_stamp(a.created_at),'consumedAt',private.agent_pulse_stamp(a.consumed_at),'terminalAt',private.agent_pulse_stamp(coalesce(a.terminal_at,case when tick>=a.expires_at then a.expires_at end)),
 'accounting',jsonb_build_object('allowanceConsumed',a.consumed_at is not null,'sendAttempted',a.send_attempted_at is not null,'transport',a.transport_state,
 'responseReceived',a.response_received_at is not null,'output',a.output_status,'publicationCompleted',a.publication_completed_at is not null));
$$;

create function public.agent_pulse_one_shot_preview(p_user_id uuid,p_parent_id uuid) returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='5s' as $$
declare s private.agent_pulse_state;o private.agent_observations;source jsonb;project uuid;slot timestamptz;tick timestamptz:=clock_timestamp();
begin
 select * into s from private.agent_pulse_state where user_id=p_user_id;
 if not found or s.mode<>'workspace' or s.checks_consent_version is distinct from 'checks-v1' or s.ai_consent_version is not null or cardinality(s.ai_project_ids)<>0 then return null; end if;
 slot:=date_bin(interval '4 hours',tick,timestamptz '1970-01-01')+interval '4 hours';
 if s.next_due_at is distinct from slot then return null; end if;
 select * into o from private.agent_observations where id=p_parent_id and user_id=p_user_id;
 if not found or o.family not in ('deadline','important_work','quiet_project') or o.target_type='workspace_day'
  or o.evidence_valid_until<=slot or o.ai_attempt_terminal or o.ai_attempt_count>=2 or not private.agent_pulse_parent_current(p_user_id,o,tick) then return null; end if;
 if o.target_type='project' then project:=o.target_id;
 elsif o.target_type='task' then select project_id into project from public.tasks where id=o.target_id and user_id=p_user_id;
 else select m.project_id into project from public.milestones m join public.projects p on p.id=m.project_id and p.user_id=p_user_id where m.id=o.target_id; end if;
 if project is null then return null; end if;
 source:=private.agent_pulse_source_projection(p_user_id,tick,jsonb_build_array(jsonb_build_object('id',o.id,'episode',o.episode,'key',o.condition_key,
  'target',jsonb_build_object('type',o.target_type,'id',o.target_id),'family',o.family,'state',o.state,'materialFingerprint',o.material_fingerprint,
  'sourceToken',o.source_token,'evidenceValidUntil',private.agent_pulse_stamp(o.evidence_valid_until),'rowRevision',o.row_revision,'contentRevision',o.content_revision,
  'attemptCount',o.ai_attempt_count,'attemptTerminal',o.ai_attempt_terminal,'seen',false,'lastCheckedAt',private.agent_pulse_stamp(o.last_checked_at))));
 return jsonb_build_object('binding',jsonb_build_object('id',o.id,'ownerId',p_user_id,'projectId',project,'parentId',o.id,'contentRevision',o.content_revision,
  'episode',o.episode,'family',o.family,'sourceToken',o.source_token,'slot',private.agent_pulse_stamp(slot),
  'expiresAt',private.agent_pulse_stamp(least(o.evidence_valid_until,slot+interval '600 seconds')),'settingsRevision',s.settings_revision,
  'provider','gemini','authorizationVersion','one-shot-v1','contextPolicyVersion','one-shot-v1'),
  'source',source,'projectTitle',(select left(title,120) from public.projects where id=project and user_id=p_user_id),
  'signalTitle',left(o.title,120),'evidenceValidUntil',private.agent_pulse_stamp(o.evidence_valid_until));
end;$$;

create function public.agent_pulse_one_shot_create(p_user_id uuid,p_parent_id uuid,p_revision bigint,p_slot timestamptz,p_model text,p_source_token text,p_context_fingerprint text,p_expected_binding jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare v jsonb;a private.agent_pulse_one_shot_authorizations;tick timestamptz;
begin
 perform pg_advisory_xact_lock(505,5);
 perform 1 from private.agent_pulse_state where user_id=p_user_id for update;
 perform 1 from private.agent_observations where id=p_parent_id and user_id=p_user_id for update;
 tick:=clock_timestamp();
 update private.agent_pulse_one_shot_authorizations set status='expired',terminal_at=tick,terminal_reason='SLOT_EXPIRED' where user_id=p_user_id and status='pending' and expires_at<=tick;
 delete from private.agent_pulse_one_shot_authorizations where user_id=p_user_id and terminal_at<tick-interval '30 days';
 if (select count(*) from private.agent_pulse_one_shot_authorizations where user_id=p_user_id)>=200 then raise exception 'CAPACITY'; end if;
 if exists(select 1 from private.agent_pulse_one_shot_authorizations where user_id=p_user_id and status='pending') then raise exception 'An existing pending authorization requires cancellation'; end if;
 v:=public.agent_pulse_one_shot_preview(p_user_id,p_parent_id);
 if v is null or (v->'binding'->>'contentRevision')::bigint is distinct from p_revision or (v->'binding'->>'slot')::timestamptz is distinct from p_slot
  or v->'binding'->>'sourceToken' is distinct from p_source_token then raise exception 'SOURCE_OR_SLOT_CHANGED' using errcode='40001'; end if;
 if p_expected_binding is distinct from ((v->'binding')||jsonb_build_object('model',p_model,'contextFingerprint',p_context_fingerprint)) then raise exception 'REVIEWED_BINDING_CHANGED' using errcode='40001';end if;
 if p_model is null or length(p_model) not between 1 and 120 or p_model~'[[:cntrl:]]' or p_context_fingerprint is null or p_context_fingerprint!~'^[0-9a-f]{64}$' then raise exception 'Invalid one-shot model/context'; end if;
 insert into private.agent_pulse_one_shot_authorizations(user_id,project_id,observation_id,content_revision,episode,family,source_token,context_fingerprint,natural_slot,provider,model,settings_revision,expires_at)
 values(p_user_id,(v->'binding'->>'projectId')::uuid,p_parent_id,p_revision,(v->'binding'->>'episode')::bigint,v->'binding'->>'family',p_source_token,p_context_fingerprint,p_slot,'gemini',p_model,
  (v->'binding'->>'settingsRevision')::bigint,(v->'binding'->>'expiresAt')::timestamptz) returning * into a;
 return private.agent_pulse_one_shot_dto(a,tick);
end;$$;

create function public.agent_pulse_one_shot_list(p_user_id uuid) returns jsonb language sql stable security definer set search_path='' set statement_timeout='5s' as $$
select jsonb_build_object('items',coalesce((select jsonb_agg(private.agent_pulse_one_shot_dto(a,clock_timestamp())||jsonb_build_object(
 'projectTitle',(select left(p.title,120) from public.projects p where p.id=a.project_id and p.user_id=p_user_id),
 'signalTitle',(select left(nullif(private.agent_pulse_safe_observation(o,clock_timestamp())->>'title',''),120) from private.agent_observations o where o.id=a.observation_id and o.user_id=p_user_id)) order by a.created_at desc,a.id)
 from(select * from private.agent_pulse_one_shot_authorizations where user_id=p_user_id order by created_at desc,id limit 20)a),'[]'::jsonb),
 'candidateIds',coalesce((select jsonb_agg(id) from(select o.id from private.agent_observations o where user_id=p_user_id and kind='signal' and state='active'
  and seen_content_revision<content_revision and family in ('deadline','important_work','quiet_project') order by rank,last_changed_at desc,id limit 20)o),'[]'::jsonb));
$$;

create function public.agent_pulse_one_shot_cancel(p_user_id uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare a private.agent_pulse_one_shot_authorizations;tick timestamptz;
begin
 perform pg_advisory_xact_lock(505,5);perform 1 from private.agent_pulse_state where user_id=p_user_id for update;
 select * into a from private.agent_pulse_one_shot_authorizations where id=p_id and user_id=p_user_id for update;
 if not found then return null; end if;tick:=clock_timestamp();
 if a.status='pending' then update private.agent_pulse_one_shot_authorizations set status=case when expires_at<=tick then 'expired' else 'cancelled' end,
  terminal_at=tick,terminal_reason=case when expires_at<=tick then 'SLOT_EXPIRED' else 'CANCELLED' end where id=a.id returning * into a;end if;
 return private.agent_pulse_one_shot_dto(a,tick);
end;$$;

revoke all on function private.agent_pulse_one_shot_guard(),private.agent_pulse_parent_current(uuid,private.agent_observations,timestamptz,boolean),
 private.agent_pulse_one_shot_dto(private.agent_pulse_one_shot_authorizations,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.agent_pulse_one_shot_preview(uuid,uuid),public.agent_pulse_one_shot_create(uuid,uuid,bigint,timestamptz,text,text,text,jsonb),public.agent_pulse_one_shot_list(uuid),public.agent_pulse_one_shot_cancel(uuid,uuid) from public,anon,authenticated;
grant execute on function public.agent_pulse_one_shot_preview(uuid,uuid),public.agent_pulse_one_shot_create(uuid,uuid,bigint,timestamptz,text,text,text,jsonb),public.agent_pulse_one_shot_list(uuid),public.agent_pulse_one_shot_cancel(uuid,uuid) to service_role;

-- Fresh-only credential: replay keeps the original DTO and cannot recover plaintext.
create or replace function public.agent_pulse_claim_dispatch(p_slot timestamptz,p_nonce uuid,p_issued_at timestamptz,p_processing_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare tick timestamptz:=clock_timestamp(); event private.agent_pulse_installation_events; owners uuid[]; state_row private.agent_pulse_state;
  pulse_row private.agent_pulses; claims jsonb:='[]'; n integer:=0; outcome text; one_shot private.agent_pulse_one_shot_authorizations; credential text; zone text; now_epoch bigint; issued_epoch bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(505,5);
  if p_processing_enabled is null or p_nonce is null or p_slot is null or not isfinite(p_slot) or p_issued_at is null or not isfinite(p_issued_at)
    or p_slot<>date_bin(interval '4 hours',tick,timestamptz '1970-01-01') or p_issued_at<>date_trunc('second',p_issued_at) then
    raise exception 'Invalid dispatch identity' using errcode='22023';
  end if;
  now_epoch:=floor(extract(epoch from tick))::bigint;
  issued_epoch:=extract(epoch from p_issued_at)::bigint;
  if issued_epoch<now_epoch-600 or issued_epoch>now_epoch+60 then
    raise exception 'Invalid dispatch identity' using errcode='22023';
  end if;
  select * into event from private.agent_pulse_installation_events where event_kind='dispatch_slot' and scheduled_slot=p_slot;
  if found then
    select coalesce(jsonb_agg(private.agent_pulse_authority_dto(p) order by p.user_id,p.id),'[]') into claims from private.agent_pulses p
      where p.scheduled_slot=p_slot and private.agent_pulse_hash(to_jsonb(p.dispatch_nonce::text))=event.nonce_fingerprint;
    return jsonb_build_object('slot',private.agent_pulse_stamp(p_slot),'replay',true,'outcome',event.dispatch_outcome,'claimCount',event.claim_count,'claims',claims);
  end if;
  if not p_processing_enabled then
    insert into private.agent_pulse_installation_events(event_kind,scheduled_slot,nonce_fingerprint,dispatch_outcome,claim_count)
      values('dispatch_slot',p_slot,private.agent_pulse_hash(to_jsonb(p_nonce::text)),'disabled',0);
    return jsonb_build_object('slot',private.agent_pulse_stamp(p_slot),'replay',false,'outcome','disabled','claimCount',0,'claims','[]'::jsonb);
  end if;
  select array_agg(user_id order by user_id) into owners from (
    select s.user_id from private.agent_pulse_state s where s.mode<>'off' and s.checks_consent_version='checks-v1' and s.policy_version='pulse-v1'
      and s.next_due_at<=tick and (s.lease_expires_at is null or s.lease_expires_at<=tick)
      and not exists(select 1 from private.agent_pulses p where p.user_id=s.user_id and p.status='running' and p.lease_expires_at>tick)
      and (select count(*) from private.agent_pulses p where p.user_id=s.user_id and p.started_at>tick-interval '24 hours' and p.started_at<=tick)<6
    order by s.next_due_at,s.user_id limit 2) selected;
  -- Acquire the whole selected state set before any selected Pulse row.
  perform 1 from private.agent_pulse_state where user_id=any(owners) order by user_id for update;
  perform 1 from private.agent_pulses where user_id=any(owners) and status='running' order by id for update;
  for state_row in select * from private.agent_pulse_state where user_id=any(owners) order by user_id loop
    if state_row.mode='off' or state_row.checks_consent_version is distinct from 'checks-v1' or state_row.policy_version<>'pulse-v1' or state_row.next_due_at>tick
      or state_row.lease_expires_at>tick or exists(select 1 from private.agent_pulses x where x.user_id=state_row.user_id and x.status='running' and x.lease_expires_at>tick)
      or (select count(*) from private.agent_pulses x where x.user_id=state_row.user_id and x.started_at>tick-interval '24 hours' and x.started_at<=tick)>=6 then continue; end if;
    update private.agent_pulses set status='abandoned',completed_at=tick,ai_outcome=case when ai_outcome='reserved' then 'unknown' else ai_outcome end
      where user_id=state_row.user_id and status='running' and lease_expires_at<=tick;
    zone:=(select time_zone from public.profiles where id=state_row.user_id);
    insert into private.agent_pulses(user_id,scheduled_slot,dispatch_nonce,started_at,fence,lease_token,lease_expires_at,settings_revision,policy_version,time_zone_used)
      values(state_row.user_id,p_slot,p_nonce,tick,state_row.fence+1,gen_random_uuid(),tick+interval '90 seconds',state_row.settings_revision,state_row.policy_version,zone) returning * into pulse_row;
    update private.agent_pulse_state set fence=pulse_row.fence,lease_token=pulse_row.lease_token,lease_expires_at=pulse_row.lease_expires_at,
      next_due_at=p_slot+case when state_row.cadence='quiet' then interval '12 hours' else interval '4 hours' end,updated_at=tick where user_id=state_row.user_id;
    select * into one_shot from private.agent_pulse_one_shot_authorizations where user_id=state_row.user_id and natural_slot=p_slot and status='pending' for update;
    if found and one_shot.expires_at>tick then
      credential:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
      update private.agent_pulse_one_shot_authorizations set pulse_id=pulse_row.id,admission_hash=private.agent_pulse_hash(to_jsonb(credential)) where id=one_shot.id;
      claims:=claims||jsonb_build_array(private.agent_pulse_authority_dto(pulse_row)||jsonb_build_object('oneShotAdmission',jsonb_build_object('authorizationId',one_shot.id,'credential',credential)));
    else claims:=claims||jsonb_build_array(private.agent_pulse_authority_dto(pulse_row)); end if;
    n:=n+1;
  end loop;
  outcome:=case when n=0 then 'empty' else 'claimed' end;
  insert into private.agent_pulse_installation_events(event_kind,scheduled_slot,nonce_fingerprint,dispatch_outcome,claim_count)
    values('dispatch_slot',p_slot,private.agent_pulse_hash(to_jsonb(p_nonce::text)),outcome,n);
  return jsonb_build_object('slot',private.agent_pulse_stamp(p_slot),'replay',false,'outcome',outcome,'claimCount',n,'claims',claims);
end;$$;

create function private.agent_pulse_commit_ai_reservation(p private.agent_pulses,o private.agent_observations,tick timestamptz)
returns jsonb language plpgsql set search_path='' as $$
declare u jsonb;operation uuid;
begin
  if o.ai_attempt_terminal then return jsonb_build_object('reserved',false,'sendAllowed',false,'reason','AI_MALFORMED'); end if;
  if o.ai_attempt_count>=2 or (o.ai_attempt_count=1 and o.ai_last_attempt_at>tick-interval '12 hours') or exists(select 1 from private.agent_observations where user_id=p.user_id and parent_observation_id=o.id and parent_episode=o.episode) then
    return jsonb_build_object('reserved',false,'sendAllowed',false,'reason','BUDGET');
  end if;
  u:=private.agent_pulse_usage(p.user_id,tick);
  if (u->>'ownerRequests')::integer>=2 or (u->>'installationRequests')::integer>=4 then return jsonb_build_object('reserved',false,'sendAllowed',false,'reason','BUDGET'); end if;
  if clock_timestamp()>=p.lease_expires_at then raise exception 'AUTHORITY_LOST' using errcode='40001'; end if;
  operation:=gen_random_uuid();
  update private.agent_pulses set ai_reserved_at=tick,installation_reservation_key=operation,ai_outcome='reserved',ai_parent_id=o.id,ai_parent_episode=o.episode,ai_attempt_number=o.ai_attempt_count+1 where id=p.id;
  insert into private.agent_pulse_installation_events(event_kind,reservation_key,created_at) values('provider_reservation',operation,tick);
  update private.agent_observations set ai_attempt_count=ai_attempt_count+1,ai_last_attempt_at=tick where id=o.id;
  return jsonb_build_object('reserved',true,'recovered',false,'sendAllowed',true);
end;$$;

create or replace function public.agent_pulse_reserve_ai(p_user_id uuid,p_pulse_id uuid,p_lease_token uuid,p_fence bigint,p_settings_revision bigint,p_parent_id uuid,p_episode bigint)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare p private.agent_pulses; o private.agent_observations; u jsonb; tick timestamptz; operation uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(505,5);
  p:=private.agent_pulse_guard(p_user_id,p_pulse_id,p_lease_token,p_fence,p_settings_revision);
  if p.ai_reserved_at is not null then return jsonb_build_object('reserved',true,'recovered',true,'sendAllowed',false); end if;
  select * into o from private.agent_observations where id=p_parent_id and user_id=p_user_id for update;
  tick:=clock_timestamp();
  if not found or p.deterministic_commit_id is null or o.latest_pulse_id<>p.id or o.episode<>p_episode or not private.agent_pulse_ai_parent_eligible(p_user_id,o,tick) then
    return jsonb_build_object('reserved',false,'sendAllowed',false,'reason','SOURCE_CHANGED');
  end if;
  return private.agent_pulse_commit_ai_reservation(p,o,tick);
end;$$;

create function public.agent_pulse_one_shot_consume(p_user_id uuid,p_pulse_id uuid,p_lease_token uuid,p_fence bigint,p_settings_revision bigint,
 p_authorization_id uuid,p_credential text,p_provider text,p_model text,p_context_fingerprint text)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare a private.agent_pulse_one_shot_authorizations;p private.agent_pulses;o private.agent_observations;s private.agent_pulse_state;
 tick timestamptz;reason text;project uuid;r jsonb;
begin
 perform pg_advisory_xact_lock(505,5);
 select * into s from private.agent_pulse_state where user_id=p_user_id for update;
 perform 1 from private.agent_pulses where id=p_pulse_id and user_id=p_user_id for update;
 select * into a from private.agent_pulse_one_shot_authorizations where id=p_authorization_id and user_id=p_user_id;
 if not found then return jsonb_build_object('reserved',false,'sendAllowed',false);end if;
 select * into o from private.agent_observations where id=a.observation_id and user_id=p_user_id for update;
 select * into a from private.agent_pulse_one_shot_authorizations where id=p_authorization_id and user_id=p_user_id for update;
 tick:=clock_timestamp();
 if a.status<>'pending' or a.pulse_id is distinct from p_pulse_id or p_credential is null or length(p_credential)<>64
  or a.admission_hash is distinct from private.agent_pulse_hash(to_jsonb(p_credential)) then return jsonb_build_object('reserved',false,'sendAllowed',false);end if;
 if tick<a.natural_slot then return jsonb_build_object('reserved',false,'sendAllowed',false); end if;
 if tick>=a.expires_at then
  update private.agent_pulse_one_shot_authorizations set status='expired',terminal_at=tick,terminal_reason='SLOT_EXPIRED' where id=a.id;
  return jsonb_build_object('reserved',false,'sendAllowed',false,'reason','SLOT_EXPIRED');
 end if;
 begin p:=private.agent_pulse_guard(p_user_id,p_pulse_id,p_lease_token,p_fence,p_settings_revision);
 exception when serialization_failure then
  update private.agent_pulse_one_shot_authorizations set status='blocked',terminal_at=tick,terminal_reason='AUTHORITY_LOST' where id=a.id;
  return jsonb_build_object('reserved',false,'sendAllowed',false,'reason','AUTHORITY_LOST');
 end;
 if p.scheduled_slot is distinct from a.natural_slot or p.settings_revision<>a.settings_revision or p.deterministic_commit_id is null
  or not exists(select 1 from private.agent_pulse_installation_events e where e.event_kind='dispatch_slot' and e.scheduled_slot=p.scheduled_slot
   and e.dispatch_outcome='claimed' and e.nonce_fingerprint=private.agent_pulse_hash(to_jsonb(p.dispatch_nonce::text))) then reason:='AUTHORITY_LOST';
 elsif s.mode<>'workspace' or s.checks_consent_version is distinct from 'checks-v1' or s.ai_consent_version is not null or cardinality(s.ai_project_ids)<>0 then reason:='AUTHORITY_LOST';
 elsif a.provider is distinct from p_provider or a.model is distinct from p_model then reason:='MODEL_CHANGED';
 elsif a.context_fingerprint is distinct from p_context_fingerprint then reason:='SOURCE_CHANGED';
 elsif o.id is null or o.content_revision is distinct from a.content_revision or o.episode is distinct from a.episode or o.family is distinct from a.family then reason:='PARENT_CHANGED';
 elsif o.state<>'active' then reason:='PARENT_RESOLVED';
 elsif o.seen_content_revision>=o.content_revision then reason:='PARENT_SEEN';
 elsif o.evidence_valid_until<=tick then reason:='EVIDENCE_EXPIRED';
 elsif o.source_token<>a.source_token or o.latest_pulse_id<>p.id or not private.agent_pulse_parent_current(p_user_id,o,tick) then reason:='SOURCE_CHANGED';
 elsif o.ai_attempt_terminal or o.ai_attempt_count>=2 then reason:='ATTEMPT_LIMIT';
 elsif (private.agent_pulse_usage(p_user_id,tick)->>'ownerIdeas')::integer>=2 then reason:='BUDGET';
 end if;
 if reason is null then
  if o.target_type='project' then project:=o.target_id;
  elsif o.target_type='task' then select project_id into project from public.tasks where id=o.target_id and user_id=p_user_id;
  elsif o.target_type='milestone' then select m.project_id into project from public.milestones m join public.projects pr on pr.id=m.project_id and pr.user_id=p_user_id where m.id=o.target_id;end if;
  if project is distinct from a.project_id then reason:='SOURCE_CHANGED';end if;
 end if;
 if reason is not null then
  update private.agent_pulse_one_shot_authorizations set status='blocked',terminal_at=tick,terminal_reason=reason where id=a.id;
  return jsonb_build_object('reserved',false,'sendAllowed',false,'reason',reason);
 end if;
 r:=private.agent_pulse_commit_ai_reservation(p,o,tick);
 if r->>'sendAllowed'='true' then
  update private.agent_pulse_one_shot_authorizations set status='consumed',consumed_at=tick,
   provider_reservation_id=(select installation_reservation_key from private.agent_pulses where id=p.id) where id=a.id;
 else
  update private.agent_pulse_one_shot_authorizations set status='blocked',terminal_at=tick,
   terminal_reason=case when r->>'reason'='AI_MALFORMED' then 'ATTEMPT_LIMIT' else 'BUDGET' end where id=a.id;
 end if;
 return r;
end;$$;
revoke all on function private.agent_pulse_commit_ai_reservation(private.agent_pulses,private.agent_observations,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.agent_pulse_one_shot_consume(uuid,uuid,uuid,bigint,bigint,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.agent_pulse_one_shot_consume(uuid,uuid,uuid,bigint,bigint,uuid,text,text,text,text) to service_role;

-- This marker suppresses normal-AI fallthrough even for an expired/cancelled matching attempt.
-- It is not admission; only the initial fresh claim adds the separate secret credential.
create or replace function private.agent_pulse_authority_dto(p private.agent_pulses) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('userId',p.user_id,'pulseId',p.id,'slot',private.agent_pulse_stamp(p.scheduled_slot),'leaseToken',p.lease_token,
 'leaseExpiresAt',private.agent_pulse_stamp(p.lease_expires_at),'fence',p.fence,'settingsRevision',p.settings_revision,'policyVersion',p.policy_version)
 ||coalesce((select jsonb_build_object('oneShotAttemptId',a.id) from private.agent_pulse_one_shot_authorizations a where a.user_id=p.user_id and a.natural_slot=p.scheduled_slot
 order by (a.status='pending') desc,a.created_at desc,a.id limit 1),'{}'::jsonb);
$$;

create function public.agent_pulse_one_shot_context(p_user_id uuid,p_pulse_id uuid,p_lease_token uuid,p_fence bigint,p_authorization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='5s' as $$
declare p private.agent_pulses;a private.agent_pulse_one_shot_authorizations;o private.agent_observations;tick timestamptz:=clock_timestamp();source jsonb;
begin
 p:=private.agent_pulse_guard(p_user_id,p_pulse_id,p_lease_token,p_fence,null);
 select * into a from private.agent_pulse_one_shot_authorizations where id=p_authorization_id and user_id=p_user_id and natural_slot=p.scheduled_slot;
 if not found then return null;end if;
 select * into o from private.agent_observations where id=a.observation_id and user_id=p_user_id;
 if found then source:=private.agent_pulse_source_projection(p_user_id,tick,jsonb_build_array(jsonb_build_object('id',o.id,'episode',o.episode,'key',o.condition_key,
  'target',jsonb_build_object('type',o.target_type,'id',o.target_id),'family',o.family,'state',o.state,'materialFingerprint',o.material_fingerprint,
  'sourceToken',o.source_token,'evidenceValidUntil',private.agent_pulse_stamp(o.evidence_valid_until),'rowRevision',o.row_revision,'contentRevision',o.content_revision,
  'attemptCount',o.ai_attempt_count,'attemptTerminal',o.ai_attempt_terminal,'seen',o.seen_content_revision>=o.content_revision,'lastCheckedAt',private.agent_pulse_stamp(o.last_checked_at))));end if;
 return jsonb_build_object('authorization',private.agent_pulse_one_shot_dto(a,tick),'source',source);
end;$$;
revoke all on function public.agent_pulse_one_shot_context(uuid,uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.agent_pulse_one_shot_context(uuid,uuid,uuid,bigint,uuid) to service_role;

create function public.agent_pulse_one_shot_record(p_user_id uuid,p_pulse_id uuid,p_lease_token uuid,p_fence bigint,p_authorization_id uuid,p_event text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare a private.agent_pulse_one_shot_authorizations;p private.agent_pulses;o private.agent_observations;tick timestamptz;
begin
 perform pg_advisory_xact_lock(505,5);p:=private.agent_pulse_guard(p_user_id,p_pulse_id,p_lease_token,p_fence,null);
 select * into a from private.agent_pulse_one_shot_authorizations where id=p_authorization_id and user_id=p_user_id and pulse_id=p.id;
 if not found then return null;end if;
 select * into o from private.agent_observations where id=a.observation_id and user_id=p_user_id for update;
 select * into a from private.agent_pulse_one_shot_authorizations where id=p_authorization_id and user_id=p_user_id and pulse_id=p.id for update;
 tick:=clock_timestamp();
 if a.status not in ('pending','consumed') then return private.agent_pulse_one_shot_dto(a,tick);end if;
 if p_event='send_attempted' and (a.status<>'consumed' or tick>=a.expires_at or a.provider_reservation_id is distinct from p.installation_reservation_key
  or o.id is null or o.content_revision is distinct from a.content_revision or o.episode is distinct from a.episode or o.family is distinct from a.family
  or o.source_token is distinct from a.source_token or not private.agent_pulse_parent_current(p_user_id,o,tick)) then
  update private.agent_pulse_one_shot_authorizations set status=case when consumed_at is null then 'blocked' else 'failed' end,terminal_at=tick,
   terminal_reason=case when tick>=a.expires_at then 'EVIDENCE_EXPIRED' else 'SOURCE_CHANGED' end where id=a.id returning * into a;
  return private.agent_pulse_one_shot_dto(a,tick);
 end if;
 if p_event='blocked' or p_event='failed' or p_event='output_rejected' then
  update private.agent_pulse_one_shot_authorizations set status=case when consumed_at is null then 'blocked' else 'failed' end,terminal_at=tick,
   terminal_reason=coalesce(p_reason,'AUTHORITY_LOST'),output_status=case when p_event='output_rejected' then 'rejected' else output_status end where id=a.id returning * into a;
 elsif a.status='consumed' then
  if p_event='send_attempted' then
   if a.send_attempted_at is not null then raise exception 'Send already attempted' using errcode='40001';end if;
   update private.agent_pulse_one_shot_authorizations set send_attempted_at=tick,transport_state='unknown' where id=a.id returning * into a;
  elsif p_event='response_received' then
   if a.send_attempted_at is null then raise exception 'Send not attempted';end if;
   update private.agent_pulse_one_shot_authorizations set response_received_at=tick,transport_state='confirmed' where id=a.id returning * into a;
  elsif p_event='transport_unknown' then update private.agent_pulse_one_shot_authorizations set transport_state='unknown' where id=a.id returning * into a;
  elsif p_event='output_accepted' then update private.agent_pulse_one_shot_authorizations set output_status='accepted' where id=a.id returning * into a;
  else raise exception 'Invalid accounting event';end if;
 else raise exception 'Authorization not consumed';end if;
 return private.agent_pulse_one_shot_dto(a,tick);
end;$$;
revoke all on function public.agent_pulse_one_shot_record(uuid,uuid,uuid,bigint,uuid,text,text) from public,anon,authenticated;
grant execute on function public.agent_pulse_one_shot_record(uuid,uuid,uuid,bigint,uuid,text,text) to service_role;

alter table private.agent_observations add column one_shot_authorization_id uuid;
create function private.agent_pulse_one_shot_idea_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and old.one_shot_authorization_id is not null and new.one_shot_authorization_id is distinct from old.one_shot_authorization_id then
  raise exception 'Immutable accepted one-shot provenance' using errcode='42501';end if;
 if new.one_shot_authorization_id is not null and (tg_op='INSERT' or old.one_shot_authorization_id is null) then
  if new.kind<>'idea' or not exists(select 1 from private.agent_pulse_one_shot_authorizations a join private.agent_pulses p on p.id=a.pulse_id and p.user_id=a.user_id
   where a.id=new.one_shot_authorization_id and a.user_id=new.user_id and a.status='consumed' and a.consumed_at is not null
   and a.observation_id=new.parent_observation_id and a.episode=new.parent_episode and p.id=new.origin_pulse_id
   and a.provider_reservation_id=p.installation_reservation_key and p.ai_parent_id=new.parent_observation_id) then
    raise exception 'Accepted one-shot provenance requires canonical consumption' using errcode='42501';end if;
 end if;return new;
end;$$;
create trigger agent_pulse_one_shot_idea_guard before insert or update on private.agent_observations for each row execute function private.agent_pulse_one_shot_idea_guard();

create function private.agent_pulse_publication_allowed(p_owner uuid,p private.agent_pulses,o private.agent_observations,tick timestamptz)
returns boolean language plpgsql stable set search_path='' as $$
declare a private.agent_pulse_one_shot_authorizations;s private.agent_pulse_state;
begin
 select * into a from private.agent_pulse_one_shot_authorizations where pulse_id=p.id and user_id=p_owner;
 if not found then return private.agent_pulse_ai_parent_eligible(p_owner,o,tick);end if;
 select * into s from private.agent_pulse_state where user_id=p_owner;
 return a.status='consumed' and a.provider_reservation_id=p.installation_reservation_key and a.consumed_at is not null
  and a.output_status='accepted' and a.natural_slot=p.scheduled_slot and tick<a.expires_at and a.settings_revision=p.settings_revision
  and a.observation_id=o.id and a.content_revision=o.content_revision and a.episode=o.episode and a.family=o.family
  and a.source_token=o.source_token and p.ai_parent_id=o.id and s.mode='workspace' and s.ai_consent_version is null
  and cardinality(s.ai_project_ids)=0 and private.agent_pulse_parent_current(p_owner,o,tick);
end;$$;
create function private.agent_pulse_idea_read_allowed(idea private.agent_observations,parent private.agent_observations,tick timestamptz)
returns boolean language sql stable set search_path='' as $$
select case when idea.one_shot_authorization_id is null then private.agent_pulse_ai_parent_eligible(idea.user_id,parent,tick,false)
 else idea.kind='idea' and parent.id=idea.parent_observation_id and parent.user_id=idea.user_id and parent.episode=idea.parent_episode
  and private.agent_pulse_parent_current(idea.user_id,parent,tick,false) end;
$$;

create function private.agent_pulse_one_shot_pending_reason(a private.agent_pulse_one_shot_authorizations,tick timestamptz)
returns text language plpgsql stable set search_path='' as $$
declare o private.agent_observations;s private.agent_pulse_state;
begin
 if a.status<>'pending' then return null;end if;
 if tick>=a.expires_at then return 'SLOT_EXPIRED';end if;
 select * into s from private.agent_pulse_state where user_id=a.user_id;
 if not found or s.mode<>'workspace' or s.settings_revision<>a.settings_revision or s.checks_consent_version is distinct from 'checks-v1'
  or s.ai_consent_version is not null or cardinality(s.ai_project_ids)<>0 then return 'AUTHORITY_LOST';end if;
 select * into o from private.agent_observations where id=a.observation_id and user_id=a.user_id;
 if not found then return 'SOURCE_CHANGED';end if;
 if o.content_revision<>a.content_revision or o.episode<>a.episode or o.family<>a.family then return 'PARENT_CHANGED';end if;
 if o.state<>'active' then return 'PARENT_RESOLVED';end if;
 if o.seen_content_revision>=o.content_revision then return 'PARENT_SEEN';end if;
 if o.ai_attempt_terminal or o.ai_attempt_count>=2 then return 'ATTEMPT_LIMIT';end if;
 if o.source_token<>a.source_token or not private.agent_pulse_parent_current(a.user_id,o,tick) then return 'SOURCE_CHANGED';end if;
 return null;
end;$$;
create function private.agent_pulse_one_shot_maintain(p_owner uuid,p_limit integer) returns void language plpgsql set search_path='' as $$
declare a private.agent_pulse_one_shot_authorizations;reason text;tick timestamptz:=clock_timestamp();
begin
 if p_limit not between 1 and 20 then raise exception 'Invalid retention batch';end if;
 for a in select * from private.agent_pulse_one_shot_authorizations where (p_owner is null or user_id=p_owner)
  and status in ('pending','consumed') order by expires_at,id limit p_limit for update loop
  reason:=private.agent_pulse_one_shot_pending_reason(a,tick);
  if reason is not null then update private.agent_pulse_one_shot_authorizations set status=case when reason='SLOT_EXPIRED' then 'expired' else 'blocked' end,
   terminal_at=tick,terminal_reason=reason where id=a.id;
  elsif a.status='consumed' and (a.expires_at<=tick or not exists(select 1 from private.agent_pulses p where p.id=a.pulse_id and p.user_id=a.user_id and p.status='running' and p.lease_expires_at>tick)) then
   update private.agent_pulse_one_shot_authorizations set status='failed',terminal_at=tick,
    terminal_reason=case when a.send_attempted_at is null then 'AUTHORITY_LOST' else 'TRANSPORT_UNKNOWN' end where id=a.id;
  end if;
 end loop;
 delete from private.agent_pulse_one_shot_authorizations where id in(select id from private.agent_pulse_one_shot_authorizations
  where (p_owner is null or user_id=p_owner) and terminal_at<tick-interval '30 days' order by terminal_at,id limit p_limit);
end;$$;
revoke all on function private.agent_pulse_one_shot_idea_guard(),private.agent_pulse_publication_allowed(uuid,private.agent_pulses,private.agent_observations,timestamptz),
 private.agent_pulse_idea_read_allowed(private.agent_observations,private.agent_observations,timestamptz),
 private.agent_pulse_one_shot_pending_reason(private.agent_pulse_one_shot_authorizations,timestamptz),private.agent_pulse_one_shot_maintain(uuid,integer) from public,anon,authenticated,service_role;

create or replace function public.agent_pulse_publish_ai(p_user_id uuid,p_pulse_id uuid,p_lease_token uuid,p_fence bigint,p_settings_revision bigint,p_idea jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare p private.agent_pulses; o private.agent_observations; existing uuid; tick timestamptz; category text; u jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(505,5);
  p:=private.agent_pulse_guard(p_user_id,p_pulse_id,p_lease_token,p_fence,p_settings_revision);
  if p.ai_reserved_at is null or p.ai_parent_id is null then raise exception 'Reservation required' using errcode='22023'; end if;
  select * into o from private.agent_observations where user_id=p_user_id and id=p.ai_parent_id for update;
  select id into existing from private.agent_observations where user_id=p_user_id and kind='idea' and origin_pulse_id=p.id;
  if existing is not null then return jsonb_build_object('accepted',true,'recovered',true,'id',existing); end if;
  if jsonb_typeof(p_idea)<>'object' or not(p_idea ?& array['category','title','summary']) or (select count(*) from jsonb_object_keys(p_idea))<>3
    or jsonb_typeof(p_idea->'title')<>'string' or length(btrim(p_idea->>'title')) not between 1 and 120
    or jsonb_typeof(p_idea->'summary')<>'string' or length(btrim(p_idea->>'summary')) not between 1 and 400
    or p_idea->>'category' not in ('review_deadline','consider_scheduling','review_quiet_project','review_tomorrow') then
    update private.agent_pulses set ai_outcome='malformed' where id=p.id;
    update private.agent_observations set ai_attempt_terminal=true where id=o.id and episode=p.ai_parent_episode;
    return jsonb_build_object('accepted',false,'reason','AI_MALFORMED');
  end if;
  tick:=clock_timestamp(); category:=p_idea->>'category';
  if p.ai_outcome='malformed' or o.episode<>p.ai_parent_episode or not private.agent_pulse_publication_allowed(p_user_id,p,o,tick)
    or not ((category='review_deadline' and o.family='deadline') or (category='consider_scheduling' and 'IMPORTANT_NO_WORK'=any(o.reason_codes))
      or (category='review_quiet_project' and o.family='quiet_project') or (category='review_tomorrow' and o.family='tomorrow')) then
    return jsonb_build_object('accepted',false,'reason','SOURCE_CHANGED');
  end if;
  u:=private.agent_pulse_usage(p_user_id,tick);
  if (u->>'ownerIdeas')::integer>=2 then return jsonb_build_object('accepted',false,'reason','BUDGET'); end if;
  if (select count(*) from private.agent_observations where user_id=p_user_id)>=300
    or (select count(*) from private.agent_observations where user_id=p_user_id and state in ('active','snoozed'))>=100
    or (select count(*) from private.agent_observations where user_id=p_user_id and state in ('dismissed','resolved'))>=200 then return jsonb_build_object('accepted',false,'reason','CAPACITY'); end if;
  select id into existing from private.agent_observations where user_id=p_user_id and parent_observation_id=o.id and parent_episode=o.episode and idea_category=category;
  if existing is not null then return jsonb_build_object('accepted',true,'recovered',true,'id',existing); end if;
  if clock_timestamp()>=p.lease_expires_at then raise exception 'AUTHORITY_LOST' using errcode='40001'; end if;
  insert into private.agent_observations(user_id,kind,condition_key,family,target_type,target_id,target_date,parent_observation_id,parent_episode,idea_category,
    material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,title,summary,importance,rank,origin_pulse_id,latest_pulse_id)
    values(p_user_id,'idea','idea:'||o.id||':'||o.episode||':'||category,null,o.target_type,o.target_id,o.target_date,o.id,o.episode,category,
      o.material_fingerprint,o.source_token,tick+interval '7 days',o.reason_codes,o.evidence,btrim(p_idea->>'title'),btrim(p_idea->>'summary'),o.importance,5,p.id,p.id) returning id into existing;
  update private.agent_pulses set idea_accepted_at=tick,ai_outcome='accepted' where id=p.id;
  update private.agent_observations set one_shot_authorization_id=(select a.id from private.agent_pulse_one_shot_authorizations a where a.pulse_id=p.id and a.status='consumed')
    where id=existing and exists(select 1 from private.agent_pulse_one_shot_authorizations a where a.pulse_id=p.id and a.status='consumed');
  update private.agent_pulse_one_shot_authorizations set status='completed',terminal_at=tick,publication_completed_at=tick,output_status='accepted'
    where pulse_id=p.id and user_id=p_user_id and status='consumed';
  return jsonb_build_object('accepted',true,'recovered',false,'id',existing);
end;$$;

create or replace function private.agent_pulse_safe_observation(p private.agent_observations,p_now timestamptz)
returns jsonb language plpgsql stable set search_path='' as $$
declare source jsonb; parent private.agent_observations; source_key text; stale boolean; unavailable boolean; label text:='';
begin
  parent:=p;
  if p.kind='idea' then
    select * into parent from private.agent_observations where user_id=p.user_id and id=p.parent_observation_id;
    if not found then parent:=null; end if;
  end if;
  source_key:=coalesce(parent.condition_key,p.condition_key);
  source:=private.agent_pulse_source_projection(p.user_id,coalesce((parent.evidence->>'evaluatedAt')::timestamptz,p.last_checked_at),
    jsonb_build_array(jsonb_build_object('key',source_key,'target',jsonb_build_object('type',p.target_type,'id',p.target_id))));
  unavailable:=p.target_type<>'workspace_day' and coalesce(source->'targetChecks'->source_key->>'exists','false')<>'true';
  stale:=unavailable or coalesce(source->'sourceTokens'->>source_key,'')<>p.source_token or p.evidence_valid_until<=p_now
    or parent.last_checked_at<=p_now-interval '24 hours' or (p.state in ('dismissed','resolved') and p.last_changed_at<=p_now-interval '30 days');
  if p.kind='idea' then stale:=stale or parent.id is null or p.parent_episode<>parent.episode or not private.agent_pulse_idea_read_allowed(p,parent,p_now); end if;
  if not unavailable then
    select x->>'title' into label from jsonb_array_elements(case p.target_type when 'task' then source->'tasks' when 'milestone' then source->'milestones' else source->'projects' end) x where x->>'id'=p.target_id::text limit 1;
    if p.target_type='workspace_day' then label:='Tomorrow workload review'; end if;
  end if;
  return jsonb_build_object('id',p.id,'kind',p.kind,'title',case when unavailable then '' when stale then coalesce(label,'') else p.title end,
    'summary',case when stale then '' else p.summary end,'explanation',case when stale then '' else p.explanation end,
    'reasonCodes',case when stale then '{}'::text[] else p.reason_codes end,'state',p.state,
    'target',jsonb_build_object('type',p.target_type,'id',p.target_id),'rowRevision',p.row_revision,'contentRevision',p.content_revision,
    'seen',p.seen_content_revision>=p.content_revision,'watching',coalesce(p.state='active' and p.revisit_at<=p_now,false),'stale',coalesce(stale,true),'unavailable',unavailable,
    'firstNoticedAt',private.agent_pulse_stamp(p.first_noticed_at),'lastCheckedAt',private.agent_pulse_stamp(p.last_checked_at),
    'snoozeUntil',private.agent_pulse_stamp(p.snooze_until),'revisitAt',private.agent_pulse_stamp(p.revisit_at));
end;$$;

create or replace function public.agent_pulse_clear_memory(p_user_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.agent_pulse_state; removed integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(505,5);
  select * into s from private.agent_pulse_state where user_id=p_user_id for update;
  if not found or s.settings_revision is distinct from p_expected_revision then raise exception 'STATE_CHANGED' using errcode='40001'; end if;
  perform private.agent_pulse_ui_write(p_user_id);
  perform 1 from private.agent_pulses where user_id=p_user_id order by id for update;
  perform 1 from private.agent_observations where user_id=p_user_id order by id for update;
  update private.agent_pulse_one_shot_authorizations set status=case when consumed_at is null then 'blocked' else 'failed' end,
    terminal_at=clock_timestamp(),terminal_reason='SOURCE_CLEARED' where user_id=p_user_id and status in ('pending','consumed');
  select count(*) into removed from private.agent_observations where user_id=p_user_id;
  delete from private.agent_observations where user_id=p_user_id and kind='idea';
  delete from private.agent_observations where user_id=p_user_id;
  update private.agent_pulses set summary=null where user_id=p_user_id and summary is not null;
  update private.agent_pulse_state set baseline='{}',last_coverage='{}',fence=fence+1,settings_revision=settings_revision+1,lease_token=null,lease_expires_at=null,
    next_due_at=case when mode<>'off' then date_bin(interval '4 hours',clock_timestamp(),timestamptz '1970-01-01')+interval '4 hours' end where user_id=p_user_id;
  return jsonb_build_object('cleared',removed,'settingsRevision',s.settings_revision+1);
end;$$;

create or replace function public.agent_pulse_retain_installation(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare removed integer; tick timestamptz;
begin
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'Invalid retention batch' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(505,5); tick:=clock_timestamp(); perform private.agent_pulse_one_shot_maintain(null,p_limit);
  delete from private.agent_pulse_installation_events where id in(select id from private.agent_pulse_installation_events
    where created_at<tick-interval '48 hours' order by created_at,id limit p_limit);
  get diagnostics removed=row_count;
  return jsonb_build_object('deleted',removed);
end;$$;

create or replace function public.agent_pulse_one_shot_create(p_user_id uuid,p_parent_id uuid,p_revision bigint,p_slot timestamptz,p_model text,p_source_token text,p_context_fingerprint text,p_expected_binding jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare v jsonb;a private.agent_pulse_one_shot_authorizations;tick timestamptz;
begin
 perform pg_advisory_xact_lock(505,5);
 perform 1 from private.agent_pulse_state where user_id=p_user_id for update;
 perform 1 from private.agent_observations where id=p_parent_id and user_id=p_user_id for update;
 tick:=clock_timestamp(); perform private.agent_pulse_one_shot_maintain(p_user_id,20);
 update private.agent_pulse_one_shot_authorizations set status='expired',terminal_at=tick,terminal_reason='SLOT_EXPIRED' where user_id=p_user_id and status='pending' and expires_at<=tick;
 delete from private.agent_pulse_one_shot_authorizations where user_id=p_user_id and terminal_at<tick-interval '30 days';
 if (select count(*) from private.agent_pulse_one_shot_authorizations where user_id=p_user_id)>=200 then raise exception 'CAPACITY'; end if;
 if exists(select 1 from private.agent_pulse_one_shot_authorizations where user_id=p_user_id and status='pending') then raise exception 'An existing pending authorization requires cancellation'; end if;
 v:=public.agent_pulse_one_shot_preview(p_user_id,p_parent_id);
 if v is null or (v->'binding'->>'contentRevision')::bigint is distinct from p_revision or (v->'binding'->>'slot')::timestamptz is distinct from p_slot
  or v->'binding'->>'sourceToken' is distinct from p_source_token then raise exception 'SOURCE_OR_SLOT_CHANGED' using errcode='40001'; end if;
 if p_expected_binding is distinct from ((v->'binding')||jsonb_build_object('model',p_model,'contextFingerprint',p_context_fingerprint)) then raise exception 'REVIEWED_BINDING_CHANGED' using errcode='40001';end if;
 if p_model is null or length(p_model) not between 1 and 120 or p_model~'[[:cntrl:]]' or p_context_fingerprint is null or p_context_fingerprint!~'^[0-9a-f]{64}$' then raise exception 'Invalid one-shot model/context'; end if;
 insert into private.agent_pulse_one_shot_authorizations(user_id,project_id,observation_id,content_revision,episode,family,source_token,context_fingerprint,natural_slot,provider,model,settings_revision,expires_at)
 values(p_user_id,(v->'binding'->>'projectId')::uuid,p_parent_id,p_revision,(v->'binding'->>'episode')::bigint,v->'binding'->>'family',p_source_token,p_context_fingerprint,p_slot,'gemini',p_model,
  (v->'binding'->>'settingsRevision')::bigint,(v->'binding'->>'expiresAt')::timestamptz) returning * into a;
 return private.agent_pulse_one_shot_dto(a,tick);
end;$$;


create or replace function private.agent_pulse_one_shot_dto(a private.agent_pulse_one_shot_authorizations,tick timestamptz)
returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('binding',jsonb_build_object('id',a.id,'ownerId',a.user_id,'projectId',a.project_id,'parentId',a.observation_id,
 'contentRevision',a.content_revision,'episode',a.episode,'family',a.family,'sourceToken',a.source_token,'contextFingerprint',a.context_fingerprint,
 'provider',a.provider,'model',a.model,'slot',private.agent_pulse_stamp(a.natural_slot),'expiresAt',private.agent_pulse_stamp(a.expires_at),
 'settingsRevision',a.settings_revision,'authorizationVersion',a.authorization_version,'contextPolicyVersion',a.context_policy_version),
 'status',case when a.status='pending' and tick>=a.expires_at then 'expired' when a.status='consumed' and tick>=a.expires_at then 'failed' when a.status='pending' and private.agent_pulse_one_shot_pending_reason(a,tick) is not null then 'blocked' else a.status end,
 'reason',case when a.status='pending' and tick>=a.expires_at then 'SLOT_EXPIRED' when a.status='consumed' and tick>=a.expires_at then 'TRANSPORT_UNKNOWN' when a.status='pending' then private.agent_pulse_one_shot_pending_reason(a,tick) else a.terminal_reason end,
 'createdAt',private.agent_pulse_stamp(a.created_at),'consumedAt',private.agent_pulse_stamp(a.consumed_at),'terminalAt',private.agent_pulse_stamp(coalesce(a.terminal_at,case when tick>=a.expires_at then a.expires_at end)),
 'accounting',jsonb_build_object('allowanceConsumed',a.consumed_at is not null,'sendAttempted',a.send_attempted_at is not null,'transport',a.transport_state,
 'responseReceived',a.response_received_at is not null,'output',a.output_status,'publicationCompleted',a.publication_completed_at is not null));
$$;
