import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHarness as rawHarness} from './browser-harness.mjs';const createHarness=(a)=>rawHarness(a,{embeddedFonts:true});
const o=process.argv[2],h=await createHarness(resolve(o,'after-assets'),{embeddedFonts:true}),records=[];
await mkdir(resolve(o,'review-frames'),{recursive:true});
try{for(const theme of ['dark','light'])for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,844]])for(const surface of ['public','case-study']){
 const {page,context,errors}=await h.session('unseen',{width,height},theme,{surface,variant:'rich'});
 try{
  await page.locator(surface==='public'?'#projects':'#project-gallery-title').waitFor();
  if(surface==='public')await page.getByRole('button',{name:'Ask AI about Franz',exact:true}).click();
  await page.waitForTimeout(700);
  const nav=await page.locator('nav[aria-label=Portfolio] a').evaluateAll(es=>es.map(e=>({text:e.textContent,width:e.clientWidth,content:e.scrollWidth})));
  assert.ok(nav.every(e=>e.content<=e.width+1),`Navigation label overlap ${width}: ${JSON.stringify(nav)}`);
  const data=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
   const rgb=color=>{const probe=document.createElement('span');probe.style.color=color;document.querySelector('.public-shell').append(probe);color=getComputedStyle(probe).color;probe.remove();ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
   const lum=rgb=>{const n=rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*n[0]+.7152*n[1]+.0722*n[2];};
   const root=document.querySelector('.public-shell'),canvasColor=rgb(getComputedStyle(root).getPropertyValue('--nb-bg'));
   const pairs=new Map(),fonts=[];
   for(const e of root.querySelectorAll('*')){
    if(!e.getClientRects().length||e.closest('[aria-hidden="true"]')||getComputedStyle(e).visibility==='hidden'||e.classList.contains('sr-only'))continue;
    const text=[...e.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();if(!text)continue;
    const s=getComputedStyle(e),fg=rgb(s.color);let bg=canvasColor.slice();const stack=[];for(let n=e;n;n=n.parentElement)stack.unshift(n);
    for(const n of stack){const c=rgb(getComputedStyle(n).backgroundColor);if(c[3])bg=c.slice(0,3).map((v,i)=>v*c[3]/255+bg[i]*(1-c[3]/255));}
    const a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05),large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700),min=large?3:4.5;
    const key=JSON.stringify([fg,bg,min]);if(!pairs.has(key))pairs.set(key,{text:text.slice(0,80),foreground:s.color,background:bg,ratio,min});
    if(e.closest('form,[role="dialog"],.public-ai-concierge')||e.matches('button,input,textarea,select'))fonts.push({text:text.slice(0,80),family:s.fontFamily});
   }
   return{pairs:[...pairs.values()],fonts};
  });
  await writeFile(resolve(o,'accessibility-partial.json'),JSON.stringify({theme,width,surface,data},null,2));
  for(const pair of data.pairs)assert.ok(pair.ratio>=pair.min,`${theme}/${width}/${surface} contrast ${pair.text}: ${pair.ratio} < ${pair.min}`);
  assert.ok(data.fonts.every(f=>f.family.includes('Geist')&&!/Caveat|Kalam|cursive/.test(f.family)),`${theme}/${width}/${surface} operational public font`);
  await page.screenshot({path:resolve(o,'review-frames',`${surface}--${theme}--${width}.png`)});assert.deepEqual(errors,[]);records.push({theme,width,surface,...data});
 }finally{await context.close();}
}
await writeFile(resolve(o,'accessibility.json'),JSON.stringify({records,scope:'Computed text/background contrast in actual public and concierge states; native video controls and pixels inside media are excluded.'},null,2));
}finally{await writeFile(resolve(o,'accessibility-request-log.json'),JSON.stringify(h.requestLog,null,2));await h.close();}
