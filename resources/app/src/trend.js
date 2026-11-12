// Market regime detection from OHLCV candles.
import { ema, atr, normalizedSlope } from './indicators.js';

/**
 * Analyse candles and classify the market regime.
 * candles: chronological [{time, open, high, low, close, volume}]
 *
 * Logic: combine an EMA(fast) vs EMA(slow) regime filter with a linear-
 * regression slope confirmation. Volatility (ATR%) is reported as a risk gauge.
 *
 * Returns:
 *  trend:        'up' | 'down' | 'range'
 *  recommended:  'long' | 'short' | 'neutral'
 *  strength:     0..1 confidence
 *  atrPct:       ATR as % of price (volatility gauge)
 *  detail:       human-readable explanation (Chinese)
 */
export function analyzeTrend(candles, opts = {}) {
  const fast = opts.fast ?? 20;
  const slow = opts.slow ?? 50;
  const slopeBars = opts.slopeBars ?? 20;
  // Slope above this (fraction/bar) counts as a real trend, not noise.
  const slopeThreshold = opts.slopeThreshold ?? 0.0015;

  const closes = candles.map((c) => c.close).filter((v) => Number.isFinite(v));
  const candleClose = closes[closes.length - 1];
  const livePrice = Number(opts.currentPrice);
  const price = livePrice > 0 ? livePrice : candleClose;

  if (closes.length < slow + 1) {
    return {
      trend: 'range', recommended: 'neutral', strength: 0,
      atrPct: null, price, candleClose,
      detail: `K线样本不足（需要至少 ${slow + 1} 根，当前 ${closes.length} 根），默认中性网格。`,
    };
  }

  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const slope = normalizedSlope(closes, slopeBars); // fraction per bar
  const a = atr(candles, 14);
  const atrPct = a && price ? (a / price) * 100 : null;

  const emaGapPct = ((emaFast - emaSlow) / emaSlow) * 100;
  const up = emaFast > emaSlow && slope > slopeThreshold;
  const down = emaFast < emaSlow && slope < -slopeThreshold;

  // Strength: blend of slope magnitude and EMA separation, clamped to 0..1.
  const strength = Math.min(
    1,
    (Math.abs(slope) / (slopeThreshold * 4)) * 0.6 +
      (Math.abs(emaGapPct) / 3) * 0.4
  );

  let trend, recommended, detail;
  if (up) {
    trend = 'up'; recommended = 'long';
    detail = `上升趋势：EMA${fast} 在 EMA${slow} 之上（差 ${emaGapPct.toFixed(2)}%），斜率 +${(slope * 100).toFixed(3)}%/根。多头结构延续时，回调可关注支撑。`;
  } else if (down) {
    trend = 'down'; recommended = 'short';
    detail = `下降趋势：EMA${fast} 在 EMA${slow} 之下（差 ${emaGapPct.toFixed(2)}%），斜率 ${(slope * 100).toFixed(3)}%/根。空头结构延续时，反弹可关注压力。`;
  } else {
    trend = 'range'; recommended = 'neutral';
    detail = `震荡/无明显趋势：EMA 差 ${emaGapPct.toFixed(2)}%，斜率 ${(slope * 100).toFixed(3)}%/根。区间内高抛低吸更依赖执行纪律。`;
  }

  const volNote = atrPct != null
    ? ` 波动率 ATR≈${atrPct.toFixed(2)}%，可作为止损与目标间距的参考。`
    : '';

  return {
    trend, recommended,
    strength: Number(strength.toFixed(2)),
    atrPct: atrPct != null ? Number(atrPct.toFixed(3)) : null,
    price, candleClose,
    emaFast, emaSlow,
    slopePct: Number((slope * 100).toFixed(4)),
    detail: detail + volNote,
  };
}
