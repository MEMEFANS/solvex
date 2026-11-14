import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const handlers = new Map(), entries = new Map();
let downloads = 0;
const cache = {
  match:async request => entries.get(request.url)?.clone(),
  put:async (request,response) => {entries.set(request.url,response);},
};
vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'), {
  URL, Response, setTimeout,
  location:{origin:'https://cache.test'},
  self:{addEventListener:(name,handler)=>handlers.set(name,handler)},
  caches:{open:async()=>cache,match:cache.match},
  fetch:async()=>{++downloads;return new Response('fresh asset');},
});
async function request(url, method='GET') {
  const pending=[];
  let response;
  const event={request:{url:'https://cache.test'+url,method,mode:'cors'},respondWith:promise=>{response=promise;},waitUntil:promise=>pending.push(promise)};
  handlers.get('fetch')(event);
  const resolved=response ? await response : null;
  await Promise.all(pending);
  return resolved;
}
const versioned = '/js/wallet.js?v=67';
entries.set('https://cache.test'+versioned,new Response('cached release'));
assert.equal(await (await request(versioned)).text(),'cached release');
assert.equal(downloads,0,'Returning users do not download their already cached version while login is pending');
assert.equal(await (await request('/js/earn.js?v=new')).text(),'fresh asset');
assert.equal(downloads,1);
assert.equal(await (await request('/js/earn.js?v=new')).text(),'fresh asset');
assert.equal(downloads,1);
entries.set('https://cache.test/assets/preview.png',new Response('old image'));
assert.equal(await (await request('/assets/preview.png')).text(),'old image');
assert.equal(downloads,2,'Unversioned assets still refresh in the background');
assert.equal(await entries.get('https://cache.test/assets/preview.png').clone().text(),'fresh asset');
const immutable = '/app/assets/index-AbCd1234.js';
entries.set('https://cache.test'+immutable,new Response('hashed build'));
assert.equal(await (await request(immutable)).text(),'hashed build');
assert.equal(downloads,2,'Content-hashed Vite assets are served from cache without any revalidation');
assert.equal(await (await request('/app/assets/index-NewHa5h.js')).text(),'fresh asset');
assert.equal(downloads,3,'A new deploy publishes new URLs, which download exactly once');
assert.equal(await request('/api/wallet/session'),null);
assert.equal(await request('/api/wallet/login-sign','POST'),null);
assert.equal(downloads,3,'Authentication and API traffic is never handled by the static cache');
console.log('PASS: cached release skips network; new version downloads once; unversioned assets update; hashed builds never revalidate; API/signature requests bypass cache');

// A CDN may have cached a 404 before the release assets were restored.
const recoveryFetches = [];
const recoveryEntries = new Map();
const recoveryHandlers = new Map();
vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'), {
  URL, Response, Date, setTimeout, location:{origin:'https://cache.test'},
  self:{addEventListener:(name,handler)=>recoveryHandlers.set(name,handler)},
  caches:{open:async()=>({match:async request=>recoveryEntries.get(request.url)?.clone(),put:async(request,response)=>recoveryEntries.set(request.url,response)})},
  fetch:async request=>{
    const url=typeof request==='string'?request:request.url;
    recoveryFetches.push(url);
    return url.includes('__svx_asset_retry=')
      ? new Response('export default "restored module"',{headers:{'Content-Type':'text/javascript'}})
      : new Response('missing',{status:404});
  },
});
async function recoveredAsset(url) {
  const pending=[];let response;
  recoveryHandlers.get('fetch')({request:{url,method:'GET',mode:'cors'},respondWith:p=>response=p,waitUntil:p=>pending.push(p)});
  const result=await response;await Promise.all(pending);return result;
}
const restoredUrl='https://cache.test/app/assets/team-old.js';
assert.equal((await recoveredAsset(restoredUrl)).status,200);
assert.equal(recoveryFetches.length,2);
assert.match(recoveryFetches[1],/__svx_asset_retry=/);
assert.equal(await (await recoveredAsset(restoredUrl)).text(),'export default "restored module"');
assert.equal(recoveryFetches.length,2,'Recovered chunks are cached under their original URL');
const poisonedUrl='https://cache.test/app/assets/ranking-old.js';
recoveryEntries.set(poisonedUrl,new Response('<html>fallback</html>',{headers:{'Content-Type':'text/html'}}));
assert.equal(await (await recoveredAsset(poisonedUrl)).text(),'export default "restored module"');
assert.equal(recoveryFetches.length,4,'HTML cached as a module is discarded and the real module is fetched');
console.log('PASS: cached CDN 404 retries bypass cache; recovered chunks cache correctly; HTML cannot poison the module cache');
