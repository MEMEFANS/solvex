import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, CalendarClock, Check, RotateCcw, Sparkles } from 'lucide-react';
import { api, post } from '@/lib/api';
import { date, formatDecimal, mulDecimal, toUnits } from '@/lib/utils';
import { buyBlindboxOnchain } from '@/lib/wallet-onchain';
import { useWallet } from '@/hooks/use-wallet';
import { BlindBoxArt, type BoxPhase } from '@/components/blindbox-art';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, ErrorState, Loading, Metric, useAction } from '@/components/common';

interface BoxReward { totalCoins: string; dailyQuotaCoins: string; claimDays: number }
interface BoxState {
  joined: boolean;
  rules: { entryUsdt: string; claimDays: number; minCoins?: string | number; maxCoins?: string | number; onchainPayment?: { enabled: boolean; contractAddress: string; chainId: number; usdtAddress: string; confirmations: number; entryUsdt: string; coinPriceUsdt: string } };
  pendingCoins: string;
  box?: BoxReward & { remainingCoins: string };
  pending: { id: string; amountCoins: string; availableAt: number; expiresAt: number; status: string }[];
}
interface BoxJoinResult extends Partial<BoxReward> { overview?: BoxState }
const positiveDecimal = (value: unknown): value is string => typeof value === 'string' && /^\d+(?:\.\d{1,18})?$/.test(value) && toUnits(value) > 0n;
const reduceMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

