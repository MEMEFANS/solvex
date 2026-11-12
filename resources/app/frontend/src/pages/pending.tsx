import { useEffect, useState } from 'react';
import { ArrowDownToLine, Clock3, Coins } from 'lucide-react';
import { useProfile } from '@/hooks/use-profile';
import { useWallet } from '@/hooks/use-wallet';
import { post } from '@/lib/api';
import { date, formatUnits } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Empty, ErrorState, Gate, Loading, Metric, useAction } from '@/components/common';
import type { Pending } from '@/types';
const label: Record<string, string> = { node: '矿池利息', stake: '能量释放', team: '团队收益', dividend: '股东分红', blindbox: '盲盒释放', miner: '历史矿机' };
export function claimable(row: Pending, now: number) { return row.status === 'pending' && now >= Number(row.availableAt) && (row.bizType === 'node' && row.periodKey === 'principal' || now < Number(row.expiresAt)); }
export default function PendingPage({ teamOnly = false }: { teamOnly?: boolean }) {
  const query = useProfile(), wallet = useWallet(), action = useAction();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (!wallet.authenticated) return <Gate />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  const rows = (query.data.pending || []).filter(r => !teamOnly || r.bizType === 'team');
  const ready = rows.filter(row => claimable(row, now));
  const s = query.data.pendingSummary;
  const claim = (id: string) => void action.run('领取收益', '确认将这笔收益领取到主余额？蓄能额度会同步计入。', async () => { await post('a-token/pending/claim', { id }); return '领取成功，已计入主余额'; });
  const claimAll = () => void action.run('领取全部收益', '确认领取当前所有可领取记录？已过期的记录无法领取。', async () => {
    const result = await post<{ claimed?: { error?: string }[] }>('a-token/pending/claim-all', {});
    const failed = (result.claimed || []).filter(r => r.error).length;
    return failed ? '部分领取完成，' + failed + ' 条未领取，请核对明细' : '领取完成，已计入主余额';
  });
  return <div className="rx-stack"><Card className="rx-metrics">
    <Metric label={teamOnly ? '团队可领取' : 'SVX 可领取'} value={formatUnits(teamOnly ? ready.reduce((n, r) => n + BigInt(r.amountUnits), 0n) : s?.claimableUnits)} unit="SVX" icon={<Coins size={17} />} />
    <Metric label="待生效" value={teamOnly ? rows.filter(r => r.status === 'pending' && now < r.availableAt).length : formatUnits(s?.waitingUnits)} unit={teamOnly ? '笔' : 'SVX'} icon={<Clock3 size={17} />} />
    {!teamOnly && <><Metric label="6 小时内过期" value={formatUnits(s?.expiringSoonUnits)} unit="SVX" /><Metric label="分红可领取" value={formatUnits(s?.claimableUsdtUnits, 6)} unit="USDT" /></>}
  </Card><Card><CardHeader><CardTitle>{teamOnly ? '团队待领取收益' : '待领取明细'}</CardTitle>{!teamOnly && <Button size="sm" disabled={action.busy || !ready.length} onClick={claimAll}><ArrowDownToLine />一键领取</Button>}</CardHeader><CardContent><p className="rx-note">每天 08:00 开放领取，次日同一时点未领取作废。</p>{!rows.length ? <Empty>暂无待领取记录</Empty> : <div className="rx-table-wrap"><table className="rx-table no-mobile-stack"><thead><tr><th>类型</th><th>数量</th><th>蓄能额度</th><th>开放领取</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map(row => {
    const principal = row.bizType === 'node' && row.periodKey === 'principal';
    const available = claimable(row, now), remaining = Math.max(0, Number(row.expiresAt) - now);
    const status = row.status !== 'pending' ? row.status === 'claimed' ? '已领取' : '已结束' : principal && now >= row.availableAt ? '本金可领' : now >= row.expiresAt ? '已过期' : now < row.availableAt ? '待生效' : Math.floor(remaining / 3600000) + '小时 ' + Math.floor(remaining % 3600000 / 60000) + '分';
    return <tr key={row.id}><td>{principal ? '矿池本金' : label[row.bizType] || row.bizType}</td><td className="rx-numeric">{formatUnits(row.amountUnits, row.asset === 'USDT' ? 6 : 18, 4)} <small>{row.asset === 'USDT' ? 'USDT' : 'SVX'}</small></td><td>{formatUnits(row.quotaUnits, 18, 4)}</td><td>{date(row.availableAt)}</td><td><span className={'rx-badge ' + (available ? 'is-positive' : '')}>{status}</span></td><td><Button variant="outline" size="sm" disabled={!available || action.busy} onClick={() => claim(row.id)}>领取</Button></td></tr>;
  })}</tbody></table></div>}</CardContent></Card>{action.dialog}</div>;
}
