import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHarness } from './browser-harness.mjs';
import { ready,selectSurface,settle } from './matrix-utils.mjs';
const output=process.argv[2];await mkdir(resolve(output,'foundation'),{recursive:true});
const harness=await createHarness(resolve(output,'assets'));const records=[];
try{
  for(const theme of ['dark','light']){
    const {context,page,errors}=await harness.session('unseen',{width:1024,height:768},theme,{surface:'dashboard'});
    try{
      await ready(page);
      await page.evaluate(()=>{
        const probe=document.createElement('section');probe.className='dark-panel p-4';probe.dataset.foundationProbe='true';
        probe.innerHTML='<h2>Shared section heading</h2><h3 data-empty-state-heading>Empty state heading</h3><form><h3 data-empty-state-heading>Form heading must be Geist</h3><label>Synthetic name<input placeholder="Synthetic placeholder" value="A deliberately long synthetic value to exercise the existing field"></label><label><input type="checkbox">Synthetic consent</label><select aria-label="Synthetic select"><option>Long synthetic option with descriptive text</option></select><textarea aria-label="Synthetic notes">Long synthetic note content to verify operational typography.</textarea><button type="button" class="ink-button primary">Synthetic action</button><button type="button" disabled class="dark-chip">Disabled action</button></form><p role="status">Synthetic status</p><p role="alert">Synthetic error</p><p data-feedback="success">Synthetic success</p>';
        document.querySelector('.notebook-workspace').append(probe);
      });
      const probe=page.locator('[data-foundation-probe]');await probe.scrollIntoViewIfNeeded();await settle(page);
      const data=await page.evaluate(()=>{
        const root=document.querySelector('.notebook-workspace'),probe=document.querySelector('[data-foundation-probe]');
        const fonts=[...probe.querySelectorAll('h2,h3,label,input,select,textarea,button,[role],p')].map(e=>({tag:e.tagName,text:(e.textContent||e.getAttribute('aria-label')||'').slice(0,80),font:getComputedStyle(e).fontFamily,allowed:e.hasAttribute('data-empty-state-heading')&&!e.closest('form,dialog')}));
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
        function color(token){const e=document.createElement('span');e.style.color=`var(${token})`;root.append(e);const css=getComputedStyle(e).color;e.remove();ctx.clearRect(0,0,1,1);ctx.fillStyle=css;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);}
        function lum(rgb){const n=rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*n[0]+.7152*n[1]+.0722*n[2];}
        const pairs=[['--workspace-ink','--workspace-canvas',4.5],['--workspace-muted','--workspace-surface',4.5],['--workspace-muted','--workspace-inset',4.5],['--workspace-on-action','--workspace-action',4.5],['--workspace-success','--workspace-surface',4.5],['--workspace-danger','--workspace-surface',4.5],['--workspace-edge','--workspace-surface',3],['--workspace-focus','--workspace-canvas',3]];
        const contrast=pairs.map(([foreground,background,min])=>{const a=lum(color(foreground)),b=lum(color(background));return {foreground,background,min,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
        const checkbox=probe.querySelector('input[type=checkbox]'),button=probe.querySelector('button');
        const rect=e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height});
        return {fonts,contrast,checkbox:rect(checkbox),button:rect(button)};
      });
      for(const item of data.fonts){if(item.allowed)assert.match(item.font,/Caveat/);else{assert.match(item.font,/Geist/);assert.doesNotMatch(item.font,/Kalam|Caveat|cursive/);}}
      for(const pair of data.contrast)assert.ok(pair.ratio>=pair.min,`${theme} ${pair.foreground}: ${pair.ratio}`);
      assert.ok(data.checkbox.width>=44&&data.checkbox.height>=44);assert.ok(data.button.width>=44&&data.button.height>=44);
      const checkbox=page.getByLabel('Synthetic consent',{exact:true});await checkbox.focus();await page.keyboard.press('Space');assert.equal(await checkbox.isChecked(),true);
      const action=page.getByRole('button',{name:'Synthetic action',exact:true});await action.focus();
      const focus=await action.evaluate(e=>{const s=getComputedStyle(e);return {visible:e.matches(':focus-visible'),style:s.outlineStyle,width:s.outlineWidth,color:s.outlineColor};});
      assert.equal(focus.visible,true);assert.equal(focus.style,'solid');assert.equal(focus.width,'3px');
      await page.screenshot({path:resolve(output,'foundation',`controls-${theme}.png`)});
      await probe.evaluate(e=>e.remove());
      // Actual reused dialog and actual protected consent surface inherit the foundation.
      const create=page.getByRole('button',{name:/^\+?\s*New Project$/i}).filter({visible:true}).last();await create.click();
      await page.locator('dialog[open]').waitFor();
      const dialogFonts=await page.locator('dialog[open]').evaluate(e=>[...e.querySelectorAll('h1,h2,h3,label,input,select,textarea,button')].map(n=>getComputedStyle(n).fontFamily));
      assert.ok(dialogFonts.every(font=>font.includes('Geist')&&!/Caveat|Kalam|cursive/.test(font)));
      await page.screenshot({path:resolve(output,'foundation',`dialog-${theme}.png`)});await page.keyboard.press('Escape');
      await selectSurface(page,'ai-settings');await settle(page);
      const consentFonts=await page.locator('section[aria-label="Workspace AI chat"]').evaluate(e=>[...e.querySelectorAll('label,input,select,button,p,h2,h3')].map(n=>getComputedStyle(n).fontFamily));
      assert.ok(consentFonts.every(font=>font.includes('Geist')&&!/Caveat|Kalam|cursive/.test(font)));
      await page.getByRole('button',{name:'Minimize chat',exact:true}).click();
      await selectSurface(page,'files');await settle(page);
      const insetBorders=await page.locator('.notebook-dense .dark-inset').evaluateAll(nodes=>nodes.map(e=>({style:getComputedStyle(e).borderTopStyle,width:getComputedStyle(e).borderTopWidth})));
      assert.ok(insetBorders.length);assert.ok(insetBorders.every(border=>border.style==='solid'&&border.width==='1px'),'Operational inset borders must be regular');
      assert.deepEqual(errors,[]);records.push({theme,...data,focus,dialogFonts,consentFonts,insetBorders});
    }finally{await context.close();}
  }
  await writeFile(resolve(output,'foundation-evidence.json'),JSON.stringify({records,scope:'Computed fonts, real dialog/consent inheritance, semantic pair contrast and visible keyboard focus; no feature behavior changes'},null,2));
  console.log('Both-theme foundation font, target, native checkbox, contrast and focus assertions passed.');
}finally{await writeFile(resolve(output,'foundation-request-log.json'),JSON.stringify(harness.requestLog,null,2));await harness.close();}