export default function BlindboxPage() {
  const wallet = useWallet(), action = useAction();
  const query = useQuery({ queryKey: ['ecosystem', 'blindbox', wallet.address, wallet.revision], queryFn: ({ signal }) => api<BoxState>('a-token/blindbox', { signal }), enabled: wallet.authenticated, refetchInterval: 60000 });
  const priceQuery = useQuery({ queryKey: ['svx-pool-price'], queryFn: ({ signal }) => api<{ priceUsdt?: string | number }>('a-token/pool', { signal }, false), staleTime: 15000, refetchInterval: 30000 });
  const [now, setNow] = useState(Date.now());
  const [phase, setPhase] = useState<BoxPhase>('closed');
  const [result, setResult] = useState<BoxReward | null>(null);
  const timer = useRef<number | null>(null);
  const stopTimer = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => { const tick = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(tick); }, []);
  useEffect(() => { stopTimer(); setResult(null); setPhase('closed'); }, [wallet.address, wallet.revision]);
  useEffect(() => stopTimer, []);
  const settle = () => { stopTimer(); setPhase('opened'); };
  const play = () => {
    stopTimer();
    if (reduceMotion()) { setPhase('opened'); return; }
    setPhase('opening');
    timer.current = window.setTimeout(() => { timer.current = null; setPhase('opened'); }, 2100);
  };
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  const data = query.data;
  const reward = result || (positiveDecimal(data.box?.totalCoins) ? data.box! : null);
  const opened = data.joined || Boolean(reward) || phase === 'opening' || phase === 'opened';
  const view = opened && phase === 'closed' ? 'opened' : phase;
  const priceText = priceQuery.data?.priceUsdt == null ? '' : String(priceQuery.data.priceUsdt);
  const price = !priceQuery.isError && positiveDecimal(priceText) ? priceText : null;
  const value = reward && price ? mulDecimal(reward.totalCoins, price) : null;
  const minCoins = String(data.rules.minCoins || '100'), maxCoins = String(data.rules.maxCoins || '500');
  const claimDays = reward?.claimDays || data.rules.claimDays || 30;
  const join = () => void action.run('开启盲盒', '支付 ' + data.rules.entryUsdt + ' USDT，同一笔链上交易自动配对 SVX 加入流动性。初始报价约 0.1 USDT/SVX；每个钱包限一份，' + claimDays + ' 天每日手动领取。', async () => {
    const payment = data.rules.onchainPayment;
    if (!payment?.enabled) throw new Error('链上盲盒收款尚未配置，请联系平台管理员');
    const identity = wallet.address.toLowerCase();
    if (!identity) throw new Error('请先连接并确认钱包');
    const storageKey = 'solvex:blindbox-payment:' + identity;
    let saved: { receiptKey?: string; transactionHash?: string } = {};
    try { saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}'); } catch { /* create a fresh receipt key */ }
    const receiptKey = saved.receiptKey || ('0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''));
    sessionStorage.setItem(storageKey, JSON.stringify({ ...saved, receiptKey }));
    let response: BoxJoinResult;
    try {
      let transactionHash = saved.transactionHash;
      if (!transactionHash) {
        const paymentResult = await buyBlindboxOnchain({ ...payment, receiptKey, onStatus: status => { if (status.includes('授权')) setPhase('waiting'); } });
        transactionHash = paymentResult.transactionHash;
        sessionStorage.setItem(storageKey, JSON.stringify({ receiptKey, transactionHash }));
      }
      setPhase('waiting');
      response = await post<BoxJoinResult>('a-token/blindbox/join', { receiptKey, transactionHash }, { 'Idempotency-Key': receiptKey });
      sessionStorage.removeItem(storageKey);
    } catch (error) { setPhase('closed'); throw error; }
    let received = response.overview?.box;
    if (positiveDecimal(response.totalCoins)) received = { totalCoins: response.totalCoins, dailyQuotaCoins: response.dailyQuotaCoins || '0', claimDays: response.claimDays || claimDays, remainingCoins: response.totalCoins };
    if (!received) received = (await query.refetch()).data?.box;
    void priceQuery.refetch();
    if (received && positiveDecimal(received.totalCoins)) {
      setResult(received);
      play();
      return '盲盒已开启，开出 ' + formatDecimal(received.totalCoins) + ' SVX';
    }
    setPhase('opened');
    return '盲盒已开启，正在同步奖励';
  });
  const priceNote = price ? <>1 SVX ≈ {formatDecimal(price, 6)} USDT · 参考估值</> : <>{priceQuery.isFetching ? '正在获取参考价格…' : '估值暂不可用'}{!priceQuery.isFetching && <button type="button" onClick={() => void priceQuery.refetch()}>刷新价格</button>}</>;

  return <div className="rx-stack" data-native-ecosystem="blindbox">
    <div className={'rx-blindbox-hero svx-blindbox-hero svx-box-reveal is-' + view}>
      <BlindBoxArt phase={view} onSkip={settle} />
      <div className="svx-blindbox-content">
        <span className="rx-kicker">SVX MYSTERY BOX</span>
        <h3>{opened ? '你的 SVX 已揭晓' : '拆开一份 SVX 惊喜'}</h3>
        {reward ? <div className="svx-box-reward" role="status" aria-live={view === 'opening' ? 'off' : 'polite'}>
          <span className="svx-box-reward-label"><Sparkles size={13} /> 本次开出</span>
          <div className="svx-box-reward-amount" data-box-token-amount>{formatDecimal(reward.totalCoins)}<small>SVX</small></div>
          <div className="svx-box-reward-value"><span>代币参考价值</span><strong data-box-usdt-value>{value !== null ? '≈ ' + formatDecimal(value) + ' USDT' : '— USDT'}</strong></div>
          <div className="svx-box-price-note">{priceNote}</div>
        </div> : opened ? <div className="svx-box-preview"><strong>奖励同步中</strong><span>盲盒已开启，可刷新查看结果。</span><Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新结果</Button></div> : <div className="svx-box-preview">
          <strong>{formatDecimal(minCoins, 0)}–{formatDecimal(maxCoins, 0)} <small>SVX</small></strong>
          <span>{price ? '参考价值约 ' + formatDecimal(mulDecimal(minCoins, price)) + '–' + formatDecimal(mulDecimal(maxCoins, price)) + ' USDT' : '开出数量以实际结果为准'}</span>
        </div>}
        <div className="svx-box-release"><CalendarClock size={22} strokeWidth={1.5} /><div><b>{claimDays} 天按日释放 · 每天 08:00 开放领取</b><span>{reward ? '每日约 ' + formatDecimal(reward.dailyQuotaCoins, 4) + ' SVX，需手动领取' : '每天手动领取，当日未领取的额度过期作废'}</span></div></div>
        <div className="svx-box-actions">
          {opened ? <div className="svx-box-opened-state"><span><Check size={14} /> 已开启 · 每个钱包限 1 份</span>{reward && <button type="button" disabled={view === 'opening' || action.busy} onClick={play}><RotateCcw size={13} />重播动画</button>}</div> : <><Button disabled={action.busy || phase === 'waiting' || !data.rules.onchainPayment?.enabled} onClick={join}>{phase === 'waiting' ? '正在开启盲盒…' : '支付 ' + data.rules.entryUsdt + ' USDT 开盲盒'}<ArrowUpRight size={17} /></Button><p>{data.rules.entryUsdt} USDT 将在同一笔交易中配对 SVX 自动加入流动性 · 初始报价约 0.1 USDT/SVX · 每个钱包限 1 份</p></>}
        </div>
        <details className="svx-box-rules"><summary>领取与估值说明</summary><p>数量与参考价值为整份盲盒的奖励，分 {claimDays} 天释放，并非开盒后一次性到账。USDT 价值随 SVX 参考价格变化。</p><p>北京时间 08:00 结算，当期额度需在次日 08:00 前领取，过期作废。领到的 SVX 计入主余额与蓄能额度；卖出需具备超速驱动的流通额度。</p></details>
      </div>
    </div>
    {data.joined && <Card className="rx-metrics rx-metrics-3"><Metric label="剩余待释放" value={formatDecimal(data.box?.remainingCoins)} unit="SVX" /><Metric label="每日额度" value={formatDecimal(data.box?.dailyQuotaCoins, 4)} unit="SVX" /><Metric label="今日待领取" value={formatDecimal(data.pendingCoins)} unit="SVX" /></Card>}
    {(data.joined || Boolean(data.pending?.length)) && <Card><CardHeader><CardTitle>每日领取记录</CardTitle></CardHeader><CardContent>{!data.pending?.length ? <Empty>暂无待领取记录</Empty> : <div className="rx-table-wrap"><table className="rx-table no-mobile-stack"><thead><tr>{['数量', '开放领取', '领取截止', '操作'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.pending.map(row => <tr key={row.id}><td>{formatDecimal(row.amountCoins, 4)} SVX</td><td>{date(row.availableAt)}</td><td>{date(row.expiresAt)}</td><td><Button variant="outline" size="sm" disabled={action.busy || now < row.availableAt || now >= row.expiresAt || row.status !== 'pending'} onClick={() => void action.run('领取盲盒额度', '领取 ' + row.amountCoins + ' SVX 到主余额，并获得蓄能额度。', async () => { await post('a-token/pending/claim', { id: row.id }); return '领取成功'; })}>领取</Button></td></tr>)}</tbody></table></div>}</CardContent></Card>}
    {action.dialog}
  </div>;
}
