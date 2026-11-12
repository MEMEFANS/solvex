import { formatUnits } from 'ethers';
import { createHash, randomUUID } from 'node:crypto';
import { A_TOKEN_DECIMALS } from './a-token-service.js';
import { ROLLING_WINDOW_MS, settlementDayStart, nextSettlementAt } from './a-token-time.js';
import { SOLVEX_RULES } from '../shared/solvex-rules.js';

// 矿池：30 天，按投入 SVX 数量定档。每日领取利息，到期手动领取本金。
// 1000–1999…：25%；2000–9999…：45%；10000 及以上：55%。
const A_UNIT = 10n ** BigInt(A_TOKEN_DECIMALS);
const BPS = 10_000n;

export const NODE_TERM = Object.freeze({
  days: SOLVEX_RULES.pool.days,
  daysMs: SOLVEX_RULES.pool.days * ROLLING_WINDOW_MS,
  minCoinsUnits: (BigInt(SOLVEX_RULES.pool.minCoins) * A_UNIT).toString(),
  midCoinsUnits: (BigInt(SOLVEX_RULES.pool.midCoins) * A_UNIT).toString(),
  highCoinsUnits: (BigInt(SOLVEX_RULES.pool.highCoins) * A_UNIT).toString(),
  lowYieldBps: SOLVEX_RULES.pool.lowYieldBps,
  midYieldBps: SOLVEX_RULES.pool.midYieldBps,
  highYieldBps: SOLVEX_RULES.pool.highYieldBps,
});

export function nodeYieldBpsFor(coinsUnits) {
  const coins = BigInt(coinsUnits);
  if (coins <= 0n) throw new Error('矿池币数必须大于 0');
  if (coins < BigInt(NODE_TERM.minCoinsUnits)) {
    throw new Error(`矿池最少 ${formatUnits(BigInt(NODE_TERM.minCoinsUnits), A_TOKEN_DECIMALS)} 币`);
  }
  // 2000（含）至10000（不含）为45%，10000及以上为55%
  if (coins >= BigInt(NODE_TERM.highCoinsUnits)) return NODE_TERM.highYieldBps;
  if (coins >= BigInt(NODE_TERM.midCoinsUnits)) return NODE_TERM.midYieldBps;
  return NODE_TERM.lowYieldBps;
}

function quoteOf(coinsUnits) {
  const coins = BigInt(coinsUnits);
  const yieldBps = nodeYieldBpsFor(coins);
  const interestUnits = coins * BigInt(yieldBps) / BPS;
  const payoutUnits = coins + interestUnits;
  return {
    coinsUnits: coins.toString(),
    yieldBps,
    ratePct: Number(yieldBps) / 100,
    days: NODE_TERM.days,
    interestUnits: interestUnits.toString(),
    payoutUnits: payoutUnits.toString(),
    // 蓄能额度默认与币数 1:1（P1 默认口径，待产品最终确认后可单点调整）
    quotaUnits: coins.toString(),
  };
}

