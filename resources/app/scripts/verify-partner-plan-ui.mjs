// Fully intercepted fixtures. This script never connects to the actual backend or submits real funds.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { fixture, wallet, other, team as baseTeam, profile } from '../test/fixtures/solvex-preview.mjs';

const root=path.resolve(import.meta.dirname,'../public'),output=path.resolve(import.meta.dirname,'../../../output/solvex-partner-polish-20261112');
fs.mkdirSync(output,{recursive:true});
const now=Date.now(),day=86400000,nextSettlement=(Math.floor(now/day)+1)*day;
const errors=[],missing=[],writes=[],reads=[];
let currentWallet=wallet,failSecondClaim=true,failHistory=false,failTeam=false;
let team={...baseTeam,level:2,upgradeA:'3500',teamPerfA:'60000'};
const originalPending=[
  {id:'isolated-d1',amountUsdt:'0.100001',availableAt:nextSettlement-day,expiresAt:nextSettlement,status:'pending'},
  {id:'isolated-d2',amountUsdt:'0.200002',availableAt:nextSettlement-day,expiresAt:nextSettlement,status:'pending'},
  {id:'isolated-future',amountUsdt:'99',availableAt:nextSettlement,expiresAt:nextSettlement+day,status:'pending'},
  {id:'isolated-expired',amountUsdt:'88',availableAt:nextSettlement-2*day,expiresAt:nextSettlement-day,status:'pending'},
];
const record=(id,amount,status='claimed')=>({id,bizType:'dividend',asset:'USDT',amountUnits:amount,availableAt:nextSettlement-day,expiresAt:nextSettlement,status,claimedAt:now-1000});
const history={claimed:[record('isolated-history','12340001'),{...record('isolated-other-income','999999999'),bizType:'node'}],expired:[record('isolated-older-expired','1000000','expired')],reversed:[record('isolated-reversed','2000000','reversed')]};
let state={
  tiers:[{key:'t500',label:'500U档',priceUsdt:'500',enabled:true,members:8,maxMembers:100,dividendPct:30,fundedTotalUsdt:'1250',currentPool:{fundedUsdt:'120',progressPct:24}},{key:'t1000',label:'1000U档',priceUsdt:'1000',enabled:false,members:0,maxMembers:0,dividendPct:70,fundedTotalUsdt:'700'}],
  member:{status:'active',tier:'t500',tierLabel:'500U档',principalUsdt:'500',dividendUsdt:'12.340001',s3Qualified:false,qualificationDeadline:now+12*day},
  dividends:structuredClone(originalPending),
  feeBurn:{totalFeeUsdt:'2500',totalBurnBudgetUsdt:'1250',totalPoolUsdt:'1250',entries:[{id:'isolated-fee',createdAt:now,feeUsdt:'10.02',burnUsdt:'5.01',poolUsdt:'5.01'}]},
  pools:[{id:'isolated-pool',tierLabel:'500U档',seq:4,fundedUsdt:'120',status:'filling'}],
};
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.emulateTimezone('America/Los_Angeles');
  await page.evaluateOnNewDocument(wallet=>{window.ethereum={request:async({method})=>{if(['eth_accounts','eth_requestAccounts'].includes(method))return [wallet];if(method==='eth_chainId')return '0x38';if(method==='personal_sign')return 'ISOLATED_PREVIEW';throw Error(method);},on(){},removeListener(){}};window.EventSource=class{static CLOSED=2;readyState=1;close(){}addEventListener(){}removeEventListener(){}};},wallet);
  await page.setRequestInterception(true);
  page.on('request',async request=>{
    const url=new URL(request.url());if(request.isInterceptResolutionHandled())return;
    if(url.hostname!=='design.test')return request.abort();
    if(url.pathname.startsWith('/api/')){
      const p=url.pathname,post=request.method()==='POST';let body=fixture(url),status=200;
      reads.push(url.pathname+url.search);
      if(p==='/api/wallet/session')body={authenticated:true,address:currentWallet};
      if(p==='/api/wallet/profile')body={authenticated:true,address:currentWallet,balances:profile.balances,deposits:[],withdrawals:[]};
      if(p==='/api/a-token/team/profile'){body=team;if(failTeam){status=503;body={error:'隔离测试：资格接口暂时不可用'};}}
      if(p==='/api/a-token/shareholder')body=currentWallet===wallet?state:{...state,member:null,dividends:[]};
      if(p==='/api/a-token/pending'&&!post){if(failHistory){status=503;body={error:'隔离测试：历史记录暂时不可用'};}else body={pending:history[url.searchParams.get('status')]||[]};}
      if(post){
        const data=JSON.parse(request.postData()||'{}');writes.push({path:p,body:data});
        if(p==='/api/a-token/pending/claim'){
          await new Promise(r=>setTimeout(r,100));
          if(data.id==='isolated-d2'&&failSecondClaim){status=503;body={error:'隔离测试：第二笔响应失败'};failSecondClaim=false;}
          else {
            const found=state.dividends.find(r=>r.id===data.id);assert.ok(found,'only existing partner dividend IDs may be submitted');
            state.dividends=state.dividends.filter(r=>r.id!==data.id);history.claimed.push(record(data.id,String(BigInt(found.amountUsdt.replace('.','')))));
            body={ok:true,claim:{id:data.id}};
          }
        }else if(!['/api/wallet/login-challenge','/api/wallet/login-sign','/api/support/read'].includes(p)){status=403;body={error:'Isolated preview blocks other writes'};}
      }
      return request.respond({status,contentType:'application/json',body:JSON.stringify(body)});
    }
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){missing.push(url.pathname);return request.respond({status:404,body:''});}
    return request.respond({contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'})[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  const waitText=(selector,text)=>page.waitForFunction((s,t)=>document.querySelector(s)?.textContent.includes(t),{},selector,text);
  const click=async selector=>{await page.$eval(selector,e=>e.scrollIntoView({block:'center'}));await page.click(selector);};
  const confirm=async()=>{await page.waitForSelector('.ui-dialog[role=dialog]',{visible:true});await page.evaluate(()=>[...document.querySelectorAll('.ui-dialog[role=dialog] button')].find(b=>b.textContent==='确认操作').click());await page.waitForSelector('.ui-dialog[role=dialog]',{hidden:true});};
  const close=async()=>{await page.click('.ui-dialog[role=dialog] .ui-dialog-close');await page.waitForSelector('.ui-dialog[role=dialog]',{hidden:true});};
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,100)))));
  const tab=async value=>{
    const id=await page.evaluate(value=>[...document.querySelectorAll('.pp-record-tabs [role=tab]')].find(b=>b.textContent===value)?.id,value);
    assert.ok(id,`record tab exists: ${value}`);
    await click(`[id="${id}"]`);
    await page.waitForFunction(id=>document.getElementById(id)?.getAttribute('aria-selected')==='true',{},id);
    await settle();
  };
  await page.setViewport({width:1440,height:1050});
  await page.goto('https://design.test/#/partner-plan',{waitUntil:'networkidle0'});await page.waitForSelector('[data-partner-qualification] [role=progressbar]');await settle();
  assert.equal(await page.$eval('.pp-dividend-total strong',e=>e.textContent),'0.300003','sum USDT at six decimals, excluding future and expired rows');
  assert.equal(await page.$$eval('[role=progressbar]',els=>els.map(e=>e.getAttribute('aria-valuenow'))).then(JSON.stringify),'["70","60"]','both V3 conditions show actual progress');
  assert.ok(await page.$eval('.pp-qualification-deadline',e=>e.textContent.includes('12 天')));
  assert.ok(await page.$eval('.pp-dividend-copy > p',e=>e.textContent.includes('08:00')),'time stays in Beijing timezone despite browser timezone');
  assert.equal(await page.$eval('.rx-partner-plan',e=>e.textContent.includes('已付本金')),false);
  assert.ok(await page.$eval('.pp-tier-seats',e=>e.textContent.includes('92')),'remaining seats use real platform count');
  assert.equal(await page.$eval('.pp-reserved-tier',e=>e.getBoundingClientRect().height<110),true,'closed tier stays compact');
  assert.equal(await page.$eval('.pp-reserved-tier button',e=>e.disabled),true);
  await page.screenshot({path:path.join(output,'partner-desktop.png'),fullPage:true});
  assert.equal(await page.$$eval('.pp-record-panel[data-state=active]',e=>e.length),1,'only one record panel renders');
  assert.ok(await page.$$eval('.pp-table tbody tr',rows=>rows.filter(r=>r.textContent.includes('99 USDT')||r.textContent.includes('88 USDT')).every(r=>r.querySelector('button').disabled)),'future and expired dividends cannot be claimed');

  await click('[data-partner-claim]');await waitText('.ui-dialog','0.300003');assert.equal(writes.length,0,'claim awaits explicit confirmation');await close();assert.equal(writes.length,0);
  await click('[data-partner-claim]');await confirm();await waitText('[data-sonner-toaster]','已领取 1 笔，其余未完成');await waitText('.pp-dividend-total','0.200002');
  assert.deepEqual(writes.filter(w=>w.path==='/api/a-token/pending/claim').map(w=>w.body.id),['isolated-d1','isolated-d2'],'partial failure stops without retrying another income type');
  await click('[data-partner-claim]');await confirm();await waitText('.pp-dividend-total','0');await page.waitForFunction(()=>document.querySelector('[data-partner-claim]').disabled);
  assert.deepEqual(writes.filter(w=>w.path==='/api/a-token/pending/claim').map(w=>w.body.id),['isolated-d1','isolated-d2','isolated-d2']);
  assert.ok(!writes.some(w=>w.path.endsWith('/claim-all')),'partner claim never claims unrelated rewards');

  await tab('手续费记录');await waitText('.pp-record-panel[data-state=active]','10.02');
  await tab('分红池记录');await waitText('.pp-record-panel[data-state=active]','#4');
  await tab('分红记录');await page.select('[aria-label="分红状态"]','claimed');await waitText('.pp-record-panel[data-state=active]','12.340001');
  assert.equal(await page.$eval('.pp-record-panel[data-state=active]',e=>e.textContent.includes('999.999999')),false,'historical list excludes non-dividend income');
  await page.select('[aria-label="分红状态"]','expired');await waitText('.pp-record-panel[data-state=active]','88');
  assert.equal(await page.$$eval('.pp-record-panel[data-state=active] tbody tr',els=>els.length),2,'locally expired pending row and server history are merged');
  await page.select('[aria-label="分红状态"]','reversed');await waitText('.pp-record-panel[data-state=active]','已撤回');

  // Status-query failures remain isolated to records and can be retried.
  failHistory=true;await page.select('[aria-label="分红状态"]','claimed');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await click('[aria-label="刷新合伙人计划"]');await waitText('.pp-record-panel .rx-error','历史记录暂时不可用');
  failHistory=false;await click('.pp-record-panel .rx-error button');await waitText('.pp-record-panel[data-state=active]','12.340001');

  // Reload as an unjoined wallet: completed conditions are shown, and joining retains existing confirmation.
  state.member=null;team={...baseTeam};state.dividends=[];
  await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('[data-partner-qualification] [role=progressbar]');await waitText('.rx-metrics','已满足条件');
  assert.ok(await page.$eval('.pp-tier-card .pp-join-button',e=>!e.disabled));
  await click('.pp-join-button');await waitText('.ui-dialog','支付 500 USDT');await close();
  assert.equal(writes.some(w=>w.path.endsWith('/shareholder/join')),false);
  await page.screenshot({path:path.join(output,'partner-unjoined.png'),fullPage:true});

  for(const width of [320,360,390,768,1024,1440]){
    await page.setViewport({width,height:844});await settle();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`no horizontal page overflow at ${width}px`);
    if(width===390){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,'partner-mobile.png'),fullPage:true});}
    await tab('手续费记录');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`fee table stays within panel at ${width}px`);
    await tab('分红记录');
  }
  state.tiers[0].members=100;await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.pp-join-button');await waitText('.pp-join-button','名额已满');assert.equal(await page.$eval('.pp-join-button',e=>e.disabled),true);

  // A failure fetching qualification does not hide the partner page or invent progress.
  failTeam=true;await page.reload({waitUntil:'networkidle0'});await waitText('.pp-qualification-card .rx-error','资格接口暂时不可用');assert.ok(await page.$('.pp-dividend-hero'));assert.equal(await page.$('[role=progressbar]'),null);
  failTeam=false;await click('.pp-qualification-card .rx-error button');await page.waitForSelector('[role=progressbar]');

  state.tiers[0].members=8;state.member={status:'active',tier:'t500',tierLabel:'500U档',principalUsdt:'500',dividendUsdt:'12.340001',s3Qualified:false,qualificationDeadline:now-1000};state.dividends=structuredClone(originalPending);
  await page.reload({waitUntil:'networkidle0'});await waitText('.pp-qualification-deadline','已截止');
  await click('[data-partner-claim]');await page.waitForSelector('.ui-dialog[role=dialog]');const beforeSwitch=writes.length;currentWallet=other;
  await page.evaluate(other=>{window.currentWalletConnection={address:other};window.currentWalletProfile={authenticated:true,address:other};const r=window.getWalletStateRevision();window.getWalletStateRevision=()=>r+1;window.dispatchEvent(new CustomEvent('walletstatechange',{detail:{address:other,authenticated:true}}));},other);
  await page.waitForSelector('.ui-dialog[role=dialog]',{hidden:true});await page.waitForFunction(()=>document.querySelector('[data-partner-claim]')?.disabled);assert.equal(writes.length,beforeSwitch,'wallet switch cancels pending financial confirmation');
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({status:'passed',mode:'isolated fixtures, every request intercepted',checks:['precise USDT sum','future and expired exclusions','Beijing deadlines','both V3 progress bars','remaining seats','compact locked tier','record tabs and filters','dividend-only claim','partial failure and manual retry','historical income filtering','history retry','empty state','unjoined qualified wallet','full capacity','qualification network failure','expired deadline','wallet switch confirmation cancellation','six responsive widths'],writes,errors,missing},null,2));
  console.log(JSON.stringify({status:'passed',output,writes:writes.length,viewports:[320,360,390,768,1024,1440]}));
}catch(error){const page=(await browser.pages()).at(-1);await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.stack,errors,missing,writes,reads:reads.slice(-30)},null,2));throw error;}finally{await browser.close();}
