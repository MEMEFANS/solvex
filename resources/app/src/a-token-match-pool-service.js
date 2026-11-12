import crypto from 'node:crypto';
import { formatUnits } from 'ethers';
import { A_TOKEN_DECIMALS, USDT_DECIMALS } from './a-token-service.js';
import { completedWindows, settlementDayStart, nextSettlementAt } from './a-token-time.js';

// ─────────────────────────────────────────────────────────────
// SVX 超速驱动协议（2026-10-31）
//
// 规则（用户已确认）：
//   · 质押产出 = 蓄能额度（原可卖额度账本），蓄能额度不能直接挂卖；
//   · 驱动额度 = USDT 按 SVX 实时价格折算购买（1 USDT 买等值 SVX 的驱动额度）；
//   · 进池必须 1:1 配比（蓄能额度 : 驱动额度），出池 = 两者相加 → 流通额度；
//   · 锁定时长：首次使用超速驱动协议后开始计时，每过一天新放入的锁定时长 +24h
//     （第1天 24h、第2天 48h …… 第30天起封顶 720h），无论是否使用每日都递增；
//   · 到期后 SVX（流通额度）发放到资产账户，卖出只消耗流通额度。
//
// 资金口径：
//   · 购买驱动额度的 USDT 从用户站内 USDT 账本扣除，转入平台归集地址（TURBO_COLLECT_WALLET）；
//   · 匹配/涡轮/可用均为额度账本（非代币），放入时锁定等量SVX，到期返还双倍SVX与流通额度。
// ─────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MAX_DURATION_HOURS = 720;                 // 封顶 720 小时（第 30 天起）
const MIN_TURBO_USDT = 10n ** BigInt(USDT_DECIMALS); // 单次最少购买 1 USDT
const A_UNIT = 10n ** BigInt(A_TOKEN_DECIMALS);
const MIN_ENTER_A = 10n * A_UNIT;               // 超速驱动协议最低 10 枚 SVX 参与
// 驱动额度 USDT 归集地址：仅平台收款记账，不属任何真实用户。
const TURBO_COLLECT_WALLET = '0x0000000000000000000000000000000000007db0';

const makeId = prefix => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const fmtA = units => { try { return formatUnits(BigInt(units || '0'), A_TOKEN_DECIMALS); } catch { return '0'; } };
const fmtU = units => { try { return formatUnits(BigInt(units || '0'), USDT_DECIMALS); } catch { return '0'; } };

