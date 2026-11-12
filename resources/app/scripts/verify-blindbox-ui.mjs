// All requests are intercepted. The rewards below are isolated synthetic UI fixtures.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { fixture, wallet, profile } from '../test/fixtures/solvex-preview.mjs';

const root=path.resolve(import.meta.dirname,'../public');
const output=path.resolve(import.meta.dirname,'../../../output/solvex-blindbox-20261112');
fs.mkdirSync(output,{recursive:true});
const errors=[],missing=[],writes=[],layouts=[];
let price='0.1375',priceStatus=200,joinStatus=503,joinDelay=0;
let state={joined:false,box:null,pending:[],pendingCoins:'0',rules:{entryUsdt:'1',claimDays:30,minCoins:'100',maxCoins:'500'}};
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
let page;
try {
  page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await page.evaluateOnNewDocument(wallet=>{
    window.ethereum={request:async({method})=>{if(['eth_accounts','eth_requestAccounts'].includes(method))return [wallet];if(method==='eth_chainId')return '0x38';if(method==='personal_sign')return 'ISOLATED_BLINDBOX_PREVIEW';throw Error(method);},on(){},removeListener(){}};
    window.EventSource=class{static CLOSED=2;readyState=1;close(){}addEventListener(){}removeEventListener(){}};
  },wallet);
  await page.setRequestInterception(true);
  page.on('request',async request=>{
    if(request.isInterceptResolutionHandled())return;
    const url=new URL(request.url());
    if(url.hostname!=='design.test')return request.abort();
    if(url.pathname.startsWith('/api/')){
      let result=fixture(url),status=200;
      if(url.pathname==='/api/wallet/profile')result={authenticated:true,address:wallet,balances:profile.balances,deposits:[],withdrawals:[]};
      if(url.pathname==='/api/a-token/blindbox')result=state;
      if(url.pathname==='/api/a-token/pool'){status=priceStatus;result=priceStatus===200?{...fixture(url),priceUsdt:price}:{error:'隔离测试：参考价格暂不可用'};}
      if(request.method()!=='GET'){
        writes.push({path:url.pathname,headers:request.headers(),body:request.postData()});
        if(url.pathname==='/api/a-token/blindbox/join'){
          if(joinDelay)await new Promise(resolve=>setTimeout(resolve,joinDelay));
          status=joinStatus;
          if(status===200){state={...state,joined:true,box:{totalCoins:'100',dailyQuotaCoins:'3.333333333333333333',claimDays:30,remainingCoins:'100'}};result={ok:true,...state.box,overview:state};}
          else result={error:'隔离测试：开盒失败，未扣款'};
        }else if(!['/api/wallet/login-challenge','/api/wallet/login-sign','/api/support/read','/api/community/read','/api/hyperliquid/info'].includes(url.pathname)){status=403;result={error:'Isolated UI review blocks other writes'};}
      }
      return request.respond({status,contentType:'application/json',body:JSON.stringify(result)});
    }
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){missing.push(url.pathname);return request.respond({status:404,body:''});}
    return request.respond({contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.ico':'image/x-icon'})[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  const text=(selector,value)=>page.waitForFunction((s,v)=>document.querySelector(s)?.textContent.includes(v),{},selector,value);
  const clickText=(selector,value)=>page.evaluate((s,v)=>[...document.querySelectorAll(s)].find(el=>el.textContent.includes(v))?.click(),selector,value);
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,80)))));
  let visitNumber=0;
  const visit=async()=>{
    await page.goto('https://design.test/?isolatedCase='+(++visitNumber)+'#/earn',{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>window.currentWalletProfile?.authenticated&&typeof window.earnSwitch==='function');
    await page.evaluate(()=>window.earnSwitch('blindbox'));
    await page.waitForSelector('.svx-mystery-art');
    await page.waitForFunction(()=>[...document.querySelectorAll('.svx-box-frame-body,.svx-box-frame-lid > img')].every(img=>img.complete&&img.naturalWidth>0));
    await settle();
  };
  const screenshot=async name=>{await page.$eval('.svx-blindbox-hero',el=>el.scrollIntoView({block:'start'}));await settle();await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});};
  const phase=()=>page.$eval('.svx-mystery-art',el=>el.dataset.boxPhase);
  const joins=()=>writes.filter(row=>row.path==='/api/a-token/blindbox/join');
  await visit();await text('.svx-box-preview','13.75–68.75 USDT');
  assert.equal(await phase(),'closed');await screenshot('blindbox-closed-mobile');
  await clickText('.svx-box-actions button','开盲盒');await page.waitForSelector('.ui-dialog[role=dialog]');
  await clickText('.ui-dialog button','取消');assert.equal(joins().length,0,'cancelling does not open or charge a box');
  await clickText('.svx-box-actions button','开盲盒');await page.waitForSelector('.ui-dialog[role=dialog]');await clickText('.ui-dialog button','确认操作');
  await text('[data-sonner-toaster]','开盒失败');assert.equal(await phase(),'closed');
  assert.equal(await page.$('[data-box-token-amount]'),null,'failed requests reveal no fabricated reward');
  joinStatus=200;joinDelay=900;
  await clickText('.svx-box-actions button','开盲盒');await page.waitForSelector('.ui-dialog[role=dialog]');await clickText('.ui-dialog button','确认操作');
  await page.waitForFunction(()=>document.querySelector('.svx-mystery-art')?.dataset.boxPhase==='waiting');
  assert.equal(await page.$('[data-box-token-amount]'),null,'waiting for the server does not reveal a reward');
  await page.waitForFunction(()=>document.querySelector('.svx-mystery-art')?.dataset.boxPhase==='opening');
  await page.screenshot({path:path.join(output,'blindbox-opening-mobile.png')});
  await page.waitForFunction(()=>document.querySelector('.svx-mystery-art')?.dataset.boxPhase==='opened');
  await text('[data-box-token-amount]','100');await text('[data-box-usdt-value]','13.75 USDT');
  assert.equal(joins().length,2);
  assert.equal(joins()[0].headers['idempotency-key'],joins()[1].headers['idempotency-key'],'failed request retry retains its request ID');
  assert.equal(JSON.parse(joins()[1].body).signature,'ISOLATED_BLINDBOX_PREVIEW');
  await screenshot('blindbox-opened-mobile');
  await page.reload({waitUntil:'networkidle0'});await page.waitForFunction(()=>typeof window.earnSwitch==='function');await page.evaluate(()=>window.earnSwitch('blindbox'));
  await text('[data-box-usdt-value]','13.75 USDT');assert.equal(await phase(),'opened','refresh restores the actual reward');
  assert.equal(await page.$$eval('.svx-box-actions button',buttons=>buttons.some(b=>b.textContent.includes('支付'))),false);
  await clickText('.svx-box-opened-state button','重播动画');await page.waitForSelector('.svx-mystery-skip');await page.click('.svx-mystery-skip');assert.equal(await phase(),'opened');assert.equal(joins().length,2,'replay never submits another join');
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await clickText('.svx-box-opened-state button','重播动画');assert.equal(await phase(),'opened','reduced motion skips animation');
  for(const width of [320,360,390,428,768,900,1440]){
    await page.setViewport({width,height:width>900?1050:844,isMobile:width<768,hasTouch:width<768});await settle();
    const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,images:[...document.querySelectorAll('.svx-box-frame-body,.svx-box-frame-lid > img')].map(img=>img.naturalWidth),value:document.querySelector('[data-box-usdt-value]')?.textContent}));
    assert.ok(layout.scroll<=layout.width+1,'no horizontal overflow at '+width);assert.ok(layout.images.every(width=>width>0));layouts.push(layout);
    if(width===1440)await screenshot('blindbox-opened-desktop');
  }
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  price='0.2';await visit();await text('[data-box-usdt-value]','20 USDT');
  priceStatus=503;await visit();await text('.svx-box-price-note','估值暂不可用');await text('[data-box-usdt-value]','— USDT');await screenshot('blindbox-price-unavailable');
  priceStatus=200;price='0.125';await page.click('.svx-box-price-note button');await text('[data-box-usdt-value]','12.5 USDT');
  price='NaN';await visit();await text('.svx-box-price-note','估值暂不可用');await text('[data-box-usdt-value]','— USDT');
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({status:'passed',layouts,errors,missing,isolatedJoinRequests:joins().length},null,2));
  console.log(JSON.stringify({status:'passed',layouts:layouts.length,isolatedJoinRequests:joins().length}));
}catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.message,errors,missing,writes:writes.map(row=>row.path)},null,2));throw error;}
finally{await browser.close();}
