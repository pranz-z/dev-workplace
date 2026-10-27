import {mkdir,copyFile,readFile,writeFile,symlink,readlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,dirname,join} from 'node:path';
import {root} from './build-fixture.mjs';
import {createHash} from 'node:crypto';
const output=process.argv[2],source=resolve(output,'next-build-source');
await mkdir(source,{recursive:true});
// Exclusive per-output marker: neither a retry nor an ignored flag may start
// another Next process against the same recorded snapshot.
await writeFile(resolve(output,'build-started.json'),JSON.stringify({startedAt:new Date().toISOString(),attempt:1}),{flag:'wx'});
const listing=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'});if(listing.status!==0)throw Error(listing.stderr);
const testListing=spawnSync('git',['ls-files','--others','--exclude-standard','-z','tests/redesign','PRODUCT.md','DESIGN.md'],{cwd:root,encoding:'utf8'});
const paths=[...listing.stdout.split('\0'),...testListing.stdout.split('\0')].filter(Boolean).filter(path=>!path.split('/').some(part=>part.startsWith('.env')||part==='.auth'||part==='.next'||part==='node_modules'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),sourceHashes={};
for(const path of paths){const target=resolve(source,path);await mkdir(dirname(target),{recursive:true});sourceHashes[path]=sha(await readFile(resolve(root,path)));await copyFile(resolve(root,path),target);if(sha(await readFile(target))!==sourceHashes[path])throw Error(`Source copy mismatch: ${path}`);}
await writeFile(resolve(output,'build-source-hashes.json'),JSON.stringify(sourceHashes,null,2));
try { await symlink(resolve(root,'node_modules'),join(source,'node_modules'),'junction'); }
catch(error) { if(error.code!=='EEXIST'||resolve(await readlink(join(source,'node_modules')))!==resolve(root,'node_modules'))throw error; }
// Next's installed font test hook serves existing local bytes, never a hosted URL.
const fonts=JSON.parse(await readFile(resolve(output,'../phase-0b/assets/font-manifest.json'),'utf8'));
const localFonts=fonts.map(font=>({...font,path:resolve(output,'../phase-0b/assets/fonts',font.filename).replaceAll('\\','/').replace(/^[A-Za-z]:/,'')}));
const fontMock=resolve(output,'local-font-responses.cjs');
await writeFile(fontMock,`const fs=require('node:fs');const fonts=${JSON.stringify(localFonts)};module.exports=new Proxy({}, {get(_,url){if(typeof url!=='string'||!url.startsWith('https://fonts.googleapis.com/'))return undefined;const family=new URL(url).searchParams.get('family').split(':')[0];const key={'Geist':'geist','Geist Mono':'geist-mono','Caveat':'caveat','Kalam':'kalam'}[family];if(!key)throw Error('Unmapped local font '+family);fs.appendFileSync(${JSON.stringify(resolve(output,'build-font-log.jsonl'))},JSON.stringify({url,delivery:'existing local bytes'})+'\\n');return fonts.filter(f=>f.name===key).map(f=>'/* latin */\\n@font-face {\\n font-family: "'+family+'";\\n font-style: normal;\\n font-weight: '+f.weight+';\\n src: url('+f.path+') format("woff2");\\n}').join('\\n');}});`);
const guard=resolve(output,'build-network-guard.cjs');
await writeFile(guard,`const fs=require('node:fs'),net=require('node:net'),dns=require('node:dns');const log=${JSON.stringify(resolve(output,'build-network-log.jsonl'))};function check(host){if(host&&!['localhost','127.0.0.1','::1'].includes(host)){fs.appendFileSync(log,JSON.stringify({blocked:host})+'\\n');throw Error('OFFLINE_BUILD_EXTERNAL_NETWORK_BLOCKED');}}const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){let o=args[0];if(Array.isArray(o))o=o[0];if(o&&typeof o==='object')check(o.host||o.hostname);else if(typeof o==='number'||/^\\d+$/.test(o))check(typeof args[1]==='string'?args[1]:undefined);return connect.apply(this,args);};const lookup=dns.lookup;dns.lookup=function(host,...args){check(host);return lookup.call(this,host,...args);};const fetch=global.fetch;global.fetch=function(input,...args){const url=new URL(typeof input==='string'?input:input.url||input.href);check(url.hostname);return fetch.call(this,input,...args);};`);
await writeFile(resolve(output,'build-network-log.jsonl'),'');
const env={...process.env,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',CI:'1',NEXT_FONT_GOOGLE_MOCKED_RESPONSES:fontMock,NODE_OPTIONS:`--require "${guard.replaceAll('\\','/')}"`};
const command=[resolve(root,'node_modules/next/dist/bin/next'),'build','--webpack'];
await writeFile(resolve(output,'build-inputs.json'),JSON.stringify({command:[process.execPath,...command],cwd:source,files:paths,envFiles:[],credentials:false,fontPolicy:'Existing Next Google-font test response hook; local woff2 copies; no loader/config/source substitutions.',network:'External Node sockets/DNS/fetch blocked by inherited preload. Telemetry disabled.',sourceCopy:true},null,2));
const run=spawnSync(process.execPath,command,{cwd:source,env,encoding:'utf8',maxBuffer:32*1024*1024});
await writeFile(resolve(output,'next-build.log'),(run.stdout??'')+(run.stderr??''));
const sourceUnchanged=(await Promise.all(paths.map(async path=>sha(await readFile(resolve(root,path)))===sourceHashes[path]))).every(Boolean);
await writeFile(resolve(output,'next-build-result.json'),JSON.stringify({exitCode:run.status,signal:run.signal,error:run.error?.message??null,command:['next','build','--webpack'],sourceCopy:source,oneBuildAttempt:true,sourceUnchanged,hashManifest:'build-source-hashes.json'},null,2));
console.log(`One real offline next build completed: exit ${run.status}.`);
