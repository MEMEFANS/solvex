import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet, parseUnits } from 'ethers';
import { createWalletService } from '../src/wallet-service.js';
import { closeDatabase } from '../src/database.js';
import { createATokenService } from '../src/a-token-service.js';
import { createATokenMinerService } from '../src/a-token-miner-service.js';
import { createATokenActivationService } from '../src/a-token-activation-service.js';
import { createATokenStakingService } from '../src/a-token-staking-service.js';
import { createATokenOrderService } from '../src/a-token-order-service.js';

// ══════════════════════════════════════════════════════════════
// 后台充值 AIX 的口径：只入余额，不发放可用额度
//   ① 充值后 usable 不变、balances.A 增加
//   ② 该用户挂卖被拒（可用额度不足）
//   ③ 该用户质押成功
//   ④ 该用户开矿机成功
//   ⑤ 历史已有可用额度的用户挂卖仍正常
//   ⑥ 后台扣减 AIX 不再回收可用额度
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
  at.setPrice('0.1'); // 1 AIX = 0.1 USDT
  const miners = createATokenMinerService({ aTokenService: at, database: db });
  const activation = createATokenActivationService({ aTokenService: at, minerService: miners, database: db, collectionAddress: main });
  const staking = createATokenStakingService({ aTokenService: at, database: db });
  const orders = createATokenOrderService({ aTokenService: at, database: db });

  const quota = w => {
    const q = db.getATokenUsableQuota(w);
    return { released: BigInt(q.releasedUnits), used: BigInt(q.usedUnits) };
  };

  // ① 后台充值 2000 AIX：余额增加，可用额度不增加
  credit('recharge_credit_1', '2000');
  assert.equal(ws.balanceUnits(wallet, 'A'), A(2000), '充值只增加 AIX 余额');
  assert.deepEqual(quota(wallet), { released: 0n, used: 0n }, '充值不得发放可用额度');

  // ② 该用户挂卖被拒：有币但无可用额度
  assert.throws(
    () => orders.placeOrder({ wallet, side: 'sell', orderType: 'limit', priceUsdt: '0.1', amount: '100' }),
    /可用额度不足/,
    '充值买入的 AIX 不能挂卖',
  );
  assert.equal(ws.balanceUnits(wallet, 'A'), A(2000), '挂卖被拒不得扣币');

  // ③ 质押成功（30 天档最低 10 AIX）
  const stake = staking.stake(wallet, 's30', '100');
  assert.equal(stake.principalUnits, A(100).toString());
  assert.equal(ws.balanceUnits(wallet, 'A'), A(1900), '质押只扣 AIX 余额');

  // ④ 开矿机成功（Mini 20 AIX）
  const record = activation.activate(wallet, '1', 'recharge_mini_request_1');
  assert.equal(record.status, 'confirmed');
  assert.equal(ws.balanceUnits(wallet, 'A'), A(1880), '激活只扣 AIX 余额并全额销毁');
  assert.equal(db.listATokenMiners(wallet).length, 1);
  assert.deepEqual(quota(wallet), { released: 0n, used: 0n }, '质押/开矿机不产生可用额度');

  // ⑤ 历史已发放可用额度的用户：挂卖仍正常
  ws.ensureUser(legacy);
  ws.creditBalance(legacy, 'A', A(100));
  db.addATokenUsableQuota(legacy, A(100)); // 模拟历史/匹配池已发放的额度
  const sell = orders.placeOrder({ wallet: legacy, side: 'sell', orderType: 'limit', priceUsdt: '0.1', amount: '100' });
  assert.equal(sell.orderStatus, 'OPEN');
  assert.deepEqual(quota(legacy), { released: A(100), used: A(100) }, '历史额度挂卖按原规则占用');
  assert.equal(ws.balanceUnits(legacy, 'A'), 0n, '卖单冻结卖出数量');

  // ⑥ 后台扣减 AIX 不再回收可用额度
  const before = quota(legacy);
  credit('recharge_debit_1', '100', legacy); // 用后台充值补足扣减所需的余额
  ws.adminDebitAsset({ wallet: legacy, asset: 'A', amount: '50', reason: '扣减口径测试', requestId: 'recharge_debit_2' }, 'recharge-admin');
  assert.equal(ws.balanceUnits(legacy, 'A'), A(50), '后台扣减只扣 AIX 余额');
  assert.deepEqual(quota(legacy), before, '后台扣减不得回收用户可用额度（含历史/匹配池额度）');

  // 撤单回归：撤销历史额度卖单，冻结的币与可用额度按原规则返还
  orders.cancelOrder({ wallet: legacy, orderId: sell.orderId });
  assert.equal(ws.balanceUnits(legacy, 'A'), A(150), '撤单返还冻结的 AIX');
  assert.deepEqual(quota(legacy), { released: A(100), used: 0n }, '撤单返还可用额度');

  console.log('PASS 后台充值只入余额不发可用额度：不能卖、可质押、可开矿机；历史额度与扣减回收口径保持原样');
} finally {
  closeDatabase(root);
  fs.rmSync(root, { recursive: true, force: true });
}
