import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
const out=path.resolve(import.meta.dirname,'../../../output/solvex-mine-contact-20261111');fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
 const page=await browser.newPage();await page.setViewport({width:1440,height:1080});
 await page.goto('http://127.0.0.1:5174/#/earn',{waitUntil:'networkidle0'});await page.waitForSelector('[data-mining-scene]');
 await page.$eval('[data-mining-scene]',e=>e.scrollIntoView());
 await new Promise(r=>setTimeout(r,400));
 const scene=await page.$('[data-mining-scene]');
 for(const [name,width,y,xs] of [['closer',19.2,68,[15,44.5,72.5]],['compact',17.6,68,[15,44.5,72.5]],['higher',17.6,65.8,[15,44.5,72.5]]]){
  await page.evaluate(({width,y,xs})=>{
   [...document.querySelectorAll('[data-mine-tier]')].forEach((e,i)=>{e.style.setProperty('--miner-x',xs[i]+'%');e.style.setProperty('--miner-y',y+'%');e.querySelector('.rx-cavern-worker').style.width=width+'%';});
   for(const e of document.querySelectorAll('.rx-cavern-worker,.rx-cavern-impact'))for(const a of e.getAnimations()){a.pause();a.currentTime=1690+parseFloat(getComputedStyle(e).animationDelay)*1000;}
  },{width,y,xs});
  await scene.screenshot({path:path.join(out,name+'.png')});
 }
}finally{await browser.close();}
