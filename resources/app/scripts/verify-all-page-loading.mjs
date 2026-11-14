// Checks deployed assets. Fixture mode intercepts every API call and wallet
// request; live mode checks public/guest views and blocks all server writes.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {fixture,wallet,profile} from '../test/fixtures/solvex-preview.mjs';

const base=process.env.SOLVEX_VERIFY_URL || 'https://solvexdex.com';
const simulated=process.argv.includes('--fixtures');
const output=new URL('../../../output/all-page-loading-20261113/',import.meta.url);
fs.mkdirSync(output,{recursive:true});
const report={base,simulated,checks:[],errors:[],failedAssets:[],blockedWrites:[]};
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
  for(const width of [1600,390]) {
    const page=await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.setViewport({width,height:width===390?844:1050,isMobile:width===390,hasTouch:width===390});
    await page.setBypassServiceWorker(true);
    page.on('pageerror',error=>report.errors.push({width,message:error.message}));
    page.on('console',message=>{if(message.type()==='error' && /页面渲染失败|React error|TypeError|SyntaxError|ReferenceError/.test(message.text()))report.errors.push({width,message:message.text()});});
    page.on('response',response=>{if(response.status()>=400 && /\.(js|css)(?:\?|$)/.test(response.url()))report.failedAssets.push({url:response.url(),status:response.status()});});
    if(simulated)await page.evaluateOnNewDocument(wallet=>{
      window.ethereum={request:async({method})=>{if(['eth_accounts','eth_requestAccounts'].includes(method))return [wallet];if(method==='eth_chainId')return '0x38';throw Error('Verification never signs or submits wallet transactions: '+method);},on(){},removeListener(){}};
      window.EventSource=class{static CLOSED=2;readyState=1;close(){}addEventListener(){}removeEventListener(){}};
    },wallet);
    await page.setRequestInterception(true);
    page.on('request',async request=>{
      if(request.isInterceptResolutionHandled())return;
      const url=new URL(request.url());
      if(simulated && url.pathname.startsWith('/api/')) {
        let result=fixture(url);
        if(url.pathname==='/api/wallet/profile')result={authenticated:true,address:wallet,balances:profile.balances,deposits:[],withdrawals:[]};
        if(url.pathname==='/api/a-token/pending')result={items:profile.pending,summary:profile.pendingSummary};
        if(url.pathname==='/api/a-token/blindbox')result={...result,rules:{...result.rules,onchainPayment:{enabled:true,contractAddress:'0xbcaA96848C32aEED39d52703aFdcE803655C52b4',usdtAddress:'0x55d398326f99059fF775485246999027B3197955',chainId:56,confirmations:3,entryUsdt:'1',coinPriceUsdt:'0.1'}}};
        return request.respond({status:200,contentType:'application/json',body:JSON.stringify(result)}).catch(()=>{});
      }
      if(request.method()!=='GET' && request.method()!=='HEAD') {
        report.blockedWrites.push({url:url.pathname,method:request.method()});
        return request.respond({status:403,contentType:'application/json',body:'{"error":"Read-only page verification"}'}).catch(()=>{});
      }
      return request.continue().catch(()=>{});
    });
    await page.goto(base+'/?all-pages-fix=20261113#/earn',{waitUntil:'networkidle2',timeout:30000});
    await page.waitForFunction(()=>Boolean(window.solvexRuntimeReady));
    await page.evaluate(()=>window.solvexRuntimeReady);
    if(simulated)await page.waitForFunction(()=>window.currentWalletProfile?.authenticated);
    async function check(name,detail='') {
      if(detail && name==='earn')await page.evaluate(sub=>window.earnSwitch(sub),detail);
      else if(detail) {
        const index=await page.$$eval('#tab-referrals [role="tab"]',(es,label)=>es.findIndex(e=>e.textContent===label),detail);
        assert(index>=0,'Missing team tab '+detail);
        const tabs=await page.$$('#tab-referrals [role="tab"]');await tabs[index].evaluate(e=>e.click());
      } else await page.evaluate(name=>window.switchTab(name),name);
      await page.waitForFunction(name=>document.getElementById('tab-'+name)?.classList.contains('active'),{},name);
      if(name==='mall')await page.waitForFunction(()=>document.getElementById('mall-frame')?.contentDocument?.querySelector('.shop-hero'));
      await new Promise(resolve=>setTimeout(resolve,650));
      const state=await page.$eval('#tab-'+name,node=>({text:node.innerText,errors:[...node.querySelectorAll('.rx-error')].map(e=>e.textContent),loading:!!node.querySelector('.rx-loading')}));
      if(state.loading){await new Promise(resolve=>setTimeout(resolve,900));}
      const text=await page.$eval('#tab-'+name,e=>e.innerText + [...e.querySelectorAll('iframe')].map(frame=>frame.contentDocument?.body?.innerText || '').join(''));
      assert(!/页面暂时无法显示|页面加载遇到问题/.test(text),name+' '+detail+' crashed');
      assert(text.trim().length>0,name+' '+detail+' is blank');
      report.checks.push({width,page:name,tab:detail,visible:true,errors:state.errors});
    }
    for(const name of ['earn','referrals','account','leaderboard','support','community-chat','ai-managed','partner-plan','a-token-trade','trade','mall'])await check(name);
    await page.evaluate(()=>window.switchTab('earn'));
    for(const sub of ['blindbox','miner','pending','play'])await check('earn',sub);
    await page.evaluate(()=>window.switchTab('referrals'));
    if(simulated)for(const tab of ['团队概览','团队成员','团队收益','升级舱','邀请好友','交易返佣'])await check('referrals',tab);
    await page.screenshot({path:fileURLToPath(new URL((simulated?'fixtures':'live')+'-team-'+width+'.png',output)),fullPage:true});
    console.log(JSON.stringify({mode:simulated?'isolated authenticated UI':'live guest UI',width,checks:report.checks.filter(c=>c.width===width).length,errors:report.errors.length,failedAssets:report.failedAssets.length}));
    await page.close();
  }
  assert.equal(report.errors.length,0,JSON.stringify(report.errors));
  assert.equal(report.failedAssets.length,0,JSON.stringify(report.failedAssets));
} finally {
  fs.writeFileSync(new URL(simulated?'fixtures.json':'live.json',output),JSON.stringify(report,null,2));
  await browser.close();
}
