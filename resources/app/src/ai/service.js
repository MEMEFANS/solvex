// Deterministic, read-only market analysis based on public exchange candles.
// No model, cloud API, bot or exchange account is involved.
import { notify, getAiConfig } from './provider.js';
import { analyzeTrend } from '../trend.js';

const SYMBOLS = ['BTC', 'ETH'];
const round = (n, d = 2) => Number.isFinite(Number(n)) ? Number(Number(n).toFixed(d)) : null;
const pct = (n) => `${round(Number(n) || 0, 2)}%`;

export function createAiService({ fetchCandles, fetchSpotCandles }) {
  return new RuleAnalysisService({ fetchCandles, fetchSpotCandles });
}

class RuleAnalysisService {
  constructor({ fetchCandles, fetchSpotCandles }) {
    this.fetchCandles = fetchCandles;
    this.fetchSpotCandles = fetchSpotCandles;
    this.market = null;
    this.marketError = null;
    this.report = null;
    this._busy = { market: false, report: false };
    this._lastMarketAt = 0;
    this._reportDoneDay = null;
  }

  start() {
    this._timer = setInterval(() => this._tick().catch(() => {}), 60_000);
    this._timer.unref?.();
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  async _tick() {
    const cfg = getAiConfig();
    const now = Date.now();
    const lastMarket = Math.max(this._lastMarketAt, this.market?.t || 0);
    if (cfg.marketMin > 0 && now - lastMarket >= cfg.marketMin * 60_000) {
      this._lastMarketAt = now;
      await this.runMarketAnalysis().catch(() => {});
    }
    const d = new Date(), day = d.toISOString().slice(0, 10);
    if (cfg.reportHour >= 0 && d.getHours() === cfg.reportHour && this._reportDoneDay !== day) {
      this._reportDoneDay = day;
      await this.makeReport().catch(() => {});
    }
  }

  _symbol(value) {
    const raw = String(value || 'BTC').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const symbol = raw.endsWith('USDT') ? raw.slice(0, -4) : raw;
    if (!/^[A-Z0-9]{2,12}$/.test(symbol)) throw new Error('分析标的格式不正确');
    return symbol;
  }

  async _candles(symbol, sec) {
    if (typeof this.fetchSpotCandles === 'function') {
      try {
        const list = await this.fetchSpotCandles(symbol, sec, 200);
        if (Array.isArray(list) && list.length) return list;
      } catch { /* fall back to futures candles */ }
    }
    try {
      const list = await this.fetchCandles(symbol, sec, 200);
      if (Array.isArray(list) && list.length) return list;
    } catch { /* both sources failed */ }
    return [];
  }

  async _regime(symbol) {
    const definitions = [['4小时', 14400], ['1小时', 3600], ['15分钟', 900]];
    const results = await Promise.all(definitions.map(async ([label, sec]) => {
      try {
        const candles = await this._candles(symbol, sec);
        if (!Array.isArray(candles) || candles.length < 30) return null;
        const a = analyzeTrend(candles);
        const last = candles.at(-1);
        return {
          label,
          frame: {
            trend: a.trend, strength: a.strength, slopePct: a.slopePct, atrPct: a.atrPct,
            emaGap: a.emaFast && a.emaSlow ? round((a.emaFast - a.emaSlow) / a.emaSlow * 100) : null,
          },
          price: Number(last?.close ?? last?.price ?? 0),
        };
      } catch { return null; }
    }));
    const frames = {};
    let price = null;
    for (const item of results) {
      if (!item) continue;
      frames[item.label] = item.frame;
      if (!(price > 0) && item.price > 0) price = item.price;
    }
    if (!Object.keys(frames).length) throw new Error('拿不到足够的K线数据，无法分析。');

    const values = Object.values(frames);
    const up = values.filter((f) => f.trend === 'up').length;
    const down = values.filter((f) => f.trend === 'down').length;
    const avgAtr = values.reduce((n, f) => n + (Number(f.atrPct) || 0), 0) / values.length;
    const avgStrength = values.reduce((n, f) => n + (Number(f.strength) || 0), 0) / values.length;
    const violent = avgAtr >= 4;
    const directional = Math.max(up, down) >= 2 && avgStrength >= 0.35;
    const regime = violent ? '剧烈波动' : directional ? (up > down ? '上升趋势' : '下降趋势') : '震荡';
    const widthPct = Math.max(2, Math.min(20, avgAtr * 3 || 4));
    const lower = price > 0 ? round(price * (1 - widthPct / 100), 6) : null;
    const upper = price > 0 ? round(price * (1 + widthPct / 100), 6) : null;
    const reasoning = `${values.length} 个周期中，上升 ${up}、下降 ${down}、震荡 ${values.length - up - down}；平均 ATR ${pct(avgAtr)}，趋势强度 ${pct(avgStrength * 100)}。`;
    const caution = violent || directional
      ? '单边趋势或高波动下，方向性风险明显放大，控制仓位比猜方向更重要。'
      : '规则只基于历史K线指标，震荡状态也可能快速转为单边行情。';
    return {
      t: Date.now(), symbol, price, frames, regime,
      confidence: round(Math.max(0.5, Math.min(0.95, 0.55 + avgStrength * 0.35)), 2),
      suggestedRange: lower && upper ? { lower, upper } : null,
      reasoning, caution,
    };
  }

  async analyze(rawSymbol) {
    return this._regime(this._symbol(rawSymbol));
  }

  async runMarketAnalysis() {
    if (this._busy.market) return this.market;
    this._busy.market = true;
    try {
      const items = [];
      const errors = {};
      for (const symbol of SYMBOLS) {
        try { items.push(await this._regime(symbol)); }
        catch (e) { errors[symbol] = e?.message || String(e); }
      }
      if (!items.length) throw new Error('公共行情暂不可用，无法分析。');
      this.market = { t: Date.now(), items, errors };
      this.marketError = null;
      this._lastMarketAt = Date.now();
      return this.market;
    } catch (e) {
      this.marketError = e?.message || String(e);
      throw e;
    } finally {
      this._busy.market = false;
    }
  }

  _formatItem(item) {
    if (!item) return '';
    const range = item.suggestedRange ? `${item.suggestedRange.lower} ~ ${item.suggestedRange.upper}` : '--';
    return `${item.symbol}：现价 ${item.price ?? '--'}，${item.regime}，参考区间 ${range}；${item.reasoning}`;
  }

  async makeReport() {
    if (this._busy.report) return this.report;
    this._busy.report = true;
    try {
      const cfg = getAiConfig();
      const stale = !this.market || Date.now() - Number(this.market.t || 0) >= Math.max(1, cfg.marketMin || 30) * 60_000;
      if (stale) await this.runMarketAnalysis();
      const at = new Date(this.market?.t || Date.now());
      const lines = [`行情日报（${at.toISOString().slice(0, 16).replace('T', ' ')} UTC）`];
      for (const item of this.market?.items || []) lines.push(this._formatItem(item));
      for (const [symbol, error] of Object.entries(this.market?.errors || {})) lines.push(`${symbol}：数据暂不可用（${error}）`);
      lines.push('说明：基于公共K线与规则指标，不构成投资建议，也不会执行任何交易。');
      this.report = { t: Date.now(), text: lines.join('\n') };
      notify('【Solvex 行情日报】\n' + this.report.text).catch(() => {});
      return this.report;
    } finally {
      this._busy.report = false;
    }
  }

  async chatAdvice(message) {
    const query = String(message || '');
    const cfg = getAiConfig();
    const stale = !this.market || Date.now() - Number(this.market.t || 0) >= Math.max(1, cfg.marketMin || 30) * 60_000;
    if (stale) await this.runMarketAnalysis().catch(() => {});
    const items = this.market?.items || [];
    const hit = SYMBOLS.filter((symbol) => query.toUpperCase().includes(symbol));
    const targets = hit.length ? items.filter((item) => hit.includes(item.symbol)) : items;
    let reply;
    if (/风险|仓位|杠杆|建议|注意/.test(query)) {
      reply = targets.length
        ? targets.map((item) => `${item.symbol}：当前${item.regime}，${item.caution}建议单笔风险敞口不超过总资金的 2%~5%，并预设止损。`).join('\n')
        : '暂未获取到行情数据，无法给出基于市场的建议。';
    } else if (/区间|支撑|压力|点位/.test(query)) {
      reply = targets.length
        ? targets.map((item) => item.suggestedRange
          ? `${item.symbol}：按 ATR 估算的参考区间 ${item.suggestedRange.lower} ~ ${item.suggestedRange.upper}（现价 ${item.price ?? '--'}）。`
          : `${item.symbol}：现价数据不足，暂不给出区间。`).join('\n')
        : '暂未获取到行情数据，无法给出区间。';
    } else {
      reply = targets.length
        ? targets.map((item) => this._formatItem(item)).join('\n')
        : '暂未获取到行情数据。';
    }
    return { reply: `本地规则分析（只读）：\n${reply}\n提示：这是指标和阈值判断，不是收益保证，也不会执行任何交易。`, readOnly: true };
  }

  async test() {
    return { ok: true, ms: 0, model: '无需模型', provider: '本地规则引擎', localOnly: true, reply: '规则引擎正常' };
  }

  async status() {
    const cfg = getAiConfig();
    return {
      configured: true, available: true, localOnly: true, provider: 'rules', model: '无需模型', modelSmall: '无需模型',
      installedModels: [],
      telegramTokenMasked: cfg.telegramToken ? cfg.telegramToken.slice(0, 4) + '…' + cfg.telegramToken.slice(-4) : '',
      telegramChat: cfg.telegramChat, webhook: cfg.webhook,
      marketMin: cfg.marketMin, reportHour: cfg.reportHour,
      notifyChannels: [cfg.telegramToken && cfg.telegramChat ? 'telegram' : null, cfg.webhook ? 'webhook' : null].filter(Boolean),
      report: this.report, market: this.market, marketError: this.marketError,
    };
  }
}