export function createATokenNodeService({ aTokenService, database, pendingService, teamService, clock = () => Date.now() }) {
  const db = database;
  const transaction = aTokenService.transaction;

  function quote(coinsInput) {
    const coins = aTokenService.parseA(coinsInput, '矿池币数');
    const q = quoteOf(coins);
    return {
      ...q,
      coins: formatUnits(BigInt(q.coinsUnits), A_TOKEN_DECIMALS),
      interest: formatUnits(BigInt(q.interestUnits), A_TOKEN_DECIMALS),
      payout: formatUnits(BigInt(q.payoutUnits), A_TOKEN_DECIMALS),
      minCoins: formatUnits(BigInt(NODE_TERM.minCoinsUnits), A_TOKEN_DECIMALS),
    };
  }

  // 记录团队业绩：整个团队都算（不区分代数，含间推），按币记；冲销由 a_token_team_perf_events 的 reverse_of 承担。
  function recordTeamPerf(node) {
    if (teamService?.recordTeamPerformance) {
      teamService.recordTeamPerformance(node.wallet, {
        bizType: 'node', bizId: node.id, amountUnits: node.principalUnits,
        occurredAt: node.startedAt,
        payload: { yieldBps: node.yieldBps, payoutUnits: node.payoutUnits },
      });
      return;
    }
    // 兼容旧测试桩：没有 P3 团队服务时按原 10 代链路记账。
    const chain = teamService?.getReferralChain?.(node.wallet) || [];
    for (let i = 0; i < chain.length; i += 1) {
      db.insertATokenTeamPerfEventRow({
        id: `atpe_node_${node.id}_${i + 1}`,
        ownerWallet: chain[i],
        sourceWallet: node.wallet,
        bizType: 'node',
        bizId: node.id,
        amountUnits: node.principalUnits,
        asset: 'A',
        depth: i + 1,
        occurredAt: node.startedAt,
        createdAt: node.startedAt,
        payload: { yieldBps: node.yieldBps, payoutUnits: node.payoutUnits },
      });
    }
  }

  // 建仓：只从甲区扣币。调用方保证事务。
  function openInside(wallet, coinsInput, { id, startedAt, requestId } = {}) {
    const key = String(wallet || '').toLowerCase();
    const coins = aTokenService.parseA(coinsInput, '矿池币数');
    const q = quoteOf(coins);
    const now = Number(startedAt ?? clock());
    if (!id && requestId) id = 'atn_req_' + createHash('sha256').update(key + ':' + requestId).digest('hex');
    const existing = id ? db.getATokenNode(id) : null;
    if (existing) {
      if (existing.wallet !== key || BigInt(existing.principalUnits) !== coins) throw Object.assign(new Error('同一请求编号不能用于不同的矿池投入'), { code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 });
      return existing;
    }
    const nodeId = String(id || `atn_${now}_${randomUUID()}`);
    // 甲区扣币（幂等键 node_open + nodeId），余额不足直接抛错
    db.debitATokenZone({
      wallet: key, zone: 'alpha', units: q.coinsUnits,
      bizType: 'node_open', refId: nodeId, createdAt: now,
      payload: { yieldBps: q.yieldBps, days: NODE_TERM.days },
    });
    const node = {
      id: nodeId,
      wallet: key,
      principalUnits: q.coinsUnits,
      yieldBps: q.yieldBps,
      ratePct: q.ratePct,
      interestUnits: q.interestUnits,
      payoutUnits: q.payoutUnits,
      quotaUnits: q.quotaUnits,
      days: NODE_TERM.days,
      startedAt: now,
      expiresAt: now + NODE_TERM.daysMs,
      status: 'active',
      settledAt: 0,
      pendingId: '',
    };
    db.upsertATokenNodeRow(node);
    recordTeamPerf(node);
    return node;
  }

  function open(wallet, coinsInput, options) {
    return transaction(() => openInside(wallet, coinsInput, options));
  }

  // 利息按实际持有时长分摊，统一在 UTC 00:00 生成；跳过的领取日不顺延。
  function settleDaily(node, now) {
    if (node.status !== 'active') return;
    const started = Number(node.startedAt), maturity = Number(node.expiresAt);
    const totalInterest = BigInt(node.interestUnits);
    let last = Number(node.lastInterestAt || started);
    const boundary = settlementDayStart(now);
    while (last < maturity && nextSettlementAt(last) <= boundary) {
      const available = nextSettlementAt(last);
      const end = Math.min(available, maturity);
      const accrued = t => totalInterest * BigInt(t - started) / BigInt(maturity - started);
      const amount = accrued(end) - accrued(last);
      if (amount > 0n) {
        pendingService.createReward({ wallet: node.wallet, bizType: 'node', bizId: node.id,
          periodKey: 'interest_' + end, amountUnits: amount.toString(), quotaUnits: amount.toString(),
          availableAt: available, expiresAt: nextSettlementAt(available),
          payload: { component: 'interest', interestUnits: amount.toString(), principalUnits: '0' } });
        teamService?.distributeStakeReward?.(node.wallet, amount, node.id, available, now);
      }
      last = end;
      node.lastInterestAt = end;
    }
    if (now >= maturity && !node.principalPendingId) {
      const p = pendingService.createReward({ wallet: node.wallet, bizType: 'node', bizId: node.id,
        periodKey: 'principal', amountUnits: node.principalUnits, quotaUnits: node.principalUnits,
        availableAt: maturity, expiresAt: Number.MAX_SAFE_INTEGER,
        payload: { component: 'principal', principalUnits: node.principalUnits, interestUnits: '0' } });
      node.principalPendingId = p.id;
    }
    if (last >= maturity && node.principalPendingId) { node.status = 'completed'; node.settledAt = now; }
    db.upsertATokenNodeRow(node);
  }
  function processAll(now = clock()) {
    const nodes = db.listActiveATokenNodes();
    let settled = 0;
    for (const node of nodes) transaction(() => { settleDaily(node, Number(now)); settled++; });
    return { settled, scanned: nodes.length };
  }

  function present(wallet) {
    const nodes = db.listATokenNodes(wallet);
    const now = clock();
    return nodes.map((n) => {
      const expired = Number(n.expiresAt) <= now;
      const active = n.status === 'active';
      return {
        ...n,
        principal: formatUnits(BigInt(n.principalUnits || '0'), A_TOKEN_DECIMALS),
        interest: formatUnits(BigInt(n.interestUnits || '0'), A_TOKEN_DECIMALS),
        payout: formatUnits(BigInt(n.payoutUnits || '0'), A_TOKEN_DECIMALS),
        remainingMs: active ? Math.max(0, Number(n.expiresAt) - now) : 0,
        progressPct: active ? Math.min(100, Math.max(0, (now - Number(n.startedAt)) / NODE_TERM.daysMs * 100)) : 100,
        statusLabel: active ? (expired ? '待结算' : '运行中') : (n.status === 'completed' ? '已到期' : n.status),
      };
    });
  }

  // 档位口径（前端只展示后端返回值，不在页面写死数值）
  function describe() {
    return {
      days: NODE_TERM.days,
      minCoins: formatUnits(BigInt(NODE_TERM.minCoinsUnits), A_TOKEN_DECIMALS),
      midCoins: formatUnits(BigInt(NODE_TERM.midCoinsUnits), A_TOKEN_DECIMALS),
      highCoins: formatUnits(BigInt(NODE_TERM.highCoinsUnits), A_TOKEN_DECIMALS),
      lowRatePct: NODE_TERM.lowYieldBps / 100,
      midRatePct: NODE_TERM.midYieldBps / 100,
      highRatePct: NODE_TERM.highYieldBps / 100,
      payoutMode: 'daily_interest_maturity_principal',
      tierNames: SOLVEX_RULES.pool.names,
      settlement: SOLVEX_RULES.settlement,
    };
  }

  function overview(wallet) {
    const nodes = present(wallet);
    return {
      term: describe(),
      zones: db.listATokenZoneBalances(wallet),
      nodes,
    };
  }

  return { open, quote, processAll, present, overview, describe, NODE_TERM, nodeYieldBpsFor };
}
