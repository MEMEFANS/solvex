import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet, parseUnits } from 'ethers';
import { createWalletService } from '../src/wallet-service.js';
import { closeDatabase } from '../src/database.js';
import { createATokenService } from '../src/a-token-service.js';
import { createATokenStakingService } from '../src/a-token-staking-service.js';
import { createATokenNodeService } from '../src/a-token-node-service.js';
import { createATokenPendingService } from '../src/a-token-pending-service.js';
import { createATokenOrderService } from '../src/a-token-order-service.js';

// ══════════════════════════════════════════════════════════════
// 后台充值 SVX 的口径：只入主余额，不发放流通额度，也不进甲区
//   ① 充值后额度不变、balances.A 增加
//   ② 该用户挂卖被拒（流通额度不足）
//   ③ 主余额不能直接质押；甲区有币才可质押（2026-11-09 P1 新口径）
//   ④ 甲区币可开算力节点，不足则被拒
//   ⑤ 历史已有流通额度的用户挂卖仍正常
//   ⑥ 后台扣减 SVX 不再回收流通额度
// ══════════════════════════════════════════════════════════════

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aix-recharge-lock-'));
const A = n => parseUnits(String(n), 18);
const main = Wallet.createRandom().address;
const wallet = Wallet.createRandom().address.toLowerCase();
const legacy = Wallet.createRandom().address.toLowerCase();
const credit = (id, amount, target = wallet) => {
  const ws = currentWs;
  return ws.adminCreditAsset({ wallet: target, asset: 'A', amount, reason: '充值口径测试', requestId: id }, 'recharge-admin');
};

let currentWs;
try {
  const ws = createWalletService({ dataRoot: root, depositAddress: main, networks: [] });
  currentWs = ws;
  const db = ws.database;
  const at = createATokenService({ database: db, walletService: ws });
  at.setPrice('0.1'); // 1 SVX = 0.1 USDT
  const pending = createATokenPendingService({ aTokenService: at, database: db });
  const staking = createATokenStakingService({ aTokenService: at, database: db, pendingService: pending });
  const nodes = createATokenNodeService({ aTokenService: at, database: db, pendingService: pending });
  const orders = createATokenOrderService({ aTokenService: at, database: db });
  // 撮合与挂单受自由交易手动开关控制（需同时满足流动性准备金门槛），这里先补足 LP 并打开开关，以覆盖“有币无额度”的拒绝路径
  db.insertATokenLpPoolEntryRow({ id:'lp_fund_1', source:'adjustment', refId:'lp_fund_1', usdtUnits:parseUnits('500000',6).toString(), aUnits:'0', direction:'in', createdAt:Date.now() });
  at.setFreeTradingEnabled(true);

  const quota = w => {
    const q = db.getATokenUsableQuota(w);
    return { released: BigInt(q.releasedUnits), used: BigInt(q.usedUnits) };
  };

  // ① 后台充值 2000 SVX：余额增加，流通额度不增加
  credit('recharge_credit_1', '2000');
  assert.equal(ws.balanceUnits(wallet, 'A'), A(2000), '充值只增加 SVX 余额');
  assert.deepEqual(quota(wallet), { released: 0n, used: 0n }, '充值不得发放流通额度');
  assert.equal(db.listATokenZoneBalances(wallet).alpha, '0', '充值不进甲区，甲区只能由买币产生');

  // ② 该用户挂卖被拒：有币但无流通额度
  assert.throws(
    () => orders.placeOrder({ wallet, side: 'sell', orderType: 'limit', priceUsdt: '0.1', amount: '100' }),
    /流通额度不足/,
    '充值买入的 SVX 不能挂卖',
  );
  assert.equal(ws.balanceUnits(wallet, 'A'), A(2000), '挂卖被拒不得扣币');

  // ③ 主余额不能直接质押；甲区有币才可质押（旧档已下线，统一走能量）
  assert.throws(() => staking.stake(wallet, 'n30', '1000'), /质押套餐无效/, '只保留能量档');
  db.creditATokenZone({ wallet, zone: 'alpha', units: A(1500).toString(), bizType: 'buy', refId: 'buy_1', createdAt: Date.now() });
  const stake = staking.stake(wallet, 'energy', '1000');
  assert.equal(stake.principalUnits, A(1000).toString());
  assert.equal(ws.balanceUnits(wallet, 'A'), A(2000), '质押不动主余额');
  assert.equal(db.listATokenZoneBalances(wallet).alpha, A(500).toString(), '质押只扣甲区');

  // ④ 甲区币可开算力节点，不足则被拒
  assert.throws(() => nodes.open(wallet, '1000'), /余额不足/, '甲区不足不能开节点');
  db.creditATokenZone({ wallet, zone: 'alpha', units: A(600).toString(), bizType: 'buy', refId: 'buy_2', createdAt: Date.now() });
  const node = nodes.open(wallet, '1000');
  assert.equal(node.yieldBps, 2500);
  assert.equal(db.listATokenZoneBalances(wallet).alpha, A(100).toString(), '节点只扣甲区');
  assert.equal(ws.balanceUnits(wallet, 'A'), A(2000), '开节点不动主余额');
  assert.deepEqual(quota(wallet), { released: 0n, used: 0n }, '质押/节点在到期领取前不产生流通额度');

  // ⑤ 历史已发放流通额度的用户：挂卖仍正常
  ws.ensureUser(legacy);
  ws.creditBalance(legacy, 'A', A(100));
  db.addATokenUsableQuota(legacy, A(100)); // 模拟历史/匹配池已发放的额度
  const sell = orders.placeOrder({ wallet: legacy, side: 'sell', orderType: 'limit', priceUsdt: '0.1', amount: '100' });
  assert.equal(sell.orderStatus, 'OPEN');
  assert.deepEqual(quota(legacy), { released: A(100), used: A(100) }, '历史额度挂卖按原规则占用');
  assert.equal(ws.balanceUnits(legacy, 'A'), 0n, '卖单冻结卖出数量');

  // ⑥ 后台扣减 SVX 不再回收流通额度
  const before = quota(legacy);
  credit('recharge_debit_1', '100', legacy); // 用后台充值补足扣减所需的余额
  ws.adminDebitAsset({ wallet: legacy, asset: 'A', amount: '50', reason: '扣减口径测试', requestId: 'recharge_debit_2' }, 'recharge-admin');
  assert.equal(ws.balanceUnits(legacy, 'A'), A(50), '后台扣减只扣 SVX 余额');
  assert.deepEqual(quota(legacy), before, '后台扣减不得回收用户流通额度（含历史/匹配池额度）');

  // 撤单回归：撤销历史额度卖单，冻结的币与流通额度按原规则返还
  orders.cancelOrder({ wallet: legacy, orderId: sell.orderId });
  assert.equal(ws.balanceUnits(legacy, 'A'), A(150), '撤单返还冻结的 SVX');
  assert.deepEqual(quota(legacy), { released: A(100), used: 0n }, '撤单返还流通额度');

  console.log('PASS 后台充值只入主余额：不能卖、不进甲区；甲区可质押/开节点；历史额度与扣减回收口径保持原样');
} finally {
  closeDatabase(root);
  fs.rmSync(root, { recursive: true, force: true });
}
