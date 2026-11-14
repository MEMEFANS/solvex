import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const code=transformSync(fs.readFileSync(new URL('../frontend/src/lib/module-recovery.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code;
function setup({href='https://example.test/?ref=INVITE#/referrals',online=true,stored=null}={}) {
  const redirects=[],handlers=new Map();let value=stored;
  const context={exports:{},module:{exports:{}},URL,Date,Error,String,Number,Math,
    location:{href,replace:url=>redirects.push(url)},navigator:{onLine:online},
    sessionStorage:{getItem:()=>value,setItem:(_,v)=>{value=v;}},
    window:{addEventListener:(name,fn)=>handlers.set(name,fn)},
  };
  vm.runInNewContext(code,context);
  return {context,redirects,handlers,getStored:()=>value};
}
const error=new Error('Failed to fetch dynamically imported module: https://example.test/app/assets/team-old.js');
const first=setup();let prevented=false;
first.handlers.get('vite:preloadError')({payload:error,preventDefault:()=>{prevented=true;}});
assert(prevented);assert.equal(first.redirects.length,1);
const recoveredUrl=new URL(first.redirects[0]);
assert.equal(recoveredUrl.hash,'#/referrals');assert.equal(recoveredUrl.searchParams.get('ref'),'INVITE');
assert(recoveredUrl.searchParams.has('__svx_reload'));
first.handlers.get('vite:preloadError')({payload:error,preventDefault(){}});
assert.equal(first.redirects.length,1,'Multiple missing dependencies cause just one navigation');
const next=setup({href:recoveredUrl.href,stored:first.getStored()});
next.handlers.get('vite:preloadError')({payload:error,preventDefault(){throw Error('Must allow fallback during cooldown');}});
assert.equal(next.redirects.length,0,'Persistent deployment failures never create a reload loop');
for(const candidate of [setup({online:false}),setup()]) {
  candidate.handlers.get('vite:preloadError')({payload:candidate.context.navigator.onLine?new Error('Insufficient USDT'):error,preventDefault(){throw Error('Unexpected recovery');}});
  assert.equal(candidate.redirects.length,0,'Offline and business errors do not trigger page reloads');
}
console.log('PASS: stale imports recover once, preserve route and referral, never loop, and ignore offline/business errors');
