// Read-only inspection of the actual local app. Mutations are blocked in this browser.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const output=path.resolve(import.meta.dirname,'../../../output/solvex-community-20261111');
fs.mkdirSync(output,{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
  const page=await browser.newPage(), errors=[], blocked=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request',request=>{
    if(request.isInterceptResolutionHandled())return;
    const url=new URL(request.url());
    if(request.method()!=='GET'||(url.hostname!=='127.0.0.1'&&url.protocol!=='data:')){blocked.push({url:url.pathname,method:request.method()});return request.abort();}
    return request.continue();
  });
  await page.setViewport({width:1440,height:1000});
  await page.goto('http://127.0.0.1:5174/#/community-chat',{waitUntil:'networkidle0'});
  await page.waitForSelector('.sx-chat-gate');
  assert.ok(await page.$('.sx-message-area'));
  await page.screenshot({path:path.join(output,'local-guest-desktop.png'),fullPage:true});
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await page.waitForSelector('.sx-chat-gate');
  await page.screenshot({path:path.join(output,'local-guest-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'local-check.json'),JSON.stringify({status:'passed',base:'http://127.0.0.1:5174',mode:'read-only guest; writes blocked',errors,blocked},null,2));
  console.log('Local community page passed read-only desktop/mobile check');
} finally {await browser.close();}
