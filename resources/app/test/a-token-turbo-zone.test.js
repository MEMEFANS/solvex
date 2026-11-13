import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet, parseUnits } from 'ethers';
import { createWalletService } from '../src/wallet-service.js';
import { closeDatabase } from '../src/database.js';
import { createATokenService } from '../src/a-token-service.js';
import { createATokenShareholderService } from '../src/a-token-shareholder-service.js';
import { createATokenTurboService } from '../src/a-token-turbo-service.js';
import { createATokenZoneTradeService } from '../src/a-token-zone-trade-service.js';

// ══════════════════════════════════════════════════════════════
// 2026-11-09 P2 第二块：
//   1. 一键买：甲区 / 乙区两个入口，按大盘价，买入 0 手续费；
//   2. 甲区与乙区账本隔离，不可互转；
//   3. 乙区买入的币留在乙区；进涡轮满 24h 释放等额卖出额度（1:1），币解锁回可用余额；
//   4. 额度滚动叠加；自释放起 30 天有效，到期未用部分作废；
//   5. 一键卖：消耗流通额度、扣币、5% USDT 手续费进股东池；
//   6. requestId 幂等，重复提交不重复扣款。
// ══════════════════════════════════════════════════════════════

const A = v => parseUnits(String(v), 18);
const U = v => parseUnits(String(v), 6);
const HOUR = 3_600_000;
const DAY = 86_400_000;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a-token-turbo-'));
const walletService = createWalletService({ dataRoot: root, networks: [] });
const database = walletService.database;
const at = createATokenService({ database, walletService });
const shareholder = createATokenShareholderService({ database, walletService, aTokenService: at });
let now = 1_800_000_000_000;
const turbo = createATokenTurboService({ aTokenService: at, database, clock: () => now });
const trade = createATokenZoneTradeService({ aTokenService: at, database, shareholderService: shareholder, clock: () => now });
const wallet = Wallet.createRandom().address.toLowerCase();

const zone = key => BigInt(database.getATokenZoneBalance(wallet, key).units);
const quota = () => database.getATokenUsableQuota(wallet);
const availableQuota = () => BigInt(quota().releasedUnits) - BigInt(quota().usedUnits);
const fail = msg => { throw new Error(`FAIL: ${msg}`); };

