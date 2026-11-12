// Isolated UI fixtures only. All network traffic is intercepted; no real chat or funds are changed.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { fixture, wallet, other } from '../test/fixtures/solvex-preview.mjs';

const root = path.resolve(import.meta.dirname, '../public');
const output = path.resolve(import.meta.dirname, '../../../output/solvex-community-20261111');
fs.mkdirSync(output, { recursive: true });
const now = Date.now(), errors = [], missing = [], writes = [];
let nextId = 20, failPacketSend = true, detailFailure = false, emptyGroupIncoming = false;
const groups = [{number:'100001',name:'总群',kind:'public'}, {number:'100002',name:'商学院',kind:'public'}, {number:'100003',name:'股东群'}, {number:'100004',name:'工作室群'}, {number:'100005',name:'朋友的小天地',kind:'private'}];
const packet = (id,asset,extra={}) => ({id,asset,total:asset==='USDT'?'20':'100',shareCount:5,remainingCount:5,claimedTotal:'0',status:'active',algorithm:'random',greeting:'见面有礼，好运常在',createdAt:now,expiresAt:now+86400000,mine:false,grabbed:false,...extra});
const packets = {
  'test-expired':packet('test-expired','USDT',{status:'refunded',remainingCount:3,claimedTotal:'8',expiresAt:now-1000}),
  'test-finished':packet('test-finished','USDT',{status:'finished',remainingCount:0,claimedTotal:'20'}),
  'test-claimed':packet('test-claimed','A',{grabbed:true,claimAmount:'6.8',remainingCount:4,claimedTotal:'6.8'}),
  'test-svx':packet('test-svx','A',{mine:true,greeting:'一份心意，送给大家'}),
  'test-usdt':packet('test-usdt','USDT'),
};
const messages = [
  {id:1,address:other,nickname:'社区伙伴',body:'欢迎来到 Solvex 社区，来聊聊今天的新鲜事吧。',kind:'text',createdAt:now-1800000},
  ...['test-expired','test-finished','test-claimed'].map((id,i)=>({id:i+2,address:other,nickname:'社区伙伴',kind:'red_packet',packet:packets[id],createdAt:now-1200000+i*1000})),
  {id:5,address:wallet,nickname:'我的昵称',body:'大家好，很高兴认识你们 😊',kind:'text',createdAt:now-120000},
  {id:6,address:other,nickname:'社区伙伴',body:'发个红包，祝大家好运！',kind:'text',createdAt:now-90000},
  {id:7,address:other,nickname:'社区伙伴',kind:'red_packet',packet:packets['test-usdt'],createdAt:now-60000},
  {id:8,address:wallet,nickname:'我的昵称',kind:'red_packet',packet:packets['test-svx'],createdAt:now-30000},
];
const claims = {'test-claimed':[{address:wallet,nickname:'我的昵称',amount:'6.8',claimedAt:now}], 'test-expired':[{address:other,nickname:'社区伙伴',amount:'8',claimedAt:now-10000}]};
let nickname = '我的昵称', avatar = '';
const browser = await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
  const page = await browser.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.evaluateOnNewDocument(wallet=>{
    window.ethereum={request:async({method})=>{if(['eth_accounts','eth_requestAccounts'].includes(method))return [wallet];if(method==='eth_chainId')return '0x38';if(method==='personal_sign')return 'ISOLATED_PREVIEW';throw Error(method);},on(){},removeListener(){}};
    window.EventSource=class {static CLOSED=2;readyState=1;close(){this.readyState=2;}addEventListener(){}removeEventListener(){}};
  },wallet);
  await page.setRequestInterception(true);
  page.on('request',async request=>{
    if(request.isInterceptResolutionHandled())return;
    const url=new URL(request.url());
    if(url.hostname!=='design.test')return request.abort();
    if(url.pathname.startsWith('/api/')) {
      let body=fixture(url), status=200;
      const p=url.pathname, group=url.searchParams.get('group')||'100001';
      const post=request.method()==='POST', data=post?JSON.parse(request.postData()||'{}'):{};
      if(post)writes.push({path:p,group,body:data});
      if(p==='/api/community/groups'&&!post)body={canCreate:true,groups};
      else if(p==='/api/community/session')body={authenticated:true,group:groups.find(g=>g.number===group),me:{address:wallet,nickname,avatar,status:'active'},members:[{address:other,nickname:'社区伙伴',isAdmin:true},{address:wallet,nickname,avatar}],memberCount:36,isAdmin:false,redPacketPolicy:[{asset:'USDT',minPerShare:'0.01',singleMax:'200',dailyMax:'1000'},{asset:'A',minPerShare:'0.1',singleMax:'5000',dailyMax:'20000'}]};
      else if(p==='/api/community/messages'&&!post) {
        let rows=group==='100001'?messages.map(m=>m.packet?{...m,packet:packets[m.packet.id]}:m):emptyGroupIncoming?[{id:100,address:other,nickname:'新群友',body:'空群也能接收到新消息',kind:'text',createdAt:now}]:[];
        const after=Number(url.searchParams.get('after_id')||0);
        if(after)rows=rows.filter(m=>m.id>after);
        body={messages:rows,latestId:rows.at(-1)?.id||0,hasMore:false};
      } else if(p==='/api/community/messages'&&post){const message={id:nextId++,address:wallet,nickname,body:data.body,kind:'text',createdAt:Date.now()};messages.push(message);body={message};}
      else if(p==='/api/community/profile'&&post){nickname=data.nickname;if(data.avatar)avatar=data.avatar;body={member:{address:wallet,nickname,avatar}};}
      else if(p==='/api/community/groups/join'&&post)body={group:groups[1]};
      else if(p==='/api/community/red-packets'&&post){
        if(failPacketSend){status=503;body={error:'隔离测试：模拟发送失败，请重试'};failPacketSend=false;}
        else {const id='test-new';packets[id]=packet(id,data.asset,{total:data.total,shareCount:data.count,remainingCount:data.count,algorithm:data.algorithm,greeting:data.greeting,mine:true});const message={id:nextId++,address:wallet,nickname,kind:'red_packet',packet:packets[id],createdAt:Date.now()};messages.push(message);body={packet:packets[id],message};}
      } else if(p.startsWith('/api/community/red-packets/')) {
        const id=p.split('/')[4];
        if(post&&p.endsWith('/grab')){
          await new Promise(resolve=>setTimeout(resolve,250));
          packets[id]={...packets[id],grabbed:true,claimAmount:'4.25',remainingCount:4,claimedTotal:'4.25'};
          claims[id]=[{address:wallet,nickname,amount:'4.25',claimedAt:now}];
          body={packet:packets[id],claim:{amount:'4.25'}};
        } else if(detailFailure){status=503;body={error:'隔离测试：详情暂时不可用'};}
        else body={packet:packets[id],claims:claims[id]||[]};
      } else if(post&&!['/api/community/read','/api/wallet/login-verify','/api/wallet/login-challenge','/api/support/read'].includes(p)){status=403;body={error:'Isolated preview blocks unhandled writes'};}
      return request.respond({status,contentType:'application/json',body:JSON.stringify(body)});
    }
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){missing.push(url.pathname);return request.respond({status:404,body:''});}
    return request.respond({contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'})[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  const waitText=(selector,text)=>page.waitForFunction((s,t)=>document.querySelector(s)?.textContent.includes(t),{},selector,text);
  const closeDialog=async()=>{await page.click('.sx-chat-dialog .ui-dialog-close');await page.waitForFunction(()=>!document.querySelector('.sx-chat-dialog'));};
  const showPacket=async(name)=>{await page.$eval(`[aria-label*="${name}"]`,e=>e.scrollIntoView({block:'center'}));await page.click(`[aria-label*="${name}"]`);await page.waitForSelector('.sx-claim-summary');};
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,100)))));
  await page.setViewport({width:1440,height:1000});
  await page.goto('https://design.test/',{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>window.currentWalletProfile?.authenticated);
  await page.evaluate(async()=>window.switchTab('community-chat'));
  await page.waitForSelector('.sx-packet-card');await settle();
  assert.equal(await page.$$eval('.sx-message.is-mine .sx-packet-card',e=>e.length),1,'own packet uses right-aligned message row');
  assert.ok(await page.$$eval('.sx-packet-art',images=>images.every(i=>i.complete&&i.naturalWidth>0)),'both packet illustrations load');
  assert.equal(await page.$eval('.sx-chat',e=>/\bA 红包\b/.test(e.textContent)),false,'internal A asset is displayed as SVX');
  await page.screenshot({path:path.join(output,'chat-desktop.png'),fullPage:true});

  await showPacket('社区伙伴的USDT红包，领取红包');
  assert.equal(writes.filter(w=>w.path.endsWith('/grab')).length,0,'viewing a packet does not claim funds');
  await page.screenshot({path:path.join(output,'packet-usdt-unopened.png')});
  await page.click('[aria-label="拆开红包"]');
  await waitText('.sx-claim-result','4.25');await waitText('.sx-claim-list','4.25');
  assert.equal(writes.filter(w=>w.path.endsWith('/grab')).length,1,'explicit opening makes one claim');
  await page.screenshot({path:path.join(output,'packet-usdt-claimed.png')});await closeDialog();

  await showPacket('我的昵称的SVX红包');
  assert.equal(await page.$('[aria-label="拆开红包"]'),null,'sender views details without claiming own packet');
  await page.screenshot({path:path.join(output,'packet-svx-sender.png')});await closeDialog();
  await showPacket('社区伙伴的USDT红包，已过期');assert.equal(await page.$('[aria-label="拆开红包"]'),null);await closeDialog();
  await showPacket('社区伙伴的USDT红包，已领完');assert.equal(await page.$('[aria-label="拆开红包"]'),null);await closeDialog();
  await showPacket('社区伙伴的SVX红包，已领取');await waitText('.sx-claim-result','6.8');await closeDialog();

  await page.click('.sx-red-packet-button');await page.waitForSelector('.sx-send-packet-dialog');
  await page.click('.sx-asset-options button:nth-child(2)');
  assert.ok((await page.$eval('.sx-send-packet-preview img',i=>i.src)).includes('packet-svx'));
  await page.click('[aria-label="红包总金额"]');await page.type('[aria-label="红包总金额"]','50');
  await page.screenshot({path:path.join(output,'send-packet-desktop.png')});
  await page.click('.sx-packet-submit');await waitText('.sx-send-packet-dialog .sx-form-error','模拟发送失败');
  await page.click('.sx-packet-submit');await page.waitForFunction(()=>!document.querySelector('.sx-send-packet-dialog'));
  const sendWrites=writes.filter(w=>w.path==='/api/community/red-packets');
  assert.equal(sendWrites.length,2);assert.equal(sendWrites[0].body.clientId,sendWrites[1].body.clientId,'packet retry keeps idempotency key');assert.equal(sendWrites[1].body.asset,'A','SVX maps to backend asset A');assert.equal(sendWrites[1].body.total,'50');

  // Chinese input method Enter confirms composition rather than sending a message.
  const beforeText=writes.filter(w=>w.path==='/api/community/messages').length;
  await page.focus('.sx-chat-composer textarea');
  await page.evaluate(()=>{const input=document.querySelector('.sx-chat-composer textarea');input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,'中文输入测试');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true}));input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});
  await settle();assert.equal(writes.filter(w=>w.path==='/api/community/messages').length,beforeText);
  await page.type('.sx-chat-composer textarea','你好');await page.keyboard.down('Shift');await page.keyboard.press('Enter');await page.keyboard.up('Shift');
  assert.equal(writes.filter(w=>w.path==='/api/community/messages').length,beforeText,'Shift Enter inserts newline');
  await page.keyboard.press('Enter');await page.waitForFunction(()=>[...document.querySelectorAll('.sx-message-delivery')].some(e=>e.textContent.includes('已发送')));await settle();
  assert.equal(writes.filter(w=>w.path==='/api/community/messages').length,beforeText+1,'plain Enter sends one text message');
  await page.click('[aria-label="选择表情"]');await page.click('[aria-label="插入🎉"]');assert.equal(await page.$eval('.sx-chat-composer textarea',e=>e.value),'🎉');

  await page.click('[aria-label="查看群成员"]');await waitText('.sx-members','社区伙伴');await closeDialog();
  assert.equal(await page.$('.sx-chat > .rx-heading'),null,'community page heading is removed');
  await page.evaluate(()=>[...document.querySelectorAll('.sx-chat-header-actions button')].find(b=>b.textContent.includes('设置')).click());
  await waitText('.sx-chat-dialog','昵称和头像会同步显示');
  const avatarFile=await page.$('.sx-avatar-file');
  await avatarFile.uploadFile(path.resolve(root,'assets/tokens/usdt.png'));
  await page.waitForFunction(()=>document.querySelector('.sx-settings-avatar-preview img')?.src.startsWith('data:image/'));
  await page.screenshot({path:path.join(output,'settings-desktop.png')});
  await page.click('.sx-chat-dialog button[type="submit"]');await page.waitForFunction(()=>!document.querySelector('.sx-chat-dialog'));
  const profileWrite=writes.find(w=>w.path==='/api/community/profile');
  assert(profileWrite?.body.avatar.startsWith('data:image/'),'avatar is resized and submitted with settings');
  await page.waitForFunction(()=>document.querySelector('.sx-message.is-mine .sx-avatar img')?.src.startsWith('data:image/'));

  // Refresh details failure stays visible, without an accidental claim.
  detailFailure=true;
  await page.$eval('[aria-label*="我的昵称的SVX红包"]',e=>e.scrollIntoView({block:'center'}));await page.click('[aria-label*="我的昵称的SVX红包"]');
  await waitText('.sx-packet-details .sx-form-error','详情暂时不可用');assert.equal(await page.$('[aria-label="拆开红包"]'),null);detailFailure=false;
  await page.click('.sx-packet-details .sx-form-error button');await page.waitForSelector('.sx-claim-summary');await closeDialog();

  await page.click('.sx-group-item:nth-child(2)');await waitText('.sx-chat-empty','从一句你好开始');
  assert.equal(await page.$eval('.sx-chat-composer textarea',e=>e.value),'','switching groups clears unsent draft');
  emptyGroupIncoming=true;await waitText('.sx-messages','空群也能接收到新消息');
  await page.click('.sx-group-item:first-child');await page.waitForSelector('.sx-packet-card');

  for(const width of [320,360,390,768,1024]) {
    await page.setViewport({width,height:844,isMobile:width<768,hasTouch:width<768});
    await page.waitForSelector('.sx-messages');await settle();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`no page overflow at ${width}px`);
    assert.ok(await page.$$eval('.sx-packet-card',els=>els.every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})),`packet cards fit at ${width}px`);
    if(width<768)assert.ok(await page.$eval('.sx-composer-bottom .sx-chat-primary',button=>{const r=button.getBoundingClientRect(),dock=document.querySelector('.rx-mobile-dock').getBoundingClientRect();return r.top>=0&&r.bottom<=dock.top;}),`send button stays above mobile navigation at ${width}px`);
    if(width===390){
      await page.screenshot({path:path.join(output,'chat-mobile.png'),fullPage:true});
      await page.click('.sx-red-packet-button');await page.waitForSelector('.sx-send-packet-dialog');await settle();
      const rect=await page.$eval('.sx-send-packet-dialog',e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
      assert.ok(rect.left>=0&&rect.right<=390&&rect.top>=0&&rect.bottom<=844,'send dialog fits phone');
      await page.click('.sx-asset-options button:nth-child(2)');await page.screenshot({path:path.join(output,'send-packet-mobile.png')});await closeDialog();
      await page.evaluate(()=>[...document.querySelectorAll('.sx-chat-header-actions button')].find(b=>b.textContent.includes('设置')).click());
      await page.waitForSelector('.sx-settings-avatar-preview img');await page.screenshot({path:path.join(output,'settings-mobile.png')});await closeDialog();
    }
  }
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  const result={status:'passed',mode:'fully intercepted isolated fixtures; no real backend writes',viewports:[320,360,390,768,1024,1440],checks:['USDT/SVX original logos and art','own/other bubble alignment','open card does not claim','explicit claim and receipt','sender/claimed/finished/expired states','details retry','send retry idempotency','SVX backend mapping','Chinese IME and Shift Enter','emoji insertion','members','settings nickname and avatar','empty-group polling','group draft isolation','mobile dialogs and no overflow'],mutations:writes.filter(w=>w.path.startsWith('/api/community/')).map(({path,group,body})=>({path,group,body})),errors,missing};
  fs.writeFileSync(path.join(output,'browser-check.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({status:result.status,checks:result.checks.length,viewports:result.viewports,output}));
} catch(error) {
  const page=(await browser.pages()).at(-1);await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
  fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.stack,errors,missing},null,2));throw error;
} finally {await browser.close();}
