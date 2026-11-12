/**
 * 提现手续费自动加 LP：运维脚本（日累计池 → 批量任务 → 指令 → 执行/回写）。
 *
 * 与 server 内执行器的关系：
 *   - 提现成功只累计手续费到当日池；每日 00:00（UTC+8）自动生成一条「日期+币种」批量任务；
 *   - 服务端默认只入队 + 提供后台回写接口，不自动广播；
 *   - 本脚本是推荐的执行入口，独立进程顺序执行，避免与提现出款共用出款钱包时抢 nonce。
 *
 * 调用顺序：
 *   1) 先 `--settle` 手动结算已关闭业务日（可选，定时任务到点会自动做）；
 *   2) 默认模式查看待执行任务与指令（不广播）；
 *   3) 在测试网或小额环境先 `--execute --job=<id>` 单笔验证；
 *   4) 确认无误后 `--execute --all` 批量执行，脚本会 approval + addLiquidity 并回写 confirmed；
 *      注：SVX 任务合约未提供 jobKey 幂等，脚本会跳过并提示人工 depositSvx；
 *   5) 如需用外部钱包/多签广播，使用 `--json` 输出指令，执行后用 `--writeback` 回写 txHash。
 *
 * 用法（当前目录 = resources/app）：
 *   node scripts/lp-auto-ops.js                         # 列出待执行任务 + 指令
 *   node scripts/lp-auto-ops.js --status=failed         # 只看失败任务
 *   node scripts/lp-auto-ops.js --json                  # 输出 JSON（供外部程序消费）
 *   node scripts/lp-auto-ops.js --settle                # 立即结算所有已关闭业务日
 *   node scripts/lp-auto-ops.js --settle --date=2026-11-09 --asset=USDT
 *   node scripts/lp-auto-ops.js --execute --job=lpjob_xxx
 *   node scripts/lp-auto-ops.js --execute --all --limit=10
 *   node scripts/lp-auto-ops.js --writeback --job=lpjob_xxx --status=confirmed --tx=0x… \
 *     --usdt-used=… --svx-used=… --lp-minted=… --price=…
 *
 * 环境变量：读取 resources/app/.env（AUTO_LP_* / PLATFORM_WITHDRAWAL_PRIVATE_KEY / BSC_RPC_URL）。
 * 私钥只从环境读取，脚本不写入、不打印。
 */
import { getConfig, DATA_ROOT } from '../src/config.js';
import { createWalletService } from '../src/wallet-service.js';
import { createATokenLpJobService } from '../src/a-token-lp-job-service.js';

function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) { out.flags.add(key); continue; }
    out[key] = next;
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const cfg = getConfig();
const walletService = createWalletService({
  ...cfg.wallet,
  dataRoot: DATA_ROOT,
  withdrawalPrivateKey: cfg.wallet.withdrawalPrivateKey,
});

// 脚本自身就是执行器，故显式 enabled=true；server 内的自动执行仍由环境变量控制。
const service = createATokenLpJobService({
  database: walletService.database,
  config: { ...cfg.wallet.autoLp, enabled: true },
  privateKey: cfg.wallet.withdrawalPrivateKey,
  isWithdrawalPaid: id => walletService.payoutRecord(id)?.status === 'paid',
});

function printable(job) {
  const instruction = service.buildInstruction(job);
  return {
    jobId: job.id,
    poolDate: job.poolDate || '',
    asset: job.asset,
    withdrawalId: job.withdrawalId,
    wallet: job.wallet,
    status: job.status,
    attempts: job.attempts,
    ledgerUnits: job.usdtUnits,
    txHash: job.txHash,
    lastError: job.lastError,
    instruction,
  };
}

