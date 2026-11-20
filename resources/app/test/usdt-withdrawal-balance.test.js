import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

// No chain calls: all wallet signatures, profiles and withdrawal POSTs are mocked.
const address = '0x1271000000000000000000000000000000000ddB';
const other = '0x2271000000000000000000000000000000000ddB';
const source = fs.readFileSync(path.resolve(import.meta.dirname, '../public/js/wallet-funds.js'), 'utf8');
const browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', req => req.respond({contentType:'text/html',body:'<!doctype html><body><button id="withdraw-submit"></button><input id="withdraw-amount"><select id="withdraw-network"><option value="bsc">BSC</option></select><div id="withdraw-status"></div></body>'}));
  await page.goto('http://withdrawal.test/');
  await page.evaluate(address => {
    window.$ = id => document.getElementById(id);
    window.escapeHtml = text => String(text ?? '');
    window.shortWallet = text => text;
    window.connectedWalletAddress = address;
    window.revision = 1;
    window.getWalletStateRevision = () => window.revision;
    window.walletProfile = {authenticated:true,address,balances:{USDT:'0'}};
    window.currentWalletProfile = window.walletProfile;
    window.walletConfig = null;
    window.serverBalance = '102';
    window.failRead = false;
    window.profileReadCount = 0;
    window.signatures = [];
    window.posts = [];
    window.config = {withdrawalEnabled:true,depositEnabled:false,withdrawalFeeBps:200,usdtMultipleOfTen:false,networks:[{id:'bsc',name:'BSC'}]};
    window.renderWalletProfile = profile => { window.walletProfile = profile; window.currentWalletProfile = profile; };
    window.ensurePlatformSession = async () => window.walletProfile;
    window.loadWalletProfile = async () => {};
    window.setAccountStatus = (id,text) => { const el=document.getElementById(id);if(el)el.textContent=text; };
    window.connectedProvider = {request:async req => {
      window.signatures.push(req);
      if(window.beforeSignReturn)window.beforeSignReturn();
      await new Promise(resolve=>setTimeout(resolve,15));
      return 'TEST_SIGNATURE_ONLY';
    }};
    window.walletApi = async (url, options={}) => {
      if(url==='/api/wallet/config')return structuredClone(window.config);
      if(url==='/api/wallet/profile'){
        window.profileReadCount++;
        if(window.failRead)throw Error('network');
        const profile={authenticated:true,address:window.connectedWalletAddress,balances:{USDT:window.serverBalance},withdrawals:[]};
        if(window.beforeProfileReturn)window.beforeProfileReturn();
        if(window.holdProfile)await window.holdProfile;
        return profile;
      }
      if(url==='/api/wallet/withdrawals'){
        const body=JSON.parse(options.body);
        window.posts.push({body,headers:options.headers});
        const toUnits=value=>{const [w,f='']=value.split('.');return BigInt(w)*1000000n+BigInt(f.padEnd(6,'0'));};
        const a=toUnits(body.amount), remaining=toUnits(window.serverBalance)-a-a*200n/10000n;
        if(remaining<0n)throw Error('平台账户余额不足');
        window.serverBalance=`${remaining/1000000n}.${String(remaining%1000000n).padStart(6,'0')}`;
        return {id:'mock',status:'pending_review'};
      }
      throw Error('Unexpected API '+url);
    };
  }, address);
  await page.addScriptTag({content:source});
  const open = () => page.evaluate(()=>USDTWithdrawal.open());
  const text = id => page.$eval('#'+id,el=>el.textContent);
  const amount = value => page.$eval('#uswd-amount',(el,v)=>{el.value=v;el.dispatchEvent(new Event('input'));},value);
  const submit = async () => {
    const signaturesBefore = await page.evaluate(()=>signatures.length);
    await page.click('#uswd-submit');
    await page.waitForFunction(before=>signatures.length===before || !/请在钱包/.test(document.getElementById('uswd-status').textContent),{},signaturesBefore);
    await page.waitForFunction(()=>!/正在|请在钱包/.test(document.getElementById('uswd-status').textContent));
    // The mocked wallet can emit an account change before its signature promise settles.
    await page.waitForFunction(()=>document.getElementById('uswd-max').disabled === false || document.getElementById('uswd-submit').disabled === false || /钱包|读取失败/.test(document.getElementById('uswd-status').textContent));
  };
  await open();
  assert.equal(await text('uswd-q-balance'),'102 U','Opening must read the server, ignoring cached zero');
  assert.equal(await text('uswd-max-amount'),'100');
  await amount('100');
  await submit();
  assert.equal(await text('uswd-status'),'提现申请已提交');
  assert.equal(await page.evaluate(()=>posts.length),1);
  assert.equal(await page.evaluate(()=>signatures[0].params[0].includes('另收2%手续费')),true);
  assert.equal(await text('uswd-q-balance'),'0 U','Refresh after success');

  await page.evaluate(()=>{serverBalance='100';});
  await open();
  await amount('100');
  await submit();
  assert.match(await text('uswd-status'),/需合计扣 102 U/);
  assert.equal(await page.evaluate(()=>signatures.length),1,'Insufficient balance must not request a signature');
  await page.click('#uswd-max');
  assert.equal(await page.$eval('#uswd-amount',el=>el.value),'98.039216');
  await submit();
  assert.equal(await text('uswd-status'),'提现申请已提交','MAX must include exact fee flooring');
  assert.equal(await page.evaluate(()=>serverBalance),'0.000000');

  await page.evaluate(()=>{serverBalance='102';});
  await open();
  await page.evaluate(()=>{serverBalance='20';});
  await amount('100');
  await submit();
  assert.match(await text('uswd-status'),/最多可提 19.607844 U/,'Refresh again on submit if balance decreased');
  assert.equal(await page.evaluate(()=>posts.length),2);

  await page.evaluate(()=>{serverBalance='102';});
  await open();
  await page.evaluate(()=>{failRead=true;});
  await amount('100');
  await submit();
  assert.match(await text('uswd-status'),/最新余额读取失败/);
  assert.equal(await page.evaluate(()=>signatures.length),2,'No stale balance fallback when read fails');
  await open();
  assert.equal(await page.$eval('#uswd-submit',el=>el.disabled),true,'Open failure disables submission');
  await page.evaluate(()=>{failRead=false;config.usdtMultipleOfTen=true;serverBalance='100';});
  await open();
  await page.click('#uswd-max');
  assert.equal(await page.$eval('#uswd-amount',el=>el.value),'90','MAX obeys tens policy');
  await amount('91');
  await submit();
  assert.match(await text('uswd-status'),/10 的整数倍/);

  // Exhaustively check the boundary formula against the server fee calculation.
  assert.equal(await page.evaluate(()=>{
    walletConfig.usdtMultipleOfTen=false;
    for(const rate of [0,200,333]){
      walletConfig.withdrawalFeeBps=rate;
      for(const balance of ['0','0.999999','1','1.02','1.020001','100','102','999999999999.123456']){
        const profile={balances:{USDT:balance}},b=usdtWithdrawalQuote(balance).amount;
        const max=maxUsdtWithdrawal(profile);
        if(max===0n)continue;
        if(max+max*BigInt(rate)/10000n>b)return false;
        const next=max+1n;
        if(next+next*BigInt(rate)/10000n<=b)return false;
      }
    }
    return true;
  }),true);

  await page.evaluate(()=>{config.usdtMultipleOfTen=false;serverBalance='102';});
  await open();
  await amount('100');
  await page.evaluate(other=>{beforeSignReturn=()=>{connectedWalletAddress=other;revision++;window.dispatchEvent(new Event('walletstatechange'));};},other);
  await submit();
  await page.waitForFunction(()=>document.getElementById('uswd-status').textContent.includes('钱包已切换'));
  assert.match(await text('uswd-status'),/钱包已切换/);
  assert.equal(await page.evaluate(()=>posts.length),2,'No POST after account switch during signing');

  await page.evaluate(address=>{beforeSignReturn=null;connectedWalletAddress=address;revision++;walletProfile={authenticated:true,address,balances:{USDT:'0'}};},address);
  await page.evaluate(other=>{beforeProfileReturn=()=>{connectedWalletAddress=other;revision++;window.dispatchEvent(new Event('walletstatechange'));};},other);
  await open();
  assert.equal(await page.$eval('#uswd-submit',el=>el.disabled),true);
  assert.equal(await page.evaluate(()=>walletProfile.balances.USDT),'0','Ignore a stale response after account switch');

  await page.evaluate(address=>{beforeProfileReturn=null;connectedWalletAddress=address;revision++;walletProfile={authenticated:true,address,balances:{USDT:'0'}};},address);
  await open();
  await amount('100');
  await page.evaluate(()=>{document.getElementById('uswd-submit').click();document.getElementById('uswd-submit').click();});
  await page.waitForFunction(()=>document.getElementById('uswd-status').textContent==='提现申请已提交');
  assert.equal(await page.evaluate(()=>posts.length),3,'Double click creates one request');

  // The legacy inline form must use the same strict fresh balance validation.
  await page.evaluate(()=>{serverBalance='102';walletProfile.balances.USDT='0';document.getElementById('withdraw-amount').value='100';});
  await page.evaluate(()=>submitWithdrawal());
  assert.equal(await text('withdraw-status'),'提现申请已提交');
  assert.equal(await page.evaluate(()=>posts.length),4);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS USDT withdrawal: fresh open/submit balance, fee-aware MAX and tens, exact arithmetic, failed reads, wallet-switch guards, duplicate clicks, legacy form');
} finally { await browser.close(); }
