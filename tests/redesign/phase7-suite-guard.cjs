// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node's --require preload must be CommonJS.
const fs=require('node:fs'),net=require('node:net'),dns=require('node:dns');
function check(host){if(host&&!['localhost','127.0.0.1','::1'].includes(host)){if(process.env.REDESIGN_SUITE_NETWORK_LOG)fs.appendFileSync(process.env.REDESIGN_SUITE_NETWORK_LOG,JSON.stringify({host,disposition:'blocked-before-network'})+'\n');throw Error('PHASE7_EXTERNAL_NETWORK_BLOCKED');}}
const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){let o=args[0];if(Array.isArray(o))o=o[0];if(o&&typeof o==='object')check(o.host||o.hostname);else if(typeof o==='number'||/^\d+$/.test(o))check(typeof args[1]==='string'?args[1]:undefined);return connect.apply(this,args);};
const lookup=dns.lookup;dns.lookup=function(host,...args){check(host);return lookup.call(this,host,...args);};
const fetch=global.fetch;global.fetch=function(input,...args){check(new URL(typeof input==='string'?input:input.url||input.href).hostname);return fetch.call(this,input,...args);};
