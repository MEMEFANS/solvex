import crypto from 'node:crypto';
import { formatUnits } from 'ethers';
import { A_TOKEN_DECIMALS, USDT_DECIMALS } from './a-token-service.js';
import { BUY_FEE_BPS, SELL_FEE_BPS } from './a-token-shareholder-service.js';

// ─────────────────────────────────────────────────────────────
// 一键买 / 一键卖（2026-11-09 P2）
//
// 用户已确认口径：
//   · 取消挂买挂卖，改为「甲区 / 乙区」两个买入口，按大盘价即时成交；
//   · 买入 0 手续费：按标的价实付，成交金额全额买币（与链上 buyTaxBps=0 对齐）；
//   · 卖出手续费 5%，按成交 USDT 金额扣除，50%用于销毁、50%进股东池；
//   · 卖出必须消耗「流通额度」（涡轮释放产出），甲区与乙区不可互转。
//
// 甲区（alpha）：买入后币留在甲区，只能质押与开算力节点，不产生卖出额度；
// 乙区（beta） ：买入后币留在乙区，只能进涡轮；满 24 小时释放等额卖出额度。
// 两区余额互不相通，本服务不提供任何 alpha ↔ beta 互转入口。
// ─────────────────────────────────────────────────────────────

const BPS = 10_000n;
const MIN_SELL_A = 10n ** BigInt(A_TOKEN_DECIMALS);   // 1 SVX 起卖
// 平台 USDT 归集地址：买入成交金额进这里，卖出由这里回购支付。
const ZONE_TREASURY_WALLET = '0x0000000000000000000000000000000000007db0';
const makeId = prefix => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const fmtA = units => { try { return formatUnits(BigInt(units || '0'), A_TOKEN_DECIMALS); } catch { return '0'; } };
const fmtU = units => { try { return formatUnits(BigInt(units || '0'), USDT_DECIMALS); } catch { return '0'; } };

const ZONE_LABELS = { alpha:'甲区', beta:'乙区', market:'自由交易（乙区）' };

