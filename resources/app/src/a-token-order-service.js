import crypto from 'node:crypto';
import { formatUnits } from 'ethers';
import { A_TOKEN_DECIMALS, USDT_DECIMALS } from './a-token-service.js';
import { BUY_FEE_BPS, SELL_FEE_BPS } from './a-token-shareholder-service.js';

// 卖出最低门槛：1 SVX（买入不限制）
// 2026-11-03 用户要求：涡轮产出的币不再 100 个起卖，1 个即可挂卖
const MIN_SELL_A = 10n ** BigInt(A_TOKEN_DECIMALS);

// ─────────────────────────────────────────────────────────────
// SVX委托撮合服务（P2P 模式 v2）
//
// 核心规则：**买必须有人卖，卖必须有人买** —— 平台资金池不再兜底承接。
//   - 下单（市价/限价）→ 立即冻结资金 → 尝试吃对手方 OPEN 挂单
//   - 吃不满的剩余部分自动转为委托，等待对手方来成交
//     · 买单剩余 = 「委托求购」，冻结 USDT（计入顶部求购额度展示）
//     · 卖单剩余 = 「挂牌待售」，冻结 A
//   - 撮合触发点：新单进入 / K线价格变动 tick / 管理后台强制撮合
//
// 价格优先级：卖单价低者优先、买单价高者优先。
//   同价档内：买单按金额大者优先（大额买家先成交）；
//   卖单默认按挂单时间先来先成交（不按金额大小插队，大单小单都能优先卖给大额买家）；
//   每 N 次撮合尝试中有 C 次改为「小额轮」：买、卖都按金额小者优先，让小卖单偶尔配给小买单。
// 成交价取**先挂一方**的限价（maker 定价）。
// 成交条件：B.限价 >= S.限价，且至少一侧已被市场价格越过
//           （S.price <= 现价 或 B.price >= 现价）—— 保证平台调控价格能驱动旧挂单成交。
//
// 手续费口径（2026-11-09 P2 用户确认）：
//   买方：成交金额的 5%，以 USDT 另收（不从币数里扣）；下单时连同手续费一起冻结，按实际成交金额逐笔划扣，
//        未成交部分撤单/尾差连同手续费原路退回。
//   卖方：成交 USDT 金额的 5%，从卖方应收 USDT 中扣除，全部进股东池（不分 LP、不销毁）。
//   买卖均按成交 USDT 金额计算，价格取成交价（一键购买/市价单锚定大盘价）。
//
// 挂单即冻结（debit）；撤单原路退回；部分成交按比例核销；铸币/储备金在 P2P 结算中不动。
// ─────────────────────────────────────────────────────────────

const BPS = 10000n;
// 灰尘阈值：剩余量小于该值即视为「不可再成交的尾差」（挂单列表里会显示为 0）。
// 注意 decimals：USDT 6 位（0.001 USDT = 1e3）、SVX 18 位（0.001 SVX = 1e15）
const DUST_A = 10n ** 15n;     // 0.001 SVX
const DUST_USDT = 10n ** 3n;   // 0.001 USDT
const makeId = prefix => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

// 小额轮分布：每 window 次撮合尝试中有 count 次走「小额优先」，用 Bresenham 方式均匀铺开。
// 例：window=10 / count=3 → 第 4、7、10 次尝试照顾小额；window=10 / count=4 → 第 3、5、8、10 次。
export function smallFirstAt(seq, window = 10, count = 3) {
  const w = Math.max(1, Math.floor(Number(window) || 10));
  const k = Math.min(w, Math.max(0, Math.floor(Number(count) || 0)));
  if (k <= 0) return false;
  const phase = (((Math.floor(Number(seq) || 0) - 1) % w) + w) % w;
  return Math.floor((phase + 1) * k / w) !== Math.floor(phase * k / w);
}

