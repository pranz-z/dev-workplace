"""Assemble local evidence; never read env files or contact a service."""
import json, pathlib, hashlib, subprocess, sys, html
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=pathlib.Path(sys.argv[1]).resolve()
def read(f): return json.loads((OUT/f).read_text(encoding='utf-8-sig'))
def write(f,v): (OUT/f).write_text(json.dumps(v,indent=2,ensure_ascii=True),encoding='utf-8')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def git(*args):
 r=subprocess.run(['git',*args],cwd=ROOT,capture_output=True,encoding='utf-8');assert r.returncode==0,r.stderr;return r.stdout
pairs=[]; rows=[]; unpaired=[]
def targets(r,items=None,source=''):
 for t in (r.get('targets',[]) if items is None else items):rows.append({**t,'viewport':r.get('viewport',t.get('viewport',{})),'theme':r.get('theme',t.get('theme')),'evidence':source})
def pair(role,key,b,a,kind,metadata=None):
 assert (OUT/b).is_file(),b
 assert (OUT/a).is_file(),a
 pairs.append(dict(role=role,key=key,before=b,after=a,baselineKind=kind,metadata=metadata or {},beforeSha256=sha(OUT/b),afterSha256=sha(OUT/a)))
original=read('../phase-0b/before-manifest.json');core=read('core/after-manifest.json')
assert len(original['captures'])==len(core['captures'])==210
for r in core['captures']:
 b=next(x for x in original['captures'] if (x['surface'],x['theme'],x['viewport'])==(r['surface'],r['theme'],r['viewport']))
 pair('Original core',r['filename'],'../phase-0b/before/'+b['filename'],'core/after/'+r['filename'],'original-phase0b',{'viewport':r['viewport'],'theme':r['theme'],'fixtureVersion':'phase0b-v1','fonts':r['fonts']});targets(r,source='core/after-manifest.json')
for folder,filename,bdir,adir in [('public','after-manifest.json','before','after'),('integrations','after-manifest.json','before','after'),('ai','after-manifest.json','before','after'),('daily','daily-after.json','daily-before','daily-after'),('timeblocks','after-manifest.json','before','after')]:
 after=read(folder+'/'+filename); before=read(folder+'/'+('daily-before.json' if folder=='daily' else 'before-manifest.json'))
 aa=after.get('records',after.get('captures'));bb=before.get('records',before.get('captures'));assert len(aa)==len(bb)
 for r in aa:
  b=next(x for x in bb if x['filename']==r['filename']);bp=f'{folder}/{bdir}/{b["filename"]}';kind='original-source-supplement'
  if folder=='public' and r['name'].startswith('baseline-'):
   surface={'baseline-hero':'public','baseline-projects':'public-projects','baseline-case':'case-study'}[r['name']]
   om=original if r['auth']=='owner' else read('../pre-phase-1-addendum/anonymous-before-manifest.json')
   old=next(x for x in om['captures'] if (x['surface'],x['theme'],x['viewport'])==(surface,r['theme'],r['viewport']))
   bp=('../phase-0b/before/' if r['auth']=='owner' else '../pre-phase-1-addendum/anonymous-before/')+old['filename'];kind='original-phase0b' if r['auth']=='owner' else 'original-anonymous-addendum'
  pair(folder,r['filename'],bp,f'{folder}/{adir}/{r["filename"]}',kind,{'viewport':r['viewport'],'theme':r['theme'],'fonts':r.get('fonts'),'variant':r.get('variant',r.get('name')),'auth':r.get('auth')});targets(r,source=folder+'/'+filename)
media=read('public/media-manifest.json')
for r in [x for x in media['records'] if x['phase']=='after']:
 b=next(x for x in media['records'] if x['phase']=='before' and all(x[k]==r[k] for k in ['auth','theme','viewport','name']))
 pair('Native media',r['filename'],'public/media/'+b['filename'],'public/media/'+r['filename'],'original-source-supplement',{'state':r['state'],'fonts':r['fonts']})
behavior=read('ai/behavior-after.json');old=read('ai/behavior-before.json')
for r in behavior['records']:
 if not r.get('protocol'):continue
 b=next(x for x in old['records'] if x.get('protocol') and x['viewport']==r['viewport'] and x['theme']==r['theme']);assert r['protocol']==b['protocol'];assert r['draft']==b['draft']
 for f in r['frames']:pair('Inbox protocol',f,'ai/journey-before/'+f,'ai/journey-after/'+f,'original-source-supplement',{'viewport':r['viewport'],'theme':r['theme']})
for f in ['actions/phase3-targets.json','actions/reconciliation-targets.json','ai/behavior-after-targets.json','integrations/integration-journey-targets.json','gap-targets.json']:
 for r in read(f):targets(r,[r],f)