try {
  walletService.ensureUser(wallet);
  walletService.creditBalance(wallet, 'USDT', U(3000));
  at.setPrice('0.1'); // 1 SVX = 0.1 USDT

  // ── 1. 甲区一键买：1000 USDT → 10000 SVX，按标的价实付、0 手续费 ──
  const buyAlpha = trade.buy({ wallet, zone: 'alpha', usdtAmount: '1000', requestId: 'buy_alpha' });
  assert.equal(buyAlpha.zone, 'alpha');
  assert.equal(zone('alpha'), A(10000), '甲区应到账 10000 SVX');
  assert.equal(zone('beta'), 0n, '乙区不应变化');
  assert.equal(buyAlpha.feeUsdt, '0.0', '买入手续费 0');
  assert.equal(buyAlpha.totalUsdt, '1000.0', '买入实付 = 成交金额');
  assert.equal(walletService.balanceUnits(wallet, 'USDT'), U(2000), 'USDT 应扣 1000（买入 0 手续费）');
  // 2026-11-11 新规：买入 0 手续费，不产生 buy_fee 记账
  assert.equal(BigInt(shareholder.overview().balanceSvx ? parseUnits(shareholder.overview().balanceSvx, 18) : 0n), 0n, '买入不产生手续费');
  assert.equal(BigInt(parseUnits(shareholder.feeBurnOverview().totalBurnSvx, 18)), 0n, '买入不产生销毁');
  assert.equal(at.balanceA(wallet), 0n, '甲区买入不应直接进可用余额');

  // ── 2. 乙区一键买：500 USDT → 5000 SVX，成交币留在乙区余额（不进主 A、不产生额度）──
  const buyBeta = trade.buy({ wallet, zone: 'beta', usdtAmount: '500', requestId: 'buy_beta' });
  assert.equal(buyBeta.zone, 'beta');
  assert.equal(buyBeta.aOut, '5000.0', '乙区入口按 0.1 购入 5000 SVX');
  assert.equal(buyBeta.feeUsdt, '0.0');
  assert.equal(buyBeta.totalUsdt, '500.0');
  assert.equal(zone('beta'), A(5000), '乙区一键买的币应留在乙区余额');
  assert.equal(zone('alpha'), A(10000), '甲区不应变化（分区隔离）');
  assert.equal(at.balanceA(wallet), 0n, '乙区买入不进主 A 余额');
  assert.equal(availableQuota(), 0n, '乙区买入不直接产生卖出额度');
  assert.equal(walletService.balanceUnits(wallet, 'USDT'), U(1500), 'USDT 应再扣 500');

  // 幂等：同一 requestId 不重复扣款
  const again = trade.buy({ wallet, zone: 'beta', usdtAmount: '500', requestId: 'buy_beta' });
  assert.equal(again.idempotent, true);
  assert.equal(zone('beta'), A(5000), '重复请求不应重复入账');
  assert.equal(walletService.balanceUnits(wallet, 'USDT'), U(1500), '重复请求不应重复扣款');

  // ── 3. 涡轮进池：直接用乙区买入的币，满 24h 释放 ──
  turbo.enter({ wallet, units: '4000', refId: 'turbo_1' });
  assert.equal(zone('beta'), A(1000), '进涡轮应从乙区扣币');
  assert.equal(zone('alpha'), A(10000), '甲区不受影响（不可互转）');
  assert.equal(at.balanceA(wallet), 0n, '未满 24h 不额外解锁币');
  assert.equal(availableQuota(), 0n, '未满 24h 不应有额度');

  assert.equal(turbo.releaseDue(), 0, '未满 24h 不应释放');
  now += 24 * HOUR;
  assert.equal(turbo.releaseDue(), 1, '满 24h 应释放 1 笔');
  assert.equal(availableQuota(), A(4000), '应释放等额 4000 卖出额度（1:1）');
  assert.equal(at.balanceA(wallet), A(4000), '锁定的币应解锁回可用余额（0 + 4000）');

  // ── 4. 滚动叠加：再买 500 SVX 进乙区 → 进涡轮，24 小时后额度累加 ──
  now += HOUR;
  trade.buy({ wallet, zone: 'beta', usdtAmount: '50', requestId: 'buy_beta_2' });
  assert.equal(zone('beta'), A(1500), '第二次乙区买入 500 SVX 后乙区为 1500');
  turbo.enter({ wallet, units: '500', refId: 'turbo_2' });
  assert.equal(zone('beta'), A(1000), '进涡轮再扣 500');
  now += 24 * HOUR;
  assert.equal(turbo.releaseDue(), 1, '第二笔满 24h 应释放');
  assert.equal(availableQuota(), A(4500), '额度应滚动叠加为 4500');
  assert.equal(at.balanceA(wallet), A(4500), '可用余额应累加（4000 + 500）');

  // ── 5. 一键卖：1000 SVX，消耗额度，5% USDT 手续费进股东池 ──
  const before = walletService.balanceUnits(wallet, 'USDT');
  const sell = trade.sell({ wallet, aixAmount: '1000', requestId: 'sell_1' });
  assert.equal(BigInt(sell.grossUsdt ? parseUnits(sell.grossUsdt, 6) : 0n), U(100), '成交额应为 100 USDT');
  assert.equal(walletService.balanceUnits(wallet, 'USDT'), before + U(100), '卖出实收全额 USDT（手续费扣 SVX）');
  assert.equal(at.balanceA(wallet), A(3500), '应扣 1000 SVX');
  assert.equal(availableQuota(), A(3500), '卖出应消耗 1000 流通额度');
  assert.equal(BigInt(shareholder.overview().balanceSvx ? parseUnits(shareholder.overview().balanceSvx, 18) : 0n), A(25), '卖出手续费 50 SVX 的 50% 进股东池');
  assert.equal(BigInt(parseUnits(shareholder.feeBurnOverview().totalBurnSvx, 18)), A(25), '卖出手续费 50 SVX 的 50% 销毁');
  const repeatSell = trade.sell({ wallet, aixAmount: '1000', requestId: 'sell_1' });
  assert.equal(repeatSell.idempotent, true);
  assert.equal(at.balanceA(wallet), A(3500), '重复卖出不应重复扣币');

  // 额度不足时禁止卖出（模拟卖出超过额度）
  assert.throws(() => trade.sell({ wallet, aixAmount: '9999', requestId: 'sell_over' }), /流通额度不足/);

  // ── 6. 30 天封顶：各批次自释放起 30 天，未用部分作废 ──
  // 首批 4000 中已用 1000，剩 3000；第二笔 500 未用。
  now = 1_800_000_000_000 + 24 * HOUR + 30 * DAY + 1;
  assert.equal(turbo.expireDue(), 1, '首批额度满 30 天应作废');
  assert.equal(availableQuota(), A(500), '首批未用的 3000 应扣回，剩余 500');
  const over = turbo.overview(wallet);
  assert.equal(over.quotaTtlDays, 30);
  assert.ok(over.locks.some(lock => lock.status === 'expired'), '应存在已作废批次');

  now = 1_800_000_000_000 + 49 * HOUR + 30 * DAY + 1;
  assert.equal(turbo.expireDue(), 1, '第二批额度满 30 天应作废');
  assert.equal(BigInt(quota().releasedUnits) - BigInt(quota().usedUnits), 0n, '全部到期后流通额度应为 0');
  assert.equal(zone('alpha'), A(10000), '全程甲区余额不变（不可互转）');
  assert.equal(zone('beta'), A(1000), '乙区剩余的 1000 SVX 仍在乙区');

  console.log('PASS: 一键买（甲/乙区隔离、买入 0 手续费）、涡轮 1:1 满 24h 释放、额度滚动叠加、30 天到期作废、一键卖消耗额度与 5% 手续费入池、requestId 幂等');
} finally {
  closeDatabase(root);
  fs.rmSync(root, { recursive: true, force: true });
}