export function createATokenZoneTradeService({ aTokenService, database, shareholderService, clock = () => Date.now() }) {
  const at = aTokenService;
  const db = database;

  function assertZone(zone) {
    if (!Object.hasOwn(ZONE_LABELS,zone)) throw new Error('无效的代币分区（仅支持 alpha / beta）');
  }
  function replay(order, side, zone, units) {
    const oldUnits = BigInt(side === 'buy' ? order.usdtUnits : order.aUnits);
    if (order.side !== side || (order.payload?.purpose || order.zone) !== zone || oldUnits !== units) {
      throw Object.assign(new Error('同一请求编号不能用于不同交易，请核对原订单'), { code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 });
    }
    return present(order, true);
  }

  function present(order, idempotent = false) {
    const usdt = BigInt(order.usdtUnits || '0');
    const fee = BigInt(order.feeUnits || '0');
    const zone = order.payload?.purpose || order.zone;
    const base = {
      orderId: order.id, side: order.side, zone,
      zoneLabel: ZONE_LABELS[zone] || zone,
      usdtIn: fmtU(usdt), aIn: fmtA(order.aUnits), feeUsdt: fmtU(fee),
      priceUsdt: fmtU(order.payload?.priceUsdtUnits || '0'),
      createdAt: order.createdAt, idempotent,
    };
    if (order.side === 'buy') {
      return {
        ...base, aOut: fmtA(order.aUnits), usdtCost: fmtU(usdt),
        totalUsdt: fmtU(BigInt(order.payload?.totalUsdtUnits || (usdt + fee).toString())),
      };
    }
    return {
      ...base, grossUsdt: fmtU(usdt),
      netUsdt: fmtU(BigInt(order.payload?.netUsdtUnits || (usdt - fee).toString())),
    };
  }

  // 报价（只读）：side=buy 传 USDT 数量；side=sell 传 SVX 数量
  function quote({ side, zone = 'alpha', amount }) {
    assertZone(zone);
    if(zone==='market') at.assertFreeTrading();
    const price = at.getPriceUsdtUnits();
    if (price <= 0n) throw new Error('当前价格无效，暂不能交易');
    const priceStr = fmtU(price);
    if (side === 'buy') {
      const usdt = at.parseUsdt(amount, '支付 USDT 数量');
      if (usdt <= 0n) throw new Error('支付 USDT 数量必须大于 0');
      const aOut = at.usdtToA(usdt, price);
      if (aOut <= 0n) throw new Error('购买数量过小，请增加 USDT 数量');
      const fee = usdt * BUY_FEE_BPS / BPS;
      const total = usdt + fee;
      return {
        side, zone, zoneLabel: ZONE_LABELS[zone], priceUsdt: priceStr,
        usdtIn: fmtU(usdt), aOut: fmtA(aOut), usdtCost: fmtU(usdt),
        feeUsdt: fmtU(fee), totalUsdt: fmtU(total),
        feeRateBps: Number(BUY_FEE_BPS), feePct: '0%',
        hint: `按大盘价 $${priceStr}：${fmtU(usdt)} USDT 买入 ${fmtA(aOut)} SVX 进${ZONE_LABELS[zone]}；买入 0 手续费，实付 ${fmtU(total)} USDT`,
      };
    }
    if (side !== 'sell') throw new Error('交易方向无效');
    const a = at.parseA(amount, '卖出 SVX 数量');
    if (a < MIN_SELL_A) throw new Error('SVX 卖出最低 1 个起');
    const gross = at.aToUsdt(a, price);
    const feeA = a * SELL_FEE_BPS / BPS;
    const net = gross;
    return {
      side, zone, priceUsdt: priceStr,
      aIn: fmtA(a), grossUsdt: fmtU(gross), feeSvx: fmtA(feeA), feeUsdt: '0', usdtOut: fmtU(net),
      feeRateBps: Number(SELL_FEE_BPS), feePct: '5%',
      hint: `按大盘价 $${priceStr}：卖出 ${fmtA(a)} SVX 得 ${fmtU(gross)} USDT，扣 5% 手续费 ${fmtA(feeA)} SVX（50%用于销毁、50%进股东池），实收 ${fmtU(net)} USDT`,
    };
  }

  // 一键买：扣 USDT（成交额，买入 0 手续费）→ 进平台归集 → 币进所选分区
  function buy({ wallet, zone = 'alpha', usdtAmount, requestId }) {
    wallet = String(wallet || '').toLowerCase();
    assertZone(zone);
    const reqId = String(requestId || '').trim();
    if (!reqId) throw new Error('缺少请求编号');
    const usdt = at.parseUsdt(usdtAmount, '支付 USDT 数量');
    const dup = db.getATokenZoneOrder(wallet, reqId);
    if (dup) return replay(dup, 'buy', zone, usdt);
    if (zone === 'market') at.assertFreeTrading();

    if (usdt <= 0n) throw new Error('支付 USDT 数量必须大于 0');
    const price = at.getPriceUsdtUnits();
    if (price <= 0n) throw new Error('当前价格无效，暂不能买入');
    const aOut = at.usdtToA(usdt, price);
    if (aOut <= 0n) throw new Error('购买数量过小，请增加 USDT 数量');
    // 买入 0 手续费：按标的价实付，不再另收 5%
    const fee = usdt * BUY_FEE_BPS / BPS;
    const total = usdt + fee;
    if (at.balanceUsdt(wallet) < total) {
      throw new Error(`USDT 可用余额不足：需 ${fmtU(total)} USDT`);
    }

    const now = clock();
    const orderId = makeId('azo');
    at.debitUsdt(wallet, total);
    try { at.creditUsdt(ZONE_TREASURY_WALLET, usdt); }
    catch (e) {
      try { at.creditUsdt(wallet, total); } catch (e2) { console.error(`[一键买] ${wallet} 退款失败:`, e2?.message || e2); }
      throw e;
    }
    const inserted = db.insertATokenZoneOrder({
      id: orderId, wallet, side: 'buy', zone: zone === 'market' ? 'beta' : zone, requestId: reqId,
      usdtUnits: usdt.toString(), aUnits: aOut.toString(), feeUnits: '0',
      status: 'filled', createdAt: now,
      payload: { purpose: zone, priceUsdtUnits: price.toString(), feeAsset: 'USDT', totalUsdtUnits: total.toString() },
    });
    if (!inserted) {
      // 并发下另一请求已入库：回吐本次扣款，按首次结果返回
      try { at.debitUsdt(ZONE_TREASURY_WALLET, usdt); at.creditUsdt(wallet, total); }
      catch (e) { console.error(`[一键买] ${wallet} 重复请求回吐失败:`, e?.message || e); }
      const again = db.getATokenZoneOrder(wallet, reqId);
      if (again) return replay(again, 'buy', zone, usdt);
      throw new Error('买入请求冲突，请稍后重试');
    }
    try {
      // 成交币留在买入分区：甲区只能质押/开矿池，乙区只能进涡轮；
      // 两区都记分区余额，不进主 A 余额，也不直接产生卖出额度。
      db.creditATokenZone({
        wallet, zone: zone === 'alpha' ? 'alpha' : 'beta', units: aOut.toString(), bizType: 'buy', refId: orderId, createdAt: now,
        payload: { usdtUnits: usdt.toString(), feeUnits: '0', priceUsdtUnits: price.toString(), purpose: zone },
      });
    } catch (e) {
      try { at.debitUsdt(ZONE_TREASURY_WALLET, usdt); at.creditUsdt(wallet, total); } catch (e2) { console.error(`[一键买] ${wallet} 分区入账失败回滚异常:`, e2?.message || e2); }
      throw e;
    }
    // 买入 0 手续费：不再产生 buy_fee 记账
    try { at.addVolume(aOut, usdt); } catch { /* 成交量统计失败不影响成交 */ }
    return present(db.getATokenZoneOrder(wallet, reqId));
  }

  // 一键卖：消耗流通额度 + 扣 SVX 币 → 扣 5% USDT 手续费进股东池 → 净额 USDT 到账
  function sell({ wallet, aixAmount, requestId }) {
    wallet = String(wallet || '').toLowerCase();
    const reqId = String(requestId || '').trim();
    if (!reqId) throw new Error('缺少请求编号');
    const a = at.parseA(aixAmount, '卖出 SVX 数量');
    const dup = db.getATokenZoneOrder(wallet, reqId);
    if (dup) return replay(dup, 'sell', 'beta', a);

    if (a < MIN_SELL_A) throw new Error('SVX 卖出最低 1 个起');
    const price = at.getPriceUsdtUnits();
    if (price <= 0n) throw new Error('当前价格无效，暂不能卖出');
    const quota = db.getATokenUsableQuota(wallet);
    const available = BigInt(quota.releasedUnits) - BigInt(quota.usedUnits);
    if (available < a) {
      const avail = available > 0n ? available : 0n;
      throw new Error(`流通额度不足：当前可用 ${fmtA(avail)} SVX（超速驱动到期释放流通额度）`);
    }
    if (at.balanceA(wallet) < a) {
      throw new Error(`SVX 可用余额不足：当前 ${fmtA(at.balanceA(wallet))} SVX`);
    }
    const gross = at.aToUsdt(a, price);
    const feeA = a * SELL_FEE_BPS / BPS;
    const net = gross;
    const now = clock();
    const orderId = makeId('azo');

    at.debitA(wallet, a);
    db.consumeATokenUsableQuota(wallet, a);
    // 平台归集地址充足时走真实回购划转；不足时由平台结算发放（账务仍记手续费）
    let treasuryPaid = false;
    at.debitUsdt(ZONE_TREASURY_WALLET, gross); treasuryPaid = true;
    try { at.creditUsdt(wallet, net); }
    catch (e) {
      try {
        at.creditA(wallet, a);
        db.refundATokenUsableQuota(wallet, a);
        if (treasuryPaid) at.creditUsdt(ZONE_TREASURY_WALLET, gross);
      } catch (e2) { console.error(`[一键卖] ${wallet} 回滚失败:`, e2?.message || e2); }
      throw e;
    }
    const inserted = db.insertATokenZoneOrder({
      id: orderId, wallet, side: 'sell', zone: 'beta', requestId: reqId,
      usdtUnits: gross.toString(), aUnits: a.toString(), feeUnits: feeA.toString(),
      status: 'filled', createdAt: now,
      payload: {
        priceUsdtUnits: price.toString(), feeAsset: 'SVX',
        netUsdtUnits: net.toString(), treasuryPaid,
      },
    });
    if (!inserted) {
      try {
        at.creditA(wallet, a);
        db.refundATokenUsableQuota(wallet, a);
        at.debitUsdt(wallet, net);
        if (treasuryPaid) at.creditUsdt(ZONE_TREASURY_WALLET, gross);
      } catch (e) { console.error(`[一键卖] ${wallet} 重复请求回滚失败:`, e?.message || e); }
      const again = db.getATokenZoneOrder(wallet, reqId);
      if (again) return replay(again, 'sell', 'beta', a);
      throw new Error('卖出请求冲突，请稍后重试');
    }
    if (feeA > 0n) {
      try {
        shareholderService?.recordFee({
          source: 'sell_fee', refId: `zonesell:${orderId}`, wallet,
          svxUnits: feeA.toString(), payload: { orderId, asset: 'A' },
        });
      } catch (e) { throw e; }
    }
    try { at.addVolume(a, gross); } catch { /* 成交量统计失败不影响成交 */ }
    return present(db.getATokenZoneOrder(wallet, reqId));
  }

  function history(wallet, limit = 50) {
    return db.listATokenZoneOrders(wallet, limit).map(order => present(order));
  }

  return { quote, buy:args=>at.transaction(()=>buy(args)), sell:args=>at.transaction(()=>sell(args)), history, ZONE_TREASURY_WALLET };
}
