import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ErrorState, Gate, Loading, PageHeading, useAction } from '@/components/common';
import { useWallet } from '@/hooks/use-wallet';
import { api, post, walletIdentity } from '@/lib/api';
import { formatDecimal } from '@/lib/utils';
import type { AiManagedBatch, AiManagedRecord, AiManagedState } from '@/types';

// 未登录/首屏加载时用零值占位，避免指标区出现空字符串
const EMPTY: AiManagedState = {
  running: false, principal: '0', dayEarned: '0', totalEarned: '0', availableBalance: '0',
  aixBalance: '0', unlockCostA: '100', unlockDays: 30, minPrincipal: '100', batches: [], records: [],
};

const SYMBOLS = [
  { symbol: 'BTCUSDT', name: 'BTC/USDT', coin: 'BTC' },
  { symbol: 'ETHUSDT', name: 'ETH/USDT', coin: 'ETH' },
  { symbol: 'SOLUSDT', name: 'SOL/USDT', coin: 'SOL' },
] as const;

const STATUS: Record<string, [string, string]> = {
  active: ['量化中', 'active'], exiting: ['等待退出量化', 'pending'], exited: ['已退出', 'muted'],
  expired: ['已到期', 'complete'], redeemed: ['已赎回', 'muted'],
};

// 收益类金额固定两位小数展示；解析失败时回退为占位符
const money = (value?: string | number | null) => formatDecimal(value, 2);
// 开仓币量允许小数
const size = (value?: number | string | null) => formatDecimal(value, 6);
// 行情价格：XRP 类保留 4 位，其余 2 位
const price = (value?: number | string | null, symbol = '') => formatDecimal(value, symbol.startsWith('XRP') ? 4 : 2);
const when = (value?: number | string | null) => {
  if (!value) return '-';
  const date = new Date(typeof value === 'string' ? value : Number(value));
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
};
const day = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN');
};

// 金额校验只做字符串/大整数比较，不经过 Number（6 位小数精度）
function parseAmount(text: string): bigint | null {
  const clean = text.trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  return BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6));
}

interface Candle { close?: number }
interface Analysis {
  coin: string; name: string; last: number; signal: '做多' | '做空' | '观望';
  trend: string; rsi: number; macd: number; upper: number; lower: number; leverage: number;
  support: string; resistance: string;
}

// 简易技术指标：RSI(14)、EMA12/EMA26 → MACD、20 周期布林带
function analyze(pick: typeof SYMBOLS[number], candles: Candle[]): Analysis | null {
  const closes = candles.map(candle => Number(candle.close || 0)).filter(value => value > 0);
  if (closes.length < 14) return null;
  const last = closes[closes.length - 1];
  let gains = 0, losses = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    if (i <= 0) continue;
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const rsi = 100 - (100 / (1 + (gains / Math.max(losses, 0.001)) / 14));
  const ema = (period: number) => {
    const k = 2 / (period + 1);
    let value = closes[0];
    for (let i = 1; i < closes.length; i++) value = closes[i] * k + value * (1 - k);
    return value;
  };
  const macd = ema(12) - ema(26);
  const slice = closes.slice(-20);
  const ma = slice.reduce((a, b) => a + b, 0) / slice.length;
  const std = Math.sqrt(slice.reduce((s, value) => s + (value - ma) ** 2, 0) / slice.length);
  const upper = ma + 2 * std, lower = ma - 2 * std;
  const bullish = macd > 0 && rsi < 70 && last > ma;
  const bearish = macd < 0 && rsi > 30 && last < ma;
  const signal = bullish ? '做多' : bearish ? '做空' : '观望';
  const trend = last > ma ? '多头排列' : last < ma ? '空头排列' : '震荡整理';
  const leverage = bullish ? [6, 8, 10][Math.floor(Math.random() * 3)]
    : bearish ? [5, 7, 8][Math.floor(Math.random() * 3)]
    : [3, 4, 5][Math.floor(Math.random() * 3)];
  return {
    coin: pick.coin, name: pick.name, last, signal, trend, rsi, macd, upper, lower, leverage,
    support: Math.min(...closes.slice(-10)).toFixed(2),
    resistance: Math.max(...closes.slice(-10)).toFixed(2),
  };
}

