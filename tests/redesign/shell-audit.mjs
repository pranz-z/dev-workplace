import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHarness} from './browser-harness.mjs';
import {ready,navigate,settle} from './matrix-utils.mjs';
const output=process.argv[2];await mkdir(output,{recursive:true});
const records=[];
for(const [role,assets] of [['owner','../phase-1/assets'],['anonymous','../phase-1/anonymous-assets']]){
  const h=await createHarness(resolve(output,assets));
  try{
    for(const theme of ['dark','light'])for(const surface of role==='owner'?['dashboard','today','projects','tasks','calendar','files','plans','notes','tech','accountability','portfolio','github','settings','public','case-study']:['public','case-study']){
      const {page,context}=await h.session('unseen',{width:1024,height:768},theme,{surface});
      try{
        if(!['public','case-study'].includes(surface)){await ready(page);if(surface!=='dashboard')await navigate(page,surface,surface==='tech'?'Tech Stack':surface);}
        await settle(page);
        records.push({role,theme,surface,...await page.evaluate(()=>({titles:[...document.querySelectorAll('.workspace-header h1')].map(e=>({text:e.textContent,font:getComputedStyle(e).fontFamily})),emptyHeadings:[...document.querySelectorAll('[data-empty-state-heading]')].map(e=>e.textContent),proseLinks:[...document.querySelectorAll('p a')].filter(e=>e.getClientRects().length).map(e=>({text:e.textContent,href:e.getAttribute('href'),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))}))});
      }finally{await context.close();}
    }
  }finally{await writeFile(resolve(output,`preflight-${role}-requests.json`),JSON.stringify(h.requestLog,null,2));await h.close();}
}
await writeFile(resolve(output,'preflight-hooks-links.json'),JSON.stringify({records,titleInstances:records.flatMap(r=>r.titles).length,emptyHeadingInstances:records.flatMap(r=>r.emptyHeadings).length,proseLinkInstances:records.flatMap(r=>r.proseLinks).length},null,2));
for(const file of ['app/globals.css','app/app/page.tsx','components/workspace/WorkspaceShell.tsx','components/workspace/WorkspaceShell.test.mjs','components/auth/user-menu.tsx']){await writeFile(resolve(output,`phase1-${file.replaceAll('/','_')}`),await readFile(file));}
console.log('Phase1 source snapshot and actual Caveat/prose-link inventory saved.');
