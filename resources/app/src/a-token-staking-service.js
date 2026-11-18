import { formatUnits } from 'ethers';
import { createHash, randomUUID } from 'node:crypto';
import { A_TOKEN_DECIMALS } from './a-token-service.js';
import { ROLLING_WINDOW_MS, settlementDayStart, nextSettlementAt } from './a-token-time.js';

// 能量额度统一 30 天释放完，最后一期自动补齐整数尾差。
const DAY_MS = ROLLING_WINDOW_MS;
const LEGACY_ENERGY_PLAN = { planId:'energy', label:'旧能量·100天', days:100, dailyRateBps:100, minUnits:'1', flexible:false, energy:true };

export const STAKE_PLANS = Object.freeze({
  energy30: { planId:'energy30', label:'能量·30天', days:30, dailyRateBps:333, minUnits:'1', flexible:false, energy:true },
});

export function createATokenStakingService({ aTokenService, database, teamService, pendingService, clock = () => Date.now() }) {
  const db = database;
  function planOf(planId) {
    // `energy` remains a compatibility alias for cached clients, but always creates a 30-day position.
    const normalized = planId === 'energy' ? 'energy30' : planId;
    const plan = Object.hasOwn(STAKE_PLANS, normalized) ? STAKE_PLANS[normalized] : null;
    if (!plan) throw new Error('质押套餐无效');
    return plan;
  }

  // 能量为已充值额度的每日释放，不额外产生利息，也不重复退本金。
  function openEnergy(wallet, principalInput, { id, admin = false, reason = '', planId = 'energy' } = {}) {
    const plan = planOf(planId);
    const principal = aTokenService.parseA(principalInput, '能量数量');
    const now = clock(), key = String(wallet || '').toLowerCase();
    const stakeId = id || 'ats_energy_' + randomUUID();
    const existing = db.getATokenStake(stakeId);
    if (existing) {
      if (String(existing.wallet).toLowerCase() !== key || BigInt(existing.principalUnits) !== principal || existing.planId !== plan.planId) throw Object.assign(new Error('请求编号已用于其他钱包、数量或释放周期'), { code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 });
      return existing;
    }
    if (!admin) db.debitATokenZone({ wallet:key, zone:'alpha', units:principal.toString(), bizType:'stake_open', refId:stakeId, createdAt:now });
    const row = { id:stakeId, wallet:key, planId:plan.planId, principalUnits:principal.toString(),
      dailyRateBps:plan.dailyRateBps, startedAt:now, expiresAt:nextSettlementAt(now) + (plan.days - 1) * DAY_MS,
      lastSettledAt:now, dayEarnedUnits:'0', totalEarnedUnits:'0', status:'active',
      principalReturnedUnits:'0', interestEarnedUnits:'0', source:admin?'admin':'wallet', reason };
    db.upsertATokenStakeRow(row);
    return row;
  }
  function stake(wallet, planId, principalInput, { requestId } = {}) {
    const plan = planOf(planId);
    const id = requestId ? 'energy_req_' + createHash('sha256').update(String(wallet).toLowerCase() + ':' + requestId).digest('hex') : undefined;
    return aTokenService.transaction(() => openEnergy(wallet, principalInput, { id, planId:plan.planId }));
  }
  function grantEnergy(wallet, amount, { requestId, reason, planId = 'energy30' } = {}) {
    if (!requestId || !reason) throw new Error('请提供请求编号与充值原因');
    return aTokenService.transaction(() => openEnergy(wallet, amount, {id:'energy_admin_' + requestId, admin:true, reason, planId}));
  }
  function quoteEnergyGrant({ amount, quantity = 1, planId = 'energy30' } = {}) {
    const plan = planOf(planId);
    const units = aTokenService.parseA(String(amount ?? '').trim(), '每份能量池额度');
    const count = String(quantity).trim();
    if (!/^[1-9]\d*$/.test(count) || typeof quantity === 'number' && !Number.isSafeInteger(quantity)) throw new Error('赠送份数须为精确的正整数');
    return { planId:plan.planId, days:plan.days, amount:formatUnits(units, A_TOKEN_DECIMALS), units:units.toString(),
      quantity:BigInt(count) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(count) : count,
      totalUnits:(units * BigInt(count)).toString(), totalAmount:formatUnits(units * BigInt(count), A_TOKEN_DECIMALS) };
  }
  function grantEnergyPools(wallet, input, { requestId, reason } = {}) {
    const quote = quoteEnergyGrant(input);
    if (!/^[A-Za-z0-9._:-]{8,80}$/.test(String(requestId || ''))) throw new Error('操作请求编号格式不正确');
    if (typeof reason !== 'string' || reason.trim().length < 2 || reason.length > 120) throw new Error('请填写赠送原因');
    return aTokenService.transaction(() => {
      // Keep large gifts bounded while retaining their exact per-pool release schedule.
      const compact = BigInt(quote.quantity) > 100n, positions = compact ? 1 : Number(quote.quantity);
      const positionQuantity = compact ? String(quote.quantity) : '1';
      const prefix = 'energy_gift_' + createHash('sha256').update(requestId).digest('hex');
      const energies = [];
      for (let index = 0; index < positions; index++) {
        const id = String(quote.quantity) === '1' ? 'energy_admin_' + requestId : prefix + '_' + index;
        const existing = db.getATokenStake(id);
        if (existing && (existing.reason !== reason || String(existing.grantQuantity ?? 1) !== String(quote.quantity))) {
          throw Object.assign(new Error('该请求编号已用于另一笔能量池赠送'), {statusCode:409, code:'IDEMPOTENCY_CONFLICT'});
        }
        const energy = openEnergy(wallet, compact ? quote.totalAmount : quote.amount, {id, admin:true, reason, planId:quote.planId});
        Object.assign(energy, {grantRequestId:requestId, grantQuantity:quote.quantity, positionQuantity, grantUnitAmount:quote.amount});
        db.upsertATokenStakeRow(energy); energies.push(energy);
      }
      return {...quote, energy:energies[0], energyIds:energies.map(item => item.id), startedAt:energies[0].startedAt};
    });
  }
  function settleEnergy(stake, now, planOverride = null) {
    const total = BigInt(stake.principalUnits);
    const plan = planOverride || STAKE_PLANS[stake.planId] || LEGACY_ENERGY_PLAN;
    const days = plan.days;
    const first = nextSettlementAt(stake.startedAt);
    const due = Math.min(days, Math.max(0, Math.floor((settlementDayStart(now) - first) / DAY_MS) + 1));
    let done = Number(stake.energyDays || 0);
    while (done < due) {
      // Cumulative fractions preserve every unit across 30/100 releases, including compact gifts.
      const quantity = BigInt(stake.positionQuantity || '1'), perPool = total / quantity;
      const amount = (perPool * BigInt(done + 1) / BigInt(days) - perPool * BigInt(done) / BigInt(days)) * quantity;
      const available = first + done * DAY_MS;
      if (amount > 0n) pendingService.createReward({ wallet:stake.wallet, bizType:'stake', bizId:stake.id,
        periodKey:(stake.migration?.energy100To30At ? `energy30_migrated_${stake.migration.energy100To30At}_` : 'energy_') + done,
        amountUnits:amount.toString(), quotaUnits:amount.toString(),
        availableAt:available, expiresAt:nextSettlementAt(available),
        payload:{ component:'energy', principalUnits:amount.toString(), interestUnits:'0' } });
      done++;
    }
    stake.energyDays = done;
    const quantity = BigInt(stake.positionQuantity || '1');
    stake.totalEarnedUnits = (total / quantity * BigInt(done) / BigInt(days) * quantity).toString();
    stake.principalReturnedUnits = stake.totalEarnedUnits;
    stake.lastSettledAt = first + (done - 1) * DAY_MS;
    if (done >= days) stake.status='completed';
    db.upsertATokenStakeRow(stake);
  }

  // Before changing a legacy position's schedule, issue any 100-day installments already due.
  // Preserve the amount paid under the old schedule and restart only the remaining principal on 30 days.
  function migrateLegacyEnergy(now = clock()) {
    const legacy = db.db.prepare("SELECT id FROM a_token_stakes WHERE plan_id='energy'").all();
    let migrated = 0;
    for (const item of legacy) {
      aTokenService.transaction(() => {
        const stake = db.getATokenStake(item.id);
        if (!stake || stake.planId !== 'energy') return;
        const wasActive = stake.status === 'active';
        if (wasActive) settleEnergy(stake, now, LEGACY_ENERGY_PLAN);
        const oldPrincipal = BigInt(stake.principalUnits);
        const oldPaid = wasActive ? BigInt(stake.totalEarnedUnits || '0') : oldPrincipal;
        const remaining = wasActive && oldPrincipal > oldPaid ? oldPrincipal - oldPaid : 0n;
        const migration = { ...(stake.migration || {}), energy100To30At:now,
          originalPrincipalUnits:String(stake.migration?.originalPrincipalUnits || oldPrincipal),
          paidBefore30DayUnits:String((BigInt(stake.migration?.paidBefore30DayUnits || '0') + oldPaid).toString()) };
        stake.planId = 'energy30';
        stake.dailyRateBps = STAKE_PLANS.energy30.dailyRateBps;
        stake.migration = migration;
        if (!wasActive || remaining <= 0n) {
          stake.principalUnits = '0';
          stake.totalEarnedUnits = '0';
          stake.energyDays = 30;
          stake.status = 'completed';
          stake.expiresAt = now;
        } else {
          stake.principalUnits = remaining.toString();
          stake.totalEarnedUnits = '0';
          stake.energyDays = 0;
          stake.startedAt = now;
          stake.lastSettledAt = now;
          stake.expiresAt = nextSettlementAt(now) + (STAKE_PLANS.energy30.days - 1) * DAY_MS;
          stake.principalReturnedUnits = '0';
        }
        db.upsertATokenStakeRow(stake);
        migrated += 1;
      });
    }
    return migrated;
  }

  const migratedLegacyEnergy = migrateLegacyEnergy();

  function settleOne(stake, now) {
    if (stake.status === 'active' && STAKE_PLANS[stake.planId]?.energy) settleEnergy(stake, now);
  }

  function processAll(now = clock()) {
    const stakes = db.listActiveATokenStakes();
    // 单笔失败只跳过该笔、留待下轮重试（与矿机巡检同策略），
    // 避免一个封禁/异常账户把整批结算卡死在列表中段（2026-10-27 事故同款风险）。
    for (const s of stakes) {
      try { aTokenService.transaction(() => settleOne(s, now)); }
      catch (e) { console.error(`[SVX质押] ${s.wallet} 结算失败，跳过待下轮重试:`, e?.message || e); }
    }
    return stakes.length;
  }

  function present(wallet) {
    return db.listATokenStakes(wallet).filter(s => s.planId === 'energy30' || s.planId === 'energy').map(s => {
      const plan = planOf(s.planId);
      const principal = BigInt(s.principalUnits);
      const earned = BigInt(s.totalEarnedUnits);
      return {
        ...s,
        label: plan.label,
        flexible: false,
        energy: true,
        pendingMaturity: false,
        days: plan.days,
        dailyRateBps: plan.dailyRateBps,
        principal: formatUnits(BigInt(s.migration?.originalPrincipalUnits || principal), A_TOKEN_DECIMALS),
        totalEarned: formatUnits(BigInt(s.migration?.paidBefore30DayUnits || '0') + earned, A_TOKEN_DECIMALS),
        interestEarned: '0',
        outstandingPrincipal: formatUnits(principal - earned, A_TOKEN_DECIMALS),
        principalReturned: formatUnits(BigInt(s.migration?.paidBefore30DayUnits || '0') + earned, A_TOKEN_DECIMALS),
        dayEarned: formatUnits(principal / BigInt(s.positionQuantity || '1') / BigInt(plan.days) * BigInt(s.positionQuantity || '1'), A_TOKEN_DECIMALS),
        energyDays: Math.min(plan.days, Number(s.energyDays || 0)),
        progressPct: Math.min(100, Number(s.energyDays || 0) / plan.days * 100),
        estimatedPending: '0',
        maxTotal: formatUnits(BigInt(s.migration?.originalPrincipalUnits || principal), A_TOKEN_DECIMALS),
      };
    });
  }

  return { stake:(...args) => aTokenService.transaction(() => stake(...args)), processAll, grantEnergy, quoteEnergyGrant, grantEnergyPools, present, STAKE_PLANS, planOf, migrateLegacyEnergy, migratedLegacyEnergy };
}
