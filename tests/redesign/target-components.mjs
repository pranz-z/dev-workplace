import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHarness } from './browser-harness.mjs';
import { ready,selectSurface,settle } from './matrix-utils.mjs';
const output=process.argv[2];
const baseline=JSON.parse(await readFile(resolve(output,'../phase-0b/target-exceptions.json'),'utf8'));
const harness=await createHarness(resolve(output,'../phase-0b/assets'));
const instances=[];
try{
  for(const sample of baseline.measurements){
    const {context,page}=await harness.session('unseen',sample.viewport,sample.theme,{surface:sample.surface});
    try{
      if(sample.surface!=='public'){await ready(page);await selectSurface(page,sample.surface);}await settle(page);
      const rows=sample.controls.filter(value=>!value.meets44);
      const enriched=await page.evaluate(rows=>{
        const controls=[...document.querySelectorAll('button,a,input,select,textarea')];
        const label=e=>(e.getAttribute('aria-label')||e.textContent||e.getAttribute('placeholder')||e.tagName).trim().slice(0,110);
        return rows.map(row=>{
          const index=/document control index (\d+)/.exec(row.selector)?.[1];
          let element=index!==undefined?controls[Number(index)]:document.querySelector(row.selector);
          if(!element||label(element)!==row.label){
            element=controls.find(e=>label(e)===row.label&&Math.abs(e.getBoundingClientRect().width-row.width)<1&&Math.abs(e.getBoundingClientRect().height-row.height)<1);
          }
          if(!element)throw new Error(`Cannot map original target: ${row.selector}`);
          const r=element.getBoundingClientRect();
          if(Math.abs(r.width-row.width)>1||Math.abs(r.height-row.height)>1)throw new Error(`Baseline rectangle mismatch: ${row.label}`);
          let area='Workspace content';let scope='#workspace-content';
          for(const [selector,name] of [['.workspace-rail','WorkspaceRail'],['.workspace-header','WorkspaceToolbar'],['.workspace-context','ContextNavigation'],['.task-kanban-card','TaskCard'],['.notebook-portfolio','PublicPortfolio']]){
            if(element.closest(selector)){area=name;scope=selector;break;}
          }
          const classes=[...element.classList].filter(value=>!['active','is-selected','is-open'].includes(value));
          const tag=element.tagName.toLowerCase();
          const kind=tag==='input'?`input:${element.getAttribute('type')||'text'}`:tag;
          const component=`${area} / ${kind} / ${classes[0]||'unstyled control'}`;
          const selector=`${scope} ${tag}${classes.slice(0,4).map(value=>'.'+CSS.escape(value)).join('')}`;
          return {...row,component,componentSelector:selector,classSignature:classes.join(' '),match:'Original locator/label and rectangle verified against accepted fixture'};
        });
      },rows);
      for(const row of enriched)instances.push({...row,surface:sample.surface,viewport:sample.viewport,theme:sample.theme});
    }finally{await context.close();}
  }
  assert.equal(instances.length,508);
  const groups=new Map();
  for(const item of instances){
    const key=JSON.stringify([item.component,item.componentSelector,item.classSignature]);
    const group=groups.get(key)??{component:item.component,selector:item.componentSelector,classSignature:item.classSignature,countOfInstances:0,surfaces:[],viewports:[],sizes:[],examples:[]};
    group.countOfInstances++;
    if(!group.surfaces.includes(item.surface))group.surfaces.push(item.surface);
    const viewport=`${item.viewport.width}x${item.viewport.height}`;if(!group.viewports.includes(viewport))group.viewports.push(viewport);
    const size={width:item.width,height:item.height};if(!group.sizes.some(value=>value.width===size.width&&value.height===size.height))group.sizes.push(size);
    if(group.examples.length<4&&!group.examples.includes(item.label))group.examples.push(item.label);
    groups.set(key,group);
  }
  const components=[...groups.values()].sort((a,b)=>b.countOfInstances-a.countOfInstances);
  for(const group of components){const widths=group.viewports.map(value=>Number(value.split('x')[0]));group.viewportRange={minWidth:Math.min(...widths),maxWidth:Math.max(...widths),measured:group.viewports};}
  assert.equal(components.reduce((sum,value)=>sum+value.countOfInstances,0),508);
  await writeFile(resolve(output,'target-components.json'),JSON.stringify({source:'../phase-0b/target-exceptions.json',undersizedInstances:508,componentGroups:components.length,grouping:'Verified DOM ancestry, tag/type and exact stable class signature; separate size variants retained. Shared classes across surfaces consolidate only within the same source area.',approvedExceptions:[],components},null,2));
  await writeFile(resolve(output,'target-component-instances.json'),JSON.stringify(instances,null,2));
  const lines=components.map((value,index)=>`| ${index+1} | ${value.component} | ${value.viewportRange.minWidth}–${value.viewportRange.maxWidth}px | ${value.sizes.map(size=>`${size.width.toFixed(1)}×${size.height.toFixed(1)}`).join(', ')} | ${value.countOfInstances} |`);
  await writeFile(resolve(output,'target-components.md'),`# Component target planning list\n\n508 undersized baseline instances → ${components.length} component/style groups. No exception is granted. Counts are repeated measured instances, not unique controls. The JSON includes exact selector, class signature, measured viewports/sizes and example labels. DOM attribution was verified against the accepted fixture; no shipped source changed.\n\n| # | Component | Viewport range | Measured size variants (CSS px) | Instances |\n|---|---|---|---|---|\n${lines.join('\n')}\n`);
  console.log(`Reconciled 508 instances into ${components.length} verified component/style groups.`);
}finally{await writeFile(resolve(output,'target-enrichment-requests.json'),JSON.stringify(harness.requestLog,null,2));await harness.close();}
