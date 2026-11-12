// Read-only screenshots of the running local app, without account fixtures.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
const output = path.resolve(import.meta.dirname, '../../../output/solvex-tunnel-20261110');
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({ headless:true, executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width:1440, height:1000 });
  await page.goto('http://127.0.0.1:5174', { waitUntil:'networkidle0' });
  await page.waitForSelector('[data-mining-scene][data-scene-state=ready] canvas');
  await page.waitForFunction(() => document.querySelector('[data-mining-scene]')?.dataset.workerCount === '0');
  await page.screenshot({ path:path.join(output, 'desktop.png'), fullPage:true });
  await page.$eval('.rx-tunnel-hero', e => e.scrollIntoView({ block:'center' }));
  await (await page.$('.rx-tunnel-hero')).screenshot({ path:path.join(output, 'mine-detail.png') });
  await page.setViewport({ width:390, height:844, isMobile:true, hasTouch:true });
  await page.waitForSelector('[data-mining-scene][data-scene-state=ready] canvas');
  await page.evaluate(() => scrollTo(0, 0));
  await new Promise(resolve => setTimeout(resolve, 700));
  await page.screenshot({ path:path.join(output, 'mobile.png'), fullPage:true });
  const metrics = await page.evaluate(() => ({ viewport:innerWidth, content:document.documentElement.scrollWidth, workers:document.querySelector('[data-mining-scene]').dataset.workerCount }));
  fs.writeFileSync(path.join(output,'capture.json'), JSON.stringify({ liveLocal:true, fixtures:false, errors, ...metrics },null,2));
  console.log(JSON.stringify({ output, errors, ...metrics }));
  // A separately labeled, static-asset-only scene demonstration. No wallet or backend data.
  const demo = await browser.newPage();
  const publicRoot = path.resolve(import.meta.dirname, '../public');
  await demo.setRequestInterception(true);
  demo.on('request', request => {
    const url = new URL(request.url());
    if(url.hostname !== 'scene.test') return request.abort();
    if(url.pathname === '/') return request.respond({ contentType:'text/html; charset=utf-8', body:
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#111b27;color:#e4eaf2;font:14px/1.7 system-ui,"Microsoft YaHei",sans-serif}.hero{width:1280px;height:720px;position:relative;overflow:hidden}.scene{position:absolute;inset:0}.scene canvas{width:100%;height:100%}header{position:absolute;top:0;left:0;right:0;background:linear-gradient(#111b27d9,transparent);padding:32px 38px 60px;pointer-events:none}header small{letter-spacing:3px;color:#c4b8ec}h1{font-size:28px;font-weight:550;margin:10px 0 0}footer{position:absolute;bottom:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;background:#101d2ae8;border-top:1px solid #ffffff15;padding:16px 32px;color:#bdc9d9}button{border:1px solid #ffffff30;border-radius:7px;background:transparent;color:#d7dfeb;padding:8px 14px;font:inherit}</style><section class="hero"><div class="scene" data-active-pools="1"></div><header><small>SOLVEX / UNDERGROUND</small><h1>地下矿区</h1></header><footer><span>矿工动画 · 场景演示，不代表实际矿池状态</span><button data-scene-pause>暂停动效</button></footer></section><script type="module">import { mountMiningScene } from "/js/mining-scene.js?v=20261110-tunnel-3"; mountMiningScene(document.querySelector(".scene"));</script></html>'
    });
    const file = path.resolve(publicRoot, '.' + url.pathname);
    if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file)) return request.abort();
    return request.respond({ contentType:file.endsWith('.js')?'application/javascript':'image/svg+xml', body:fs.readFileSync(file) });
  });
  await demo.setViewport({ width:1280, height:720, deviceScaleFactor:1.5 });
  await demo.goto('https://scene.test/', { waitUntil:'networkidle0' });
  await demo.waitForSelector('[data-scene-state=ready]');
  await demo.screenshot({path:path.join(output,'mine-workers-demo.png')});
  await demo.close();
} finally { await browser.close(); }
