import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lit, json, rpc } from './phase5d-postgres-fixture.mjs';

export async function reviewContextCases(t, h) {
  const parent = await h.one(`select id,episode from private.agent_observations where user_id=${lit(h.owner)} and target_id=${lit(h.task)} and kind='signal'`);
  assert.ok(parent);
  await h.value(rpc('agent_pulse_reserve_ai',h.owner,h.authority.pulseId,h.authority.leaseToken,h.authority.fence,h.authority.settingsRevision,parent.id,parent.episode));
  const published = await h.value(`select public.agent_pulse_publish_ai(${[h.owner,h.authority.pulseId,h.authority.leaseToken,h.authority.fence,h.authority.settingsRevision].map(lit).join(',')},${json({category:'review_deadline',title:'Provider idea Bravo',summary:'Provider advisory Charlie'})}) r`);
  assert.equal(published.accepted,true);
  const read = id => h.value(rpc('agent_pulse_get_observation',h.owner,id));
  const snapshot = async () => {
    const tables = await h.rows("select schemaname||'.'||tablename name from pg_tables where schemaname in ('public','private') order by schemaname,tablename");
    const result = {};
    for (const {name} of tables) result[name] = await h.value(`select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) r from ${name} x`);
    return result;
  };
  const context = (item) => { assert.ok(item.reviewContext,'Missing read-only reviewContext'); return item.reviewContext; };
  const invariant = async fn => { const before = await snapshot(); await fn(); assert.deepEqual(await snapshot(),before,'Detail GET changed stored data'); };
  const transaction = async fn => { await h.q('begin'); try { await fn(); } finally { await h.q('rollback'); } };
  const parentText = await h.one(`select summary,explanation from private.agent_observations where id=${lit(parent.id)}`);
  assert.equal(parentText.summary,'Deadline today. Important task has no qualifying scheduled work before its deadline.');

  await t.test('fresh signal uses canonical label, deterministic facts and no advisory',async()=>invariant(async()=>{
    const result = await read(parent.id), c = context(result);
    assert.deepEqual(c,{targetLabel:'Canonical target Alpha',deterministicSummary:parentText.summary,deterministicExplanation:parentText.explanation || null,advisoryIdea:null});
  }));
  await t.test('fresh idea separates canonical label and exact-parent facts from provider prose',async()=>invariant(async()=>{
    const c = context(await read(published.id));
    assert.deepEqual(c,{targetLabel:'Canonical target Alpha',deterministicSummary:parentText.summary,deterministicExplanation:parentText.explanation || null,advisoryIdea:{title:'Provider idea Bravo',summary:'Provider advisory Charlie'}});
    assert.notEqual(c.targetLabel,c.advisoryIdea.title); assert.notEqual(c.deterministicSummary,c.advisoryIdea.summary);
    assert.doesNotMatch(JSON.stringify(c),/parentObservationId|episode|sourceToken|fingerprint|evidence|lease|fence|nonce|reservation|prompt|reasoning/i);
  }));
  await t.test('same-target fresh signals cannot substitute for the exact stored parent',async()=>transaction(async()=>{
    await h.q(`update public.projects set title='Canonical project label',target_date=current_date where id=${lit(h.project)}`);
    const ids=[];
    for(const [family,suffix,summary,explanation] of [['deadline','deadline','Exact deadline facts','Exact deadline explanation'],['quiet_project','quiet_project','Other quiet facts','Other quiet explanation']]){
      const id=randomUUID(), key=`project:${h.project}:${suffix}`;ids.push(id);
      await h.q(`insert into private.agent_observations(id,user_id,condition_key,family,target_type,target_id,material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,title,summary,explanation,origin_pulse_id,latest_pulse_id)
        select ${lit(id)},${lit(h.owner)},${lit(key)},${lit(family)},'project',${lit(h.project)},repeat('a',64),s->'sourceTokens'->>${lit(key)},clock_timestamp()+interval '1 day',array['DEADLINE_TODAY'],jsonb_build_object('complete',true,'evaluatedAt',private.agent_pulse_stamp(clock_timestamp())),'Stored historical label',${lit(summary)},${lit(explanation)},${lit(h.authority.pulseId)},${lit(h.authority.pulseId)}
        from (select private.agent_pulse_source_projection(${lit(h.owner)},clock_timestamp(),${json([{key,target:{type:'project',id:h.project}}])}) s) q`);
    }
    for(const [index,id] of ids.entries()){
      const idea=randomUUID();await h.q(`insert into private.agent_observations(id,user_id,kind,condition_key,target_type,target_id,parent_observation_id,parent_episode,idea_category,material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,title,summary,rank,origin_pulse_id,latest_pulse_id)
        select ${lit(idea)},user_id,'idea',${lit('idea:'+idea)},target_type,target_id,id,episode,${lit(index===0?'review_deadline':'review_quiet_project')},material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,'Provider other title','Provider other summary',5,origin_pulse_id,latest_pulse_id from private.agent_observations where id=${lit(id)}`);
      await invariant(async()=>{const c=context(await read(idea));assert.equal(c.targetLabel,'Canonical project label');assert.equal(c.deterministicSummary,index===0?'Exact deadline facts':'Other quiet facts');assert.equal(c.deterministicExplanation,index===0?'Exact deadline explanation':'Other quiet explanation');});
    }
  }));

  const nullCases = [
    ['changed parent source',`update private.agent_observations set source_token=repeat('c',64) where id=${lit(parent.id)}`],
    ['changed child source',`update private.agent_observations set source_token=repeat('b',64) where id=${lit(published.id)}`],
    ['changed parent episode',`update private.agent_observations set episode=episode+1 where id=${lit(parent.id)}`],
    ['changed parent material',`update private.agent_observations set material_fingerprint=repeat('d',64) where id=${lit(parent.id)}`],
    ['expired parent',`update private.agent_observations set evidence_valid_until=clock_timestamp()-interval '1 second' where id=${lit(parent.id)}`],
    ['expired child',`update private.agent_observations set evidence_valid_until=clock_timestamp()-interval '1 second' where id=${lit(published.id)}`],
    ['old parent check',`update private.agent_observations set last_checked_at=clock_timestamp()-interval '24 hours' where id=${lit(parent.id)}`],
    ['unknown parent evidence',`update private.agent_observations set evidence=evidence||'{"complete":false}'::jsonb where id=${lit(parent.id)}`],
    ['current target edited',`update public.tasks set title='Changed current source' where id=${lit(h.task)}`],
    ['target deleted',`delete from public.tasks where id=${lit(h.task)}`],
    ['target no longer owned',`update public.tasks set user_id=${lit(h.other)},project_id=${lit(h.otherProject)} where id=${lit(h.task)}`],
    // Fault injection stays inside a rolled-back disposable transaction. Production FK/trigger guards are unchanged.
    ['missing exact parent',`set local session_replication_role=replica;update private.agent_observations set parent_observation_id=${lit(randomUUID())} where id=${lit(published.id)}`],
    ['deleted exact parent',`set local session_replication_role=replica;delete from private.agent_observations where id=${lit(parent.id)}`],
    ['wrong-owner exact parent',`set local session_replication_role=replica;update private.agent_observations set user_id=${lit(h.other)} where id=${lit(parent.id)}`],
    ['malformed child target relationship',`set local session_replication_role=replica;update private.agent_observations set target_id=${lit(h.project)},target_type='project' where id=${lit(published.id)}`],
    ['malformed category-parent relationship',`set local session_replication_role=replica;update private.agent_observations set idea_category='review_quiet_project' where id=${lit(published.id)}`],
  ];
  for(const [label,sql] of nullCases)await t.test(label+' withdraws review authority with zero GET writes',async()=>transaction(async()=>{
    await h.q(sql);await invariant(async()=>assert.equal((await read(published.id)).reviewContext,null));
  }));
  await t.test('wrong-kind exact parent yields null despite a valid same-target signal',async()=>transaction(async()=>{
    const invalidParent=randomUUID();await h.q(`insert into private.agent_observations(id,user_id,kind,condition_key,target_type,target_id,parent_observation_id,parent_episode,idea_category,material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,title,summary,rank,origin_pulse_id,latest_pulse_id)
      select ${lit(invalidParent)},user_id,'idea',${lit('idea:'+invalidParent)},target_type,target_id,parent_observation_id,parent_episode,'consider_scheduling',material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,'Wrong kind','Wrong facts',5,origin_pulse_id,latest_pulse_id from private.agent_observations where id=${lit(published.id)};
      set local session_replication_role=replica;update private.agent_observations set parent_observation_id=${lit(invalidParent)} where id=${lit(published.id)}`);
    await invariant(async()=>assert.equal((await read(published.id)).reviewContext,null));
  }));
  await t.test('stale signal cannot reuse copied deterministic text',async()=>transaction(async()=>{
    await h.q(`update public.tasks set title='Replacement label' where id=${lit(h.task)}`);
    await invariant(async()=>{const item=await read(parent.id);assert.equal(item.stale,true);assert.equal(item.summary,'');assert.equal(item.reviewContext,null);});
  }));
  await t.test('unknown signal coverage yields null review context',async()=>transaction(async()=>{
    await h.q(`update private.agent_observations set evidence=evidence||'{"complete":false}'::jsonb where id=${lit(parent.id)}`);
    await invariant(async()=>assert.equal((await read(parent.id)).reviewContext,null));
  }));
  await t.test('foreign and absent observation detail both remain null',async()=>invariant(async()=>{
    assert.equal(await h.value(rpc('agent_pulse_get_observation',h.other,published.id)),null);
    assert.equal(await read(randomUUID()),null);
  }));
  await t.test('canonical current label is bounded by120 code points and not the stored title',async()=>transaction(async()=>{
    await h.q(`update public.tasks set title=repeat('😀',121) where id=${lit(h.task)};
      update private.agent_observations p set source_token=(select s->'sourceTokens'->>p.condition_key from (select private.agent_pulse_source_projection(p.user_id,(p.evidence->>'evaluatedAt')::timestamptz,jsonb_build_array(jsonb_build_object('key',p.condition_key,'target',jsonb_build_object('type',p.target_type,'id',p.target_id)))) s) q) where p.id=${lit(parent.id)}`);
    await invariant(async()=>{const c=context(await read(parent.id));assert.equal(c.targetLabel,'😀'.repeat(120));assert.equal(Array.from(c.targetLabel).length,120);assert.notEqual(c.targetLabel,'Canonical target Alpha');});
  }));
  await t.test('deterministic and advisory code-point boundaries stay400/240/120/400',async()=>transaction(async()=>{
    await h.q(`update private.agent_observations set summary=repeat('😀',400),explanation=repeat('😀',240) where id=${lit(parent.id)};
      update private.agent_observations set title=repeat('😀',120),summary=repeat('😀',400) where id=${lit(published.id)}`);
    await invariant(async()=>{const c=context(await read(published.id));assert.equal(Array.from(c.deterministicSummary).length,400);assert.equal(Array.from(c.deterministicExplanation).length,240);assert.equal(Array.from(c.advisoryIdea.title).length,120);assert.equal(Array.from(c.advisoryIdea.summary).length,400);});
  }));
  await t.test('empty deterministic explanation is null',async()=>transaction(async()=>{
    await h.q(`update private.agent_observations set explanation='' where id=${lit(parent.id)}`);
    assert.equal(context(await read(published.id)).deterministicExplanation,null);
  }));
  await t.test('milestone canonical label uses the fixed current source projection',async()=>transaction(async()=>{
    const id=randomUUID(),observation=randomUUID(),key=`milestone:${id}:deadline`;
    await h.q(`insert into public.milestones(id,project_id,title,target_date) values(${lit(id)},${lit(h.project)},'Canonical milestone label',current_date);
      insert into private.agent_observations(id,user_id,condition_key,family,target_type,target_id,material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,title,summary,origin_pulse_id,latest_pulse_id)
      select ${lit(observation)},${lit(h.owner)},${lit(key)},'deadline','milestone',${lit(id)},repeat('a',64),s->'sourceTokens'->>${lit(key)},clock_timestamp()+interval '1 day',array['DEADLINE_TODAY'],jsonb_build_object('complete',true,'evaluatedAt',private.agent_pulse_stamp(clock_timestamp())),'Old milestone label','Current milestone deadline',${lit(h.authority.pulseId)},${lit(h.authority.pulseId)}
      from (select private.agent_pulse_source_projection(${lit(h.owner)},clock_timestamp(),${json([{key,target:{type:'milestone',id}}])}) s) q`);
    await invariant(async()=>assert.equal(context(await read(observation)).targetLabel,'Canonical milestone label'));
  }));
  await t.test('workspace-day canonical label stays fixed and owner/source checked',async()=>transaction(async()=>{
    const row=await h.one(`select ((clock_timestamp() at time zone time_zone)::date+1)::text calendar_day from public.profiles where id=${lit(h.owner)}`);
    const key=`workspace_day:${h.owner}:tomorrow:${row.calendar_day}`,observation=randomUUID();
    const evaluatedAt=(await h.one('select private.agent_pulse_stamp(clock_timestamp()) evaluated_at')).evaluated_at;
    await h.q(`insert into private.agent_observations(id,user_id,condition_key,family,target_type,target_id,target_date,material_fingerprint,source_token,evidence_valid_until,reason_codes,evidence,title,summary,origin_pulse_id,latest_pulse_id)
      select ${lit(observation)},${lit(h.owner)},${lit(key)},'tomorrow','workspace_day',${lit(h.owner)},${lit(row.calendar_day)},repeat('a',64),s->'sourceTokens'->>${lit(key)},clock_timestamp()+interval '1 day',array['TOMORROW_DEADLINES'],jsonb_build_object('complete',true,'evaluatedAt',${lit(evaluatedAt)}),'Old day label','Current tomorrow facts',${lit(h.authority.pulseId)},${lit(h.authority.pulseId)}
      from (select private.agent_pulse_source_projection(${lit(h.owner)},${lit(evaluatedAt)}::timestamptz,${json([{key,target:{type:'workspace_day',id:h.owner}}])}) s) q`);
    await invariant(async()=>assert.equal(context(await read(observation)).targetLabel,'Tomorrow workload review'));
  }));
  await t.test('list Brief Journal never receive reviewContext and remain read only',async()=>invariant(async()=>{
    for(const sql of [`select public.agent_pulse_list_inbox(${lit(h.owner)},'all',null,20) r`,rpc('agent_pulse_get_brief',h.owner),`select public.agent_pulse_list_journal(${lit(h.owner)},null,20) r`])assert.doesNotMatch(JSON.stringify(await h.value(sql)),/reviewContext|targetLabel|deterministicSummary|advisoryIdea/);
  }));
  await t.test('actual getter catalog and browser/helper execution grants remain service-only',async()=>{
    const fn=await h.one("select prosecdef,provolatile,proconfig,exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public from pg_proc where oid='public.agent_pulse_get_observation(uuid,uuid)'::regprocedure");
    assert.equal(fn.prosecdef,true);assert.equal(fn.provolatile,'s');assert.equal(fn.public,false);assert.ok(fn.proconfig.includes('search_path=""'));
    for(const role of ['anon','authenticated','service_role']){
      const p=await h.one(`select has_function_privilege(${lit(role)},'public.agent_pulse_get_observation(uuid,uuid)','execute') getter,has_function_privilege(${lit(role)},'private.agent_pulse_safe_observation(private.agent_observations,timestamptz)','execute') helper,has_table_privilege(${lit(role)},'private.agent_observations','select') table_read`);
      assert.equal(p.getter,role==='service_role');assert.equal(p.helper,false);assert.equal(p.table_read,false);
      await h.q('begin');try{await h.q('set local role '+role);if(role==='service_role')assert.ok(context(await read(published.id)));else await assert.rejects(read(published.id),{code:'42501'});}finally{await h.q('rollback');}
    }
  });
}
