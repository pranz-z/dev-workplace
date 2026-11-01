// Added only to existing browser tests running from the external source snapshot.
// Individual tests install their synthetic page routes after this deny boundary.
import {chromium} from 'playwright';
import {appendFileSync} from 'node:fs';
const original=chromium.launch.bind(chromium);
const guard=async target=>target.route('**/*',route=>{const u=new URL(route.request().url());if(u.protocol==='http:'&&u.hostname==='127.0.0.1')return route.continue();if(process.env.REDESIGN_BROWSER_NETWORK_LOG)appendFileSync(process.env.REDESIGN_BROWSER_NETWORK_LOG,JSON.stringify({url:u.href,disposition:'denied-before-network'})+'\n');return route.abort('blockedbyclient');});
chromium.launch=async options=>{
 const browser=await original({...options,args:[...(options?.args??[]),'--disable-background-networking','--disable-component-update','--no-pings']});
 const context=browser.newContext.bind(browser),page=browser.newPage.bind(browser);
 browser.newContext=async options=>{const c=await context(options);await guard(c);return c;};
 browser.newPage=async options=>{const p=await page(options);await guard(p.context());return p;};
 return browser;
};
