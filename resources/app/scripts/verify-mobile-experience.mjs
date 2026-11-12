// Isolated UI fixtures: every request is intercepted; no real funds or records are used.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { fixture, wallet, profile } from '../test/fixtures/solvex-preview.mjs';

const root=path.resolve(import.meta.dirname,'../public');
const output=path.resolve(import.meta.dirname,'../../../output/solvex-mobile-upgrade-20261112');
fs.mkdirSync(output,{recursive:true});
const errors=[],missing=[],writes=[],layouts=[];
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
let page;
try {
  page=await browser.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.emulateTimezone('Asia/Shanghai');
  await page.evaluateOnNewDocument(wallet=>{
    window.ethereum={request:async({method})=>{
      if(['eth_accounts','eth_requestAccounts'].includes(method))return [wallet];
      if(method==='eth_chainId')return '0x38';
      if(method==='personal_sign')return 'ISOLATED_UI_PREVIEW';
      throw Error('Unexpected wallet method: '+method);
    },on(){},removeListener(){}};
    window.EventSource=class {static CLOSED=2;readyState=1;close(){}addEventListener(){}removeEventListener(){}};
  },wallet);
  await page.setRequestInterception(true);
  page.on('request',request=>{
    if(request.isInterceptResolutionHandled())return;
    const url=new URL(request.url());
    if(url.hostname!=='design.test')return request.abort();
    if(url.pathname.startsWith('/api/')){
      let result=fixture(url),status=200;
      if(url.pathname==='/api/a-token/profile')result={...profile,account:{totalEquity:'9885.05',availableMargin:'8600',spotValue:'1285.05',positionEquity:'0',strategyValue:'0',stakingValue:'0'}};
      if(url.pathname==='/api/wallet/profile')result={authenticated:true,address:wallet,userId:'ISOLATED_UI',balances:profile.balances,withdrawals:[],deposits:[{createdAt:Date.now()-3600000,network:'bsc',networkName:'BNB Smart Chain',asset:'USDT',amount:'100',status:'confirmed',txHash:'ISOLATED_TEST_TRANSACTION'}]};
      if(request.method()!=='GET'){
        writes.push({path:url.pathname,method:request.method()});
        if(!['/api/wallet/login-challenge','/api/wallet/login-sign','/api/support/read','/api/community/read','/api/hyperliquid/info'].includes(url.pathname)){status=403;result={error:'Isolated mobile review blocks mutations'};}
      }
      return request.respond({status,contentType:'application/json',body:JSON.stringify(result)});
    }
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){missing.push(url.pathname);return request.respond({status:404,body:''});}
    return request.respond({contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.ico':'image/x-icon'})[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,150)))));
  const click=async selector=>{await page.$eval(selector,e=>e.scrollIntoView({block:'center',inline:'nearest'}));await page.click(selector);await settle();};
  const text=(selector,value)=>page.waitForFunction((s,v)=>[...document.querySelectorAll(s)].some(e=>e.textContent.includes(v)),{},selector,value);
  const visit=async name=>{
    await page.evaluate(async name=>{await window.switchTab(name);window.scrollTo(0,0);},name);
    await page.waitForSelector('#tab-'+name+'.active');
    const ready={trade:'#trade-chart canvas','a-token-trade':'#atrade-chart canvas',account:'.assets-total',referrals:'.rx-team-next'}[name];
    if(ready)await page.waitForSelector(ready);
    await settle();
  };
  const snap=async name=>{await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});};
  const fits=async selector=>page.$eval(selector,e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1;});
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await page.goto('https://design.test/#/trade',{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>window.currentWalletProfile?.authenticated);
  await visit('trade');
  assert.equal(await page.$eval('.mt-bottom-nav',e=>getComputedStyle(e).position),'static','trading views no longer form a second fixed navigation');
  assert.ok(await fits('.mt-bottom-nav'));
  assert.equal(await page.$eval('#tab-trade .terminal-bottom',e=>getComputedStyle(e).display),'none','market view does not repeat account tabs below the chart');
  assert.equal(await page.$eval('.mt-drawing-tools',e=>getComputedStyle(e).display),'none','advanced drawing tools start collapsed');
  await click('[data-mt-action=tools]');
  assert.equal(await page.$eval('[data-mt-action=tools]',e=>e.getAttribute('aria-expanded')),'true');
  await click('[data-mt-action=tools]');
  await snap('trade-mobile');
  await click('[data-mt-view=trade]');
  await page.waitForSelector('#trade-order-size',{visible:true});
  await page.type('#trade-order-size','12.34');
  await click('[data-mt-view=market]');await click('[data-mt-view=trade]');
  assert.equal(await page.$eval('#trade-order-size',e=>e.value),'12.34','view switching preserves the draft');
  assert.equal(await page.$eval('#trade-order-size',e=>getComputedStyle(e).fontSize),'16px','amount input avoids iOS focus zoom');
  await snap('trade-order-mobile');
  await click('[data-mt-view=account]');await page.waitForSelector('#trade-account-tabs',{visible:true});
  await page.evaluate(()=>window.openTradePage('perp'));await settle();await click('[data-mt-view=trade]');
  await text('#trade-buy-label','做多');await snap('perp-order-mobile');

  await visit('a-token-trade');
  assert.equal(await page.$eval('#svx-order-sheet',e=>e.open),false);
  assert.ok(await fits('.svx-mobile-actions'));
  const actionPosition=await page.evaluate(()=>({actions:document.querySelector('.svx-mobile-actions').getBoundingClientRect().bottom,dock:document.querySelector('.rx-mobile-dock').getBoundingClientRect().top}));
  assert.ok(Math.abs(actionPosition.actions-actionPosition.dock)<=1,'quick actions sit above the site dock');
  await snap('svx-mobile');
  await click('.svx-mobile-buy');await page.waitForFunction(()=>document.querySelector('#svx-order-sheet')?.matches(':modal'));
  assert.ok(await fits('#svx-order-sheet'));
  await page.type('#atrade-input-amount','100');await snap('svx-buy-sheet');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#svx-order-sheet').open);
  await click('.svx-mobile-buy');assert.equal(await page.$eval('#atrade-input-amount',e=>e.value),'100','dismiss and reopen retains same-side draft');
  await click('.svx-order-sheet-head button');await click('.svx-mobile-sell');await text('#atrade-input-label','卖出');
  await snap('svx-sell-sheet');
  await page.setViewport({width:390,height:480,isMobile:true,hasTouch:true});await settle();assert.ok(await fits('#svx-order-sheet'),'sheet fits a shorter viewport');
  await page.setViewport({width:1440,height:1050});await settle();
  assert.equal(await page.$eval('#svx-order-sheet',e=>e.open&&!e.matches(':modal')),true,'desktop restores the inline form');
  assert.equal(await page.$eval('.svx-mobile-actions',e=>getComputedStyle(e).display),'none');
  await snap('svx-desktop');
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await settle();

  await visit('account');
  assert.equal(await page.$eval('.assets-metrics',e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),2);
  assert.equal(await page.$eval('.assets-distribution',e=>e.open),false);
  assert.ok(await page.$eval('.assets-mobile-list',e=>e.getBoundingClientRect().top<innerHeight),'coin balances are reached in the first viewport');
  await snap('assets-mobile');
  await click('.assets-mobile-coin summary');
  assert.equal(await page.$eval('.assets-mobile-coin',e=>e.open),true);
  await click('.assets-mobile-coin-actions button');await page.waitForSelector('.assets-deposit-sheet',{visible:true});
  await settle();assert.ok(await fits('.assets-deposit-sheet'));await snap('assets-deposit-sheet');
  await page.keyboard.press('Escape');await page.waitForSelector('.assets-deposit-sheet',{hidden:true});
  await page.type('.assets-search input','NO_MATCH_ISOLATED');await text('.assets-mobile-list','没有符合条件');
  await page.focus('.assets-search input');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
  await click('.assets-records-shortcut');await text('.rec-cards','充值');
  await click('.rec-cards details summary');assert.equal(await page.$eval('.rec-cards details',e=>e.open),true,'record details expand without relying on legacy handlers');
  await snap('assets-records-mobile');

  await visit('referrals');
  assert.equal(await page.$eval('.rx-team-rules details',e=>e.open),false);
  assert.ok(await page.$eval('.rx-team-next',e=>e.getBoundingClientRect().top<innerHeight),'upgrade progress appears in the first viewport');
  await text('.rx-team-next','还差 5,000');
  assert.ok(await page.$eval('.rx-team-hero',e=>e.getBoundingClientRect().height<150),'decorative level display is compact');
  await snap('team-mobile');
  const selectTeam=async label=>{const id=await page.evaluate(label=>[...document.querySelectorAll('.rx-team-tabs [role=tab]')].find(e=>e.textContent===label)?.id,label);assert.ok(id);await click(`[id="${id}"]`);};
  await selectTeam('团队成员');await page.waitForSelector('.rx-team-members-mobile summary',{visible:true});await click('.rx-team-members-mobile summary');await snap('team-members-mobile');
  await selectTeam('邀请好友');await page.waitForSelector('#invite-link');
  assert.ok(await page.$eval('#invite-link',e=>e.getBoundingClientRect().top<innerHeight),'invite link is reached in the first viewport');
  await snap('team-invite-mobile');
  await selectTeam('团队概览');

  for(const width of [320,360,390,428,768,900,1440]){
    await page.setViewport({width,height:width>900?1050:844,isMobile:width<=768,hasTouch:width<=768});
    for(const name of ['trade','a-token-trade','account','referrals']){
      await visit(name);
      const metrics=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth}));
      assert.ok(metrics.document<=metrics.width+1,`${name} does not overflow at ${width}px: ${JSON.stringify(metrics)}`);
      layouts.push({name,...metrics});
      if(name==='a-token-trade'&&width<=768){await click('.svx-mobile-buy');assert.ok(await fits('#svx-order-sheet'));await page.keyboard.press('Escape');}
      if(name==='referrals'){
        await selectTeam('团队成员');
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        await selectTeam('团队概览');
      }
    }
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual(missing,[]);
  assert.ok(!writes.some(r=>!['/api/wallet/login-challenge','/api/wallet/login-sign','/api/support/read','/api/community/read','/api/hyperliquid/info'].includes(r.path)),'review never submits a financial operation');
  const result={status:'passed',mode:'isolated fixtures; every request intercepted; no financial writes',layouts,errors,missing,writes};
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({status:'passed',output,layouts:layouts.length}));
} catch(error) {
  await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
  fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.stack,errors,missing,writes},null,2));
  throw error;
} finally {await browser.close();}