for r in read('shell/shell-target-ledger.json')['measurements']:targets(r,[r],'shell/shell-target-ledger.json')
for r in read('public/keyboard-journeys.json')['records']:
 auth,theme,size=r['key'].split('--');w,h=map(int,size.split('x'))
 for k in ['openFrame','lightbox']:targets({'viewport':{'width':w,'height':h},'theme':theme},r[k]['targets'],'public/keyboard-journeys.json')
for r in read('public/avatar-regression.json')['records']:targets(r,[r],'public/avatar-regression.json')
def groupkey(r):return r['component']+'/'+r.get('selector',r.get('tag','')+'.'+r.get('className',''))
groups={}
for r in rows:
 k=groupkey(r);g=groups.setdefault(k,dict(component=r['component'],selector=r.get('selector',r.get('tag','')+'.'+r.get('className','')),instances=0,minWidth=1e10,minHeight=1e10,viewports=[],exceptions=[],evidence=[]))
 g['instances']+=1;g['minWidth']=min(g['minWidth'],r['width']);g['minHeight']=min(g['minHeight'],r['height']);v=r['viewport']
 if v not in g['viewports']:g['viewports'].append(v)
 if r.get('exception') and r['exception'] not in g['exceptions']:g['exceptions'].append(r['exception'])
 if r['evidence'] not in g['evidence']:g['evidence'].append(r['evidence'])
bad=[r for r in rows if not r.get('exception') and (r['width']<43.9 or r['height']<43.9)]
previous=read('../phase-6/target-component-ledger.json');lineage=[dict(component=r['component'],selector=r['selector'],freshCoverage=groupkey(r) in groups) for r in previous['groups']+previous['retainedGroups']]
write('unresolved-targets.json',bad);write('missing-groups.json',[r for r in lineage if not r['freshCoverage']]);assert not bad,('undersized',len(bad));assert all(r['freshCoverage'] for r in lineage),'Missing earlier target groups'
ledger=dict(measuredInstances=len(rows),componentGroups=len(groups),unresolved=0,carriedMeasurements=0,lineage=lineage,groups=list(groups.values()),exceptions=[dict(component='Drive file input',reason='Hidden native file input; approved by user.',equivalentAction='Files > New > File upload',approval='Phase1 decision'),dict(component='Browser-native media controls',status='unmeasured manual boundary',reason='Browser-owned shadow controls are not author DOM hit areas; no claim of a 44px pass.')],inlineLinkException=False)
write('target-component-ledger.json',ledger)
write('exception-ledger.json',ledger['exceptions'])
(OUT/'target-component-ledger.md').write_text('# Final fresh target ledger\n\n'+f'{len(rows)} measurements / {len(groups)} groups / zero unresolved author controls. No carried measurements. All {len(lineage)} previous ledger entries have fresh coverage.\n\n| Component / selector | Count | Minimum | Widths |\n|---|---:|---|---|\n'+'\n'.join(f'| {g["component"]} / {g["selector"].replace("|","/")} | {g["instances"]} | {g["minWidth"]:.1f} x {g["minHeight"]:.1f} | {sorted(set(v.get("width",0) for v in g["viewports"]))} |' for g in groups.values()),encoding='utf-8')
# Added presentation states have no identical original control. Link contextual
# original frames explicitly; never call these pixel-matched BEFORE states.
for r in read('shell/shell-journey.json')['records']:
 for s in r['steps']:
  unpaired.append(dict(role='Shell state',after='shell/shell/'+s['filename'],viewport=r['viewport'],theme=r['theme'],reason='New shell state has no identical original Phase0b capture; core dashboard pair supplies baseline context.'))
for r in read('actions/phase3-journey.json')['records']:
 for f in r.get('frames',[]):unpaired.append(dict(role='Projects/tasks action state',after='actions/projects-tasks/'+f['filename'],viewport=r['viewport'],theme=r['theme'],reason='Supplementary final interaction frame; original core project/task pair and original-source behavior assertions are the baseline, not a same-state image.'))