export function createATokenOrderService({ aTokenService, database, teamService, referralService, shareholderService, clock = () => Date.now(), matchSmallFirstWindow = 10, matchSmallFirstCount = 3 }) {
  const at = aTokenService;
  const db = database;

  // 撮合优先级（价格为主键，买卖价交叉仍是硬性成交条件）：
  //   买单：同价档内始终「小额优先」（挂单金额小者先成交，金额相同再按挂单时间）——2026-10-23 用户确认
  //   卖单：同价档内默认按挂单时间先来先成交；
  //   每 SMALL_FIRST_WINDOW 次撮合尝试中有 SMALL_FIRST_COUNT 次改为「小额轮」，卖单也按金额小者优先。
  const SMALL_FIRST_WINDOW = Math.max(1, Math.floor(Number(matchSmallFirstWindow) || 10));
  const SMALL_FIRST_COUNT = Math.min(SMALL_FIRST_WINDOW, Math.max(0, Math.floor(Number(matchSmallFirstCount) || 0)));
  let matchAttemptSeq = 0;

  // 手续费规则（2026-11-11 调整）：
  //   买方 0（按标的价实付）；卖方 5%（按成交 USDT 金额扣除，全部进股东池）。
  function feeRates() {
    return { fee: SELL_FEE_BPS, buyFee: BUY_FEE_BPS };
  }

  function minerDirectCountOf(wallet) {
    try { return referralService?.minerDirectCount?.(String(wallet || '').toLowerCase()) ?? 0; }
    catch { return 0; }
  }

  function payloadOf(row) {
    try { return JSON.parse(row?.payload_json || '{}') || {}; } catch { return {}; }
  }

  // ─────────────────────────────────────────────────────────────
  //  把订单里冻结的钱原路退回（撤单/系统升级退款用）
  // ─────────────────────────────────────────────────────────────
  function _refundLocked(order) {
    const wallet = String(order.wallet || '').toLowerCase();
    if (!wallet) return;
    if (BigInt(order.input_usdt_units || '0') > 0n) {
      at.creditUsdt(wallet, BigInt(order.input_usdt_units));
    }
    // 存量 5% 买单的手续费托管余额（新单恒为 0，仅历史单兼容退款）
    try {
      const p = JSON.parse(order.payload_json || '{}') || {};
      if (BigInt(p.buyFeeRemainingUnits || '0') > 0n) at.creditUsdt(wallet, BigInt(p.buyFeeRemainingUnits));
    } catch {}
    if (BigInt(order.input_a_units || '0') > 0n) {
      at.creditA(wallet, BigInt(order.input_a_units));
      // 撤单返还已占用的流通额度（旧单未占用过额度时 used 归零，不会凭空发放额度）
      try { db.refundATokenUsableQuota?.(wallet, BigInt(order.input_a_units)); } catch {}
    }
  }

  // 服务启动迁移（仅一次）：P2P 撮合上线前的存量 OPEN 单按旧口径结算，
  // 与新规则不兼容 → 自动撤单退款。
  // 判定依据：旧订单的 payload 里没有 feeRateBps（新撮合时代所有订单都会写入费率快照），
  // 避免每次重启都把正常挂着的委托撤掉
  function _migrateLegacyOpenOrders() {
    let cancelled = 0;
    let refunded = 0;
    let refundedUnits = 0n;
    try {
      for (const o of db.listATokenOpenOrders()) {
        try {
          let payload = {};
          try { payload = JSON.parse(o.payload_json || '{}') || {}; } catch {}
          if (payload.feeRateBps !== undefined) {
            // 新撮合时代订单：2026-11-11 起买入 0 手续费，存量买单另收冻结的
            // 5% 托管原路退回并归零（幂等：退完即为 0，重启不会重复退款）
            if (String(o.side) === 'buy') {
              const escrow = BigInt(payload.buyFeeRemainingUnits || '0');
              if (escrow > 0n) {
                at.creditUsdt(String(o.wallet || '').toLowerCase(), escrow);
                db.updateATokenOrderPayload(o.id, {
                  ...payload, buyFeeRateBps: 0, buyFeeUnits: '0', buyFeeRemainingUnits: '0',
                }, clock());
                refunded += 1;
                refundedUnits += escrow;
              }
            }
            continue;
          }
          _refundLocked(o);
          const t = clock();
          db.markATokenOrderCancelled(o.id, { cancelledAt: t, updatedAt: t, reason: 'system_upgrade:p2p_match' });
          cancelled += 1;
        } catch {}
      }
    } catch {}
    if (cancelled > 0) console.log(`[SVX撮合] 系统升级：${cancelled} 笔旧版挂单已自动撤单退款`);
    if (refunded > 0) console.log(`[SVX撮合] 买入免手续费：${refunded} 笔挂单的手续费托管 ${formatUnits(refundedUnits, USDT_DECIMALS)} USDT 已退回`);
  }
  _migrateLegacyOpenOrders();

  // ─────────────────────────────────────────────────────────────
  //  挂单报价：限价单预览（不冻结、不入库）
  // ─────────────────────────────────────────────────────────────
  function quoteLimitOrder({ side, priceUsdt, amount, wallet = '' }) {
    const price = at.parseUsdt(priceUsdt, '限价');
    if (price <= 0n) throw new Error('限价必须大于 0');
    const priceStr = formatUnits(price, USDT_DECIMALS);

    if (side === 'buy') {
      // 买入 0 手续费：冻结金额即成交金额（按标的价实付）
      const usdt = at.parseUsdt(amount, '支付 USDT 数量');
      if (usdt <= 0n) throw new Error('支付 USDT 数量必须大于 0');
      const aReceive = at.usdtToA(usdt, price);
      if (aReceive <= 0n) throw new Error('购买数量过小，请增加 USDT 数量');
      const feeUsdt = 0n;
      const totalUsdt = usdt;
      return {
        side:'buy', orderType:'limit', priceUsdt:priceStr,
        usdtIn:formatUnits(usdt, USDT_DECIMALS),
        aOut:formatUnits(aReceive, A_TOKEN_DECIMALS),
        amountUsdt:formatUnits(usdt, USDT_DECIMALS),
        feeUsdt:formatUnits(feeUsdt, USDT_DECIMALS),
        totalUsdt:formatUnits(totalUsdt, USDT_DECIMALS),
        feeRateBps:0, feePct:'0%',
        hint:`冻结 ${formatUnits(totalUsdt, USDT_DECIMALS)} USDT（买入 0 手续费）· 限价 ${priceStr} 可买入约 ${formatUnits(aReceive, A_TOKEN_DECIMALS)} SVX`,
      };
    }

    const rates = feeRates();   // 卖方 5%（按成交 USDT 金额）
    const directCnt = minerDirectCountOf(wallet);

    // sell：冻结 = 卖出数量本身（手续费不再从币里扣），成交后按 USDT 金额扣 5%
    const a = at.parseA(amount, '卖出 SVX 数量');
    const grossUsdt = at.aToUsdt(a, price);
    const feeUsdt = grossUsdt * rates.fee / BPS;
    const usdtOut = grossUsdt - feeUsdt;
    return {
      side: 'sell', orderType: 'limit', priceUsdt: priceStr,
      aIn: formatUnits(a, A_TOKEN_DECIMALS),
      lockedA: formatUnits(a, A_TOKEN_DECIMALS),
      usdtOut: formatUnits(usdtOut, USDT_DECIMALS),
      grossUsdt: formatUnits(grossUsdt, USDT_DECIMALS),
      feeUsdt: formatUnits(feeUsdt, USDT_DECIMALS),
      feeRateBps: Number(rates.fee),
      directCount: directCnt,
      feePct: (Number(rates.fee) / 100).toFixed(0) + '%',
      hint: `冻结卖出数量 ${formatUnits(a, A_TOKEN_DECIMALS)} A；卖出手续费 ${(Number(rates.fee) / 100).toFixed(0)}%（按成交 USDT 金额扣除，全部进股东池），预计实收约 ${formatUnits(usdtOut, USDT_DECIMALS)} USDT`,
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  下单：市价 / 限价 → 冻结资金 → 尝试撮合 → 未成交部分转委托
  // ─────────────────────────────────────────────────────────────
  function placeOrder({ wallet, side, orderType = 'market', priceUsdt, amount }) {
    at.assertFreeTrading();
    if (side !== 'buy' && side !== 'sell') throw new Error('side 必须是 buy 或 sell');
    wallet = String(wallet || '').toLowerCase();
    if (!wallet) throw new Error('钱包地址必填');
    orderType = String(orderType).toLowerCase();
    if (orderType !== 'market' && orderType !== 'limit') throw new Error(`orderType 暂不支持：${orderType}`);

    const now0 = clock();
    const currentPrice = at.getPriceUsdtUnits();
    if (currentPrice <= 0n) throw new Error('当前价格无效，暂不能下单');

    // 市价单的"愿意成交价"锚定现价；限价单使用用户指定限价
    const limitPriceRaw = orderType === 'limit'
      ? at.parseUsdt(priceUsdt, '限价')
      : currentPrice;
    if (limitPriceRaw <= 0n) throw new Error('限价必须大于 0');
    const rates = feeRates();   // 买入 0 / 卖出 5%（下单时快照进 payload，撮合按快照结算）

    let inputUsdtUnits = 0n;
    let inputAUnits = 0n;

    if (side === 'buy') {
      const usdt = at.parseUsdt(amount, '支付 USDT 数量');
      if (usdt <= 0n) throw new Error('支付 USDT 数量必须大于 0');
      // 买入 0 手续费：只冻结成交金额（按标的价实付）
      const totalUsdt = usdt;
      if (at.balanceUsdt(wallet) < totalUsdt) {
        throw new Error(`USDT 可用余额不足：需 ${formatUnits(totalUsdt, USDT_DECIMALS)} USDT`);
      }
      const aReceive = at.usdtToA(usdt, limitPriceRaw);
      if (aReceive <= 0n) throw new Error('购买数量过小，请增加 USDT 数量');
      at.debitUsdt(wallet, totalUsdt);               // 冻结：仅成交金额
      inputUsdtUnits = usdt;
    } else {
      // sell：只冻结卖出数量本身；5% 手续费在成交时按 USDT 金额从卖方应收里扣
      const a = at.parseA(amount, '卖出 SVX 数量');
      if (at.balanceA(wallet) < a) {
        throw new Error(`SVX可用余额不足：需 ${formatUnits(a, A_TOKEN_DECIMALS)} A`);
      }
      if (a < MIN_SELL_A) throw new Error('SVX 卖出最低 1 个起，买入不限制');
      // 2026-10-31 匹配池规则：只有经匹配池转换的「流通额度」才可以卖，质押产出（蓄能额度）不能直接挂卖
      const quotaSnapshot = db.getATokenUsableQuota(wallet);
      const quotaAvailable = BigInt(quotaSnapshot.releasedUnits) - BigInt(quotaSnapshot.usedUnits);
      if (quotaAvailable < a) {
        const avail = quotaAvailable > 0n ? quotaAvailable : 0n;
        throw new Error(`流通额度不足：流通额度需通过匹配池转换获得，当前可用 ${formatUnits(avail, A_TOKEN_DECIMALS)} SVX`);
      }
      at.debitA(wallet, a);
      db.consumeATokenUsableQuota(wallet, a);
      inputAUnits = a;
    }

    const orderId = makeId('aor');
    db.insertATokenOrderRow({
      id: orderId, wallet, side, orderType,
      orderPriceUsdtUnits: limitPriceRaw.toString(),
      inputUsdtUnits: inputUsdtUnits.toString(),
      inputAUnits: inputAUnits.toString(),
      status: 'OPEN',
      createdAt: now0, updatedAt: now0,
      payload: {
        orderType,
        feeRateBps: Number(rates.fee),
        // 买入 0 手续费：字段保留固定 0，供历史撮合逻辑读取时保持结构一致
        buyFeeRateBps: 0,
        buyFeeUnits: '0',
        buyFeeRemainingUnits: '0',
      },
    });

    // 新单立即参与撮合（吃对手方 / 被对手方吃由后续轮询处理）
    const fills = new Map();
    _matchPass(fills);

    const latest = db.getATokenOrder(orderId);
    const myFill = fills.get(orderId);
    const remainUsdt = BigInt(latest?.input_usdt_units || '0');
    const remainA = BigInt(latest?.input_a_units || '0');
    const isFilled = latest?.status === 'FILLED';

    const base = {
      ok: true, orderId, orderType, side,
      orderStatus: isFilled ? 'FILLED' : 'OPEN',
      priceUsdt: formatUnits(BigInt(latest?.order_price_usdt_units || limitPriceRaw), USDT_DECIMALS),
      // 委托冻结展示：新单仅成交金额；存量单兼容历史手续费托管余额
      lockedUsdt: formatUnits(remainUsdt + BigInt(payloadOf(latest).buyFeeRemainingUnits || '0'), USDT_DECIMALS),
      lockedA: formatUnits(remainA, A_TOKEN_DECIMALS),
      createdAt: now0,
    };

    if (!myFill) return base;

    if (side === 'buy') {
      return {
        ...base,
        usdtPaid: myFill.usdtPaid,
        feeUsdt: myFill.feeUsdt,
        aReceived: myFill.aReceived,
        avgPrice: myFill.avgPrice || null,
        partialFilled: !isFilled && myFill.count > 0,
      };
    }
    return {
      ...base,
      aSold: myFill.aSold,
      usdtReceived: myFill.usdtReceived,
      feeUsdt: myFill.feeUsdt,
      avgPrice: myFill.avgPrice || null,
      partialFilled: !isFilled && myFill.count > 0,
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  撮合引擎：交叉撮合所有 OPEN 订单（买卖互为对手方）
  //  fills: Map<orderId, fillDetail> 用于把本次撮合明细回传给下单者
  // ─────────────────────────────────────────────────────────────
  function _matchPass(fills = new Map()) {
    if (!at.liquidityStatus().enabled) return { matched:0, skipped:0, errors:[], trades:0 };
    const currentPrice = at.getPriceUsdtUnits();
    if (currentPrice <= 0n) return { matched: 0, skipped: 0, errors: [] };

    let openRows = db.listATokenOpenOrders();
    const errors = [];
    let matchedCount = 0;
    let skipped = 0;
    let guard = 0;

    // 灰尘单清理：剩余量已小到无法再成交任何有效单位（列表里显示 0），
    // 原路退回冻结并关闭订单（CANCELLED），避免永远"挂单中"并每轮产生 0 数量的成交记录。
    for (const r of openRows) {
      try {
        if (String(r.status || '') !== 'OPEN') continue;
        const isBuy = String(r.side) === 'buy';
        const rem = BigInt((isBuy ? r.input_usdt_units : r.input_a_units) || '0');
        if (rem > 0n && rem >= (isBuy ? DUST_USDT : DUST_A)) continue;
        _refundLocked(r);
        const t = clock();
        db.markATokenOrderCancelled(r.id, { cancelledAt: t, updatedAt: t, reason: 'dust_cleanup' });
        r.status = 'CANCELLED';
      } catch {}
    }

    // 市价单转委托后，委托价跟随当前币价刷新（限价单保持用户指定价不变）
    {
      const nowM = clock();
      for (const r of openRows) {
        if (String(r.status) !== 'OPEN' || String(r.order_type) !== 'market') continue;
        if (BigInt(r.order_price_usdt_units || '0') === currentPrice) continue;
        db.updateATokenOrderMarketPrice(r.id, { priceUsdtUnits: currentPrice.toString(), updatedAt: nowM });
        r.order_price_usdt_units = currentPrice.toString();
      }
    }

    while (guard++ < 200) {
      openRows = openRows.filter(r => r.status === 'OPEN'
        && BigInt(r.input_usdt_units || '0') >= 0n
        && BigInt(r.input_a_units || '0') >= 0n);

      // 卖单侧的小额轮：每 SMALL_FIRST_WINDOW 次尝试中有 SMALL_FIRST_COUNT 次
      const smallFirst = smallFirstAt(++matchAttemptSeq, SMALL_FIRST_WINDOW, SMALL_FIRST_COUNT);
      const cmpAmt = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
      const byTime = (a, b) => Number(a.created_at) - Number(b.created_at);

      // 买单：同价档内始终「小额优先」（金额小者先成交，2026-10-23 用户确认：SVX 优先卖给小额订单），
      //       同金额再按挂单时间
      const buys = openRows.filter(r => String(r.side) === 'buy' && BigInt(r.input_usdt_units || '0') > 0n)
        .sort((a, b) => {
          const pb = BigInt(b.order_price_usdt_units) - BigInt(a.order_price_usdt_units); // 价高优先
          if (pb !== 0n) return pb > 0n ? 1 : -1;
          const c = cmpAmt(BigInt(a.input_usdt_units || '0'), BigInt(b.input_usdt_units || '0'));
          return c !== 0 ? c : byTime(a, b);
        });
      // 卖单：同价档内默认轮按挂单时间先来先成交（不按金额插队）；
      //       小额轮按金额小者优先（小卖单优先配小买单）
      const sells = openRows.filter(r => String(r.side) === 'sell' && BigInt(r.input_a_units || '0') > 0n)
        .sort((a, b) => {
          const ps = BigInt(a.order_price_usdt_units) - BigInt(b.order_price_usdt_units); // 价低优先
          if (ps !== 0n) return ps > 0n ? 1 : -1;
          if (!smallFirst) return byTime(a, b);
          const c = cmpAmt(BigInt(a.input_a_units || '0'), BigInt(b.input_a_units || '0'));
          return c !== 0 ? c : byTime(a, b);
        });

      // 本轮找到第一对可成交组合
      let pair = null;
      outer:
      for (const s of sells) {
        const sPrice = BigInt(s.order_price_usdt_units);
        for (const b of buys) {
          const bWallet = String(b.wallet).toLowerCase();
          const sWallet = String(s.wallet).toLowerCase();
          if (bWallet === sWallet) continue;                       // 防自成交
          const bPrice = BigInt(b.order_price_usdt_units);
          if (bPrice < sPrice) break outer;                        // 买价不够高，后面更贵
          const touchedByMarket = sPrice <= currentPrice || bPrice >= currentPrice;
          if (!touchedByMarket) continue;
          pair = [b, s];
          break outer;
        }
      }
      if (!pair) break;

      try {
        const done = _settleMatch(pair[0], pair[1], currentPrice, fills);
        if (done) matchedCount += 1; else skipped += 1;
      } catch (err) {
        skipped += 1;
        errors.push(`撮合 pair 失败（跳过）：${err?.message || String(err)}`);
        break;                                                     // 防御异常死循环
      }
    }

    return { matched: matchedCount, skipped, errors, trades: Array.from(fills.keys()).length };
  }

  // ─────────────────────────────────────────────────────────────
  //  执行一对买卖的成交（支持部分成交）
  //  判定已在 _matchPass 完成：bPrice >= sPrice 且受市场价格驱动
  // ─────────────────────────────────────────────────────────────
  function _settleMatch(buyRaw, sellRaw, currentPrice, fills) {
    const now = clock();
    const bRemainUsdt = BigInt(buyRaw.input_usdt_units || '0');
    const sRemainA = BigInt(sellRaw.input_a_units || '0');
    if (bRemainUsdt <= 0n || sRemainA <= 0n) return false;

    const bWallet = String(buyRaw.wallet || '').toLowerCase();
    const sWallet = String(sellRaw.wallet || '').toLowerCase();
    if (!bWallet || !sWallet || bWallet === sWallet) return false;

    // 成交价 = 先挂一方的限价（maker 定价）
    const execPrice = Number(buyRaw.created_at) <= Number(sellRaw.created_at)
      ? BigInt(buyRaw.order_price_usdt_units)
      : BigInt(sellRaw.order_price_usdt_units);
    if (execPrice <= 0n) return false;

    // 费率快照：买入 0（2026-11-11 起）、卖出 5%（按成交 USDT 扣，进股东池）
    const bPayload = payloadOf(buyRaw);
    const sPayload = payloadOf(sellRaw);
    const sellFeeBps = BigInt(sPayload.feeRateBps ?? Number(SELL_FEE_BPS));

    // 本次成交数量：受买方剩余 USDT 与卖方剩余 A 双重约束
    let aFill = at.usdtToA(bRemainUsdt, execPrice);
    if (aFill > sRemainA) aFill = sRemainA;
    if (aFill <= 0n) return false;

    let usdtFill = at.aToUsdt(aFill, execPrice);
    if (usdtFill <= 0n) return false;
    if (usdtFill > bRemainUsdt) {
      // 反向换算产生的边界误差：按买方实际剩余收紧
      aFill = at.usdtToA(bRemainUsdt, execPrice);
      usdtFill = at.aToUsdt(aFill, execPrice);
      if (usdtFill <= 0n || usdtFill > bRemainUsdt) return false;
    }

    const sellRemainAfter = sRemainA - aFill;
    const buyRemainAfter = bRemainUsdt - usdtFill;

    // 双方手续费均按成交 USDT 金额计算
    const sellFee = usdtFill * sellFeeBps / BPS;      // 卖方手续费：从应收 USDT 中扣，全部进股东池
    const sellerNet = usdtFill - sellFee;
    // 兼容历史单：启动迁移后正常为 0；万一仍有存量 5% 托管，直接退回买家
    const legacyEscrow = BigInt(bPayload.buyFeeRemainingUnits || '0');
    if (legacyEscrow > 0n) at.creditUsdt(bWallet, legacyEscrow);
    const buyFee = 0n;                                // 买入 0 手续费

    const groupId = makeId('amt');

    // 1) 买家收 A（冻结的 USDT 直接核销给卖家）
    at.creditA(bWallet, aFill);
    // 2026-11-02 交易大厅买到的 SVX 同步计入驱动额度（1:1 数量），矿机匹配池可直接使用
    try { db.addATokenTurboQuota(bWallet, aFill); }
    catch (e) { console.error(`[交易] ${bWallet} 驱动额度累加失败:`, e?.message || e); }
    // 2) 卖家收 USDT（成交金额扣除 5% 手续费）
    at.creditUsdt(sWallet, sellerNet);
    // 3) 卖出手续费全部进股东池（买入 0，不再产生 buy_fee 记账）
    try {
      if (sellFee > 0n) shareholderService?.recordFee({ source: 'sell_fee', refId: `${groupId}:sell`, wallet: sWallet, usdtUnits: sellFee.toString(), payload: { orderId: sellRaw.id } });
      if (!shareholderService && sellFee > 0n) {
        console.error(`[交易] 股东池服务缺失，本次卖出手续费未入账 groupId=${groupId} sell=${sellFee}`);
      }
    } catch (e) {
      console.error(`[交易] 手续费入股东池失败 groupId=${groupId}:`, e?.message || e);
    }
    // 4) 成交量统计
    at.addVolume(aFill, usdtFill);

    // 写双方成交记录（各自视角；手续费口径为 USDT）
    const priceStr = formatUnits(execPrice, USDT_DECIMALS);
    db.insertATokenTradeRow({
      id: makeId('att'), wallet: bWallet, side: 'buy',
      priceUsdtUnits: execPrice.toString(),
      sizeUnits: aFill.toString(),
      amountUsdtUnits: usdtFill.toString(),
      feeUnits: buyFee.toString(), burnUnits: '0', dividendUnits: '0',
      createdAt: now,
      payload: { source: 'p2p_match', matchGroupId: groupId, orderId: buyRaw.id, counterOrderId: sellRaw.id, priceUsdt: priceStr, feeAsset: 'USDT' },
    });
    db.insertATokenTradeRow({
      id: makeId('att'), wallet: sWallet, side: 'sell',
      priceUsdtUnits: execPrice.toString(),
      sizeUnits: aFill.toString(),
      amountUsdtUnits: usdtFill.toString(),
      feeUnits: sellFee.toString(),
      burnUnits: '0',
      dividendUnits: '0',
      createdAt: now,
      payload: { source: 'p2p_match', matchGroupId: groupId, orderId: sellRaw.id, counterOrderId: buyRaw.id, priceUsdt: priceStr, feeAsset: 'USDT', netUsdtUnits: sellerNet.toString() },
    });

    // 更新两张订单的剩余冻结额度；剩余量低于灰尘阈值即视为该单已完成（尾差原路退回），
    // 否则最后一点点尾差会留成"挂单中"，下一轮被灰尘清理误标记为「已撤单」
    const buyDone = buyRemainAfter < DUST_USDT;
    const sellDone = sellRemainAfter < DUST_A;
    db.updateATokenOrderInputs(buyRaw.id, {
      inputUsdtUnits: buyDone ? '0' : buyRemainAfter.toString(),
      inputAUnits: '0', updatedAt: now,
    });
    db.updateATokenOrderPayload(buyRaw.id, {
      ...bPayload,
      buyFeeRateBps: 0, buyFeeUnits: '0', buyFeeRemainingUnits: '0',
    }, now);
    db.updateATokenOrderInputs(sellRaw.id, {
      inputUsdtUnits: '0',
      inputAUnits: sellDone ? '0' : sellRemainAfter.toString(),
      updatedAt: now,
    });
    if (buyDone) {
      if (buyRemainAfter > 0n) at.creditUsdt(bWallet, buyRemainAfter);   // 尾差（灰尘）原路退回
      db.markATokenOrderFilled(buyRaw.id, {
        fillPriceUsdtUnits: execPrice.toString(), fillTradeId: groupId, filledAt: now, updatedAt: now,
      });
    }
    if (sellDone) {
      if (sellRemainAfter > 0n) at.creditA(sWallet, sellRemainAfter);     // 尾差（灰尘）原路退回
      db.markATokenOrderFilled(sellRaw.id, {
        fillPriceUsdtUnits: execPrice.toString(), fillTradeId: groupId, filledAt: now, updatedAt: now,
      });
    }

    // 内存行同步（供本轮继续撮合 & 成交明细回传）
    buyRaw.status = buyDone ? 'FILLED' : 'OPEN';
    buyRaw.input_usdt_units = buyDone ? '0' : buyRemainAfter.toString();
    sellRaw.status = sellDone ? 'FILLED' : 'OPEN';
    sellRaw.input_a_units = sellDone ? '0' : sellRemainAfter.toString();

    // 下单响应明细累计
    const fmtU = u => formatUnits(u, USDT_DECIMALS);
    const fmtA2 = u => formatUnits(u, A_TOKEN_DECIMALS);
    // 累计用 BigInt 求和后再格式化：展示字段是带小数的字符串，若回读 BigInt('12.5') 会抛错
    // 并导致整轮撮合被 break 中断，故一律只对 sumUnits / sumUsdt / sumFee 等 BigInt 累加。
    const accBuy = fills.get(buyRaw.id) || {
      aReceived: '0', usdtPaid: '0', feeUsdt: '0', count: 0, sumUnits: 0n, sumUsdt: 0n, sumFee: 0n,
    };
    accBuy.sumUnits += aFill; accBuy.sumUsdt += usdtFill; accBuy.sumFee += buyFee; accBuy.count += 1;
    accBuy.aReceived = fmtA2(accBuy.sumUnits);
    accBuy.usdtPaid = fmtU(accBuy.sumUsdt);
    accBuy.feeUsdt = fmtU(accBuy.sumFee || 0n);
    accBuy.avgPrice = accBuy.sumUnits > 0n ? fmtU(accBuy.sumUsdt * 1_000000000000000000n / accBuy.sumUnits, USDT_DECIMALS) : null;
    fills.set(buyRaw.id, accBuy);

    const accSell = fills.get(sellRaw.id) || {
      aSold: '0', usdtReceived: '0', feeUsdt: '0', count: 0, sumUnits: 0n, sumUsdt: 0n, sumFee: 0n,
    };
    accSell.sumUnits += aFill; accSell.sumUsdt += sellerNet; accSell.sumFee += sellFee; accSell.count += 1;
    accSell.aSold = fmtA2(accSell.sumUnits);
    accSell.usdtReceived = fmtU(accSell.sumUsdt);
    accSell.feeUsdt = fmtU(accSell.sumFee || 0n);
    accSell.avgPrice = accSell.sumUnits > 0n ? fmtU(accSell.sumUsdt * 1_000000000000000000n / accSell.sumUnits, USDT_DECIMALS) : null;
    fills.set(sellRaw.id, accSell);

    return true;
  }

  // ─────────────────────────────────────────────────────────────
  //  公开撮合入口（K线 tick / 管理后台手动触发）
  // ─────────────────────────────────────────────────────────────
  function matchOpenOrders() {
    return _matchPass(new Map());
  }

  // ─────────────────────────────────────────────────────────────
  //  我的冻结：OPEN 委托占用中的 USDT / A（资产条展示「可用 + 冻结中」）
  // ─────────────────────────────────────────────────────────────
  function myLocks(wallet) {
    const locks = db.sumATokenLockedByWallet(String(wallet || '').toLowerCase());
    return {
      usdt: formatUnits(BigInt(locks.usdtUnits), USDT_DECIMALS),
      a: formatUnits(BigInt(locks.aUnits), A_TOKEN_DECIMALS),
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  委托簿深度：求购总额（顶部「委托求购额度」展示数据源）
  // ─────────────────────────────────────────────────────────────
  function depth() {
    let openBuyUsdtUnits = 0n;
    let openBuyCount = 0n;
    let openSellANet = 0n;
    let openSellCount = 0n;
    try {
      for (const r of db.listATokenOpenOrders()) {
        if (String(r.side) === 'buy') {
          const u = BigInt(r.input_usdt_units || '0');
          if (u > 0n) { openBuyUsdtUnits += u; openBuyCount += 1n; }
        } else {
          const net = _sellNetA(r);
          if (net > 0n) { openSellANet += net; openSellCount += 1n; }
        }
      }
    } catch {}
    return {
      openBuyUsdt: formatUnits(openBuyUsdtUnits, USDT_DECIMALS),
      openBuyCount: Number(openBuyCount),
      openSellCount: Number(openSellCount),
      openSellA: formatUnits(openSellANet, A_TOKEN_DECIMALS),
    };
  }

  // 卖单可成交 A = 冻结量本身（2026-11-09 起卖出手续费改按 USDT 金额扣除，不再从币里扣）
  function _sellNetA(row) {
    return BigInt(row.input_a_units || '0');
  }

  // ─────────────────────────────────────────────────────────────
  //  真实 P2P 盘口：按价位聚合（同价同向合并为一档，不含地址）
  //   bids 价高在前 / asks 价低在前；每档附带 top（金额降序前 5 笔明细）
  // ─────────────────────────────────────────────────────────────
  function orderbook({ limit = 20 } = {}) {
    // 按价位聚合：同价同向委托合并为一档；每档附带 top：按金额降序的前 5 笔明细（前端展开显示）
    const bidMap = new Map();   // price -> { price, a, usdt, top: [] }
    const askMap = new Map();
    try {
      for (const r of db.listATokenOpenOrders()) {
        if (String(r.status) !== 'OPEN') continue;
        const price = BigInt(r.order_price_usdt_units || '0');
        if (price <= 0n) continue;
        if (String(r.side) === 'buy') {
          const u = BigInt(r.input_usdt_units || '0');
          if (u <= 0n) continue;
          const row = bidMap.get(price) || { price, a: 0n, usdt: 0n, top: [] };
          const a = at.usdtToA(u, price);
          row.a += a;
          row.usdt += u;
          row.top.push({ a, usdt: u });
          bidMap.set(price, row);
        } else if (String(r.side) === 'sell') {
          const netA = _sellNetA(r);
          if (netA <= 0n) continue;
          const u = at.aToUsdt(netA, price);
          const row = askMap.get(price) || { price, a: 0n, usdt: 0n, top: [] };
          row.a += netA;
          row.usdt += u;
          row.top.push({ a: netA, usdt: u });
          askMap.set(price, row);
        }
      }
    } catch {}
    const bidRows = [...bidMap.values()];
    const askRows = [...askMap.values()];

    const fmtRow = r => ({
      price: formatUnits(r.price, USDT_DECIMALS),
      size: formatUnits(r.a, A_TOKEN_DECIMALS),
      usdt: formatUnits(r.usdt, USDT_DECIMALS),
      count: (r.top || []).length,
      top: (r.top || [])
        .sort((x, y) => (y.usdt > x.usdt ? 1 : y.usdt < x.usdt ? -1 : 0))
        .slice(0, 5)
        .map(t => ({ size: formatUnits(t.a, A_TOKEN_DECIMALS), usdt: formatUnits(t.usdt, USDT_DECIMALS) })),
    });
    // bids 价高在前；asks 价低在前（最优报价在前；JS sort 稳定，同价保持提交先后）
    const byPriceDesc = (x, y) => x.price > y.price ? -1 : x.price < y.price ? 1 : 0;
    const byPriceAsc  = (x, y) => x.price > y.price ? 1 : x.price < y.price ? -1 : 0;
    bidRows.sort(byPriceDesc);
    askRows.sort(byPriceAsc);
    const bids = bidRows.slice(0, limit).map(fmtRow);
    const asks = askRows.slice(0, limit).map(fmtRow);
    return {
      bids, asks,
      bestBid: bids[0]?.price || null,
      bestAsk: asks[0]?.price || null,
      markPrice: formatUnits(at.getPriceUsdtUnits(), USDT_DECIMALS),
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  挂单明细：逐笔列出当前 OPEN 委托（不包含钱包地址，公开可看）
  //  买单展示：挂单价 / 委托 USDT 金额 / 按挂单价可买 SVX 数量
  //  卖单展示：挂单价 / 委托卖出 SVX 数量（含费冻结额）/ 可成交净 A / 折合 USDT
  // ─────────────────────────────────────────────────────────────
  function openOrders({ limit = 50 } = {}) {
    const rows = [];
    // 挂单中的市价单「委托价跟随现价」：展示用当前币价，不依赖撮合轮刷新（限价单用用户指定价）
    const livePrice = at.getPriceUsdtUnits();
    try {
      for (const r of db.listATokenOpenOrders()) {
        if (String(r.status) !== 'OPEN') continue;
        const isMarket = String(r.order_type || 'market') === 'market';
        const price = isMarket && livePrice > 0n ? livePrice : BigInt(r.order_price_usdt_units || '0');
        if (price <= 0n) continue;
        const isBuy = String(r.side) === 'buy';
        if (isBuy) {
          const remainUsdt = BigInt(r.input_usdt_units || '0');
          if (remainUsdt <= 0n) continue;
          rows.push({
            side:'buy',
            orderType:String(r.order_type || 'market'),
            priceUsdt:formatUnits(price, USDT_DECIMALS),
            amountUsdt:formatUnits(remainUsdt, USDT_DECIMALS),
            sizeA:formatUnits(at.usdtToA(remainUsdt, price), A_TOKEN_DECIMALS),
            createdAt:Number(r.created_at),
          });
        } else {
          const remainA = BigInt(r.input_a_units || '0');
          if (remainA <= 0n) continue;
          const netA = _sellNetA(r);
          rows.push({
            side:'sell',
            orderType:String(r.order_type || 'market'),
            priceUsdt:formatUnits(price, USDT_DECIMALS),
            sizeA:formatUnits(remainA, A_TOKEN_DECIMALS),
            netA:formatUnits(netA, A_TOKEN_DECIMALS),
            amountUsdt:formatUnits(at.aToUsdt(netA, price), USDT_DECIMALS),
            createdAt:Number(r.created_at),
          });
        }
      }
    } catch {}
    // 买盘价高在前、卖盘价低在前；同价新单在前
    rows.sort((a, b) => {
      if (a.side !== b.side) return a.side === 'buy' ? -1 : 1;
      if (a.priceUsdt !== b.priceUsdt) {
        const cmp = Number(a.priceUsdt) - Number(b.priceUsdt);
        return a.side === 'buy' ? -cmp : cmp;
      }
      return b.createdAt - a.createdAt;
    });
    return {
      count:rows.length,
      buys:rows.filter(r => r.side === 'buy').slice(0, limit),
      sells:rows.filter(r => r.side === 'sell').slice(0, limit),
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  撤单：OPEN 订单 → 冻结原路退回 + 状态改 CANCELLED
  // ─────────────────────────────────────────────────────────────
  function cancelOrder({ wallet, orderId, reason = 'user_cancelled' }) {
    wallet = String(wallet || '').toLowerCase();
    if (!wallet) throw new Error('钱包地址必填');
    const order = db.getATokenOrder(String(orderId));
    if (!order) throw new Error('订单不存在');
    if (String(order.wallet || '').toLowerCase() !== wallet) throw new Error('非本人订单，无法撤单');
    if (order.status !== 'OPEN') throw new Error(`订单状态为 ${order.status}，仅 OPEN 状态可撤单`);

    const now = clock();
    _refundLocked(order);
    const info = db.markATokenOrderCancelled(order.id, { cancelledAt: now, updatedAt: now, reason });
    if (!info.changes) throw new Error('撤单失败，订单可能已成交/撤单');
    return {
      ok: true, orderId: order.id, orderStatus: 'CANCELLED',
      refundUsdt: order.input_usdt_units ? formatUnits(BigInt(order.input_usdt_units), USDT_DECIMALS) : '0',
      refundA: order.input_a_units ? formatUnits(BigInt(order.input_a_units), A_TOKEN_DECIMALS) : '0',
      cancelledAt: now,
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  我的委托列表
  // ─────────────────────────────────────────────────────────────
  function myOrders({ wallet, limit = 100 }) {
    wallet = String(wallet || '').toLowerCase();
    if (!wallet) return [];
    // 一次拉取该钱包成交流水，按 orderId 聚合累计成交量。
    // 订单表 input_a_units/input_usdt_units 是“剩余冻结量”，成交后归零，不能当作委托/成交数量展示
    const fillAgg = new Map();
    try {
      for (const t of db.listATokenTradesByWallet(wallet, 5000)) {
        const oid = String(t.payload?.orderId || '');
        if (!oid) continue;
        const cur = fillAgg.get(oid) || { a: 0n, usdt: 0n };
        cur.a += BigInt(t.sizeUnits || '0');
        cur.usdt += BigInt(t.amountUsdtUnits || '0');
        fillAgg.set(oid, cur);
      }
    } catch {}
    return db.listATokenOrdersByWallet(wallet, limit)
      .map(r => mapOrderToReadable(r, fillAgg.get(r.id)));
  }

  // ─────────────────────────────────────────────────────────────
  //  小工具：DB 行 → 人类可读字段
  // ─────────────────────────────────────────────────────────────
  function mapOrderToReadable(r, agg = null) {
    // 挂单中（OPEN）的市价单「委托价跟随现价」：直接按当前币价展示，
    // 不依赖撮合轮刷新（撮合由 K 线 tick 驱动，manual 模式下不会跑）。
    // 限价单保持用户指定价；已结束（FILLED/CANCELLED）的市价单保留历史价。
    const liveMarketPrice = String(r.status) === 'OPEN' && String(r.order_type) === 'market'
      ? at.getPriceUsdtUnits() : 0n;
    return {
      orderId: r.id,
      wallet: r.wallet,
      side: r.side,
      orderType: r.order_type,
      orderStatus: r.status,
      orderPriceUsdt: liveMarketPrice > 0n
        ? formatUnits(liveMarketPrice, USDT_DECIMALS)
        : (r.order_price_usdt_units ? formatUnits(BigInt(r.order_price_usdt_units), USDT_DECIMALS) : null),
      inputUsdt: formatUnits(BigInt(r.input_usdt_units || '0'), USDT_DECIMALS),
      inputA: formatUnits(BigInt(r.input_a_units || '0'), A_TOKEN_DECIMALS),
      // 累计成交量（多次部分成交聚合）；FILLED 订单的委托量应看这里，input* 已归零
      filledA: formatUnits(BigInt(agg?.a || 0n), A_TOKEN_DECIMALS),
      filledUsdt: formatUnits(BigInt(agg?.usdt || 0n), USDT_DECIMALS),
      fillPriceUsdt: r.fill_price_usdt_units ? formatUnits(BigInt(r.fill_price_usdt_units), USDT_DECIMALS) : null,
      tradeId: r.fill_trade_id || null,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      filledAt: r.filled_at ? Number(r.filled_at) : null,
      cancelledAt: r.cancelled_at ? Number(r.cancelled_at) : null,
      cancelReason: r.cancel_reason || null,
    };
  }

  function stats() {
    return {
      openOrders: db.countATokenOrdersByStatus('OPEN'),
      filledOrders: db.countATokenOrdersByStatus('FILLED'),
      cancelledOrders: db.countATokenOrdersByStatus('CANCELLED'),
    };
  }

  // 手续费档案：买入 0、卖出 5%（按成交 USDT 金额；卖方从应收中扣）
  function sellFeeProfile(wallet) {
    const directCount = minerDirectCountOf(wallet);
    return {
      feeRateBps: Number(SELL_FEE_BPS), feePct: '5%',
      buyFeeRateBps: 0, buyFeePct: '0%',
      directCount,
    };
  }

  // 流通额度（2026-10-31 匹配池规则）：只有经匹配池转换的流通额度可以卖；挂单占用、撤单返还
  function sellQuota(wallet) {
    const q = db.getATokenUsableQuota(String(wallet || '').toLowerCase());
    const released = BigInt(q.releasedUnits);
    const used = BigInt(q.usedUnits);
    const available = released > used ? released - used : 0n;
    return {
      released: formatUnits(released, A_TOKEN_DECIMALS),
      used: formatUnits(used, A_TOKEN_DECIMALS),
      available: formatUnits(available, A_TOKEN_DECIMALS),
      releasedUnits: released.toString(),
      usedUnits: used.toString(),
      availableUnits: available.toString(),
    };
  }

  return {
    placeOrder, cancelOrder, myOrders,
    quoteLimitOrder, matchOpenOrders, orderbook, openOrders, depth, stats, myLocks, sellFeeProfile, sellQuota,
  };
}
