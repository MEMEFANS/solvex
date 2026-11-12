import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import { api, post, postOnce, postSigned } from '@/lib/api';
import { date, formatDecimal, toUnits, units } from '@/lib/utils';
import { useWallet } from '@/hooks/use-wallet';
import { useProfile } from '@/hooks/use-profile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, ErrorState, Gate, Loading, Metric, useAction } from '@/components/common';

interface DriveState { matchQuota?: { available: string }; turboQuota: string; usableQuota?: { available: string }; nextDurationHours: number; maxDurationHours: number; usedToday: boolean; entries: { id: string; totalA: string; matchA: string; turboA: string; durationHours: number; createdAt: number; maturesAt: number; status: string }[]; purchases: { id: string; usdtIn: string; turboOut: string; createdAt: number }[] }
interface TurboQuote { aixIn: string; usdtOut: string; usdtCost: string; feeUsdt: string; priceUsdt: string }
function useData<T>(path: string) { const wallet = useWallet(); return useQuery({ queryKey: ['ecosystem', path, wallet.address, wallet.revision], queryFn: ({ signal }) => api<T>('a-token/' + path, { signal }), enabled: wallet.authenticated, refetchInterval: 60000 }); }
function Frame({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <Card><CardHeader><CardTitle>{title}</CardTitle>{action}</CardHeader><CardContent>{children}</CardContent></Card>; }
function Table({ headings, children }: { headings: string[]; children: ReactNode }) { return <div className="rx-table-wrap"><table className="rx-table no-mobile-stack"><thead><tr>{headings.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }

function DrivePage() {
  const wallet = useWallet(), query = useData<DriveState>('match-pool'), profile = useProfile(), action = useAction();
  const [purchase, setPurchase] = useState(''), [amount, setAmount] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebounced(purchase.trim()), 350); return () => clearTimeout(timer); }, [purchase]);
  const valid = /^\d+(?:\.\d{1,18})?$/.test(debounced) && toUnits(debounced) > 0n;
  const quote = useQuery({ queryKey: ['drive-quote', wallet.address, wallet.revision, debounced], queryFn: ({ signal }) => api<TurboQuote>('a-token/match-pool/quote?aix=' + encodeURIComponent(debounced), { signal }), enabled: wallet.authenticated && valid });
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!query.data || !profile.data) return profile.error ? <ErrorState error={profile.error} retry={() => void profile.refetch()} /> : <Loading />;
  const data = query.data, q = quote.data;
  const maximum = [data.matchQuota?.available || '0', data.turboQuota || '0'].map(n => toUnits(n)).reduce((a, b) => a < b ? a : b);
  const enter = () => void action.run('放入超速驱动协议', '放入 ' + amount + ' SVX，消耗等量蓄能额度与驱动额度，锁定 ' + data.nextDurationHours + ' 小时，到期生成双倍 SVX 与流通额度。每日仅一次。', async () => {
    if (toUnits(amount.trim()) < toUnits('10')) throw Error('最低 10 SVX');
    await postOnce('a-token/match-pool/enter', { amount: amount.trim() }, 'drive-enter'); setAmount(''); return '已放入超速驱动协议';
  });
  const buy = () => { if (!q || debounced !== purchase.trim()) return; void action.run('购买驱动额度', q.aixIn + ' SVX 驱动额度，成交 ' + q.usdtCost + ' USDT，实付 ' + q.usdtOut + ' USDT（买入 0 手续费）。请在钱包确认签名。', async () => {
    await postSigned('a-token/match-pool/buy-turbo', { aix: debounced }, 'turbo-buy', (id, ts) => 'Solvex 驱动额度购买确认：购买 ' + debounced + ' SVX，编号 ' + id + '，时间：' + ts); setPurchase(''); return '驱动额度购买成功';
  }); };
  return <div className="rx-stack" data-native-ecosystem="matchpool"><Card className="rx-metrics"><Metric label="蓄能额度" value={formatDecimal(data.matchQuota?.available)} unit="SVX" /><Metric label="驱动额度" value={formatDecimal(data.turboQuota)} unit="SVX" /><Metric label="可用卖出额度" value={formatDecimal(data.usableQuota?.available)} unit="SVX" /><Metric label="本次锁定" value={data.nextDurationHours} unit="小时" /></Card>
    <div className="rx-energy-grid"><Frame title="购买驱动额度" action={<Zap size={20} />}><label className="rx-label" htmlFor="drive-buy-amount">购买数量（SVX 驱动额度）</label><input className="rx-input" id="drive-buy-amount" inputMode="decimal" value={purchase} onChange={e => setPurchase(e.target.value)} placeholder="输入数量" /><p className="rx-note">可用 USDT：{formatDecimal(profile.data.balances.USDT)}</p><p className="rx-note" role="status">{quote.error ? quote.error.message : quote.isFetching ? '正在获取报价…' : q && debounced === purchase.trim() ? '成交 ' + q.usdtCost + ' USDT，实付 ' + q.usdtOut + ' USDT（买入 0 手续费）' : '输入数量后获取实时报价'}</p><Button disabled={action.busy || !q || quote.isFetching || debounced !== purchase.trim() || !valid} onClick={buy}>确认购买</Button></Frame>
    <Frame title="放入超速驱动协议"><label className="rx-label" htmlFor="drive-enter-amount">投入数量（SVX）</label><input className="rx-input" id="drive-enter-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="最低 10 SVX" /><p className="rx-note">可投入 {formatDecimal(units(maximum))} SVX；蓄能额度与驱动额度取较小值。</p><div className="rx-dialog-actions"><Button variant="outline" disabled={action.busy || data.usedToday} onClick={() => setAmount(units(maximum))}>最大</Button><Button disabled={action.busy || data.usedToday || !amount.trim()} onClick={enter}>{data.usedToday ? '今日已使用' : '确认放入'}</Button></div><p className="rx-note">首日锁定 24 小时，每日增加 24 小时，上限 720 小时；30 天未用重置。</p></Frame></div>
    <Frame title="记录"><div className="rx-record-group">
      <h4>协议记录</h4>
      {!data.entries?.length ? <Empty>暂无超速驱动记录</Empty> : <Table headings={['到期额度', '锁定时长', '到期时间', '状态']}>{data.entries.map(row => <tr key={row.id}><td>{formatDecimal(row.totalA)} SVX</td><td>{row.durationHours} 小时</td><td>{date(row.maturesAt)}</td><td>{row.status === 'locked' ? '锁定中' : '已发放'}</td></tr>)}</Table>}
      <h4>驱动额度购买记录</h4>
      {!data.purchases?.length ? <Empty>暂无购买记录</Empty> : <Table headings={['支付', '额度', '时间']}>{data.purchases.map((row, i) => <tr key={row.id || i}><td>{formatDecimal(row.usdtIn)} USDT</td><td>{formatDecimal(row.turboOut)} SVX</td><td>{date(row.createdAt)}</td></tr>)}</Table>}
    </div></Frame>{action.dialog}</div>;
}

const section = { id: 'earn-drive', kicker: 'BOOST PROTOCOL', title: '超速驱动协议', note: '驱动额度、锁定与协议记录' };
// 协议池页（原「玩法」）只保留超速驱动；盲盒自 2026-11-12 起独立为 earn 的第一个页签。
export default function PlayPage() {
  const wallet = useWallet();
  if (!wallet.authenticated) return <Gate description="连接并确认钱包，查看超速驱动协议" />;
  return <div className="rx-play-page">
    <section id={section.id} className="rx-play-section">
      <div className="rx-section-heading"><div><span className="rx-kicker">{section.kicker}</span><h2>{section.title}</h2></div><span>{section.note}</span></div>
      <DrivePage />
    </section>
  </div>;
}
