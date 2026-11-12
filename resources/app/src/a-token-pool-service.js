import { formatUnits } from 'ethers';
import { A_TOKEN_DECIMALS, USDT_DECIMALS } from './a-token-service.js';
import { BUY_FEE_BPS } from './a-token-shareholder-service.js';

// SVX池报价服务：仅供交易页市价单的费用/到账预估（只读，不执行交易）。
// 实际买卖一律走挂单撮合（order-service），历史 AMM 即时买卖已移除。
const BPS = 10000n;

export function createATokenPoolService({ aTokenService, sellFeeProfile = null }) {
  // 报价（不执行）：side='buy' 传入 USDT 数量；side='sell' 传入 A 数量
  // wallet 传入时，卖方手续费按该钱包的直推阶梯费率（与挂单撮合一致）
  function quote(side, inputAmount, wallet = '') {
    if (side !== 'buy' && side !== 'sell') throw new Error('交易方向无效');
    const price = aTokenService.getPriceUsdtUnits();
    const meta = aTokenService.getPoolMeta();
    let feeRateBps = BigInt(meta.feeRateBps || 0);
    let directCount = null;
    if (wallet && typeof sellFeeProfile === 'function') {
      try {
        const p = sellFeeProfile(wallet);
        if (p?.feeRateBps != null) {
          feeRateBps = BigInt(p.feeRateBps);
          directCount = p.directCount ?? null;
        }
      } catch { /* 阶梯费率获取失败时退回 meta 费率 */ }
    }
    const priceStr = formatUnits(price, USDT_DECIMALS);
    if (side === 'buy') {
      const usdt = aTokenService.parseUsdt(inputAmount, 'USDT 数量');
      const aReceive = aTokenService.usdtToA(usdt, price);
      const feeUsdt = usdt * BUY_FEE_BPS / BPS;   // 买入 0 手续费：按标的价实付
      return {
        side, priceUsdt: priceStr,
        usdtIn: formatUnits(usdt, USDT_DECIMALS),
        aOut: formatUnits(aReceive, A_TOKEN_DECIMALS),
        feeUsdt: formatUnits(feeUsdt, USDT_DECIMALS),
        totalUsdt: formatUnits(usdt + feeUsdt, USDT_DECIMALS),
        feeA: '0', burnA: '0', dividendA: '0',
        feeRateBps: Number(BUY_FEE_BPS), feePct: '0%',
      };
    }
    const a = aTokenService.parseA(inputAmount, 'SVX数量');
    // 卖方 5%：按成交 USDT 金额从应收里扣，币数不扣；全部进股东池
    const grossUsdt = aTokenService.aToUsdt(a, price);
    const feeUsdt = grossUsdt * feeRateBps / BPS;
    return {
      side, priceUsdt: priceStr,
      aIn: formatUnits(a, A_TOKEN_DECIMALS),
      aNet: formatUnits(a, A_TOKEN_DECIMALS),
      grossUsdt: formatUnits(grossUsdt, USDT_DECIMALS),
      usdtOut: formatUnits(grossUsdt - feeUsdt, USDT_DECIMALS),
      feeUsdt: formatUnits(feeUsdt, USDT_DECIMALS),
      feeA: '0', burnA: '0', dividendA: '0',
      feeRateBps: Number(feeRateBps),
      feePct: (Number(feeRateBps) / 100).toFixed(0) + '%',
      directCount,
    };
  }

  return { quote, stats: () => aTokenService.poolStats() };
}
