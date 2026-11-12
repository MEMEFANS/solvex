import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet, formatUnits } from 'ethers';
import { createWalletService } from '../src/wallet-service.js';
import { createATokenService, A_TOKEN_DECIMALS } from '../src/a-token-service.js';
import { createATokenTeamService } from '../src/a-token-team-service.js';
import { createATokenOrderService } from '../src/a-token-order-service.js';
import { createATokenShareholderService } from '../src/a-token-shareholder-service.js';
import { createReferralService } from '../src/referral-service.js';

// ══════════════════════════════════════════════════════════════
// 市价单「委托价跟随现价」：
//   - 挂单中（OPEN）的市价单，读取时直接按当前币价展示（不依赖撮合轮刷新，
//     manual 模式下 K 线 tick 不跑，撮合轮也不会执行）
//   - 限价单保持用户指定价
//   - 已结束（FILLED/CANCELLED）的市价单保留成交时的历史价
// ══════════════════════════════════════════════════════════════

const A = v => BigInt(v) * 10n ** BigInt(A_TOKEN_DECIMALS);
const U6 = v => BigInt(v) * 10n ** 6n;
const pass = msg => console.log(`  ✓ ${msg}`);

function makeEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-market-price-'));
  const walletService = createWalletService({ dataRoot: root, depositAddress: `0x${'D'.repeat(40)}`, networks: [] });
  const database = walletService.database;
  const at = createATokenService({ database, walletService });
  const teamService = createATokenTeamService({ database, walletService });
  const referralService = createReferralService({ database, walletService });
  const shareholderService = createATokenShareholderService({ database, walletService, aTokenService: at });
  const orderService = createATokenOrderService({ aTokenService: at, database, teamService, referralService, shareholderService });
  at.setPrice('0.1');
  const wallets = {};
  for (const key of ['buyer', 'seller']) {
    wallets[key] = Wallet.createRandom().address.toLowerCase();
    walletService.ensureUser(wallets[key]);
  }
  at.creditUsdt(wallets.buyer, U6(1000));
  at.creditA(wallets.seller, A(1000));
  // 卖出必须有流通额度（2026-10-31 匹配池规则）：额度不足时挂卖会被网关直接拒绝
  database.addATokenUsableQuota(wallets.seller, A(1000));
  // 下单/撮合受自由交易手动开关 + LP 准备金门槛双重约束：补齐门槛并打开开关
  database.insertATokenLpPoolEntryRow({
    id: 'seed_lp', source: 'adjustment', refId: 'seed_lp', direction: 'in',
    usdtUnits: U6(500000).toString(), aUnits: '0', createdAt: Date.now(),
  });
  at.setFreeTradingEnabled(true);
  return { root, walletService, database, at, orderService, wallets };
}

const BPS = 10000n;
const PRICE_UNITS = 100000n;            // 0.1 USDT/A（6 位小数）
const usdtFor = aUnits => aUnits * PRICE_UNITS / A(1);

const myOrder = (env, wallet, orderId) =>
  env.orderService.myOrders({ wallet }).find(o => o.orderId === orderId);
// formatUnits 会去掉小数末尾的 0（'0.1' 而非 '0.100000'），统一按 4 位小数比较
const p4 = v => Number(v).toFixed(4);

// ── 场景 1：撮合轮没跑，OPEN 市价单也要跟随现价 ──
{
  const env = makeEnv();
  const r = env.orderService.placeOrder({ wallet: env.wallets.buyer, side: 'buy', orderType: 'market', amount: '100' });
  assert.equal(r.orderStatus, 'OPEN', '无对手方时应挂单');
  assert.equal(p4(myOrder(env, env.wallets.buyer, r.orderId).orderPriceUsdt), '0.1000');
  env.at.setPrice('0.2');
  // 注意：这里刻意不调用 matchOpenOrders()
  assert.equal(p4(myOrder(env, env.wallets.buyer, r.orderId).orderPriceUsdt), '0.2000', '改价后应立刻跟随，无需撮合轮');
  assert.equal(p4(env.orderService.openOrders({}).buys[0].priceUsdt), '0.2000', '挂单明细里市价单价格同样跟随');
  pass('OPEN 市价单不依赖撮合轮，读取即跟随现价（我的委托 + 挂单明细）');
}

// ── 场景 2：限价单保持用户指定价 ──
{
  const env = makeEnv();
  const r = env.orderService.placeOrder({ wallet: env.wallets.buyer, side: 'buy', orderType: 'limit', priceUsdt: '0.05', amount: '100' });
  assert.equal(p4(myOrder(env, env.wallets.buyer, r.orderId).orderPriceUsdt), '0.0500');
  env.at.setPrice('0.2');
  assert.equal(p4(myOrder(env, env.wallets.buyer, r.orderId).orderPriceUsdt), '0.0500', '限价单不得被现价覆盖');
  assert.equal(p4(env.orderService.openOrders({}).buys[0].priceUsdt), '0.0500');
  pass('限价单保持用户指定价不受现价影响');
}

