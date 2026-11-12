import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const publicDir=path.resolve(import.meta.dirname,'../public');
const output=path.resolve(import.meta.dirname,'../../../output/solvex-model-20261110');fs.mkdirSync(output,{recursive:true});
const wallet='0x'+'1'.repeat(40),now=Date.now(),unit=10n**18n,A=n=>(BigInt(n)*unit).toString();
const term={days:30,minCoins:'1000',midCoins:'2000',highCoins:'10000',lowRatePct:25,midRatePct:45,highRatePct:55};
const energy={planId:'energy',label:'能量',energy:true,days:100,dailyRateBps:100,minCoins:'1'};
const tiers=[{key:'t500',enabled:true,label:'500U档',priceUsdt:'500',dividendPct:30,members:8},{key:'t1000',enabled:false,label:'1000U档',priceUsdt:'1000',dividendPct:70,members:0}];
const profile={userId:'DEMO001',balances:{A:'2500',USDT:'500'},liquidity:{enabled:false,status:'pending'},zones:{alpha:A(2000),beta:'0'},nodeTerm:term,
 nodes:[{id:'node_demo',status:'active',principal:'1000',interest:'250',payout:'1250',ratePct:25,days:30,progressPct:20,expiresAt:now+24*86400000}],
 stakes:[{...energy,id:'energy_demo',principal:'1000',dayEarned:'10',totalEarned:'150',outstandingPrincipal:'850',energyDays:15,status:'active'}],
 pending:[{id:'principal_demo',bizType:'node',periodKey:'principal',amountUnits:A(1000),quotaUnits:A(1000),availableAt:now-1000,expiresAt:Number.MAX_SAFE_INTEGER,status:'pending'}],pendingSummary:{claimableUnits:A(1000),waitingUnits:'0',expiringSoonUnits:'0'},miners:[],activations:[],shareholder:{tiers,member:null,pools:[],dividends:[]},sellQuota:{available:'500'}};
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);
 page.on('request',request=>{
  const url=new URL(request.url());if(url.hostname!=='solvex.test')return request.abort();
  const json=data=>request.respond({contentType:'application/json',body:JSON.stringify(data)});
  if(url.pathname==='/')return request.respond({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/critical.css"><link rel="stylesheet" href="/styles/lazy.css"><style>body{margin:0}.preview-header{padding:14px 24px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #e2e8f0;font:600 22px system-ui}.preview-header img{width:36px;height:36px}.preview-header small{font-size:12px;font-weight:400;color:#64748b}.tab-panel:not(.active){display:none}</style></head><body><div class="preview-header"><img src="/assets/brand/logo.svg">Solvex <small>本地规则预览 · 测试数据</small></div><div id="tab-earn" class="portal-page tab-panel active"></div><div id="tab-a-token-trade" class="portal-page tab-panel"></div><script>window.currentWalletProfile={authenticated:true};window.currentWalletConnection={address:'${wallet}'};var connectedWalletAddress='${wallet}',connectedProvider=null;window.showToast=()=>{};window.loadPageCharts=async()=>{};window.switchTab=async name=>{document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id==='tab-'+name));await Portal.load(name);};</script><script src="/js/portal-shared.js"></script><script src="/js/earn.js"></script><script src="/js/a-token-trade.js"></script><script>Portal.load('earn');</script></body></html>`});
  if(!url.pathname.startsWith('/api/')){
   const file=path.join(publicDir,url.pathname);if(!fs.existsSync(file))return request.respond({status:404,body:''});
   return request.respond({contentType:({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'text/plain',body:fs.readFileSync(file)});
  }
  if(url.pathname==='/api/a-token/plans')return json({activation:[],miner:[],activationEnabled:false,staking:[energy],nodes:term,liquidity:profile.liquidity});
  if(url.pathname==='/api/a-token/profile')return json(profile);
  if(url.pathname==='/api/a-token/shareholder')return json(profile.shareholder);
  if(url.pathname==='/api/a-token/claim/status')return json({enabled:true,balanceA:'1020',balanceUnits:A(1020),contractAddress:wallet,feeRateBps:200});
  if(url.pathname==='/api/a-token/team/summary'||url.pathname==='/api/a-token/team/profile')return json({level:3,directs:[],TEAM_LEVELS:[],byKind:{}});
  if(url.pathname==='/api/a-token/pool')return json({priceUsdt:'0.1',totalSupply:'1000000000',totalBurned:'10000',todayBurned:'10'});
  if(url.pathname==='/api/a-token/orderbook')return json({bids:[],asks:[]});
  if(url.pathname==='/api/community/groups')return json({canCreate:true,groups:[{number:'100001',name:'总群'},{number:'100002',name:'商学院'},{number:'100003',name:'股东群'},{number:'100004',name:'工作室群'},{number:'200001',name:'测试私人群'}]});
  const group=url.searchParams.get('group')||'100001';
  if(url.pathname==='/api/community/session')return json({authenticated:true,group:{number:group,name:group==='100001'?'总群':'测试私人群',isAdmin:true,invite:'test-invite'},me:{address:wallet,nickname:'测试用户',status:'active',isAdmin:true},members:[],memberCount:1,unread:0,isAdmin:true,redPacketPolicy:[]});
  if(url.pathname==='/api/community/messages')return json({messages:[{id:group==='100001'?100:2,wallet,nickname:'测试用户',body:group==='100001'?'总群消息':'私人群消息',kind:'text',createdAt:now,status:'visible'}],hasMore:false});
  return json({orders:[],entries:[],trades:[],candles:[]});
 });
 await page.setViewport({width:1440,height:1000});await page.goto('http://solvex.test/',{waitUntil:'networkidle0'});
 await page.waitForFunction(()=>document.querySelector('#earn-content')?.textContent.includes('1,000'));
 assert.match(await page.$eval('#earn-content',e=>e.textContent),/每日领取|每天08:00/);
 assert.match(await page.$eval('.stake-plan-summary strong',e=>e.textContent),/^2,000\.00 币$/);
 await page.screenshot({path:path.join(output,'pool-desktop.png'),fullPage:true});
 await page.evaluate(()=>earnSwitch('staking'));await page.waitForFunction(()=>document.querySelector('#earn-content')?.textContent.includes('850'));
 assert.doesNotMatch(await page.$eval('#earn-content',e=>e.textContent),/选择质押周期|已领取收益|本金与收益一并/);
 await page.screenshot({path:path.join(output,'energy-desktop.png'),fullPage:true});
 await page.evaluate(()=>earnSwitch('pending'));assert.match(await page.$eval('#earn-content',e=>e.textContent),/到期可领，不作废/);
 assert.equal(await page.$$eval('[data-pending-expires]',els=>els.some(e=>e.dataset.pendingExpires==='9007199254740991')),false);
 await page.evaluate(()=>earnSwitch('shareholder'));await page.waitForFunction(()=>document.querySelector('#earn-content')?.textContent.includes('暂未开放'));
 assert.equal(await page.$$eval('[onclick*="shareholderJoin"]',els=>els.some(e=>e.getAttribute('onclick').includes('t1000'))),false);
 await page.evaluate(()=>switchTab('a-token-trade'));await page.waitForFunction(()=>document.querySelector('#atrade-content')?.textContent.includes('驱动额度'));
 assert.equal(await page.$('[onclick="window.atradeZone(\'market\')"]'),null);
 assert.match(await page.$eval('#atrade-content',e=>e.textContent),/蓄能额度/);
 assert.doesNotMatch(await page.$eval('#atrade-content',e=>e.textContent),/甲区 · 蓄能额度|乙区 · 驱动额度|自由交易 · 待开放/);
 await page.screenshot({path:path.join(output,'trade-desktop.png'),fullPage:true});
 await page.setViewport({width:390,height:844});await page.evaluate(async()=>{await switchTab('earn');await earnSwitch('staking');});
 await page.screenshot({path:path.join(output,'energy-mobile.png'),fullPage:false});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);assert.equal(overflow,false,'mobile energy must not overflow');
 await page.evaluate(address=>{
   window.walletConfig={withdrawalEnabled:true,withdrawalFeeBps:200,networks:[{id:'bsc',name:'BNB Smart Chain'}]};
   window.walletProfile={address,balances:{USDT:'500'},withdrawals:[]};
   window.signedMessages=[];
   connectedProvider={request:async ({params})=>{signedMessages.push(params[0]);return 'test_signature';}};
   window.ensurePlatformSession=async()=>{};window.loadWalletProfile=async()=>{};
   window.walletApi=async(url,options)=>{const r=await fetch(url,options);return r.json();};
   window.setAccountStatus=()=>{};window.$=id=>document.getElementById(id);
   const legacy=document.createElement('div');legacy.hidden=true;
   legacy.innerHTML='<input id="withdraw-amount"><select id="withdraw-network"><option value="bsc">BSC</option></select><button id="withdraw-submit"></button>';
   document.body.append(legacy);
 },wallet);
 await page.addScriptTag({url:'http://solvex.test/js/wallet-funds.js'});
 await page.evaluate(()=>USDTWithdrawal.open());
 async function enterAmount(value) {await page.$eval('#uswd-amount',(e,v)=>{e.value=v;e.dispatchEvent(new Event('input'));},value);}
 await enterAmount('10.123456');
 assert.equal(await page.$eval('#uswd-q-fee',e=>e.textContent),'0.202469 U');
 assert.equal(await page.$eval('#uswd-q-total',e=>e.textContent),'10.325925 U');
 await enterAmount('500');await page.click('#uswd-submit');
 await page.waitForFunction(()=>document.querySelector('#uswd-status').textContent.includes('余额不足'));
 assert.equal(await page.evaluate(()=>signedMessages.length),0,'insufficient fee balance must fail before signing');
 await enterAmount('100');
 assert.equal(await page.$eval('#uswd-q-total',e=>e.textContent),'102 U');
 assert.match(await page.$eval('#uswd-rule-hint',e=>e.textContent),/2%.*LP/);
 await page.screenshot({path:path.join(output,'withdrawal-mobile.png')});
 await page.click('#uswd-submit');await page.waitForFunction(()=>document.querySelector('#uswd-status').textContent.includes('申请已提交'));
 assert.match(await page.evaluate(()=>signedMessages[0]),/^Solvex 提现确认：100 USDT（另收2%手续费）/);
 await page.evaluate(async()=>{document.getElementById('withdraw-amount').value='10';await submitWithdrawal();});
 assert.match(await page.evaluate(()=>signedMessages[1]),/^Solvex 提现确认：10 USDT（另收2%手续费）/);
 await page.evaluate(()=>{
   USDTWithdrawal.close();
   window.ethers={BrowserProvider:class {},Contract:class {
     async totalReserve(){return 1000000n*10n**18n;}async totalHarvested(){return 0n;}async paused(){return false;}
   }};
 });
 await page.addScriptTag({url:'http://solvex.test/js/a-token-claim.js'});
 await page.evaluate(()=>SvxClaim.open());
 assert.match(await page.$eval('#aix-claim-balance',e=>e.textContent),/^1,020 SVX$/);
 await page.$eval('#aix-claim-pct [data-pct="100"]',e=>e.click());
 assert.equal(await page.$eval('#aix-claim-amount',e=>e.value),'1000.0000');
 assert.equal(await page.$eval('#aix-claim-fee',e=>e.textContent),'20 SVX');
 assert.equal(await page.$eval('#aix-claim-total',e=>e.textContent),'1,020 SVX');
 assert.deepEqual(errors,[]);console.log('PASS browser: pool/energy/principal/tier UI, group switching, LP gate, withdrawal fee quote/balance/signatures; desktop/mobile screenshots: '+output);
} finally {await browser.close();}