function BatchCard({ batch }: { batch: AiManagedBatch }) {
  const status = STATUS[batch.status] || ['已结束', 'muted'];
  const exitNote = batch.status === 'active' ? '可随时停止量化'
    : batch.status === 'exiting' ? `预计 ${when(batch.payoutAt)} 到账`
    : '-';
  return <div className="aim-batch-card">
    <div className="aim-batch-head"><code>{String(batch.id || '').slice(-8).toUpperCase()}</code><span className={'aim-state ' + status[1]}>{status[0]}</span></div>
    <div className="aim-kv"><span>投入 USDT</span><b>{money(batch.principal)} USDT</b></div>
    <div className="aim-kv aim-positive"><span>累计收益</span><b>+{money(batch.totalEarned)} USDT</b></div>
    <div className="aim-kv"><span>开始时间</span>{when(batch.startedAt)}</div>
    <div className="aim-kv"><span>退出</span>{exitNote}</div>
  </div>;
}

function RecordCard({ record }: { record: AiManagedRecord }) {
  const isShort = record.direction === '空' || record.side === 'sell';
  const profit = String(record.profit ?? '0').trim();
  const positive = !profit.startsWith('-');
  return <div className="aim-record-card">
    <div className="aim-record-head">
      <span>{when(record.t)}</span><b>{record.symbol || '-'}</b>
      <span className={'aim-direction ' + (isShort ? 'sell' : 'buy')}>{isShort ? '空' : '多'}</span>
    </div>
    <div className="aim-kv"><span>开仓价</span>{price(record.openPrice ?? record.price, record.symbol)}</div>
    <div className="aim-kv"><span>平仓价</span>{price(record.closePrice ?? record.price, record.symbol)}</div>
    <div className="aim-kv"><span>开仓币量</span><b>{size(record.size)}</b></div>
    <div className="aim-kv"><span>杠杆</span>{record.leverage || 1}x</div>
    <div className={'aim-kv ' + (positive ? 'aim-positive' : 'aim-negative')}>
      <span>收益</span><b>{positive ? '+' : ''}{money(profit)} USDT</b>
    </div>
  </div>;
}

