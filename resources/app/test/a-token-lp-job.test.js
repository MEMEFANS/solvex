// 提现手续费「按日累计 + 每日批量加 LP」链路测试。
// 覆盖：多笔汇总成一次 / 同日重复执行不重复加池 / 跨日累计不串账 / 失败重试不丢金额 / 冲销扣减。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet, parseUnits, keccak256, toUtf8Bytes, getAddress } from 'ethers';
import { createWalletService } from '../src/wallet-service.js';
import { createATokenService } from '../src/a-token-service.js';
import { installSolvexWithdrawalFees } from '../src/solvex-withdrawal-fees.js';
import { createATokenLpJobService } from '../src/a-token-lp-job-service.js';
import { closeDatabase } from '../src/database.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solvex-auto-lp-daily-'));
const user = Wallet.createRandom();
const U = n => parseUnits(String(n), 6);
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const SVX = '0x2222222222222222222222222222222222222222';
const LP_CONTRACT = '0x1111111111111111111111111111111111111111';
const options = {
  dataRoot: root,
  withdrawalAddress: Wallet.createRandom().address,
  autoWithdrawalEnabled: true,
  autoWithdrawalReviewThresholdUsdt: '100000',
  autoWithdrawalDailyLimitUsdt: '1000000',
  networks: [{
    id: 'bsc', name: 'BNB Smart Chain', chainId: 56, provider: {},
    tokenContract: USDT, tokenDecimals: 18, confirmations: 10,
  }],
};

async function signed(requestId, amount = '100', asset = 'USDT') {
  const timestamp = String(Date.now());
  const message = `Solvex 提现确认：${amount} ${asset}（另收2%手续费），编号 ${requestId}，时间：${timestamp}`;
  return { requestId, amount, asset, network: 'bsc', timestamp, signature: await user.signMessage(message) };
}

let clockMs = Date.parse('2026-11-09T10:00:00+08:00');
const clock = () => clockMs;
const setTime = iso => { clockMs = Date.parse(iso); };

function makeLpService(db, config = {}) {
  return createATokenLpJobService({
    database: db,
    config: {
      contractAddress: LP_CONTRACT,
      usdtContract: USDT,
      usdtDecimals: 18,
      svxContract: SVX,
      svxDecimals: 18,
      chainId: 56,
      enabled: false,
      settleEnabled: true,
      settleHourUtc8: 0,
      ...config,
    },
    clock,
  });
}

let txSeq = 0;
function txHash() {
  txSeq += 1;
  return '0x' + String(txSeq).padStart(64, 'a');
}

