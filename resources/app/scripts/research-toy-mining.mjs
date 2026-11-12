import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const root = path.resolve(import.meta.dirname, '../../../output/imagegen/solvex-toy-mine-20261111');
fs.mkdirSync(root, { recursive: true });
const browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1050 });
  const results = [];
  for (const [slug, url] of [
    ['bing', 'https://www.bing.com/search?q=' + encodeURIComponent('潮玩宇宙 挖矿 矿场 矿工 界面')],
    ['baidu-images', 'https://image.baidu.com/search/index?tn=baiduimage&word=' + encodeURIComponent('潮玩宇宙 矿场 挖矿')],
  ]) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 1800));
      await page.screenshot({ path: path.join(root, 'reference-' + slug + '.png') });
      const body = await page.evaluate(() => ({
        title: document.title,
        text: document.body.innerText.slice(0, 16000),
        links: [...document.querySelectorAll('a')].filter(a => /潮玩|矿场|挖矿/.test(a.textContent)).slice(0, 30).map(a => ({ title: a.textContent.trim().slice(0, 120), url: a.href })),
        images: [...document.images].filter(i => i.naturalWidth > 160).slice(0, 30).map(i => ({ src: i.currentSrc, alt: i.alt, width: i.naturalWidth, height: i.naturalHeight })),
      }));
      results.push({ slug, url, ...body });
    } catch (error) { results.push({ slug, url, error: error.message }); }
  }
  fs.writeFileSync(path.join(root, 'research.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(({slug,title,text,links,error}) => ({slug,title,text,links,error}))));
} finally { await browser.close(); }
