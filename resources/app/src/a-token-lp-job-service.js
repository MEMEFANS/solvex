// 提现手续费 2% 自动加 LP：
//   - 提现「成功放款（status=paid）」后，按业务日（UTC+8）与币种累计手续费；
//   - 每日固定时间（默认 08:00 UTC+8）把前一日累计合并成一条批量任务，减少链上 gas；
//   - jobKey = keccak256('lp_daily:<date>:<asset>')，同一日期+币种只允许一条任务/一笔加池；
//   - 累计只由 paid 写入，冲销对应扣减；跨日不清账、失败重试不丢金额。
import { Interface, JsonRpcProvider, Wallet, Contract, keccak256, toUtf8Bytes } from 'ethers';
import { SOLVEX_RULES } from '../shared/solvex-rules.js';

const LEDGER_DECIMALS = 6;
const BUSINESS_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const autoLpInterface = new Interface([
  'function addLiquidity(uint256 usdtAmount, bytes32 jobKey)',
  'function depositSvx(uint256 amount)',
  'function usedJobs(bytes32 jobKey) view returns (bool)',
  'event LiquidityAdded(bytes32 indexed jobKey, uint256 usdtAmount, uint256 svxAmount, uint256 lpMinted)',
]);
const tokenInterface = new Interface([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('日期格式应为 YYYY-MM-DD');
  return text;
}

export function createATokenLpJobService({ database, config = {}, privateKey = '', isWithdrawalPaid = () => false, clock = () => Date.now() }) {
  const autoLp = { ...config };
  const executorEnabled = autoLp.enabled === true;
  const contractAddress = String(autoLp.contractAddress || '').trim();
  const usdtContract = String(autoLp.usdtContract || '').trim();
  const svxContract = String(autoLp.svxContract || '').trim();
  const usdtDecimals = Number(autoLp.usdtDecimals || 18);
  const svxDecimals = Number(autoLp.svxDecimals || 18);
  const chainId = Number(autoLp.chainId || 56);
  const confirmations = Number(autoLp.confirmations || 3);
  const maxAttempts = Number(autoLp.maxAttempts || 5);
  const gasLimit = BigInt(autoLp.gasLimit || 600000);
  const settleHourUtc8 = Math.min(Math.max(Number(autoLp.settleHourUtc8 ?? SOLVEX_RULES.settlement.hour) || 0, 0), 23);
  const settleEnabled = autoLp.settleEnabled !== false;
  runMigration();

  const now = () => Number(clock());
  const businessDate = ts => new Date(Number(ts) + BUSINESS_OFFSET_MS - settleHourUtc8 * 3600000).toISOString().slice(0, 10);
  const assetOf = value => String(value || '').toUpperCase() === 'A' ? 'A' : 'USDT';
  const unitsOf = value => BigInt(String(value || '0'));
  const max0 = value => value > 0n ? value : 0n;

  function poolId(date, asset) {
    return 'lpjob_' + date.replace(/-/g, '') + '_' + asset.toLowerCase();
  }

  function nextOpenDate(startDate, asset) {
    let date = startDate;
    for (let i = 0; i < 30; i++) {
      const pool = database.getATokenLpDailyPool(date, asset);
      if (!pool || pool.status !== 'settled') return date;
      date = businessDate(new Date(date + 'T00:00:00.000Z').getTime() + DAY_MS);
    }
    return date;
  }

  // 老数据迁移：旧版「提现创建即写 LP 流水」的成功提现，按日补记累计；
  // 尚未上链的旧单笔任务取消并转为按日累计，已上链的保持原状避免重复加池。
  function runMigration() {
    try {
      const entries = database.listAllATokenLpPoolEntries?.() || [];
      for (const entry of entries) {
        if (entry.source !== 'withdraw_fee' || entry.direction !== 'in') continue;
        const ref = String(entry.refId || '');
        const isUsdt = ref.startsWith('usdt:');
        if (!isUsdt) continue;
        const withdrawalId = ref.slice(5);
        if (!withdrawalId || !isWithdrawalPaid(withdrawalId)) continue;
        if (database.getATokenLpFeeAccrualByWithdrawalId(withdrawalId)) continue;
        const legacy = database.getATokenLpJobByWithdrawalId(withdrawalId);
        if (legacy && ['processing', 'sent', 'confirmed'].includes(legacy.status)) continue;
        const units = BigInt(entry.usdtUnits || '0');
        if (units <= 0n) continue;
        const date = businessDate(entry.createdAt || now());
        database.transaction(() => {
          database.insertATokenLpFeeAccrual({
            id: 'lpfee_' + withdrawalId, withdrawalId, wallet: entry.wallet, asset: 'USDT',
            units: units.toString(), poolDate: date, createdAt: Number(entry.createdAt) || now(),
          });
          const pool = database.ensureATokenLpDailyPool(date, 'USDT', now());
          database.updateATokenLpDailyPool({
            poolDate: date, asset: 'USDT', units: (unitsOf(pool.units) + units).toString(),
            settledUnits: pool.settledUnits, status: pool.status, jobId: pool.jobId,
            settledAt: pool.settledAt, updatedAt: now(),
          });
          if (legacy && (legacy.status === 'pending' || legacy.status === 'failed')) {
            database.cancelATokenLpJob(legacy.id, 'migrated_to_daily_pool', now(), {
              ...(legacy.payload || {}), migratedTo: date,
            });
          }
        });
      }
    } catch (error) {
      console.warn('加 LP 日累计历史迁移失败（不影响服务启动）:', error?.message || error);
    }
  }

  // 提现成功放款后调用：写手续费流水 + 当日累计，幂等。
  function accrueWithdrawalFee(record) {
    if (!record || !record.id) return null;
    if (String(record.status || '') !== 'paid') return null;
    const asset = assetOf(record.asset);
    const units = unitsOf(record.feeUnits);
    if (units <= 0n) return null;
    const existing = database.getATokenLpFeeAccrualByWithdrawalId(record.id);
    if (existing) return existing;
    const at = now();
    return database.transaction(() => {
      if (asset === 'USDT') {
        database.insertATokenLpPoolEntryRow({
          id: 'alp_usdt_' + record.id, source: 'withdraw_fee', refId: 'usdt:' + record.id,
          wallet: record.wallet, asset: 'USDT', usdtUnits: units.toString(), direction: 'in',
          createdAt: at, payload: { withdrawalId: record.id, rateBps: 200, daily: true },
        });
      } else {
        database.insertATokenLpPoolEntryRow({
          id: 'alp_' + record.id, source: 'withdraw_fee', refId: 'wd:' + record.id,
          wallet: record.wallet, asset: 'A', aUnits: units.toString(), direction: 'in',
          createdAt: at, payload: { withdrawalId: record.id, rateBps: 200, daily: true },
        });
      }
      // 先确定实际入账日期：极端情况下若当日已结算（例如人工提前结算），顺延到最近未结算日，
      // 避免同日二次出任务；accrual 记录实际入账日期，保证冲销时扣的是同一个池。
      let poolDate = businessDate(at);
      let pool = database.ensureATokenLpDailyPool(poolDate, asset, at);
      if (pool.status === 'settled') {
        poolDate = nextOpenDate(poolDate, asset);
        pool = database.ensureATokenLpDailyPool(poolDate, asset, at);
      }
      // 同一提现单只能累计一次；并发重复触发时以唯一索引为准。
      database.insertATokenLpFeeAccrual({
        id: 'lpfee_' + record.id, withdrawalId: record.id, wallet: record.wallet, asset,
        units: units.toString(), poolDate, createdAt: at,
      });
      database.updateATokenLpDailyPool({
        poolDate, asset, units: (unitsOf(pool.units) + units).toString(),
        settledUnits: pool.settledUnits, status: 'open', jobId: pool.jobId,
        settledAt: pool.settledAt, updatedAt: at,
      });
      return database.getATokenLpFeeAccrualByWithdrawalId(record.id);
    });
  }

  // 提现被驳回/退款/冲销：只处理已累计记录，扣减当日池；不会出现负累计。
  function reverseWithdrawalFee(record, reason = 'withdrawal_reversed') {
    const withdrawalId = String(record?.id || '');
    if (!withdrawalId) return null;
    const accrual = database.getATokenLpFeeAccrualByWithdrawalId(withdrawalId);
    if (!accrual || accrual.status === 'reversed') return accrual;
    const at = now();
    const units = unitsOf(accrual.units);
    return database.transaction(() => {
      if (!database.markATokenLpFeeAccrualReversed(withdrawalId, at)) return database.getATokenLpFeeAccrualByWithdrawalId(withdrawalId);
      if (accrual.asset === 'USDT') {
        if (!database.getATokenLpPoolEntryByRef('withdraw_fee', 'usdt:' + withdrawalId + ':refund')) {
          database.insertATokenLpPoolEntryRow({
            id: 'alp_usdt_refund_' + withdrawalId, source: 'withdraw_fee', refId: 'usdt:' + withdrawalId + ':refund',
            wallet: accrual.wallet, asset: 'USDT', usdtUnits: units.toString(), direction: 'out',
            createdAt: at, payload: { withdrawalId, reason },
          });
        }
      } else if (!database.getATokenLpPoolEntryByRef('withdraw_fee', 'wd:' + withdrawalId + ':refund')) {
        database.insertATokenLpPoolEntryRow({
          id: 'alp_' + withdrawalId + '_refund', source: 'withdraw_fee', refId: 'wd:' + withdrawalId + ':refund',
          wallet: accrual.wallet, asset: 'A', aUnits: units.toString(), direction: 'out',
          createdAt: at, payload: { withdrawalId, reason },
        });
      }
      const pool = database.getATokenLpDailyPool(accrual.poolDate, accrual.asset);
      if (!pool) return database.getATokenLpFeeAccrualByWithdrawalId(withdrawalId);
      if (pool.status !== 'settled') {
        database.updateATokenLpDailyPool({
          ...pool, units: max0(unitsOf(pool.units) - units).toString(), updatedAt: at,
        });
        return database.getATokenLpFeeAccrualByWithdrawalId(withdrawalId);
      }
      // 已结算：优先从未上链任务里扣减；已上链则记录待人工核对的差额，不擅自改链上金额。
      const job = pool.jobId ? database.getATokenLpJobById(pool.jobId) : null;
      if (job && job.status === 'cancelled') {
        // 任务已取消，金额已退回池，直接扣减池余额。
        database.updateATokenLpDailyPool({
          ...pool, units: max0(unitsOf(pool.units) - units).toString(), updatedAt: at,
        });
      } else if (job && (job.status === 'pending' || job.status === 'failed')) {
        const nextUnits = max0(unitsOf(job.usdtUnits) - units);
        database.updateATokenLpJobUnits(job.id, nextUnits.toString(), at, {
          ...(job.payload || {}),
          adjustedUnits: (unitsOf(job.payload?.adjustedUnits || '0') + units).toString(),
        });
        database.updateATokenLpDailyPool({
          ...pool, settledUnits: max0(unitsOf(pool.settledUnits) - units).toString(), updatedAt: at,
        });
      } else if (job) {
        database.updateATokenLpJobRow({
          ...job, updatedAt: at,
          payload: { ...(job.payload || {}), reversalOwedUnits: (unitsOf(job.payload?.reversalOwedUnits || '0') + units).toString() },
        });
        console.warn('已上链加池任务收到手续费冲销，差额已记录待人工核对:', withdrawalId);
      }
      return database.getATokenLpFeeAccrualByWithdrawalId(withdrawalId);
    });
  }

  // 结算某一天+币种：只结算已关闭的业务日（早于今天），同一天只出一条任务。
  function settleDate(date, asset = 'USDT') {
    const poolDate = normalizeDate(date);
    const normalizedAsset = assetOf(asset);
    const today = businessDate(now());
    if (poolDate >= today) {
      const error = new Error('只能结算已结束的业务日（UTC+8）');
      error.code = 'LP_SETTLE_DATE_NOT_CLOSED';
      throw error;
    }
    return database.transaction(() => {
      const existing = database.getATokenLpJobByPoolDate(poolDate, normalizedAsset);
      if (existing && existing.status !== 'cancelled') return existing;
      const pool = database.getATokenLpDailyPool(poolDate, normalizedAsset);
      if (!pool) return existing || null;
      const units = unitsOf(pool.units);
      if (units <= 0n) return existing || null;
      const at = now();
      // 取消过的任务：金额已退回池，这里复用同一行（同一 idempotencyKey/jobKey）重新入队，
      // 既满足 (pool_date,asset) 唯一索引，也保证重复执行不会二次加池。
      if (existing && existing.status === 'cancelled') {
        database.reopenATokenLpJob(existing.id, units.toString(), at, {
          ...(existing.payload || {}), reopenedAt: at,
          reopenCount: Number(existing.payload?.reopenCount || 0) + 1,
        });
        database.updateATokenLpDailyPool({
          poolDate, asset: normalizedAsset, units: '0', settledUnits: units.toString(),
          status: 'settled', jobId: existing.id, settledAt: at, updatedAt: at,
        });
        return database.getATokenLpJobById(existing.id);
      }
      const idempotencyKey = 'lp_daily:' + poolDate + ':' + normalizedAsset;
      const job = {
        id: poolId(poolDate, normalizedAsset),
        withdrawalId: 'daily:' + poolDate + ':' + normalizedAsset,
        poolDate, wallet: '', asset: normalizedAsset, usdtUnits: units.toString(),
        idempotencyKey, status: 'pending', chainId, attempts: 0,
        createdAt: at, updatedAt: at,
        payload: { source: 'withdraw_fee_daily', poolDate, asset: normalizedAsset },
      };
      if (!database.insertATokenLpJobRow(job)) {
        return database.getATokenLpJobByPoolDate(poolDate, normalizedAsset);
      }
      database.updateATokenLpDailyPool({
        poolDate, asset: normalizedAsset, units: '0', settledUnits: units.toString(),
        status: 'settled', jobId: job.id, settledAt: at, updatedAt: at,
      });
      return database.getATokenLpJobById(job.id);
    });
  }

  // 扫描所有已关闭且有余额的池子；重复调用安全（唯一索引 + 已存在任务直接返回）。
  function settleDue() {
    const today = businessDate(now());
    const settled = [];
    for (const pool of database.listATokenLpDailyPools({ status: 'open', limit: 1000 })) {
      if (pool.poolDate >= today) continue;
      if (unitsOf(pool.units) <= 0n) continue;
      const job = settleDate(pool.poolDate, pool.asset);
      if (job) settled.push(job);
    }
    return settled;
  }

  function maybeSettle() {
    if (!settleEnabled) return [];
    const bjHour = new Date(now() + BUSINESS_OFFSET_MS).getUTCHours();
    if (bjHour < settleHourUtc8) return [];
    return settleDue();
  }

  // 手动结算：date 为空时结算所有已关闭日期；供后台运维提前触发。
  function settleAll({ date = '', asset = '' } = {}) {
    if (date) return [settleDate(String(date), asset || 'USDT')].filter(Boolean);
    return settleDue();
  }

  function getJob(id) {
    return database.getATokenLpJobById(String(id || ''));
  }
  function listJobs({ status = '', limit = 200 } = {}) {
    return database.listATokenLpJobs({ status, limit });
  }
  function listPools({ status = '', limit = 500 } = {}) {
    return database.listATokenLpDailyPools({ status, limit });
  }
  function listAccruals({ status = '', limit = 500 } = {}) {
    return database.listATokenLpFeeAccruals({ status, limit });
  }
  function getPool(date, asset) {
    return database.getATokenLpDailyPool(String(date || ''), assetOf(asset));
  }

  function buildInstruction(job) {
    if (!job) throw new Error('加池任务不存在');
    const asset = assetOf(job.asset);
    const units = unitsOf(job.usdtUnits);
    const tokenAddress = asset === 'USDT' ? usdtContract : svxContract;
    const tokenDecimals = asset === 'USDT' ? usdtDecimals : svxDecimals;
    const missing = [];
    if (!contractAddress) missing.push('AUTO_LP_CONTRACT_ADDRESS');
    if (!tokenAddress) missing.push(asset === 'USDT' ? 'AUTO_LP_USDT_CONTRACT' : 'AUTO_LP_SVX_CONTRACT');
    const scale = 10n ** BigInt(Math.max(tokenDecimals - LEDGER_DECIMALS, 0));
    const chainUnits = units * scale;
    const jobKey = keccak256(toUtf8Bytes(job.idempotencyKey));
    const ready = missing.length === 0;
    const token = { address: tokenAddress, ledgerDecimals: LEDGER_DECIMALS, tokenDecimals, ledgerUnits: units.toString(), chainUnits: chainUnits.toString() };
    const call = ready ? (asset === 'USDT'
      ? {
        to: contractAddress, method: 'addLiquidity',
        args: [chainUnits.toString(), jobKey],
        data: autoLpInterface.encodeFunctionData('addLiquidity', [chainUnits, jobKey]),
      }
      : {
        to: contractAddress, method: 'depositSvx',
        args: [chainUnits.toString()],
        data: autoLpInterface.encodeFunctionData('depositSvx', [chainUnits]),
      }) : null;
    return {
      jobId: job.id, withdrawalId: job.withdrawalId, poolDate: job.poolDate || '',
      asset, idempotencyKey: job.idempotencyKey, jobKey,
      ready, missing, executable: asset === 'USDT',
      token, usdt: asset === 'USDT' ? token : undefined, svx: asset === 'A' ? token : undefined,
      approve: ready ? { token: tokenAddress, spender: contractAddress, amount: chainUnits.toString() } : null,
      call,
    };
  }

  function writeback({ jobId = '', withdrawalId = '', status = '', txHash = '', usdtUsed = '', svxUsed = '', lpMinted = '', priceUsdtPerSvx1e18 = '', error = '', note = '' } = {}) {
    let job = jobId ? getJob(jobId)
      : (withdrawalId ? database.getATokenLpJobByWithdrawalId(String(withdrawalId)) : null);
    if (!job) throw new Error('加池任务不存在');
    const allowed = ['pending', 'processing', 'sent', 'confirmed', 'failed'];
    const normalized = String(status || '').trim();
    if (!allowed.includes(normalized)) throw new Error('回写状态不合法');
    if (job.status === 'confirmed' && normalized !== 'confirmed') throw new Error('任务已确认，不能回退状态');
    const at = now();
    const payload = { ...(job.payload || {}) };
    if (note) payload.note = String(note).slice(0, 500);
    if (usdtUsed) payload.usdtUsed = String(usdtUsed);
    if (svxUsed) payload.svxUsed = String(svxUsed);
    if (lpMinted) payload.lpMinted = String(lpMinted);
    if (priceUsdtPerSvx1e18) payload.priceUsdtPerSvx1e18 = String(priceUsdtPerSvx1e18);
    if (error) payload.error = String(error).slice(0, 500);
    if (job.txHash && txHash && job.txHash.toLowerCase() !== String(txHash).toLowerCase()) {
      throw new Error('txHash 与已记录值不一致');
    }
    database.updateATokenLpJobRow({
      ...job, status: normalized, txHash: txHash || job.txHash,
      attempts: normalized === 'sent' ? Math.max(job.attempts, 1) : job.attempts,
      lastError: normalized === 'failed' ? String(error || job.lastError || 'failed').slice(0, 500) : '',
      sentAt: normalized === 'sent' ? (job.sentAt || at) : job.sentAt,
      confirmedAt: normalized === 'confirmed' ? (job.confirmedAt || at) : job.confirmedAt,
      updatedAt: at, payload,
    });
    return getJob(job.id);
  }

  async function executeJob(jobId) {
    if (!executorEnabled) throw new Error('执行器未开启，不能广播交易');
    const job = getJob(jobId);
    if (!job) throw new Error('加池任务不存在');
    if (assetOf(job.asset) !== 'USDT') throw new Error('SVX 加池任务需人工执行 depositSvx（合约未提供 jobKey 幂等）');
    if (job.status === 'confirmed') return { job, skipped: 'already_confirmed' };
    if (job.status === 'cancelled') throw new Error('任务已取消');
    if (!privateKey) throw new Error('缺少出款私钥，不能广播交易');
    const instruction = buildInstruction(job);
    if (!instruction.ready) throw new Error('加池配置缺失：' + instruction.missing.join(', '));
    if (!database.claimATokenLpJob(job.id, now(), maxAttempts)) {
      return { job: getJob(job.id), skipped: 'already_processing' };
    }
    let provider;
    try {
      provider = new JsonRpcProvider(autoLp.rpcUrl, chainId);
      const signer = new Wallet(privateKey, provider);
      const contract = new Contract(contractAddress, autoLpInterface, signer);
      if (await contract.usedJobs(instruction.jobKey)) {
        return { job: writeback({ jobId: job.id, status: 'confirmed', note: 'jobKey 已上链，跳过重复加池' }) };
      }
      const token = new Contract(instruction.token.address, tokenInterface, signer);
      const balance = await token.balanceOf(signer.address);
      if (balance < BigInt(instruction.token.chainUnits)) throw new Error('出款钱包 USDT 余额不足');
      const allowance = await token.allowance(signer.address, contractAddress);
      if (allowance < BigInt(instruction.token.chainUnits)) {
        const approveTx = await token.approve(contractAddress, instruction.token.chainUnits);
        const approveReceipt = await approveTx.wait(1);
        if (!approveReceipt || approveReceipt.status !== 1) throw new Error('USDT approve 失败');
      }
      const tx = await contract.addLiquidity(instruction.token.chainUnits, instruction.jobKey, { gasLimit });
      writeback({ jobId: job.id, status: 'sent', txHash: tx.hash });
      const receipt = await tx.wait(confirmations);
      if (!receipt || receipt.status !== 1) throw new Error('加池交易执行失败');
      return { job: writeback({ jobId: job.id, status: 'confirmed', txHash: tx.hash }), txHash: tx.hash };
    } catch (error) {
      writeback({ jobId: job.id, status: 'failed', error: error?.message || String(error) });
      throw error;
    } finally {
      provider?.destroy?.();
    }
  }

  async function runOnce() {
    const results = [];
    const staleBefore = now() - Math.max(Number(autoLp.staleMs || 10 * 60_000), 60_000);
    for (const job of database.listDueATokenLpJobs({ maxAttempts, staleBefore, limit: 20 })) {
      if (assetOf(job.asset) !== 'USDT') continue;
      // 兼容旧版单笔任务：只有对应提现成功才允许执行。
      if (job.withdrawalId && !job.withdrawalId.startsWith('daily:') && !isWithdrawalPaid(job.withdrawalId)) continue;
      try { results.push(await executeJob(job.id)); }
      catch (error) { results.push({ jobId: job.id, error: error?.message || String(error) }); }
    }
    return results;
  }

  // 取消任务并把金额退回当日池，保证“失败/取消不丢金额”。
  function cancelJob(jobId, reason = 'admin_cancelled', payload = {}) {
    const job = getJob(jobId);
    if (!job) return null;
    if (job.status === 'confirmed' || job.status === 'sent') {
      const error = new Error('任务已上链，不能取消，请人工核对');
      error.code = 'LP_JOB_ALREADY_ONCHAIN';
      throw error;
    }
    return database.transaction(() => {
      const at = now();
      const cancelled = database.cancelATokenLpJob(job.id, String(reason || 'admin_cancelled').slice(0, 120), at, {
        ...(job.payload || {}), ...payload,
      });
      if (!cancelled) return getJob(job.id);
      if (job.poolDate) {
        const pool = database.getATokenLpDailyPool(job.poolDate, assetOf(job.asset));
        if (pool) {
          database.updateATokenLpDailyPool({
            ...pool,
            units: (unitsOf(pool.units) + unitsOf(job.usdtUnits)).toString(),
            settledUnits: max0(unitsOf(pool.settledUnits) - unitsOf(job.usdtUnits)).toString(),
            status: 'open', jobId: null, updatedAt: at,
          });
        }
      }
      return getJob(job.id);
    });
  }

  function cancelWithdrawalFee(record, reason = 'withdrawal_reversed') {
    return reverseWithdrawalFee(record, reason);
  }

  function readiness() {
    return {
      contractConfigured: Boolean(contractAddress),
      usdtConfigured: Boolean(usdtContract),
      svxConfigured: Boolean(svxContract),
      executorEnabled,
      settleEnabled,
      settleHourUtc8,
      chainId,
    };
  }

  function stats() {
    const base = database.getATokenLpJobStats();
    const pools = database.listATokenLpDailyPools({ limit: 1000 });
    const pendingByAsset = { USDT: 0n, A: 0n };
    for (const pool of pools) {
      if (pool.status !== 'open') continue;
      pendingByAsset[assetOf(pool.asset)] += unitsOf(pool.units);
    }
    return {
      ...base,
      executorEnabled,
      settleHourUtc8,
      settleEnabled,
      openPools: pools.filter(pool => pool.status === 'open').length,
      pendingAccruedByAsset: { USDT: pendingByAsset.USDT.toString(), A: pendingByAsset.A.toString() },
    };
  }

  let timer = null;
  let ticking = false;
  function start(intervalMs = 60_000) {
    if (timer) return true;
    const tick = async () => {
      if (ticking) return;
      ticking = true;
      try {
        const settled = maybeSettle();
        if (settled.length) console.log('加 LP 日结算完成:', settled.map(job => job.poolDate + ':' + job.asset).join(','));
        if (executorEnabled) await runOnce();
      } catch (error) {
        console.error('加 LP 任务调度失败:', error?.message || error);
      } finally {
        ticking = false;
      }
    };
    timer = setInterval(() => void tick(), Math.max(Number(intervalMs) || 60_000, 10_000));
    if (typeof timer.unref === 'function') timer.unref();
    void tick();
    return true;
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    config: { ...autoLp, executorEnabled, settleHourUtc8, settleEnabled },
    accrueWithdrawalFee, reverseWithdrawalFee,
    enqueueWithdrawalFee: accrueWithdrawalFee, cancelWithdrawalFee,
    settleDate, settleDue, settleAll, maybeSettle,
    getJob, listJobs, listPools, listAccruals, getPool, readiness,
    buildInstruction, writeback, executeJob, runOnce, cancelJob, stats, start, stop,
  };
}