for r in read('gap-evidence.json')['records']:unpaired.append(dict(role='Gap evidence',after='gap-frames/'+r['filename'],viewport=r['viewport'],theme=r['theme'],reason='Final keyboard/touch/motion assertion frame; no original same-state image.'))
for r in unpaired:assert (OUT/r['after']).is_file(),r
manifest=dict(originalSource='0e2997da8de0076c33c2bc074ed35741524e784d',originalCorePairs=210,fixtureVersion='phase0b-v1 core; explicit detailed local variants retain their own before/after data',fixedTime='2026-10-26T02:00:00.000Z',timezone='Asia/Manila',viewports=[[1440,1000],[1024,768],[768,1024],[390,844],[320,844]],themes=['dark','light'],baselinePolicy='Original Phase0b core/addendum images take precedence. Detailed missing original scenarios are exact Git HEAD component/source + original Phase0b stylesheet supplements; no previous-phase BEFORE used. Programmatic old-rail setup is render-only evidence.',pairs=pairs,unpairedFinalEvidence=unpaired)
write('comparison-manifest.json',manifest)
(OUT/'comparison.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Integrated redesign comparisons</title><style>body{font:16px system-ui;background:#eee;color:#222;margin:24px}select{padding:12px;max-width:100%}main{display:flex;gap:16px}figure{flex:1;min-width:0;margin:12px 0}img{max-width:100%;border:1px solid #888}p{max-width:85ch}@media(max-width:700px){main{display:block}}</style><h1>Phase7 integrated comparisons</h1><p>Original Phase0b BEFORE plus explicitly labeled original-source supplements. New shell/action states without identical original images are listed separately in the manifest. Local fixtures, fixed clock, existing local assets. Physical/live checks remain open.</p><label>Comparison <select id="pair"></select></label><p id="kind"></p><main><figure><figcaption>BEFORE</figcaption><img id="before" alt="Original baseline or labeled supplement"></figure><figure><figcaption>AFTER</figcaption><img id="after" alt="Final source"></figure></main><script>const pairs='''+json.dumps(pairs)+''';const s=document.querySelector('#pair');pairs.forEach((p,i)=>{const o=document.createElement('option');o.value=i;o.textContent=p.role+' / '+p.key;s.append(o)});function show(){const p=pairs[s.value];document.querySelector('#before').src=p.before;document.querySelector('#after').src=p.after;document.querySelector('#kind').textContent=p.baselineKind}s.onchange=show;show()</script></html>''',encoding='utf-8')
protected=json.loads((ROOT/'tests/redesign/protected-source-hashes.json').read_text(encoding='utf-8-sig'))
for f,h in protected.items():assert sha(ROOT/f)==h
buildChecks=[]
for folder in ['core/assets','daily/assets','integrations/assets','ai/assets','public/after-assets','actions/action-assets','timeblocks/assets','public/avatar-assets','inbox/assets']:
 build=read(folder+'/build-manifest.json')
 for f,h in build['sources'].items():assert sha(ROOT/f)==h,(folder,f,'Source changed since capture bundle')
 assert sha(OUT/folder/'app.css')==build['cssSha256'],folder
 buildChecks.append(dict(folder=folder,files=len(build['sources']),cssSha256=build['cssSha256']))
write('capture-source-checks.json',buildChecks)
changed=git('diff','--name-only').splitlines();forbidden=[f for f in changed if f in protected or f.startswith(('data/','lib/','app/api/','supabase/')) or any(x in f.lower() for x in ['config','package','lock','fonts.ts','proxy'])];assert not forbidden,forbidden
prior=read('phase6-source-hashes.json');phase7=[f for f,h in prior.items() if sha(ROOT/f)!=h];assert phase7==['app/globals.css'],phase7
for filename,args in [('git-status.txt',['status','--short','--untracked-files=all']),('cumulative-diff-summary.txt',['diff','--stat']),('cumulative-shipped.diff',['diff']),('staged-status.txt',['diff','--cached','--name-only'])]:(OUT/filename).write_text(git(*args),encoding='utf-8')
assert not git('diff','--cached','--name-only').strip();assert git('rev-parse','HEAD').strip()==manifest['originalSource']
write('diff-summary.json',dict(trackedFiles=changed,trackedStat=git('diff','--numstat'),phase7ShippedChanges=phase7,protectedHashes=protected,protectedHashUpdates=[],forbiddenChanges=[],docs=['PRODUCT.md','DESIGN.md'],testHarness='tests/redesign/',commits=False,deploys=False))
network=[]
for f in OUT.rglob('*request-log.json'):
 if 'head-source' in f.parts or 'final-source' in f.parts:continue
 j=json.loads(f.read_text(encoding='utf-8'));denied=[r for r in j if str(r.get('disposition','')).startswith('denied')]
 intentional=f.relative_to(OUT).as_posix()=='inbox/test-request-log.json'
 if intentional:assert len(denied)==6 and all(r['disposition']=='denied-before-network' for r in denied)
 else:assert not denied,str(f)
 network.append(dict(file=str(f.relative_to(OUT)),events=len(j),deniedBeforeNetwork=len(denied),intentionalIsolationProbes=intentional))
write('request-log-summary.json',network)
jobs=read('job-status.json');assert all(j['status']=='passed' for j in jobs)
suite=read('full-suite-comparison.json');write('handoff-preflight.json',dict(matchedPairs=len(pairs),unpairedFinalFrames=len(unpaired),freshTargetMeasurements=len(rows),freshTargetGroups=len(groups),previousEntries=len(lineage),jobs=jobs,suite=suite,protected=protected))
print(json.dumps(dict(pairs=len(pairs),unpaired=len(unpaired),measurements=len(rows),groups=len(groups),previousEntries=len(lineage))))