try {
  const wallet = createWalletService(options);
  const db = wallet.database;
  const at = createATokenService({ database: db, walletService: wallet });
  const lpJobs = makeLpService(db);
  installSolvexWithdrawalFees({ walletService: wallet, aTokenService: at, database: db, lpJobService: lpJobs });
  wallet.creditBalance(user.address, 'USDT', U(10000));
  const balance = () => wallet.balanceUnits(user.address);
  const lpUsdt = () => BigInt(db.getATokenLpPoolBalance().usdtUnits);
  const pool = (date, asset = 'USDT') => db.getATokenLpDailyPool(date, asset);

  async function paidWithdrawal(requestId, amount) {
    const record = wallet.requestWithdrawal(user.address, await signed(requestId, amount));
    wallet.claimPayout(record.id);
    wallet.recordSignedPayout(record.id, { txHash: txHash(), rawTransaction: '0xab', nonce: txSeq });
    wallet.recordBroadcastPayout(record.id);
    wallet.recordPaidPayout(record.id, 10);
    return wallet.payoutRecord(record.id);
  }

  // ── 1) 多笔成功提现只累计、不产生单笔任务 ───────────────────────────────
  const w1 = await paidWithdrawal('lp_daily_0001', '100'); // 手续费 2
  const w2 = await paidWithdrawal('lp_daily_0002', '200'); // 手续费 4
  const w3 = await paidWithdrawal('lp_daily_0003', '50');  // 手续费 1
  assert.equal(w1.status, 'paid');
  assert.equal(db.getATokenLpJobByWithdrawalId(w1.id), null, '提现成功不应再产生单笔加池任务');
  assert.equal(db.listATokenLpJobs({ status: '', limit: 100 }).length, 0, '累计阶段不应有任何加池任务');
  assert.equal(pool('2026-11-09').units, U(7).toString(), '三笔手续费应按日汇总为 7 USDT');
  assert.equal(lpUsdt(), U(7));
  assert.equal(db.listATokenLpFeeAccruals({ limit: 100 }).length, 3, '每笔成功提现各一条累计事实');

  // 同日还没到结算窗口（未跨日），不能出任务
  assert.equal(lpJobs.settleDue().length, 0, '未结束的业务日不结算');
  assert.throws(() => lpJobs.settleDate('2026-11-09', 'USDT'), /只能结算已结束的业务日/);

  // ── 2) 次日 00:00（UTC+8）批量结算：多笔汇总成一次 ─────────────────────
  setTime('2026-11-10T00:00:30+08:00');
  const settled1 = lpJobs.settleDue();
  assert.equal(settled1.length, 1, '一天一个币种只出一条批量任务');
  const job1 = settled1[0];
  assert.equal(job1.poolDate, '2026-11-09');
  assert.equal(job1.asset, 'USDT');
  assert.equal(job1.usdtUnits, U(7).toString(), '任务金额应为当日累计合计');
  assert.equal(job1.idempotencyKey, 'lp_daily:2026-11-09:USDT');
  assert.equal(job1.withdrawalId, 'daily:2026-11-09:USDT');
  assert.equal(pool('2026-11-09').status, 'settled');
  assert.equal(pool('2026-11-09').units, '0', '已合并进任务的金额不再留在待加池余额');
  assert.equal(pool('2026-11-09').settledUnits, U(7).toString());

  // ── 3) 同日重复执行不重复加池 ──────────────────────────────────────────
  assert.equal(lpJobs.settleDue().length, 0);
  assert.equal(lpJobs.settleDate('2026-11-09', 'USDT').id, job1.id, '重复结算返回同一任务');
  assert.equal(db.listATokenLpJobs({ status: '', limit: 100 }).length, 1);
  const instruction = lpJobs.buildInstruction(job1);
  assert.equal(instruction.jobKey, keccak256(toUtf8Bytes('lp_daily:2026-11-09:USDT')));
  assert.equal(instruction.call.to, getAddress(LP_CONTRACT));
  assert.equal(instruction.call.method, 'addLiquidity');
  assert.equal(instruction.usdt.chainUnits, U(7).toString() + '000000000000');

  // ── 4) 跨日累计不串账 ────────────────────────────────────────────────
  setTime('2026-11-10T12:00:00+08:00');
  await paidWithdrawal('lp_daily_0004', '500'); // 手续费 10
  assert.equal(pool('2026-11-10').units, U(10).toString());
  assert.equal(lpJobs.settleDue().length, 0, '当日不结算当日累计');
  assert.equal(lpJobs.getJob(job1.id).usdtUnits, U(7).toString(), '前一日任务金额不被后一日影响');

  setTime('2026-11-11T00:00:30+08:00');
  const settled2 = lpJobs.settleDue();
  assert.equal(settled2.length, 1);
  const job2 = settled2[0];
  assert.equal(job2.poolDate, '2026-11-10');
  assert.equal(job2.usdtUnits, U(10).toString(), '第二天只结算当天累计的 10 USDT');
  assert.equal(lpJobs.getJob(job1.id).usdtUnits, U(7).toString());
  assert.equal(db.listATokenLpJobs({ status: '', limit: 100 }).length, 2);

  // ── 5) 失败重试不丢金额 ──────────────────────────────────────────────
  lpJobs.writeback({ jobId: job2.id, status: 'failed', error: 'rpc down' });
  assert.equal(lpJobs.getJob(job2.id).status, 'failed');
  assert.equal(lpJobs.getJob(job2.id).usdtUnits, U(10).toString(), '失败任务保留金额');
  assert.equal(pool('2026-11-10').settledUnits, U(10).toString(), '失败不把金额清出账');
  assert.equal(lpJobs.settleDue().length, 0, '失败任务不会被重复新建');
  assert.equal(db.listATokenLpJobs({ status: '', limit: 100 }).length, 2);

  // ── 6) 冲销扣减（未上链任务）且不重复扣 ───────────────────────────────
  const reversed1 = lpJobs.reverseWithdrawalFee(w1);
  assert.equal(reversed1.status, 'reversed');
  assert.equal(lpJobs.getJob(job1.id).usdtUnits, U(5).toString(), '冲销后任务金额同步下调');
  assert.equal(lpJobs.getJob(job1.id).payload.adjustedUnits, U(2).toString());
  assert.equal(pool('2026-11-09').settledUnits, U(5).toString());
  assert.equal(lpUsdt(), U(5 + 10));
  lpJobs.reverseWithdrawalFee(w1);
  assert.equal(lpJobs.getJob(job1.id).usdtUnits, U(5).toString(), '重复冲销不重复扣减');

  // ── 7) 取消任务 → 金额退回池 → 下次结算复用同一 jobKey ──────────────────
  lpJobs.cancelJob(job2.id, 'test_cancel');
  assert.equal(lpJobs.getJob(job2.id).status, 'cancelled');
  assert.equal(pool('2026-11-10').status, 'open');
  assert.equal(pool('2026-11-10').units, U(10).toString(), '取消后金额退回待加池余额');
  assert.equal(pool('2026-11-10').settledUnits, '0');
  const reopenedJobs = lpJobs.settleDue();
  assert.equal(reopenedJobs.length, 1);
  assert.equal(reopenedJobs[0].id, job2.id, '复用同一任务行，避免唯一索引挡住重试');
  assert.equal(reopenedJobs[0].status, 'pending');
  assert.equal(reopenedJobs[0].usdtUnits, U(10).toString());
  assert.equal(db.listATokenLpJobs({ status: '', limit: 100 }).length, 2, '同一日期+币种仍只有一条任务');

  // ── 8) 未结算池的冲销不会出现负累计 ────────────────────────────────────
  setTime('2026-11-11T10:00:00+08:00');
  const w5 = await paidWithdrawal('lp_daily_0005', '10'); // 手续费 0.2
  assert.equal(pool('2026-11-11').units, U('0.2').toString());
  lpJobs.reverseWithdrawalFee(w5);
  assert.equal(pool('2026-11-11').units, '0', '扣减不会变成负数');
  assert.equal(lpUsdt(), U('15'));

  // ── 9) SVX 与 USDT 分开累计、分开出任务 ────────────────────────────────
  const aAccrual = lpJobs.accrueWithdrawalFee({
    id: 'svx_manual_0001', status: 'paid', asset: 'A', feeUnits: U(3).toString(), wallet: user.address,
  });
  assert.equal(aAccrual.asset, 'A');
  assert.equal(pool('2026-11-11', 'A').units, U(3).toString());
  assert.equal(pool('2026-11-11', 'USDT').units, '0', '币种之间不串账');

  setTime('2026-11-12T00:00:30+08:00');
  const settled3 = lpJobs.settleDue();
  const jobA = settled3.find(item => item.asset === 'A');
  assert.ok(jobA, '应生成 SVX 日任务');
  assert.equal(jobA.idempotencyKey, 'lp_daily:2026-11-11:A');
  assert.equal(jobA.usdtUnits, U(3).toString());
  const instructionA = lpJobs.buildInstruction(jobA);
  assert.equal(instructionA.executable, false, 'SVX 任务需人工执行');
  assert.equal(instructionA.call.method, 'depositSvx');
  assert.equal(instructionA.svx.chainUnits, U(3).toString() + '000000000000');

  // ── 10) 累计失败不影响提现成功；重复触发可幂等补记（无需补录按钮）───────
  setTime('2026-11-12T10:00:00+08:00');
  const before = balance();
  const record = wallet.requestWithdrawal(user.address, await signed('lp_daily_0006', '100'));
  wallet.claimPayout(record.id);
  wallet.recordSignedPayout(record.id, { txHash: txHash(), rawTransaction: '0xab', nonce: txSeq });
  wallet.recordBroadcastPayout(record.id);
  db.db.exec("CREATE TEMP TRIGGER fail_lp_accrual BEFORE INSERT ON a_token_lp_fee_accruals BEGIN SELECT RAISE(ABORT,'accrual write failure'); END");
  wallet.recordPaidPayout(record.id, 10);
  assert.equal(wallet.payoutRecord(record.id).status, 'paid', '累计失败不能回滚提现成功状态');
  assert.equal(balance(), before - U(102), '累计失败不能改动提现后的余额');
  assert.equal(db.getATokenLpFeeAccrualByWithdrawalId(record.id), null);
  db.db.exec('DROP TRIGGER fail_lp_accrual');
  const replay = lpJobs.accrueWithdrawalFee(wallet.payoutRecord(record.id));
  assert.ok(replay, '放款成功后可幂等补记');
  assert.equal(pool('2026-11-12').units, U(2).toString());
  assert.equal(lpJobs.accrueWithdrawalFee(wallet.payoutRecord(record.id)).status, 'accrued', '重复补记不重复累计');

  // ── 11) 统计口径与重启持久化 ──────────────────────────────────────────
  const stats = lpJobs.stats();
  assert.equal(stats.pendingAccruedByAsset.USDT, U(2).toString());
  assert.equal(stats.pendingAccruedByAsset.A, '0');

  closeDatabase(root);
  const reopened = createWalletService(options);
  const db2 = reopened.database;
  const lpJobs2 = makeLpService(db2);
  assert.equal(lpJobs2.getPool('2026-11-09').settledUnits, U(5).toString());
  assert.equal(lpJobs2.listJobs({ limit: 100 }).length, 3, '重启后任务不重复（USDT 两条 + SVX 一条）');

  console.log('PASS Solvex auto LP daily: aggregate/multi-into-one/idempotent-settle/cross-day/retry/reversal/svx-split/replay/restart');
} finally {
  closeDatabase(root);
  fs.rmSync(root, { recursive: true, force: true });
}
