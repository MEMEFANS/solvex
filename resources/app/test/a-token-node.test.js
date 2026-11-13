import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseUnits } from 'ethers';
import { createWalletService } from '../src/wallet-service.js';
import { closeDatabase } from '../src/database.js';
import { createATokenService } from '../src/a-token-service.js';
import { createATokenPendingService } from '../src/a-token-pending-service.js';
import { createATokenNodeService } from '../src/a-token-node-service.js';
import { nextSettlementAt } from '../src/a-token-time.js';

const A = x => parseUnits(String(x), 18);
const user = n => '0x' + n.toString(16).padStart(40, '0');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aix-node-'));
let now = Date.now();
try {
  const wallet = createWalletService({ dataRoot: root, depositAddress: user(999), networks: [] });
  const db = wallet.database;
  const at = createATokenService({ database: db, walletService: wallet });
  const pending = createATokenPendingService({ aTokenService: at, database: db, clock: () => now });
  const u1 = user(1), u2 = user(2), u3 = user(3);
  wallet.ensureUser(u1); wallet.ensureUser(u2); wallet.ensureUser(u3);
  const team = { getReferralChain: () => [u2, u3] };
  const nodes = createATokenNodeService({ aTokenService: at, database: db, pendingService: pending, teamService: team, clock: () => now });

  assert.equal(nodes.quote('1000').yieldBps, 2500);
  assert.equal(nodes.quote('1999').yieldBps, 2500);
  assert.equal(nodes.quote('2000').yieldBps, 4500);
  assert.equal(nodes.quote('5000').yieldBps, 4500);
  assert.equal(nodes.quote('5001').yieldBps, 4500, '银档上限已放宽到 10,000');
  assert.equal(nodes.quote('9999').yieldBps, 4500);
  assert.equal(nodes.quote('10000').yieldBps, 5500, '10,000 起进入金档');
  assert.throws(() => nodes.quote('999'), /最少/);

  db.creditATokenZone({ wallet: u1, zone: 'alpha', units: A(3000).toString(), bizType: 'buy', refId: 'buy1', createdAt: now });
  assert.throws(() => nodes.open(u1, '3001'), /余额不足/);
  const n = nodes.open(u1, '2000');
  assert.equal(n.yieldBps, 4500);
  assert.equal(db.listATokenZoneBalances(u1).alpha, A(1000).toString());
  assert.equal(db.sumATokenTeamPerfUnits(u2, 'node'), A(2000).toString());
  assert.equal(db.sumATokenTeamPerfUnits(u3, 'node'), A(2000).toString());

  // 到期后要等最后一个 UTC 结算边界过去，尾段利息才结清
  now = nextSettlementAt(n.expiresAt);
  const r = nodes.processAll();
  assert.equal(r.settled, 1);
  // 利息按 UTC 00:00 逐日分摊（首尾不足一天单独成段），到期再挂本金（1 条）
  const rows = pending.list(u1, 'pending', 500);
  const interestRows = rows.filter(x => String(x.periodKey).startsWith('interest_'));
  assert.ok(interestRows.length >= 30, '按日分摊，至少 30 段利息');
  assert.equal(rows.filter(x => String(x.periodKey) === 'principal').length, 1, '到期单独挂本金');
  const sumOf = key => rows.reduce((s, x) => s + BigInt(x[key]), 0n);
  assert.equal(sumOf('amountUnits'), A(2900), '利息 45% = 900，加本金 2000');
  assert.equal(sumOf('quotaUnits'), A(2900), '利息与本金均释放卖出额度');
  assert.equal(db.getATokenNode(n.id).status, 'completed');
  nodes.processAll();
  assert.equal(pending.list(u1, 'pending', 500).length, rows.length, '重复巡检不重复挂账');

  // 本金不作废，可领；日利息过次日 00:00 作废
  const principalRow = rows.find(x => String(x.periodKey) === 'principal');
  assert.ok(principalRow, '本金单独一条');
  const before = at.balanceA(u1);
  const zoneBefore = BigInt(db.getATokenZoneBalance(u1, 'alpha').units);
  const c = pending.claim(u1, principalRow.id);
  assert.equal(BigInt(c.amountUnits), A(2000));
  assert.equal(at.balanceA(u1) - before, 0n);
  assert.equal(BigInt(db.getATokenZoneBalance(u1, 'alpha').units) - zoneBefore, A(2000));
  assert.throws(() => pending.claim(u1, principalRow.id), /已处理|已被领取/);

  const firstInterest = rows.find(x => String(x.periodKey).startsWith('interest_'));
  assert.ok(firstInterest);
  const swept = pending.sweepExpired(now);
  assert.ok(swept.expired >= 1, '已过窗口的日利息被作废');
  assert.equal(db.getATokenPendingReward(firstInterest.id).status, 'expired');
  assert.throws(() => pending.claim(u1, firstInterest.id), /过期|已处理/);

  db.creditATokenZone({ wallet: u1, zone: 'alpha', units: A(1000).toString(), bizType: 'buy', refId: 'buy2', createdAt: now });
  const n2 = nodes.open(u1, '1000');
  now = nextSettlementAt(n2.expiresAt); nodes.processAll();
  const secondRows = pending.list(u1, 'pending', 500).filter(x => x.bizId === n2.id);
  assert.equal(secondRows.filter(x => String(x.periodKey) === 'principal').length, 1, '第二期到期同样挂本金');
  assert.ok(secondRows.filter(x => String(x.periodKey).startsWith('interest_')).length >= 30, '第二期同样按日分摊');

  console.log('P1 节点链路校验通过');
} finally {
  closeDatabase(root);
  fs.rmSync(root, { recursive: true, force: true });
}

