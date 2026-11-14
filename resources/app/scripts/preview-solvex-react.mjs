// Every HTTP request is intercepted; this review never starts the real server.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { wallet, other, profile, fixture } from '../test/fixtures/solvex-preview.mjs';
const root = path.resolve(import.meta.dirname,'../public');
const output = path.resolve(import.meta.dirname,'../../../output/solvex-react-20261110');
fs.mkdirSync(output,{recursive:true});
const errors=[], requests=[], mutations=[], missing=[];
let currentWallet=wallet, authenticated=true, profileDelay=0, failProfile=false, allowedMutation=null, holdMutation=0, mutationStatus=200;
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
  const page=await browser.newPage();
  page.on('pageerror',error=>{errors.push(error.message);console.error('BROWSER:',error.stack);});
  page.on('console',async message=>{
    if(message.type()!=='error'||message.text().startsWith('Failed to load resource:'))return;
    const details=await Promise.all(message.args().map(arg=>arg.evaluate(value=>value instanceof Error?value.stack:String(value)).catch(()=>'')));
    const detail=details.join(' ')||message.text();
    if(!detail)return;
    if(detail.includes('An unknown error occurred when fetching the script'))return; // Chrome's service-worker fetch bypasses request interception.
    errors.push(detail);console.error('CONSOLE:',detail);
  });
  await page.emulateTimezone('Asia/Shanghai');
  await page.evaluateOnNewDocument(wallet=>{
    const listeners=new Map();
    window.ethereum={request:async({method})=>{if(['eth_accounts','eth_requestAccounts'].includes(method))return [wallet];if(method==='eth_chainId')return '0x38';if(method==='personal_sign')return 'PREVIEW_ONLY';throw Error(method);},on(name,fn){listeners.set(name,fn);},removeListener(name){listeners.delete(name);}};
    window.EventSource=class {static CLOSED=2;readyState=1;close(){this.readyState=2;}addEventListener(){}removeEventListener(){}};
  },wallet);
  await page.setRequestInterception(true);
  page.on('request',async request=>{
    if(request.isInterceptResolutionHandled())return;
    const url=new URL(request.url());
    if(url.hostname!=='design.test')return request.abort();
    if(url.pathname.startsWith('/api/')){
      requests.push({path:url.pathname,method:request.method()});
      let result=fixture(url),status=200;
      if(url.pathname==='/api/wallet/session')result={authenticated,address:currentWallet};
      if(url.pathname==='/api/wallet/profile')result={authenticated,address:currentWallet,userId:'PREVIEW',balances:profile.balances,deposits:[],withdrawals:[]};
      if(url.pathname==='/api/a-token/profile'){
        result=currentWallet===wallet?profile:{...profile,balances:{A:'777',USDT:'0'},zones:{alpha:'777000000000000000000',beta:'0'},nodes:[],stakes:[],pending:[],pendingSummary:{claimableUnits:'0',waitingUnits:'0',expiringSoonUnits:'0'}};
        if(profileDelay)await new Promise(resolve=>setTimeout(resolve,profileDelay));
        if(failProfile){status=503;result={error:'模拟网络不可用'};}
      }
      if(url.pathname==='/api/a-token/nodes/quote'){
        const coins=url.searchParams.get('coins')||'0',rate=Number(coins)>=10000?55:Number(coins)>=2000?45:25;
        result={coins,days:30,ratePct:rate,payout:String(Number(coins)*(1+rate/100))};
      }
      if(request.method()!=='GET'&&!url.pathname.startsWith('/api/wallet/login-')&&!['/api/wallet/disconnect','/api/support/read','/api/community/read','/api/hyperliquid/info'].includes(url.pathname)){
        mutations.push({path:url.pathname,body:request.postData(),headers:request.headers()});
        if(allowedMutation===url.pathname){status=mutationStatus;result=mutationStatus===200?{ok:true,claimed:[{id:'r1'},{id:'r2',error:'模拟已过期'}]}:{error:'模拟响应中断，请重试核对'};if(holdMutation)await new Promise(resolve=>setTimeout(resolve,holdMutation));}
        else {status=403;result={error:'预览模式不提交资金操作'};}
      }
      try{return await request.respond({status,contentType:'application/json',body:JSON.stringify(result)});}catch{return;}
    }
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){missing.push(url.pathname);return request.respond({status:404,body:''});}
    return request.respond({contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'})[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,200)))));
  const waitText=async(selector,text)=>page.waitForFunction((s,t)=>document.querySelector(s)?.textContent.includes(t),{},selector,text);
  async function visit(name, sub) {
    await page.evaluate(async(name,sub)=>{await window.switchTab(name);window.scrollTo(0,0);},name,sub);
    await page.waitForSelector('#tab-'+name+'.active');
    if(name==='earn') {
      await page.waitForSelector('#tab-earn .rx-page');
      if(sub){await page.evaluate(sub=>window.earnSwitch(sub),sub);await settle();}
      if(!sub||sub==='miner')await page.waitForSelector('[data-mining-scene][data-scene-state="sprite"] .rx-cavern-background');
    }
    if(name==='referrals')await waitText('#tab-referrals','团队概览');
    if(name==='leaderboard')await waitText('#tab-leaderboard','合约跟单收益排名');
    if(name==='support')await waitText('#tab-support','客服在线');
    if(name==='community-chat')await waitText('#tab-community-chat','欢迎来到 Solvex 社区');
    if(name==='ai-managed')await waitText('#tab-ai-managed','量化批次');
    if(name==='partner-plan')await page.waitForSelector('#tab-partner-plan [data-native-ecosystem="shareholder"]');
    if(name==='trade') {
      await page.waitForFunction(()=>typeof tradeCandleData!=='undefined'&&tradeCandleData.length>0);
      await page.waitForSelector('#trade-chart canvas');
      assert.equal(await page.$eval('#trade-order-btn',e=>e.textContent.includes('连接钱包')),false,'trading recognizes the authenticated wallet');
      if(await page.evaluate(()=>innerWidth>768)) {
        const bounds=await page.$eval('.order-entry',e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:innerWidth}));
        assert.ok(bounds.left>=0&&bounds.right<=bounds.width,'order entry stays visible beside the sidebar');
      }
    }
    await settle();
  }
  await page.setViewport({width:1440,height:1050});
  await page.goto('https://design.test/',{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>window.currentWalletProfile?.authenticated);
  await visit('earn','miner');
  await waitText('.rx-metrics','5,000');
  await page.screenshot({path:path.join(output,'pool-desktop.png'),fullPage:true});
  await page.screenshot({path:path.join(output,'pool-overview.png')});
  console.log('Initial React page rendered',JSON.stringify({errors,missing,requests:requests.length}));
  if(process.argv.includes('--initial')) {
    await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    await visit('earn','miner');await page.screenshot({path:path.join(output,'pool-mobile.png'),fullPage:true});
    if(process.argv.includes('--menu')) {
      await page.click('.rx-mobile-menu');await page.waitForSelector('.rx-mobile-sheet');
      console.log('MENU',await page.$eval('.rx-mobile-sheet',e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {classes:e.className,style:e.getAttribute('style'),left:s.left,top:s.top,transform:s.transform,translate:s.translate,width:s.width,height:s.height,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom}};}));
      await page.screenshot({path:path.join(output,'menu-debug.png')});
    }
  } else {
    assert.equal(errors.length,0,'no initial runtime errors');
    assert.ok(!requests.some(r=>r.path.startsWith('/api/market/')),'home does not request trading data');
    assert.equal(await page.$$eval('[data-mining-scene] canvas',nodes=>nodes.length),0,'mining scene uses lightweight sprite animation');
    assert.equal(await page.$eval('[data-mining-scene]',e=>e.dataset.sceneState),'sprite');
    assert.equal(await page.$eval('[data-mining-scene] .rx-cavern-background',e=>e.complete && e.naturalWidth > 0),true,'mining background is visible');
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await settle();
    assert.equal(await page.$$eval('[data-mining-scene] .rx-cavern-worker',nodes=>nodes.every(node=>getComputedStyle(node).animationName==='none')),true,'reduced-motion preference disables sprite animation');
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
    await page.evaluate(()=>{window.__oldMine=document.querySelector('[data-mining-scene]');});
    await visit('referrals');
    assert.equal(await page.evaluate(()=>window.__oldMine.querySelector('canvas')),null,'no WebGL canvas is created');
    await visit('earn','miner');
    assert.equal(await page.$$eval('[data-mining-scene] canvas',nodes=>nodes.length),0,'sprite scene does not create a canvas');
    const cases=[['earn','pool','miner'],['earn','energy','staking'],['earn','pending','pending'],['partner-plan','shareholder'],['earn','blindbox','blindbox'],['earn','drive','matchpool'],['referrals','team'],['ai-managed','quant'],['account','assets'],['a-token-trade','svx'],['trade','trading'],['leaderboard','ranking'],['support','support'],['community-chat','community'],['mall','mall']];
    for(const mobile of [false,true]) {
      await page.setViewport(mobile?{width:390,height:844,isMobile:true,hasTouch:true}:{width:1440,height:1050});
      for(const [name,label,sub] of cases) {
        await visit(name,sub);
        if(name==='mall')await page.waitForFunction(()=>document.getElementById('mall-frame')?.contentDocument?.querySelector('.shop-hero'));
        // 资产页是 React 懒加载 + 两个接口并发，截图前等首屏数据落位，否则拍到“正在同步数据”
        if(name==='account'){
          await page.waitForSelector('#tab-account .assets-total',{visible:true});
          await waitText('#tab-account','账户分布');
          assert.equal(await page.$('#tab-account [data-lp-progress]'),null,'资产页不再展示流动性准备金进度');
        }
        const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
        assert.ok(overflow.document<=overflow.viewport+2,label+' overflow: '+JSON.stringify(overflow));
        await page.screenshot({path:path.join(output,label+'-'+(mobile?'mobile':'desktop')+'.png'),fullPage:!mobile||name==='ai-managed'});
        if(name==='ai-managed'&&mobile) {
          assert.ok(await page.$eval('.aim-primary',e=>e.getBoundingClientRect().height>=44),'mobile primary action has a comfortable tap target');
          assert.ok(await page.$eval('.aim-metrics > div:first-child',e=>{
            const centers=[...e.children].map(child=>{const r=child.getBoundingClientRect();return r.top+r.height/2;});
            return Math.max(...centers)-Math.min(...centers)<2;
          }),'mobile principal and active-batch caption share one row');
          assert.equal(await page.$eval('#tab-ai-managed',e=>e.textContent.includes('跟单')),false,'quant page uses updated copy');
          for(const width of [320,360,640,768]) {
            await page.setViewport({width,height:844,isMobile:true,hasTouch:true});await visit('ai-managed');
            assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'quant fits '+width+'px viewport');
          }
          await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await visit('ai-managed');
        }
      }
    }
    // Pool cards open the current investment dialog; no business mutation is submitted.
    await visit('earn','miner');
    await page.click('.rx-tier[data-tone=copper] .rx-tier-invest');
    await page.waitForSelector('.rx-invest-dialog',{visible:true});
    const poolBounds=await page.$eval('.rx-invest-dialog',e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};});
    assert.ok(poolBounds.left>=0&&poolBounds.right<=poolBounds.width+1&&poolBounds.top>=0&&poolBounds.bottom<=poolBounds.height+1,'investment dialog fits mobile viewport');
    await page.type('#pool-invest-amount','1000');
    await waitText('.rx-invest-estimate','1,250');
    assert.ok(await page.$eval('.rx-invest-facts',e=>e.textContent.includes('25%')),'copper investment quote follows actual amount');
    await page.screenshot({path:path.join(output,'pool-invest-dialog.png')});
    await page.click('.rx-invest-actions .ui-button');
    await page.waitForSelector('.rx-invest-dialog',{hidden:true});
    // Energy amounts open in a Radix sheet; confirmation preserves the entered value.
    for(const [sub,mode] of [['staking','energy']]) {
      await visit('earn',sub);
      assert.equal(await page.$('#amount-'+mode),null,'mobile amount field waits for its sheet');
      await page.click('[data-open-amount='+mode+']');
      await page.waitForSelector('.rx-amount-sheet',{visible:true});
      await page.$eval('.rx-amount-sheet',e=>Promise.all(e.getAnimations().map(animation=>animation.finished)));
      const bounds=await page.$eval('.rx-amount-sheet',e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};});
      assert.ok(bounds.left>=0&&bounds.right<=bounds.width+1&&bounds.bottom<=bounds.height+1,'amount sheet fits viewport');
      await page.type('#amount-'+mode,'1000');
      await page.click('.rx-amount-sheet .rx-amount-form .rx-full');
      await page.waitForFunction(()=>document.querySelectorAll('.ui-dialog[role=dialog]').length===2);
      await page.waitForFunction(()=>document.querySelector('.ui-dialog[role=dialog]:not(.rx-amount-sheet)')?.contains(document.activeElement));
      await settle();
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.querySelectorAll('.ui-dialog[role=dialog]').length===1);
      assert.equal(await page.$eval('#amount-'+mode,e=>e.value),'1000','cancel keeps amount in the sheet');
      await page.screenshot({path:path.join(output,mode+'-amount-sheet.png')});
      await page.click('.rx-amount-sheet .ui-dialog-close');
      await page.waitForSelector('.rx-amount-sheet',{hidden:true});
    }
    await page.setViewport({width:1440,height:1050});
    await visit('referrals');
    const selectTeam=async label=>{
      const id=await page.evaluate(label=>[...document.querySelectorAll('#tab-referrals [role=tab]')].find(b=>b.textContent===label)?.id,label);
      assert.ok(id,'team tab exists: '+label);
      await page.click('[id="'+id+'"]');
      await page.waitForFunction(id=>document.getElementById(id)?.getAttribute('aria-selected')==='true',{},id);
      await settle();
    };
    for(const label of ['团队成员','团队收益','升级舱','邀请好友','交易返佣']) {
      await selectTeam(label);
      assert.ok(await page.$eval('#tab-referrals',el=>el.textContent.length>60));
    }
    const confirm=async()=>{
      await page.waitForSelector('.ui-dialog[role=dialog]',{visible:true});
      await page.evaluate(()=>[...document.querySelectorAll('.ui-dialog[role=dialog] button')].find(b=>b.textContent==='确认操作').click());
      await page.waitForSelector('.ui-dialog[role=dialog]',{hidden:true});
    };
    await selectTeam('团队收益');
    assert.ok(!(await page.$eval('#tab-referrals .rx-table',e=>e.textContent)).includes('矿池利息'),'team rewards exclude pool rewards');
    allowedMutation='/api/a-token/pending/claim';
    await page.click('#tab-referrals .rx-table button');await confirm();
    await waitText('[data-sonner-toaster]','领取成功');
    assert.equal(JSON.parse(mutations.find(r=>r.path===allowedMutation).body).id,'r2');
    await selectTeam('升级舱');
    await page.waitForSelector('#amount-upgrade');
    await page.type('#amount-upgrade','1000.000000000000000001');
    allowedMutation='/api/a-token/upgrade/enter';mutationStatus=503;
    await page.click('#tab-referrals .rx-amount-form .rx-full');await confirm();
    await waitText('[data-sonner-toaster]','模拟响应中断');
    mutationStatus=200;
    await page.waitForFunction(()=>!document.querySelector('#tab-referrals .rx-amount-form .rx-full').disabled);
    await page.click('#tab-referrals .rx-amount-form .rx-full');await confirm();
    await page.waitForFunction(()=>document.getElementById('amount-upgrade').value==='');
    const upgrades=mutations.filter(r=>r.path===allowedMutation);
    assert.equal(upgrades.length,2);
    assert.match(upgrades[0].headers['idempotency-key'],/^aup_/);
    assert.equal(upgrades[0].headers['idempotency-key'],upgrades[1].headers['idempotency-key'],'uncertain upgrade retry keeps its request ID');
    assert.equal(JSON.parse(upgrades[0].body).amount,'1000.000000000000000001');
    allowedMutation='/api/a-token/upgrade/redeem';
    await page.click('#tab-referrals .rx-table button');await confirm();
    await waitText('[data-sonner-toaster]','已提交赎回');
    assert.equal(JSON.parse(mutations.find(r=>r.path===allowedMutation).body).positionId,'u1');
    allowedMutation=null;
    await visit('earn','staking');
    allowedMutation='/api/a-token/stake';
    await page.type('#amount-energy','1.000000000000000001');
    await page.click('.rx-amount-form .rx-full');await confirm();
    await page.waitForFunction(()=>document.getElementById('amount-energy').value==='');
    assert.deepEqual(JSON.parse(mutations.find(r=>r.path===allowedMutation).body),{planId:'energy',principal:'1.000000000000000001'});
    allowedMutation=null;
    await visit('earn','miner');
    await page.click('.rx-tier[data-tone=silver] .rx-tier-invest');
    await page.waitForSelector('.rx-invest-dialog',{visible:true});
    await page.type('#pool-invest-amount','2000');
    await waitText('.rx-invest-facts','45%');
    allowedMutation='/api/a-token/nodes/open';holdMutation=300;
    await page.waitForFunction(()=>!document.querySelector('.rx-invest-actions .ui-button:last-child').disabled);
    await page.evaluate(()=>{const button=document.querySelector('.rx-invest-actions .ui-button:last-child');button.click();button.click();});
    await page.waitForSelector('.rx-invest-dialog',{hidden:true});
    assert.equal(mutations.filter(r=>r.path===allowedMutation).length,1);
    assert.equal(JSON.parse(mutations.find(r=>r.path===allowedMutation).body).coins,'2000','pool integer amount remains a string');
    allowedMutation=null;holdMutation=0;
    await visit('earn','pending');
    allowedMutation='/api/a-token/pending/claim-all';
    await page.evaluate(()=>[...document.querySelectorAll('#tab-earn button')].find(b=>b.textContent.includes('一键领取')).click());
    await page.waitForSelector('.ui-dialog[role=dialog]');
    await page.evaluate(()=>[...document.querySelectorAll('.ui-dialog[role=dialog] button')].find(b=>b.textContent==='确认操作').click());
    await waitText('[data-sonner-toaster]','部分领取完成');
    allowedMutation=null;
    // Native ecosystem actions retain wallet signatures and retry IDs.
    const clickText = async text => {
      await page.evaluate(text => [...document.querySelectorAll('.tab-panel.active button')].find(b => b.textContent.includes(text))?.click(), text);
    };
    await visit('earn','blindbox'); await page.waitForSelector('[data-native-ecosystem="blindbox"]');
    const blindboxButton = await page.$('[data-native-ecosystem="blindbox"] .svx-box-actions button');
    assert.ok(blindboxButton,'blindbox action is rendered');
    // The isolated preview deliberately has no chain payment contract. Keep
    // the production fail-closed guard covered instead of trying to fake an
    // EVM receipt in a UI-only browser fixture.
    assert.equal(await blindboxButton.evaluate(button => button.disabled), true, 'blindbox stays disabled without on-chain payment config');
    await visit('partner-plan'); await page.waitForSelector('[data-native-ecosystem="shareholder"]');
    assert.equal(await page.$$eval('[data-native-ecosystem="shareholder"] button', rows=>rows.find(b=>b.textContent.includes('暂不开放')).disabled),true);
    allowedMutation='/api/a-token/shareholder/join'; mutationStatus=503;
    await clickText('加入 500U档'); await confirm(); await waitText('[data-sonner-toaster]','模拟响应中断');
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-native-ecosystem="shareholder"] button')].some(b=>b.textContent.includes('加入 500U档')&&!b.disabled));
    mutationStatus=200;
    await clickText('加入 500U档'); await confirm(); await waitText('[data-sonner-toaster]','已加入合伙人');
    const joins=mutations.filter(r=>r.path===allowedMutation);
    assert.equal(joins.length,2); assert.equal(joins[0].headers['idempotency-key'],joins[1].headers['idempotency-key']);
    assert.equal(JSON.parse(joins[1].body).tier,'t500');
    await visit('earn','matchpool'); await page.waitForSelector('#drive-buy-amount');
    await page.type('#drive-buy-amount','100');
    await page.waitForFunction(()=>[...document.querySelectorAll('#tab-earn button')].some(b=>b.textContent==='确认购买'&&!b.disabled));
    allowedMutation='/api/a-token/match-pool/buy-turbo';
    await clickText('确认购买'); await confirm(); await waitText('[data-sonner-toaster]','驱动额度购买成功');
    assert.equal(JSON.parse(mutations.find(r=>r.path===allowedMutation).body).aix,'100');
    allowedMutation='/api/a-token/match-pool/enter';
    await page.type('#drive-enter-amount','10'); await clickText('确认放入'); await confirm();
    await waitText('[data-sonner-toaster]','已放入超速驱动协议');
    assert.equal(JSON.parse(mutations.find(r=>r.path===allowedMutation).body).amount,'10');
    allowedMutation=null;
    // Navigation state follows user clicks, history, and the original market tabs.
    await page.click('[data-nav-page=trade]');
    await page.waitForSelector('#trade-chart canvas');
    await page.$eval('[data-trade-section=perp]',e=>e.click());
    await page.waitForFunction(()=>tradeProduct==='perp');
    await page.$eval('[data-trade-section=stock]',e=>e.click());
    await page.waitForFunction(()=>tradeMarketScope==='stock');
    await page.click('[data-nav-page=referrals]');
    await page.waitForSelector('#tab-referrals.active');
    await page.goBack();await page.waitForSelector('#tab-trade.active');
    await page.goForward();await page.waitForSelector('#tab-referrals.active');
    assert.equal(await page.$$eval('.rx-sidebar [aria-label="主导航"] [data-nav-page]',buttons=>buttons.at(-1).dataset.navPage),'partner-plan','partner plan is the last desktop navigation entry');
    await page.click('.rx-sidebar [data-nav-page=partner-plan]');
    await page.waitForSelector('#tab-partner-plan.active .rx-partner-plan');
    assert.equal(await page.$eval('.rx-breadcrumb strong',e=>e.textContent),'合伙人计划');
    await page.reload({waitUntil:'networkidle0'});
    await page.waitForSelector('#tab-partner-plan.active .rx-partner-plan');
    await visit('earn','play');
    assert.equal(await page.$('#tab-earn [data-native-ecosystem="shareholder"]'),null,'partner content removed from pool play page');
    await page.evaluate(()=>window.earnSwitch('shareholder'));
    await page.waitForSelector('#tab-partner-plan.active');
    await page.goto('https://design.test/#/earn/shareholder',{waitUntil:'networkidle0'});
    await page.reload({waitUntil:'networkidle0'});
    await page.waitForSelector('#tab-partner-plan.active .rx-partner-plan');
    assert.equal(await page.evaluate(()=>location.hash),'#/partner-plan','old shareholder deep link redirects to its independent page');
    await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    await page.click('.rx-mobile-menu');
    await page.waitForSelector('.rx-mobile-sheet');
    assert.equal(await page.$$eval('.rx-mobile-sheet [aria-label="主导航"] [data-nav-page]',buttons=>buttons.at(-1).dataset.navPage),'partner-plan','partner plan is the last mobile menu entry');
    await page.click('.rx-mobile-sheet [data-nav-page=partner-plan]');
    await page.waitForSelector('#tab-partner-plan.active .rx-partner-plan');
    await page.waitForSelector('.rx-mobile-sheet',{hidden:true});
    await page.click('.rx-mobile-menu');
    await page.waitForSelector('.rx-mobile-sheet');
    await page.click('.rx-mobile-sheet [data-nav-page=earn]');
    await page.waitForSelector('#tab-earn.active');
    await page.waitForSelector('.rx-mobile-sheet',{hidden:true});
    await page.click('#lang-toggle');
    await page.waitForSelector('#lang-menu');
    await page.evaluate(()=>[...document.querySelectorAll('#lang-menu button')].find(b=>b.textContent.includes('English')).click());
    await page.waitForFunction(()=>window.I18n.current==='en');
    await page.evaluate(()=>window.I18n.set('zh'));
    await page.waitForFunction(()=>window.I18n.current==='zh');
    await page.setViewport({width:1440,height:1050});
    // A signed-in wallet change must synchronously remove old account values.
    await visit('earn','miner');
    await page.click('.rx-tier[data-tone=copper] .rx-tier-invest');
    await page.waitForSelector('.rx-invest-dialog',{visible:true});
    await page.type('#pool-invest-amount','1000');
    currentWallet=other;profileDelay=500;
    await page.evaluate(other=>{
      window.currentWalletConnection={address:other};
      window.currentWalletProfile={authenticated:true,address:other};
      const revision=window.getWalletStateRevision();window.getWalletStateRevision=()=>revision+1;
      window.dispatchEvent(new CustomEvent('walletstatechange',{detail:{address:other,authenticated:true}}));
    },other);
    await page.waitForFunction(()=>!document.querySelector('.ui-dialog[role=dialog]'));
    assert.equal(await page.$('#pool-invest-amount'),null,'wallet change closes investment input');
    assert.ok(!(await page.$eval('.rx-metrics',e=>e.textContent)).includes('5,000'));
    assert.ok(await page.$('.rx-value-skeleton'),'new wallet shows a loading skeleton before its balance arrives');
    await waitText('.rx-metrics','777');
    assert.equal(await page.$eval('[data-mining-scene]',e=>e.dataset.activePools),'0');
    await waitText('.rx-pool-empty','你的第一份矿池');
    failProfile=true;profileDelay=0;
    await page.click('[aria-label="刷新当前页数据"]');
    await waitText('.rx-error','模拟网络不可用');
    assert.ok(await page.$('.rx-error button'),'network failure has a retry action');
    failProfile=false;
    await page.click('.rx-error button');
    await page.waitForSelector('.rx-error',{hidden:true});
    profileDelay=0;authenticated=false;
    await page.evaluate(()=>{
      window.currentWalletConnection=null;window.currentWalletProfile=null;
      const revision=window.getWalletStateRevision();window.getWalletStateRevision=()=>revision+1;
      window.dispatchEvent(new CustomEvent('walletstatechange',{detail:{address:'',authenticated:false}}));
    });
    await settle();
    assert.equal(await page.$('.rx-metrics'),null,'guest view never shows account balances');
    assert.equal(await page.$eval('[data-mining-scene]',e=>e.dataset.activePools),'0');
    await page.screenshot({path:path.join(output,'pool-guest-desktop.png'),fullPage:true});
    await visit('earn','staking');
    assert.equal(await page.$('#earn-energy'),null,'guest pool page does not render private energy records');
    await visit('earn','miner');
    for(const width of [360,768,1024]) {
      await page.setViewport({width,height:900});await settle();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    }
    await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    await visit('earn','miner');
    await page.screenshot({path:path.join(output,'pool-guest-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[],'no uncaught browser errors across routes');
    assert.deepEqual(missing,[],'all local resources resolve');
    const titles={pool:'矿池',energy:'能量',pending:'待领取',shareholder:'合伙人计划',blindbox:'盲盒',drive:'超速驱动协议',team:'团队',quant:'Ai量化',assets:'我的资产',svx:'SVX交易',trading:'交易',ranking:'合约风云榜',support:'在线客服',community:'群聊',mall:'商城'};
    fs.writeFileSync(path.join(output,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Solvex React 界面预览</title><style>*{box-sizing:border-box}body{background:#f6f7fc;color:#292e49;font:14px/1.6 system-ui;margin:0;padding:35px}main{max-width:1400px;margin:auto}h1{font-size:28px}p{color:#8a8b79}section{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}article{background:white;border:1px solid #e6e0cf;border-radius:16px;padding:17px}img{width:100%;height:230px;object-fit:cover;object-position:top;border-radius:9px;border:1px solid #e9e3d3}a{color:#7044e8;text-decoration:none}h2{font-size:17px}small{display:block;margin-top:10px}@media(max-width:900px){section{grid-template-columns:1fr}body{padding:20px}}</style><main><h1>Solvex / 品牌紫蓝主题</h1><p>React + TypeScript + Vite · 页面截图均使用模拟数据，无真实资金操作。</p><section>'+cases.map(([,label])=>'<article><h2>'+titles[label]+'</h2><a href="'+label+'-desktop.png"><img src="'+label+'-desktop.png" alt="'+titles[label]+'桌面版"></a><small><a href="'+label+'-desktop.png">查看桌面版</a> · <a href="'+label+'-mobile.png">查看手机版</a></small></article>').join('')+'</section></main></html>');
    fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({status:'passed',routes:cases.length,viewports:[360,390,768,1024,1440],requests:requests.length,mutations:mutations.map(({path,body})=>({path,body})),errors,missing},null,2));
    console.log('React browser verification passed',JSON.stringify({routes:cases.length,requests:requests.length,mutations:mutations.length}));
  }
} catch(error) { await (await browser.pages()).at(-1)?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:error.message,errors,missing,requests:requests.slice(-30)},null,2));throw error; }
finally { await browser.close(); }
