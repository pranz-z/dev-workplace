import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

const root=resolve(import.meta.dirname,'../..');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO9sAAAAASUVORK5CYII=';
const projects=['featured','regular','missing'].map((slug,index)=>({slug,name:`Project ${slug}`,visibility:'Public',featured:index===0,type:'Web app',role:'Developer',description:'Project summary',publicSummary:'',technologies:['React'],links:{github:'https://github.com/example/demo',live:'https://example.com'}}));

test('Chromium: public cards, hover lifecycle, bounded failures, responsive/static modes and owner UI',async()=>{
  assert.ok(process.env.PORTFOLIO_TEST_ESBUILD_MODULE,'Set PORTFOLIO_TEST_ESBUILD_MODULE to the existing esbuild runtime');
  const {build}=await import(pathToFileURL(process.env.PORTFOLIO_TEST_ESBUILD_MODULE).href);
  const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import PublicPortfolio from '@/components/portfolio/PublicPortfolio';import{ProjectPreviewVideo}from'@/components/projects/project-preview-video';
    createRoot(document.getElementById('root')).render(location.pathname==='/owner'?<ProjectPreviewVideo projectId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"/>:<PublicPortfolio initialProjects={${JSON.stringify(projects)}} initialProfile={null} initialError={false} initialProfessionalContent={null} introduction={{name:'Owner',headline:'Developer',bio:''}}/>);`,resolveDir:root,loader:'tsx'},outfile:'fixture.js',bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:resolve(root,'tsconfig.json'),nodePaths:[resolve(root,'node_modules')],define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture-boundaries',setup(b){
      b.onResolve({filter:/^next\/(link|image)$/},args=>({path:args.path,namespace:'next-fixture'}));
      b.onLoad({filter:/.*/,namespace:'next-fixture'},args=>({loader:'js',resolveDir:root,contents:`import React from 'react';export default function Component({children,...props}){return React.createElement('${args.path.endsWith('link')?'a':'img'}',props,children)}`}));
      b.onResolve({filter:/^@\/(components\/auth\/auth-provider|components\/public-ai\/public-ai-concierge|data\/projectScreenshotService|lib\/supabase\/env)$/},args=>({path:args.path,namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path.endsWith('auth-provider')?'export const useAuth=()=>({status:"unauthenticated"})':args.path.endsWith('public-ai-concierge')?'export const PublicAiConcierge=()=>null':args.path.endsWith('projectScreenshotService')?`export const listPublicProjectScreenshots=async()=>[{projectSlug:'featured',signedUrl:${JSON.stringify(image)}}]`:'export const isSupabaseConfigured=()=>true'}));
    }}]});
  const cssDir=resolve(root,'.next/static/chunks');
  const css=existsSync(cssDir)?readdirSync(cssDir).filter(n=>n.endsWith('.css')).map(n=>readFileSync(resolve(cssDir,n),'utf8')).join('\n'):'';
  assert.ok(css.length,'Run npm run build before responsive browser checks');
  const calls=[],uploads=[]; let video=null;
  const server=createServer(async(req,res)=>{
    if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].text)}
    if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');return res.end(css)}
    if(req.url.startsWith('/api/public/projects/')){calls.push(req.url);res.setHeader('Content-Type','application/json');if(req.url.includes('/missing/')){res.statusCode=404;return res.end('{}')}return res.end(JSON.stringify({url:`https://example.private.blob.vercel-storage.com/${req.url.includes('featured')?'featured':'regular'}.mp4?signature=${calls.length}`,mimeType:'video/mp4',expiresAt:Date.now()+900000}))}
    if(req.url.startsWith('/api/projects/')){let raw='';for await(const chunk of req)raw+=chunk;const input=raw?JSON.parse(raw):{};uploads.push({method:req.method,input,size:raw.length});res.setHeader('Content-Type','application/json');if(input.action==='begin')return res.end(JSON.stringify({uploadId:'upload',url:'https://vercel.com/api/blob?signed=upload'}));if(input.action==='finalize')video={fileName:'test.mp4',mimeType:'video/mp4',sizeBytes:16,enabled:false,updatedAt:'2026-10-25'};if(input.action==='preview')return res.end(JSON.stringify({url:'https://example.private.blob.vercel-storage.com/owner.mp4?signature=owner',mimeType:'video/mp4',expiresAt:Date.now()+900000}));if(req.method==='PATCH')video={...video,enabled:input.enabled};if(req.method==='DELETE')video=null;return res.end(JSON.stringify({video}))}
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1100}});
    await context.addInitScript(()=>{window.videoCalls={play:[],pause:0};HTMLMediaElement.prototype.load=function(){};HTMLMediaElement.prototype.play=function(){window.videoCalls.play.push({muted:this.muted,loop:this.loop,inline:this.playsInline,src:this.src});return Promise.resolve()};HTMLMediaElement.prototype.pause=function(){window.videoCalls.pause++}});
    const page=await context.newPage(),errors=[],mediaRequests=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(/\.(mp4|webm)(\?|$)/.test(r.url()))mediaRequests.push(r.url())});
    await page.goto(origin);await page.locator('article.portfolio-project').first().waitFor();await page.waitForTimeout(150);
    assert.equal(calls.length,0);assert.equal(mediaRequests.length,0);assert.equal(await page.locator('video[src]').count(),0);
    const cards=page.locator('article.portfolio-project'),first=cards.nth(0),regular=cards.nth(1);
    for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:1100});await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`no horizontal overflow at ${width}`);const r=await first.locator('video').boundingBox();assert.ok(Math.abs(r.width/r.height-16/9)<.05,`aspect ratio ${width}`)}
    assert.equal(calls.length,0);
    await page.setViewportSize({width:1440,height:1100});await first.hover();await page.waitForFunction(()=>window.videoCalls.play.length===1,null,{timeout:5000});assert.equal(calls.length,1);
    assert.deepEqual(await page.evaluate(()=>({...window.videoCalls.play[0],src:undefined})),{muted:true,loop:true,inline:true,src:undefined});
    assert.equal(await first.locator('video').getAttribute('preload'),'none');assert.equal(await first.locator('video').getAttribute('aria-hidden'),'true');assert.ok(await first.locator('video').evaluate(v=>getComputedStyle(v).pointerEvents==='none'));
    const before=await first.boundingBox();await page.mouse.move(0,0);assert.equal(await first.locator('video').evaluate(v=>v.currentTime),0);assert.ok(await page.evaluate(()=>window.videoCalls.pause>0));assert.match(await first.locator('video').getAttribute('class'),/opacity-0/);
    await first.hover();await page.waitForFunction(()=>window.videoCalls.play.length===2);assert.equal(calls.length,1);assert.ok(Math.abs((await first.boundingBox()).height-before.height)<0.1);
    await page.mouse.move(0,0);await page.evaluate(()=>{const real=Date.now;Date.now=()=>{Date.now=real;return real()+901000}});await first.hover();await page.waitForFunction(()=>window.videoCalls.play.length===3);assert.equal(calls.length,2);
    await first.locator('video').dispatchEvent('error');assert.match(await first.locator('video').getAttribute('class'),/opacity-0/);await page.mouse.move(0,0);await first.hover();await page.waitForFunction(()=>window.videoCalls.play.length===4);assert.equal(calls.length,3);
    await page.mouse.move(0,0);await regular.hover();await page.waitForFunction(()=>window.videoCalls.play.length===5);assert.equal(calls.length,4);
    await regular.locator('video').dispatchEvent('error');await page.mouse.move(0,0);await regular.hover();await page.waitForFunction(()=>window.videoCalls.play.length===6);
    // Play rejection remains a static cover and never leaks a rejected promise.
    await page.evaluate(()=>{HTMLMediaElement.prototype.play=()=>Promise.reject(Error('blocked'))});await page.mouse.move(0,0);await regular.hover();await page.waitForTimeout(50);assert.match(await regular.locator('video').getAttribute('class'),/opacity-0/);
    await regular.locator('video').dispatchEvent('error');await page.mouse.move(0,0);const boundedCalls=calls.length;await regular.hover();await page.waitForTimeout(50);assert.equal(calls.length,boundedCalls,'only one later-hover refresh after media failure');
    await page.mouse.move(0,0);const missing=cards.nth(2);await missing.hover();await page.waitForTimeout(50);const missingCalls=calls.length;await page.mouse.move(0,0);await missing.hover();await page.waitForTimeout(50);assert.equal(calls.length,missingCalls);assert.equal(await missing.locator('video[src]').count(),0);
    assert.equal(await first.getByRole('link',{name:/View case study/}).getAttribute('href'),'/projects/featured');assert.equal(await first.getByRole('link',{name:'Live demo'}).getAttribute('href'),'https://example.com/');assert.equal(await first.getByRole('link',{name:'Repository'}).getAttribute('href'),'https://github.com/example/demo');
    await page.evaluate(()=>{HTMLMediaElement.prototype.play=function(){window.videoCalls.play.push({muted:this.muted});return Promise.resolve()}});await first.hover();await page.waitForFunction(()=>document.querySelector('article.portfolio-project video').classList.contains('opacity-100'));
    await first.evaluate(el=>{el.style.position='absolute';el.style.top='-10000px'});await page.waitForFunction(()=>document.querySelector('article.portfolio-project video').classList.contains('opacity-0'));assert.equal(await first.locator('video').evaluate(v=>v.currentTime),0);await first.evaluate(el=>{el.style.position='';el.style.top=''});
    await first.hover();await page.waitForFunction(()=>document.querySelector('article.portfolio-project video').classList.contains('opacity-100'));
    const beforeHidden=calls.length;await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});await page.waitForFunction(()=>document.querySelector('article.portfolio-project video').classList.contains('opacity-0'));assert.equal(await first.locator('video').evaluate(v=>v.currentTime),0);assert.equal(calls.length,beforeHidden);await page.evaluate(()=>{delete document.hidden});await page.mouse.move(0,0);
    await first.hover();await page.waitForFunction(()=>document.querySelector('article.portfolio-project video').classList.contains('opacity-100'));const beforeMotion=calls.length;await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>!document.querySelector('article.portfolio-project video').hasAttribute('src'));assert.equal(calls.length,beforeMotion);await page.emulateMedia({reducedMotion:'no-preference'});
    for(const options of [{reducedMotion:'reduce'},{hasTouch:true,isMobile:true,viewport:{width:390,height:844}}]){
      const staticContext=await browser.newContext(options);await staticContext.addInitScript(()=>{window.plays=0;HTMLMediaElement.prototype.play=function(){window.plays++;return Promise.resolve()}});const staticPage=await staticContext.newPage();const prior=calls.length;await staticPage.goto(origin);await staticPage.locator('article.portfolio-project').first().waitFor();await staticPage.locator('article.portfolio-project').first().dispatchEvent('pointerenter',{pointerType:'mouse'});await staticPage.waitForTimeout(100);assert.equal(calls.length,prior);assert.equal(await staticPage.locator('video[src]').count(),0);assert.equal(await staticPage.evaluate(()=>window.plays),0);await staticContext.close();
    }
    await page.goto(origin+'/owner');await page.getByText('No preview video uploaded.').waitFor();await page.getByLabel('MP4 video',{exact:true}).setInputFiles({name:'test.mp4',mimeType:'video/mp4',buffer:Buffer.alloc(16)});let direct=0;await page.route('https://vercel.com/api/blob?**',route=>{direct++;return route.fulfill({status:200,body:'{}',headers:{'access-control-allow-origin':'*'}})});await page.getByRole('button',{name:'Upload video',exact:true}).click();await page.getByText('Video saved privately. Enable it when ready.').waitFor();assert.equal(direct,1);assert.equal(await page.getByRole('checkbox').isChecked(),false);await page.getByRole('checkbox').click();await page.getByText('Preview visibility saved.').waitFor();assert.equal(await page.getByRole('checkbox').isChecked(),true);await page.getByRole('button',{name:'Preview current video'}).click();await page.locator('video[src]').waitFor();assert.equal(await page.locator('video').getAttribute('autoplay'),null);await page.getByRole('button',{name:'Remove video'}).click();await page.getByText('Preview removed.').waitFor();assert.equal(await page.locator('video').count(),0);assert.ok(uploads.every(u=>u.size<512));assert.equal(errors.length,0,errors.join('\n'));
    mkdirSync(resolve(root,'.next/video-preview-evidence'),{recursive:true});await page.screenshot({path:resolve(root,'.next/video-preview-evidence/owner.png')});
    console.log('Verified: responsive widths 1440/1024/768/390/320; zero initial video requests; hover/cache/expiry/fallback; touch/reduced-motion; owner direct-upload UI. Media playback was mocked; real Blob delivery/decoding was not exercised.');
    await context.close();
  }finally{await browser.close();await new Promise(r=>server.close(r))}
});