export default function AiManagedPage() {
  const wallet = useWallet();
  const identity = walletIdentity();
  const { run, busy, dialog } = useAction();
  const [amount, setAmount] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisAt, setAnalysisAt] = useState('');

  const query = useQuery({
    queryKey: ['ai-managed', identity],
    queryFn: ({ signal }) => api<AiManagedState>('ai-managed/state', { signal }),
    enabled: wallet.authenticated,
    refetchInterval: 30000,
  });
  const state = query.data ?? EMPTY;
  const batches = state.batches || [];
  const records = state.records || [];
  const vip = Boolean(state.copyTradeUnlocked);
  const expired = Boolean(state.unlockExpiresAt) && !vip;
  const isRenew = expired;
  const statusText = state.exitPending ? '等待退出量化 · 24 小时到账' : state.running ? '运行中' : '未开始';

  // 实时合约分析：每 30 秒刷新一次，离开页面即停止
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const load = async () => {
      const pick = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      try {
        const data = await api<{ candles?: Candle[] }>(`market/candles?symbol=${pick.coin}&intervalSec=3600&product=perp`, { signal: controller.signal }, false);
        if (cancelled) return;
        const next = analyze(pick, Array.isArray(data?.candles) ? data.candles : []);
        setAnalysis(next);
        if (next) setAnalysisAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
      } catch { if (!cancelled) setAnalysis(null); }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); };
  }, []);

  function unlockVip() {
    const text = isRenew
      ? `销毁 ${state.unlockCostA || '100'} SVX，续费 ${state.unlockDays || 30} 天量化权益（永久销毁，不返还）；权益期内加入量化不再重复销毁 SVX。`
      : `销毁 ${state.unlockCostA || '100'} SVX，开通 ${state.unlockDays || 30} 天量化权益（永久销毁，不返还）；到期后需再次销毁才能继续量化。`;
    void run(isRenew ? '续费 VIP 量化权益' : '开通 VIP 量化权益', text, async () => {
      await post('ai-managed/unlock', {});
      return isRenew ? 'VIP 续费成功，30 天权益已生效' : 'VIP 开通成功，现在可以设置金额开始量化了';
    });
  }

  function start() {
    const value = parseAmount(amount);
    if (!value || value <= 0n) { toast.error('请输入量化金额'); return; }
    const min = parseAmount(state.minPrincipal || '100') ?? 100_000_000n;
    if (value < min) { toast.error(`量化金额最低 ${state.minPrincipal || '100'} USDT`); return; }
    if (!vip) {
      toast.error(expired
        ? 'VIP 量化权益已到期，请先点击「续费 VIP」销毁 SVX 续费'
        : '请先点击上方「开通 VIP」销毁 SVX 开通 30 天权益，开通后即可量化');
      return;
    }
    void run('确认加入量化',
      `量化金额 ${amount.trim()} USDT；VIP 权益有效中，剩余 ${state.unlockDaysLeft ?? 0} 天，量化不重复销毁 SVX；月化收益 15%-20%（随机浮动）；停止量化后本金 24 小时全额到账，不扣罚金。`,
      async () => {
        await post('ai-managed/start', { amount: amount.trim() });
        setAmount('');
        return '量化资金已加入';
      });
  }

  function stop() {
    void run('停止量化确认',
      '所有量化中批次将进入等待退出量化，已产生收益照常结算；投入的 USDT 全额返还，不扣除任何罚金，本金将于 24 小时后自动返回到可用余额。此操作不可撤销。',
      async () => {
        await post('ai-managed/stop', {});
        return '已提交停止量化，本金将于 24 小时后到账';
      });
  }

  if (!wallet.authenticated) return <div className="rx-page">
    <PageHeading title="Ai量化" subtitle="以策略连接市场 · 每日结算，自主管理" />
    <Gate description="连接并确认钱包，查看量化批次与策略收益" />
  </div>;

  if (query.error) return <div className="rx-page">
    <PageHeading title="Ai量化" subtitle="以策略连接市场 · 每日结算，自主管理" />
    <ErrorState error={query.error} retry={() => void query.refetch()} />
  </div>;

  if (query.isPending) return <div className="rx-page">
    <PageHeading title="Ai量化" subtitle="以策略连接市场 · 每日结算，自主管理" />
    <Loading />
  </div>;

  const vipDesc = vip
    ? <>👑 已开通 VIP，剩余 <b style={{ color: '#0e9c88' }}>{state.unlockDaysLeft ?? 0} 天</b>{day(state.unlockExpiresAt) ? `，有效期至 ${day(state.unlockExpiresAt)}` : ''}；权益期内量化不重复销毁 SVX，到期后需续费才能继续量化。</>
    : expired
      ? <>VIP 已于 <b style={{ color: '#c62a37' }}>{day(state.unlockExpiresAt)}</b> 到期：销毁 <b style={{ color: '#a8700a' }}>{state.unlockCostA || '100'} SVX</b> 续费 <b>{state.unlockDays || 30} 天</b>（永久销毁，不返还），续费后即可继续量化。</>
      : <>开通 VIP 后才能开始量化：销毁 <b style={{ color: '#a8700a' }}>{state.unlockCostA || '100'} SVX</b> 开通 <b>{state.unlockDays || 30} 天</b>权益（永久销毁，不返还），到期后续费重新销毁 {state.unlockCostA || '100'} SVX。</>;

  return <main className="aim-page">
    {dialog}
    <header className="aim-topbar">
      <div className="aim-heading">
        <div className="aim-title-row"><h1>Ai量化</h1><span className={'aim-status' + (state.running ? ' running' : '')}>{statusText}</span></div>
        <p>以策略连接市场 · 每日结算，自主管理</p>
      </div>
      <div className="aim-robot" aria-hidden="true" />
    </header>

    <section className="aim-metrics" aria-label="量化资产概览">
      <div><span>量化 USDT</span><strong>{money(state.principal)} USDT</strong><small>当前有效批次</small></div>
      <div><span>今日收益</span><strong className="aim-positive">+{money(state.dayEarned)} USDT</strong><small>达到目标后入账</small></div>
      <div><span>累计收益</span><strong className="aim-positive">+{money(state.totalEarned)} USDT</strong><small>历史累计</small></div>
    </section>

    <div className="aim-workspace">
      <section className="aim-panel aim-invest-panel">
        <header className="aim-panel-head">
          <div><h2>新增量化</h2><p>开通 VIP 后加入量化，停止量化 24 小时到账</p></div>
          <span>可用余额 {money(state.availableBalance)} USDT</span>
        </header>
        <div className={'aim-vip-card' + (vip ? ' is-active' : '')}>
          <div className="aim-vip-badge">👑 VIP</div>
          <div className="aim-vip-body">
            <b>{vip ? 'VIP 量化权益 · 有效中' : expired ? 'VIP 量化权益 · 已到期' : '量化 VIP 权益'}</b>
            <span>{vipDesc}</span>
            <span style={{ color: '#4d2ab0', fontWeight: 700 }}>SVX 余额 {money(state.aixBalance)} SVX</span>
          </div>
          <button className="aim-vip-btn" type="button" disabled={vip || busy} onClick={unlockVip}>
            {vip ? 'VIP 有效中' : expired ? `续费 VIP · 销毁 ${state.unlockCostA || '100'} SVX` : `开通 VIP · 销毁 ${state.unlockCostA || '100'} SVX`}
          </button>
        </div>
        <div className="aim-amount-block">
          <label htmlFor="aim-amount">量化金额（最低 {state.minPrincipal || '100'} USDT）</label>
          <div className="aim-amount-field">
            <input id="aim-amount" name="ai_managed_usdt_amount" type="number" min="100" step="0.01" inputMode="decimal"
              placeholder={`最低 ${state.minPrincipal || '100'}`} autoComplete="transaction-amount" value={amount}
              onChange={event => setAmount(event.target.value)} />
            <span>USDT</span>
            <button type="button" disabled={busy} onClick={() => setAmount(state.availableBalance || '')}>全部</button>
          </div>
        </div>
        <div className="aim-actions">
          <button className="aim-primary" type="button" disabled={busy} onClick={start}>加入量化</button>
          <button className="aim-secondary" type="button" disabled={!state.running || busy} onClick={stop}>{state.exitPending ? '等待退出量化' : '停止量化'}</button>
        </div>
        <div className="aim-notice"><b>退出规则</b><span>停止量化后进入等待退出量化，本金 24 小时后自动返回到可用余额，不扣除任何罚金。</span></div>
      </section>

      <aside className="aim-panel aim-analysis-panel">
        <header className="aim-panel-head"><div><h2>实时合约分析</h2><p>AI 策略引擎实时推送</p></div><span>{analysisAt || '--:--'}</span></header>
        <div className="aim-analysis-content">
          {!analysis ? <div className="aim-analysis-loading">正在获取市场数据…</div> : <>
            <div className="aim-analysis-pair">
              <img className="aim-analysis-coin" src={`/assets/tokens/${analysis.coin.toLowerCase()}.png?v=20261111-domain-solvex-1`} alt={analysis.coin} onError={event => { event.currentTarget.style.display = 'none'; }} />
              <div><strong>{analysis.name}</strong><small>{analysis.last.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</small></div>
              <span className={'aim-analysis-signal ' + (analysis.signal === '做多' ? 'aim-signal-long' : analysis.signal === '做空' ? 'aim-signal-short' : 'aim-signal-neutral')}>{analysis.signal}</span>
            </div>
            <div className="aim-analysis-grid">
              <div><dt>趋势</dt><dd>{analysis.trend}</dd></div>
              <div><dt>RSI(14)</dt><dd className={analysis.rsi > 70 ? 'aim-over' : analysis.rsi < 30 ? 'aim-under' : ''}>{analysis.rsi.toFixed(1)}</dd></div>
              <div><dt>MACD</dt><dd className={analysis.macd >= 0 ? 'aim-positive' : 'aim-negative'}>{analysis.macd >= 0 ? '+' : ''}{analysis.macd.toFixed(2)}</dd></div>
              <div><dt>布林上轨</dt><dd>{analysis.upper.toFixed(2)}</dd></div>
              <div><dt>布林下轨</dt><dd>{analysis.lower.toFixed(2)}</dd></div>
              <div><dt>建议杠杆</dt><dd>{analysis.leverage}x</dd></div>
              <div><dt>支撑位</dt><dd>{analysis.support}</dd></div>
              <div><dt>阻力位</dt><dd>{analysis.resistance}</dd></div>
            </div>
            <div className="aim-analysis-summary">
              {analysis.signal === '做多' ? <>RSI {analysis.rsi.toFixed(0)} 未超买，MACD 金叉向上，布林带开口扩张，建议顺势 <b>做多</b>。</>
                : analysis.signal === '做空' ? <>RSI {analysis.rsi.toFixed(0)} 未超卖，MACD 死叉向下，布林带开口扩张，建议顺势 <b>做空</b>。</>
                : <>RSI 中性区间，布林带收窄，建议<b>观望</b>等待突破方向。</>}
            </div>
          </>}
        </div>
      </aside>
    </div>

    <section className="aim-panel aim-card-panel">
      <header className="aim-panel-head"><div><h2>量化批次</h2><p>停止量化后 24 小时到账</p></div><span>{batches.length} 个批次</span></header>
      <div className="aim-card-list">
        {batches.length ? batches.map(batch => <BatchCard key={batch.id} batch={batch} />) : <div className="aim-empty">暂无量化批次</div>}
      </div>
    </section>

    <section className="aim-panel aim-card-panel">
      <header className="aim-panel-head"><div><h2>策略执行明细</h2><p>合约量化的周期执行记录</p></div><span>{records.length} 条记录</span></header>
      <div className="aim-card-list">
        {records.length ? records.map((record, index) => <RecordCard key={record.id || index} record={record} />) : <div className="aim-empty">暂无执行明细</div>}
      </div>
    </section>
  </main>;
}