export function createATokenMatchPoolService({ aTokenService, database, shareholderService, clock = () => Date.now() }) {
  const at = aTokenService;
  const db = database;

  // 锁定时长（小时）：自首次进池起每满 24 小时 +24h，封顶 720h。
  // 2026-11-09 统一为「滚动 24 小时窗口」：不再按北京时间自然日跨日重置，
  // 首次进池 23 小时后仍按 24h 计，满 24 小时才升到 48h。
  function durationHoursFor(firstPoolAt, now = clock()) {
    const first = Number(firstPoolAt) || 0;
    if (first <= 0) return 24;
    const hours = (completedWindows(first, now) + 1) * 24;
    return Math.min(hours, MAX_DURATION_HOURS);
  }

  // ── 驱动额度报价：USDT → 等值 SVX 驱动额度（按大盘实时价，1:1 数量）──
  function quoteTurbo(usdtAmount) {
    const usdt = at.parseUsdt(usdtAmount, '购买 USDT 数量');
    if (usdt < MIN_TURBO_USDT) throw new Error(`单次最少购买 ${fmtU(MIN_TURBO_USDT)} USDT 的驱动额度`);
    const price = at.getPriceUsdtUnits();
    if (price <= 0n) throw new Error('当前价格无效，暂不能购买');
    const turbo = at.usdtToA(usdt, price);
    if (turbo <= 0n) throw new Error('购买数量过小，请增加 USDT 数量');
    const fee = 0n;             // 买入 0 手续费：实付 = 成交额
    const total = usdt;
    return {
      usdtIn: fmtU(usdt),
      feeUsdt: fmtU(fee),
      totalUsdt: fmtU(total),
      turboOut: fmtA(turbo),
      priceUsdt: fmtU(price),
      hint: `按大盘价 $${fmtU(price)}：${fmtU(usdt)} USDT ≈ ${fmtA(turbo)} SVX 驱动额度；买入 0 手续费，实付 ${fmtU(total)} USDT`,
    };
  }

  // ── 购买驱动额度：扣站内 USDT → 平台归集地址，驱动额度入账 ──
  // requestId 幂等：同一请求重复提交直接返回首次结果，不重复扣款
  function buyTurbo({ wallet, usdtAmount, requestId }) {
    wallet = String(wallet || '').toLowerCase();
    const reqId = String(requestId || '').trim();
    const presentPurchase = (dup, idempotent = true) => {
      const feeUnits = BigInt(dup.payload?.feeUnits || '0');
      return {
        usdtIn: fmtU(dup.usdtUnits), feeUsdt: fmtU(feeUnits),
        totalUsdt: fmtU(BigInt(dup.usdtUnits || '0') + feeUnits),
        turboOut: fmtA(dup.turboUnits), priceUsdt: fmtU(dup.priceUnits),
        turboBalance: fmtA(db.getATokenZoneBalance(wallet, 'beta').units), purchaseId: dup.id, idempotent,
      };
    };
    if (reqId) {
      const dup = db.getATokenTurboPurchase(wallet, reqId);
      if (dup) return presentPurchase(dup);
    }
    const usdt = at.parseUsdt(usdtAmount, '购买 USDT 数量');
    if (usdt < MIN_TURBO_USDT) throw new Error(`单次最少购买 ${fmtU(MIN_TURBO_USDT)} USDT 的驱动额度`);
    const price = at.getPriceUsdtUnits();
    if (price <= 0n) throw new Error('当前价格无效，暂不能购买');
    const turbo = at.usdtToA(usdt, price);
    if (turbo <= 0n) throw new Error('购买数量过小，请增加 USDT 数量');
    const fee = 0n;             // 买入 0 手续费：实付 = 成交额
    const total = usdt;
    if (at.balanceUsdt(wallet) < total) {
      throw new Error(`USDT 可用余额不足：需 ${fmtU(total)} USDT`);
    }
    at.debitUsdt(wallet, total);
    try { at.creditUsdt(TURBO_COLLECT_WALLET, usdt); }   // 成交金额进平台归集（买入 0 手续费）
    catch (e) {
      try { at.creditUsdt(wallet, total); } catch (e2) { console.error(`[超速驱动协议] ${wallet} 购买涡轮退款失败，需人工处理:`, e2?.message || e2); }
      throw e;
    }
    const purchaseId = makeId('atp');
    if (reqId) {
      const inserted = db.insertATokenTurboPurchase({
        id: purchaseId, wallet, requestId: reqId,
        usdtUnits: usdt.toString(), turboUnits: turbo.toString(), priceUnits: price.toString(),
        feeUnits: fee.toString(), totalUsdtUnits: total.toString(),
        createdAt: clock(),
      });
      if (!inserted) {   // 并发下另一请求已入库：回吐刚扣的 USDT，按首次结果返回
        try { at.debitUsdt(TURBO_COLLECT_WALLET, usdt); at.creditUsdt(wallet, total); }
        catch (e) { console.error(`[超速驱动协议] ${wallet} 重复购买回吐失败，需人工处理:`, e?.message || e); }
        const dup = db.getATokenTurboPurchase(wallet, reqId);
        if (dup) return presentPurchase(dup);
        throw new Error('购买请求冲突，请稍后重试');
      }
    }
    // 买入 0 手续费：不再产生 buy_fee 记账
    db.creditATokenZone({
      wallet, zone: 'beta', units: turbo.toString(), bizType: 'turbo_buy', refId: purchaseId, createdAt: clock(),
      payload: { usdtUnits: usdt.toString(), priceUnits: price.toString() },
    });
    // 2026-11-02 一键购买驱动额度也累计进交易大厅 24h 成交量（SVX 量 + USDT 额）
    try { at.addVolume(turbo, usdt); }
    catch (e) { console.error(`[超速驱动协议] ${wallet} 一键购买成交量累加失败:`, e?.message || e); }
    return {
      usdtIn: fmtU(usdt),
      feeUsdt: fmtU(fee),
      totalUsdt: fmtU(total),
      turboOut: fmtA(turbo),
      priceUsdt: fmtU(price),
      turboBalance: fmtA(db.getATokenZoneBalance(wallet, 'beta').units),
      purchaseId,
    };
  }

  // ── 按 SVX 数量反推 USDT 成本（向上取整到 0.000001 USDT，平台不吃小数亏）──
  function costForA(aixAmount) {
    const a = at.parseA(aixAmount, '购买 SVX 数量');
    if (a <= 0n) throw new Error('购买数量必须大于 0');
    const price = at.getPriceUsdtUnits();
    if (price <= 0n) throw new Error('当前价格无效，暂不能购买');
    const usdt = (a * price + A_UNIT - 1n) / A_UNIT;
    if (usdt < MIN_TURBO_USDT) {
      throw new Error(`按实时价折算最少购买约 ${fmtA(at.usdtToA(MIN_TURBO_USDT, price))} SVX（≈${fmtU(MIN_TURBO_USDT)} USDT）`);
    }
    const fee = 0n;             // 买入 0 手续费：实付 = 成交额
    const total = usdt;
    return { a, usdt, fee, total, price, aixStr: fmtA(a), usdtStr: fmtU(usdt), feeStr: fmtU(fee), totalStr: fmtU(total), priceStr: fmtU(price) };
  }

  // ── 驱动额度报价：SVX 数量 → 应付 USDT（按大盘价，买入 0 手续费）──
  function quoteTurboByA(aixAmount) {
    const c = costForA(aixAmount);
    return {
      aixIn: c.aixStr,
      usdtOut: c.totalStr,          // 签名/支付总额（买入 0 手续费，等于成交金额）
      usdtCost: c.usdtStr,
      feeUsdt: c.feeStr,
      priceUsdt: c.priceStr,
      hint: `按大盘价 $${c.priceStr}：${c.aixStr} SVX 驱动额度 = 实付 ${c.totalStr} USDT（买入 0 手续费）`,
    };
  }

  // ── 按 SVX 数量购买驱动额度：扣站内 USDT（签名时锁定金额）→ 平台归集地址，驱动额度精确入账 ──
  // requestId 幂等：同一请求重复提交直接返回首次结果，不重复扣款
  function buyTurboByA({ wallet, aixAmount, usdtUnits, requestId }) {
    wallet = String(wallet || '').toLowerCase();
    const reqId = String(requestId || '').trim();
    const presentPurchase = (dup, idempotent = true) => {
      const feeUnits = BigInt(dup.payload?.feeUnits || '0');
      return {
        aixIn: fmtA(dup.turboUnits), usdtIn: fmtU(dup.usdtUnits), feeUsdt: fmtU(feeUnits),
        totalUsdt: fmtU(BigInt(dup.usdtUnits || '0') + feeUnits),
        turboOut: fmtA(dup.turboUnits), priceUsdt: fmtU(dup.priceUnits),
        turboBalance: fmtA(db.getATokenZoneBalance(wallet, 'beta').units), purchaseId: dup.id, idempotent,
      };
    };
    if (reqId) {
      const dup = db.getATokenTurboPurchase(wallet, reqId);
      if (dup) return presentPurchase(dup);
    }
    const c = costForA(aixAmount);
    // 签名消息里锁定的金额必须与本次实时计算一致（报价到签名之间价格跳动则拒绝，让用户重签）
    if (usdtUnits !== undefined && String(usdtUnits) !== c.total.toString()) {
      throw new Error('价格已变动，请刷新报价后重新确认');
    }
    if (at.balanceUsdt(wallet) < c.total) {
      throw new Error(`USDT 可用余额不足：需 ${c.totalStr} USDT`);
    }
    at.debitUsdt(wallet, c.total);
    try { at.creditUsdt(TURBO_COLLECT_WALLET, c.usdt); }   // 成交金额进平台归集（买入 0 手续费）
    catch (e) {
      try { at.creditUsdt(wallet, c.total); } catch (e2) { console.error(`[超速驱动协议] ${wallet} 购买涡轮退款失败，需人工处理:`, e2?.message || e2); }
      throw e;
    }
    const purchaseId = makeId('atp');
    if (reqId) {
      const inserted = db.insertATokenTurboPurchase({
        id: purchaseId, wallet, requestId: reqId,
        usdtUnits: c.usdt.toString(), turboUnits: c.a.toString(), priceUnits: c.price.toString(),
        feeUnits: c.fee.toString(), totalUsdtUnits: c.total.toString(),
        createdAt: clock(),
      });
      if (!inserted) {   // 并发下另一请求已入库：回吐刚扣的 USDT，按首次结果返回
        try { at.debitUsdt(TURBO_COLLECT_WALLET, c.usdt); at.creditUsdt(wallet, c.total); }
        catch (e) { console.error(`[超速驱动协议] ${wallet} 重复购买回吐失败，需人工处理:`, e?.message || e); }
        const dup = db.getATokenTurboPurchase(wallet, reqId);
        if (dup) return presentPurchase(dup);
        throw new Error('购买请求冲突，请稍后重试');
      }
    }
    // 买入 0 手续费：不再产生 buy_fee 记账
    db.creditATokenZone({
      wallet, zone: 'beta', units: c.a.toString(), bizType: 'turbo_buy', refId: purchaseId, createdAt: clock(),
      payload: { usdtUnits: c.usdt.toString(), priceUnits: c.price.toString() },
    });
    return {
      aixIn: c.aixStr,
      usdtIn: c.usdtStr,
      feeUsdt: c.feeStr,
      totalUsdt: c.totalStr,
      turboOut: c.aixStr,
      priceUsdt: c.priceStr,
      turboBalance: fmtA(db.getATokenZoneBalance(wallet, 'beta').units),
      purchaseId,
    };
  }

  // ── 放入超速驱动协议：蓄能额度 + 驱动额度 1:1 锁入，到期出 2× 流通额度 ──
  function enterPoolInside({ wallet, amount, requestId = '' }) {
    wallet = String(wallet || '').toLowerCase();
    const a = at.parseA(amount, '放入数量');
    const entryId = requestId ? 'amp_req_' + crypto.createHash('sha256').update(wallet + ':' + requestId).digest('hex') : makeId('amp');
    const existing = db.getATokenMatchPoolEntry(entryId);
    if (existing) {
      if (BigInt(existing.matchUnits) !== a) throw Object.assign(new Error('同一请求编号不能用于不同的协议数量'), { code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 });
      return { ...presentEntry(existing), idempotent: true };
    }
    if (a < MIN_ENTER_A) throw new Error(`超速驱动协议最低 ${fmtA(MIN_ENTER_A)} SVX 参与`);
    // 蓄能额度 = 甲区（alpha）余额，驱动额度 = 乙区（beta）余额（2026-11-13：统一按分区余额记账）
    const zones = db.listATokenZoneBalances(wallet);
    const alphaAvail = BigInt(zones.alpha || '0');
    const betaAvail = BigInt(zones.beta || '0');
    if (alphaAvail < a) {
      throw new Error(`蓄能额度不足：当前可用 ${fmtA(alphaAvail)} SVX（蓄能额度即甲区余额）`);
    }
    if (betaAvail < a) {
      throw new Error(`驱动额度不足：需 1:1 配比 ${fmtA(a)} SVX 驱动额度，当前 ${fmtA(betaAvail)} SVX，可用 USDT 购买驱动额度`);
    }
    const now = clock();
    const latest = db.listATokenMatchPoolEntries(wallet, 1)[0];
    if (latest && Number(latest.createdAt) >= settlementDayStart(now)) throw new Error('超速驱动协议每日仅可使用一次，UTC 00:00（北京 08:00）重置');
    const state = db.touchATokenMatchPoolState(wallet, now);   // 首次使用落锚，之后每日 +24h
    const durationHours = durationHoursFor(state.firstPoolAt, now);
    // 进池从两个分区各扣等量 SVX（共 2a 锁定），到期发 2a 币 + 2a 流通额度
    db.debitATokenZone({ wallet, zone: 'alpha', units: a.toString(), bizType: 'match_pool', refId: entryId, createdAt: now });
    db.debitATokenZone({ wallet, zone: 'beta', units: a.toString(), bizType: 'match_pool', refId: entryId, createdAt: now });
    const entry = db.insertATokenMatchPoolEntry({
      id: entryId, wallet,
      matchUnits: a.toString(), turboUnits: a.toString(),
      totalUnits: (a * 2n).toString(),
      durationHours, createdAt: now, maturesAt: now + durationHours * HOUR_MS,
      status: 'locked', releasedAt: 0,
    });
    return presentEntry(entry);
  }

  function presentEntry(entry) {
    const now = clock();
    const remainMs = entry.status === 'locked' ? Math.max(0, Number(entry.maturesAt) - now) : 0;
    return {
      id: entry.id,
      matchA: fmtA(entry.matchUnits),
      turboA: fmtA(entry.turboUnits),
      totalA: fmtA(entry.totalUnits),
      durationHours: entry.durationHours,
      createdAt: entry.createdAt,
      maturesAt: entry.maturesAt,
      remainMs,
      status: entry.status,
      releasedAt: entry.releasedAt || 0,
    };
  }

  // ── 到期释放：total_units → 流通额度 + 等额 SVX 币 ──
  // 2026-11-03：进池时锁定等额 SVX 币，到期发 2 倍币 + 2 倍流通额度，出池即可全额挂卖。
  function enterPool(input) { return at.transaction(() => enterPoolInside(input)); }
  function releaseOne(entry, now) {
    return at.transaction(() => {
      if (!db.markATokenMatchPoolEntryReleased(entry.id, now)) return false;
      const units = BigInt(entry.totalUnits);
      db.addATokenUsableQuota(entry.wallet, units);
      at.creditA(entry.wallet, units);
      return true;
    });
  }

  function releaseDue(limit = 200) {
    const now = clock();
    let released = 0;
    for (const entry of db.listDueATokenMatchPoolEntries(now, limit)) {
      if (releaseOne(entry, now)) released += 1;
    }
    return released;
  }

  // ── 我的超速驱动协议总览：先懒释放本人到期条目，再返回配额 + 条目 + 状态 ──
  function overview(wallet) {
    wallet = String(wallet || '').toLowerCase();
    // 懒释放：本人到期条目立即结算（全局定时任务兜底其他情况）
    const now = clock();
    for (const entry of db.listDueATokenMatchPoolEntries(now, 500)) {
      if (String(entry.wallet).toLowerCase() !== wallet) continue;
      releaseOne(entry, now);
    }
    const zones = db.listATokenZoneBalances(wallet);
    const alphaUnits = BigInt(zones.alpha || '0');
    const betaUnits = BigInt(zones.beta || '0');
    const usableQuota = db.getATokenUsableQuota(wallet);
    const usableReleased = BigInt(usableQuota.releasedUnits);
    const usableUsed = BigInt(usableQuota.usedUnits);
    const state = db.getATokenMatchPoolState(wallet);
    const started = state.firstPoolAt > 0;
    return {
      matchQuota: {
        released: fmtA(alphaUnits),
        used: '0',
        available: fmtA(alphaUnits),
      },
      turboQuota: fmtA(betaUnits),
      usableQuota: {
        released: fmtA(usableReleased),
        used: fmtA(usableUsed),
        available: fmtA(usableReleased > usableUsed ? usableReleased - usableUsed : 0n),
      },
      usedToday: Boolean(db.listATokenMatchPoolEntries(wallet, 1)[0]?.createdAt >= settlementDayStart(now)),
      nextUseAt: nextSettlementAt(now),
      firstPoolAt: state.firstPoolAt || 0,
      started,
      dayIndex: started ? completedWindows(state.firstPoolAt, now) : 0,
      nextDurationHours: durationHoursFor(started ? state.firstPoolAt : now, now),
      maxDurationHours: MAX_DURATION_HOURS,
      priceUsdt: fmtU(at.getPriceUsdtUnits()),
      entries: db.listATokenMatchPoolEntries(wallet, 100).map(presentEntry),
      purchases: db.listATokenTurboPurchases(wallet, 20).map(p => ({
        id: p.id, usdtIn: fmtU(p.usdtUnits), turboOut: fmtA(p.turboUnits),
        priceUsdt: fmtU(p.priceUnits), createdAt: p.createdAt,
      })),
    };
  }

  return { quoteTurbo, buyTurbo:args=>at.transaction(()=>buyTurbo(args)), quoteTurboByA, buyTurboByA:args=>at.transaction(()=>buyTurboByA(args)), costForA, enterPool, overview, releaseDue, durationHoursFor, TURBO_COLLECT_WALLET };
}
