// Functional check against a real, isolated local backend. No funds, transactions or remote deployment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Wallet, getBytes, isHexString } from 'ethers';
import puppeteer from 'puppeteer';
import { localEnvironment } from './local-environment.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solvex-local-runtime-'));
const marker = path.join(dataRoot, 'functional-test.json');
fs.writeFileSync(marker, JSON.stringify({ purpose: 'solvex-isolated-functional-test' }));
const output = path.resolve(appRoot, '../../output/solvex-local-20261110');
fs.mkdirSync(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), isolated: true, routes: [], errors: [] };
let backend, browser;
try {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  backend = spawn(process.execPath, ['src/server.js'], {
    cwd: appRoot, env: localEnvironment({ dataRoot, port }), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let startupError;
  backend.on('error', error => { startupError = error; });
  // Consume diagnostics without including configuration in the test report.
  backend.stderr.on('data', () => {});
  const readyBy = Date.now() + 20000;
  for (;;) {
    if (startupError) throw startupError;
    if (backend.exitCode !== null) throw new Error('Isolated backend exited during startup');
    try {
      const response = await fetch(base + '/api/wallet/session', { signal: AbortSignal.timeout(750) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { authenticated: false });
      break;
    } catch (error) {
      if (Date.now() >= readyBy) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  const html = await fetch(base).then(response => response.text());
  const ruleResponse = await fetch(base + '/api/a-token/rules');
  assert.match(ruleResponse.headers.get('X-Request-Id'), /^[a-f0-9-]{36}$/);
  const rules = await ruleResponse.json();
  assert.equal(rules.asset.mode, 'platform');
  assert.equal(rules.settlement.hour, 8);
  for (const route of ['withdraw', 'claim-signature', 'claim-confirm', 'claim-refund']) {
    const result = await fetch(base + '/api/a-token/' + route, { method: 'POST', body: '{}' });
    assert.equal(result.status, 409);
    assert.equal((await result.json()).code, 'SVX_PLATFORM_ONLY');
  }
  assert.equal(html.includes('UI_PREVIEW_ONLY'), false);
  const initialChart = await fetch(base + '/api/a-token/kline').then(response => response.json());
  assert.deepEqual(initialChart.candles, []);
  assert.equal(initialChart.status.generationEnabled, false);

  const wallet = Wallet.createRandom();
  let signatures = 0;
  browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.exposeFunction('__functionalSign', async message => {
    signatures++;
    return wallet.signMessage(isHexString(message) ? getBytes(message) : message);
  });
  await page.evaluateOnNewDocument(address => {
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method, params }) => {
        if (['eth_accounts', 'eth_requestAccounts'].includes(method)) return [address];
        if (method === 'eth_chainId') return '0x38';
        if (method === 'net_version') return '56';
        if (method === 'personal_sign') return window.__functionalSign(params[0]);
        throw new Error('Functional check does not perform wallet operation: ' + method);
      },
      on() {}, removeListener() {},
    };
  }, wallet.address);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.currentWalletProfile?.authenticated && !connectorRestoring);
  const routes = ['earn', 'referrals', 'trade', 'a-token-trade', 'account', 'ai-managed', 'leaderboard', 'support', 'community-chat', 'mall'];
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 900, isMobile: width < 768, hasTouch: width < 768 });
    for (const route of routes) {
      await page.evaluate(async route => { await window.switchTab(route); }, route);
      await page.waitForSelector('#tab-' + route + '.active');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 200)))));
      assert.equal(await page.evaluate(() => window.currentWalletProfile?.authenticated), true, route + ' retains login');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true, route + ' fits viewport ' + width);
      report.routes.push({ route, width, authenticated: true });
    }
  }
  for (const sub of ['miner', 'staking', 'pending', 'shareholder', 'blindbox', 'matchpool']) {
    await page.evaluate(async sub => { await window.switchTab('earn'); window.earnSwitch(sub); }, sub);
    assert.equal(await page.evaluate(() => window.currentWalletProfile?.authenticated), true);
    if (['shareholder', 'blindbox', 'matchpool'].includes(sub)) await page.waitForSelector('[data-native-ecosystem="' + sub + '"]');
  }
  await page.evaluate(async () => { await window.switchTab('mall'); });
  const frame = await (await page.waitForSelector('#mall-frame')).contentFrame();
  await frame.waitForSelector('#wallet-login');
  const mall = await frame.evaluate(async () => {
    const { WebsiteSession } = await import('/games/mall/session.js?v=20261110-solvex-1');
    let result;
    const session = new WebsiteSession(value => { result = value; });
    await session.refresh(); session.stop();
    return { status: result.status, balance: result.balance, loginHidden: document.getElementById('wallet-login').hidden };
  });
  assert.equal(mall.status, 'ready');
  assert.equal(Number(mall.balance), 0);
  assert.equal(mall.loginHidden, true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.currentWalletProfile?.authenticated && !connectorRestoring);
  assert.equal(signatures, 1, 'navigation and reload reuse the valid session');
  assert.deepEqual(report.errors, []);
  const database = new DatabaseSync(path.join(dataRoot, 'wg-platform.sqlite'), { readOnly: true });
  try {
    report.recordCounts = {};
    for (const table of ['deposits', 'withdrawals', 'orders', 'fills', 'a_token_trades', 'a_token_klines']) {
      report.recordCounts[table] = database.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
      assert.equal(report.recordCounts[table], 0);
    }
  } finally { database.close(); }
  Object.assign(report, { status: 'passed', signatures, mall, completedAt: new Date().toISOString() });
  fs.writeFileSync(path.join(output, 'runtime-check.json'), JSON.stringify(report, null, 2));
  console.log('PASS local runtime: fresh ledger; 10 routes at desktop/mobile sizes; one real login signature; reload and mall share session.');
} catch (error) {
  fs.writeFileSync(path.join(output, 'runtime-failure.json'), JSON.stringify({ ...report, message: error.message }, null, 2));
  throw error;
} finally {
  await browser?.close();
  if (backend && backend.exitCode === null) {
    const stopped = once(backend, 'exit');
    backend.kill();
    await stopped;
  }
  const target = fs.realpathSync(dataRoot);
  assert.ok(target.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
  assert.ok(path.basename(target).startsWith('solvex-local-runtime-'));
  assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).purpose, 'solvex-isolated-functional-test');
  fs.rmSync(target, { recursive: true, force: true });
}