async function main() {
  const jobId = String(args.job || '');
  const status = String(args.status || '');
  const limit = Math.max(1, Math.min(500, Number(args.limit || 50)));

  if (args.flags.has('settle')) {
    const jobs = service.settleAll({
      date: String(args.date || '').trim(),
      asset: String(args.asset || '').trim(),
    });
    console.log(JSON.stringify({
      ok: true,
      settled: jobs.map(job => ({ jobId: job.id, poolDate: job.poolDate, asset: job.asset, ledgerUnits: job.usdtUnits })),
    }, null, 2));
    return;
  }

  if (args.flags.has('writeback')) {
    if (!jobId && !args.tx) throw new Error('--writeback 需要 --job=<id> 或 --tx=<hash>');
    const job = service.writeback({
      jobId: jobId || undefined,
      txHash: args.tx ? String(args.tx) : undefined,
      status: status || 'confirmed',
      usdtUsed: args['usdt-used'],
      svxUsed: args['svx-used'],
      lpMinted: args['lp-minted'],
      priceUsdtPerSvx1e18: args.price,
      error: args.error,
      note: args.note,
    });
    console.log(JSON.stringify({ ok: true, job }, null, 2));
    return;
  }

  if (args.flags.has('execute')) {
    if (jobId) {
      const result = await service.executeJob(jobId);
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      return;
    }
    if (!args.flags.has('all')) throw new Error('--execute 需要 --job=<id> 或 --all');
    const jobs = service.listJobs({ status, limit })
      .filter(item => item.status === 'pending' || item.status === 'failed');
    const results = [];
    for (const job of jobs) {
      // 旧版单笔任务：只有对应提现成功才允许执行；日批量任务不再绑定单笔提现。
      const legacySingle = job.withdrawalId && !job.withdrawalId.startsWith('daily:');
      if (legacySingle && walletService.payoutRecord(job.withdrawalId)?.status !== 'paid') {
        results.push({ jobId: job.id, skipped: 'withdrawal_not_paid' });
        continue;
      }
      if (String(job.asset || 'USDT').toUpperCase() !== 'USDT') {
        results.push({
          jobId: job.id, poolDate: job.poolDate, asset: job.asset, skipped: 'manual_execution_required',
          note: 'SVX 任务需人工执行 depositSvx（合约未提供 jobKey 幂等）',
        });
        continue;
      }
      try {
        results.push(await service.executeJob(job.id));
      } catch (error) {
        results.push({ jobId: job.id, error: error?.shortMessage || error?.message || String(error) });
      }
    }
    console.log(JSON.stringify({ ok: true, total: jobs.length, results }, null, 2));
    return;
  }

  const jobs = service.listJobs({ status, limit }).map(printable);
  const output = { config: service.readiness(), stats: service.stats(), jobs };
  if (args.flags.has('json')) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  const missing = [];
  if (!output.config.contractConfigured) missing.push('AUTO_LP_CONTRACT_ADDRESS');
  if (!output.config.usdtConfigured) missing.push('AUTO_LP_USDT_CONTRACT');
  console.log('配置就绪: ' + (missing.length ? '否，缺失 ' + missing.join(', ') : '是'));
  console.log('执行器: ' + (output.config.executorEnabled ? '开' : '关')
    + '，日结算: ' + (output.config.settleEnabled ? '开（UTC+8 ' + output.config.settleHourUtc8 + ':00）' : '关'));
  console.log('任务统计: ' + JSON.stringify(output.stats.byStatus)
    + '，待加池累计(账本 6dp) USDT=' + output.stats.pendingAccruedByAsset.USDT
    + ' SVX=' + output.stats.pendingAccruedByAsset.A);
  for (const item of jobs) {
    const { instruction } = item;
    console.log('────────────────────────────────────────────');
    console.log(`${item.jobId}  [${item.status}]  业务日 ${item.poolDate || '-'}  币种 ${item.asset}`);
    console.log(`${item.asset}: ${item.ledgerUnits} (账本 6dp) → ${instruction?.token.chainUnits ?? '-'} (链上 ${instruction?.token.tokenDecimals ?? '?'}dp)`);
    if (instruction?.ready) {
      console.log(`合约: ${instruction.call.to}  方法: ${instruction.call.method}`);
      console.log(`calldata: ${instruction.call.data}`);
      if (!instruction.executable) console.log('提示: 该币种需人工执行，脚本不自动广播');
    } else {
      console.log('未就绪，缺失: ' + (instruction?.missing || []).join(', '));
    }
    if (item.lastError) console.log('lastError: ' + item.lastError);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ ' + (error?.shortMessage || error?.message || String(error)));
    process.exit(1);
  });
