// All requests use an isolated fixture origin. No business database is opened.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {wallet,profile,fixture} from '../test/fixtures/solvex-preview.mjs';
const root=path.resolve(import.meta.dirname,'../public');
const out=path.resolve(import.meta.dirname,'../../../output/solvex-mine-wall-20261111');
fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const errors=[],results=[];
let authenticated=true,nodes=[],failure=false,delay=0,caseNumber=0;
const node=(principal,status='active',expiresAt=Date.now()+86400000)=>({...profile.nodes[0],id:Math.random().toString(36),principal,status,expiresAt});
try {
 const page=await browser.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:1080});
 await page.evaluateOnNewDocument(wallet=>{window.ethereum={request:async({method})=>['eth_accounts','eth_requestAccounts'].includes(method)?[wallet]:method==='eth_chainId'?'0x38':'PREVIEW',on(){},removeListener(){}};window.EventSource=class {static CLOSED=2;readyState=1;close(){}addEventListener(){}removeEventListener(){}};},wallet);
 await page.setRequestInterception(true);
 page.on('request',async request=>{
  if(request.isInterceptResolutionHandled())return;
  const url=new URL(request.url());
  if(url.hostname!=='mine.test')return request.abort();
  if(url.pathname.startsWith('/api/')){
   let body=fixture(url),status=200;
   if(url.pathname==='/api/wallet/session')body={authenticated,address:authenticated?wallet:null};
   if(url.pathname==='/api/wallet/profile')body={authenticated,address:wallet,userId:'PREVIEW',balances:profile.balances};
   if(url.pathname==='/api/a-token/profile'){
    if(delay)await new Promise(r=>setTimeout(r,delay));
    status=failure?503:200;body=failure?{error:'预览网络异常'}:{...profile,nodes};
   }
   if(request.method()!=='GET'&&!url.pathname.startsWith('/api/wallet/login-')){status=403;body={error:'isolated preview: mutations disabled'};}
   return request.respond({status,contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
  }
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return request.respond({status:404,body:''});
  return request.respond({contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
 });
 async function load(mode){
  await page.goto('https://mine.test/?mineCase='+ ++caseNumber +'#/earn',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(mode=>document.querySelector('[data-mining-scene]')?.dataset.sceneMode===mode,{timeout:20000},mode);
  await page.$eval('[data-mining-scene]',e=>e.scrollIntoView({block:'start'}));
  await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))));
 }
 const counts=()=>page.$$eval('[data-mine-tier]',els=>Object.fromEntries(els.map(e=>[e.dataset.mineTier,{working:e.dataset.working,label:e.querySelector('.rx-cavern-label').textContent,workers:e.querySelectorAll('.rx-cavern-worker').length}])));
 // Thresholds stay exact even one wei below a new tier.
 nodes=[node('1000'),node('1999.999999999999999999'),node('2000'),node('9999.999999999999999999'),node('10000'),node('50000'),node('1000','active',Date.now()-1),node('10000','expired')];
 await load('active');
 let tiers=await counts();
 for(const tier of ['copper','silver','gold']){assert.equal(tiers[tier].workers,1);assert.ok(tiers[tier].label.includes('2 份运行中'));}
 assert.equal(await page.$eval('[data-mining-scene]',e=>e.dataset.activePools),'6');
 assert.equal(await page.$eval('.rx-cavern-stage',e=>Math.round(e.clientWidth/e.clientHeight*100)),178,'native image ratio retained');
 results.push('exact 1000 / 2000 / 10000 boundaries; expired orders excluded; one miner per tier');
 await page.waitForFunction(()=>document.querySelector('[data-mining-scene]').dataset.animationRunning==='true');
 const frames=()=>page.$eval('.rx-cavern-worker',e=>getComputedStyle(e).backgroundPosition);
 const seen=new Set();for(let i=0;i<9;i++){seen.add(await frames());await new Promise(r=>setTimeout(r,90));}assert.ok(seen.size>3,'visible swing progresses through frames');
 await page.click('.rx-cavern-toggle');await page.waitForFunction(()=>document.querySelector('[data-mining-scene]').dataset.animationRunning==='false');
 const frozen=await frames();await new Promise(r=>setTimeout(r,260));assert.equal(await frames(),frozen);
 await page.click('.rx-cavern-toggle');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 assert.ok(await page.$$eval('.rx-cavern-worker',es=>es.every(e=>getComputedStyle(e).animationName==='none')));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
 await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
 await page.waitForFunction(()=>document.querySelector('[data-mining-scene]').dataset.animationRunning==='false');
 results.push('frame progression, pause/resume, reduced motion, and offscreen pause');
 nodes=[node('2000'),node('9000')];await load('active');tiers=await counts();assert.equal(tiers.copper.workers,0);assert.equal(tiers.silver.workers,1);assert.equal(tiers.gold.workers,0);
 results.push('only the held tier receives a miner');
 nodes=[];await load('preview');assert.equal(await page.$$('.rx-cavern-worker').then(x=>x.length),3);assert.ok(await page.$eval('.rx-cavern-state',e=>e.textContent.includes('预览')));
 for(const width of [360,390,430,768]){
  await page.setViewport({width,height:844,isMobile:true,hasTouch:true});
  await page.waitForSelector('[data-scene-style=toy]');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const bounds=await page.$eval('.rx-cavern-viewport',e=>({width:e.clientWidth,content:e.scrollWidth,stage:e.querySelector('.rx-cavern-stage').clientWidth}));
  assert.equal(bounds.content,bounds.width,'entire panorama fits without horizontal scrolling at '+width);
  assert.equal(bounds.stage,bounds.width,'stage scales with viewport at '+width);
 }
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await page.click('.rx-cavern-zones [data-tone=gold]');
 assert.equal(await page.$eval('.rx-cavern-zones [data-tone=gold]',e=>e.getAttribute('aria-pressed')),'true');
 assert.equal(await page.$eval('[data-mine-tier=gold]',e=>e.dataset.selected),'true');
 await page.click('.rx-cavern-zones [data-tone=copper]');
 assert.equal(await page.$eval('.rx-cavern-viewport',e=>e.scrollLeft),0);
 results.push('360 / 390 / 430 / 768px: complete panorama visible without cropping or horizontal scrolling; tier selection preserved');
 delay=1200;await load('loading');assert.equal(await page.$$('.rx-cavern-worker').then(x=>x.length),0);await page.waitForFunction(()=>document.querySelector('[data-mining-scene]').dataset.sceneMode==='preview');delay=0;
 failure=true;await load('error');assert.equal(await page.$$('.rx-cavern-worker').then(x=>x.length),0);assert.ok(await page.$eval('[data-mining-scene]',e=>!e.textContent.includes('运行中')));failure=false;
 authenticated=false;await load('preview');assert.equal(await page.$$('.rx-cavern-worker').then(x=>x.length),3);
 results.push('loading/error show no workers; guest/no-holding scenes explicitly marked as preview');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'browser-check.json'),JSON.stringify({passed:true,results,errors},null,2));
 console.log(JSON.stringify({passed:true,results,errors}));
}finally{await browser.close();}