// ── 场景 3：已成交（FILLED）的市价单保留历史价 ──
{
  const env = makeEnv();
  const sell = env.orderService.placeOrder({ wallet: env.wallets.seller, side: 'sell', orderType: 'limit', priceUsdt: '0.1', amount: '10' });
  assert.equal(sell.orderStatus, 'OPEN');
  // 市价买单 0.5 USDT → 按 0.1 价需要 5 SVX（小于卖家可成交净额，应全额成交）
  const buy = env.orderService.placeOrder({ wallet: env.wallets.buyer, side: 'buy', orderType: 'market', amount: '0.5' });
  assert.equal(buy.orderStatus, 'FILLED', '应吃到对手方限价卖单');
  assert.equal(p4(myOrder(env, env.wallets.buyer, buy.orderId).orderPriceUsdt), '0.1000');
  env.at.setPrice('0.5');
  assert.equal(p4(myOrder(env, env.wallets.buyer, buy.orderId).orderPriceUsdt), '0.1000', '已结束订单保留历史价');
  pass('FILLED 市价单保留成交时的历史价');
}

// ── 场景 4：挂单（maker）被部分吃掉后，剩余委托量必须按成交量递减 ──
{
  const env = makeEnv();
  // 卖家挂限价卖单 10 SVX @ 0.1
  const sell = env.orderService.placeOrder({ wallet: env.wallets.seller, side: 'sell', orderType: 'limit', priceUsdt: '0.1', amount: '10' });
  assert.equal(sell.orderStatus, 'OPEN');
  assert.equal(Number(myOrder(env, env.wallets.seller, sell.orderId).inputA), 10, '初始挂单量应为 10 SVX');

  // 买家限价买入 0.2 USDT @ 0.1 → 成交 2 SVX；卖出手续费按 USDT 扣，不扣币
  const buy = env.orderService.placeOrder({ wallet: env.wallets.buyer, side: 'buy', orderType: 'limit', priceUsdt: '0.1', amount: '0.2' });
  assert.equal(buy.orderStatus, 'FILLED', '小额买单应全额成交');
  const sellAfter = myOrder(env, env.wallets.seller, sell.orderId);
  assert.equal(sellAfter.orderStatus, 'OPEN', '卖家仅被部分成交，应仍为挂单中');
  assert.equal(sellAfter.inputA, formatUnits(A(8), A_TOKEN_DECIMALS), '卖家剩余挂单量 = 10 − 2（币数不扣手续费）');
  assert.equal(Number(sellAfter.filledA), 2, '卖家累计成交量应为 2 SVX');
  pass('限价卖单（maker）部分成交后，挂单量按成交量递减且状态保持挂单中');
}

// ── 场景 5：限价买单（maker）被吃掉后，剩余 USDT 委托量递减 ──
{
  const env = makeEnv();
  // 买家挂限价买单 10 USDT @ 0.1（买入 0 手续费，只冻结成交金额）
  const buy = env.orderService.placeOrder({ wallet: env.wallets.buyer, side: 'buy', orderType: 'limit', priceUsdt: '0.1', amount: '10' });
  assert.equal(buy.orderStatus, 'OPEN');
  assert.equal(Number(myOrder(env, env.wallets.buyer, buy.orderId).inputUsdt), 10, '初始冻结成交金额应为 10 USDT');

  // 卖家限价卖出 10 SVX @ 0.1 → 全部被买家吸收（成交 1 USDT）
  const sell = env.orderService.placeOrder({ wallet: env.wallets.seller, side: 'sell', orderType: 'limit', priceUsdt: '0.1', amount: '10' });
  assert.equal(sell.orderStatus, 'FILLED', '卖家全部币被买家吸收');
  const buyAfter = myOrder(env, env.wallets.buyer, buy.orderId);
  assert.equal(buyAfter.orderStatus, 'OPEN', '买家仅部分成交，应仍挂单中');
  assert.equal(buyAfter.inputUsdt, formatUnits(U6(9), 6), '买家挂单成交金额应按成交量递减');
  assert.equal(buyAfter.filledUsdt, formatUnits(U6(1), 6), '买家累计成交额应为 1 USDT');
  assert.equal(buyAfter.filledA, formatUnits(A(10), A_TOKEN_DECIMALS), '买家累计买入应为卖家成交币数');
  pass('限价买单（maker）部分成交后，冻结 USDT 委托量递减且状态保持挂单中');
}

// ── 场景 6：maker 被全额吃掉后应变 FILLED 且剩余量归零 ──
{
  const env = makeEnv();
  // 卖家挂 10 SVX @0.1，买家以 10 USDT 限价吃单：币数足够，卖单被全部吃掉
  const sell = env.orderService.placeOrder({ wallet: env.wallets.seller, side: 'sell', orderType: 'limit', priceUsdt: '0.1', amount: '10' });
  const buy = env.orderService.placeOrder({ wallet: env.wallets.buyer, side: 'buy', orderType: 'limit', priceUsdt: '0.1', amount: '10' });
  assert.equal(buy.orderStatus, 'OPEN', '买单只吃掉卖家 10 SVX，剩余仍挂单');
  const sellAfter = myOrder(env, env.wallets.seller, sell.orderId);
  assert.equal(sellAfter.orderStatus, 'FILLED', '卖单被吃光后应变已成交');
  assert.equal(Number(sellAfter.inputA), 0, '已成交的挂单剩余量应归零');
  assert.equal(sellAfter.filledA, formatUnits(A(10), A_TOKEN_DECIMALS), '已成交的挂单成交量应为 10 SVX');
  pass('maker 被全额吃掉后状态变为已成交、剩余量归零、成交量正确');
}
