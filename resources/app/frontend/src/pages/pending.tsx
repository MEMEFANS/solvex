import { canRetainQueryData } from '@/lib/page-cache';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, Clock3, Coins } from 'lucide-react';
import { useProfile } from '@/hooks/use-profile';
import { useWallet } from '@/hooks/use-wallet';
import { useBoundaryClock } from '@/hooks/use-boundary-clock';
import { api, post } from '@/lib/api';
import { date, formatUnits, short } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Empty, ErrorState, Gate, Loading, Metric, useAction } from '@/components/common';
import type { Pending } from '@/types';
const label: Record<string, string> = { node: '矿池利息', stake: '能量释放', team: '团队收益', dividend: '股东分红', blindbox: '盲盒释放', miner: '历史矿机' };
const teamLabel = (row: Pending) => row.kind === 'node_direct' || row.kind === 'stake_direct' ? '直推奖励' : row.kind === 'node_level_diff' ? '团队级差' : '团队收益';
function RewardType({ row }: { row: Pending }) {
  if (row.bizType !== 'team') return <>{row.bizType === 'node' && row.periodKey === 'principal' ? '矿池本金' : label[row.bizType] || row.bizType}</>;
  return <><span>{teamLabel(row)}{row.rateBps != null ? ` ${row.rateBps / 100}%` : ''}</span>{row.sourceWallet && <div className="rx-muted" title={row.sourceWallet}>来源 {short(row.sourceWallet)}</div>}</>;
}
export function claimable(row: Pending, now: number) { return row.status === 'pending' && now >= Number(row.availableAt) && (row.bizType === 'node' && row.periodKey === 'principal' || now < Number(row.expiresAt)); }
function RemainingTime({ expiresAt }: { expiresAt: number }) {
  const now = useBoundaryClock([expiresAt], 60000), remaining = Math.max(0, expiresAt - now);
  return <>{Math.floor(remaining / 3600000)}小时 {Math.floor(remaining % 3600000 / 60000)}分</>;
}
export default function PendingPage({ teamOnly = false }: { teamOnly?: boolean }) {
  const query = useProfile(), wallet = useWallet(), action = useAction('claim');
  const [historyVisible, setHistoryVisible] = useState(false);
  const history = useQuery({ queryKey: ['reward-history', wallet.address, wallet.revision], queryFn: ({ signal }) => api<{ pending: Pending[] }>('a-token/pending?status=all&limit=1000', { signal }), enabled: historyVisible && wallet.authenticated });
  useEffect(() => { setHistoryVisible(false); }, [wallet.address, wallet.revision]);
  const pending = query.data?.pending || [];
  const boundaries = pending.filter(row => row.status === 'pending').flatMap(row => row.bizType === 'node' && row.periodKey === 'principal' ? [row.availableAt] : [row.availableAt, row.expiresAt, row.expiresAt - 6 * 3600000]);
  const now = useBoundaryClock(boundaries);
  const previousTime = useRef(now);
  useEffect(() => {
    const crossed = boundaries.some(time => time > previousTime.current && time <= now);
    previousTime.current = now;
    if (crossed && wallet.authenticated) void query.refetch();
  }, [now, wallet.authenticated]);
  if (!wallet.authenticated) return <Gate />;
  if (query.error && !canRetainQueryData(query)) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  const rows = pending.filter(r => !teamOnly || r.bizType === 'team');
  const ready = rows.filter(row => claimable(row, now));
  const received = (canRetainQueryData(history) ? history.data?.pending || [] : []).filter(row => !teamOnly || row.bizType === 'team').sort((a, b) => Number(b.claimedAt || b.createdAt || b.availableAt) - Number(a.claimedAt || a.createdAt || a.availableAt));
  const directReady = ready.filter(row => row.bizType === 'team' && ['node_direct', 'stake_direct'].includes(row.kind || ''));
  const diffReady = ready.filter(row => row.bizType === 'team' && row.kind === 'node_level_diff');
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
    {teamOnly && <><Metric label="直推可领取" value={formatUnits(directReady.reduce((n, r) => n + BigInt(r.amountUnits), 0n), 18, 4)} unit="SVX" /><Metric label="级差可领取" value={formatUnits(diffReady.reduce((n, r) => n + BigInt(r.amountUnits), 0n), 18, 4)} unit="SVX" /></>}
    {!teamOnly && <><Metric label="6 小时内过期" value={formatUnits(s?.expiringSoonUnits)} unit="SVX" /><Metric label="分红可领取" value={formatUnits(s?.claimableUsdtUnits, 6)} unit="USDT" /></>}
  </Card><Card><CardHeader><CardTitle>{teamOnly ? '团队待领取收益' : '待领取明细'}</CardTitle>{!teamOnly && <Button size="sm" disabled={action.busy || !ready.length} onClick={claimAll}><ArrowDownToLine />一键领取</Button>}</CardHeader><CardContent><p className="rx-note">{teamOnly ? '下级个人成功领取矿池利息后，才产生团队收益；生成后立即可领，24 小时未领取作废。' : '矿池日利息每天 08:00 开放，次日 08:00 未领取作废；团队收益在下级领取后生成，24 小时未领取作废。到期本金不作废。'}</p>{!rows.length ? <Empty>暂无待领取记录</Empty> : <div className="rx-table-wrap"><table className="rx-table no-mobile-stack"><thead><tr><th>类型</th><th>数量</th><th>蓄能额度</th><th>开放领取</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map(row => {
    const principal = row.bizType === 'node' && row.periodKey === 'principal';
    const available = claimable(row, now);
    const status = row.status !== 'pending' ? row.status === 'claimed' ? '已领取' : row.status === 'expired' ? '已过期未领取' : '已撤回' : principal && now >= row.availableAt ? '本金可领' : now >= row.expiresAt ? '已过期' : now < row.availableAt ? '待生效' : <RemainingTime expiresAt={Number(row.expiresAt)} />;
    return <tr key={row.id}><td><RewardType row={row} /></td><td className="rx-numeric">{formatUnits(row.amountUnits, row.asset === 'USDT' ? 6 : 18, 4)} <small>{row.asset === 'USDT' ? 'USDT' : 'SVX'}</small></td><td>{formatUnits(row.quotaUnits, 18, 4)}</td><td>{date(row.availableAt)}</td><td><span className={'rx-badge ' + (available ? 'is-positive' : '')}>{status}</span></td><td><Button variant="outline" size="sm" disabled={!available || action.busy} onClick={() => claim(row.id)}>领取</Button></td></tr>;
  })}</tbody></table></div>}</CardContent></Card>
  <Card><CardHeader><CardTitle>{teamOnly ? '团队收益记录详情' : '收益记录详情'}</CardTitle><Button variant="outline" size="sm" aria-expanded={historyVisible} onClick={() => setHistoryVisible(value => !value)}>{historyVisible ? '收起记录详情' : '查看全部记录详情'}</Button></CardHeader><CardContent>
    {teamOnly && <p className="rx-note">显示已领取、待领取和已过期的团队奖励。下级领取矿池利息后才生成团队收益，直推按已领取利息的10%计算，级差按比例差计算；未领取的记录也会保留状态和来源。</p>}
    {!teamOnly && <p className="rx-note">矿池首个结算日即使不足24小时，也按完整一天计；每笔最多发放30个收益日，累计不超过该档位约定总收益。记录详情显示最近1000条矿池、能量、盲盒和团队收益的领取状态。</p>}
    {historyVisible && <div className="rx-team-received">{history.error && !canRetainQueryData(history) ? <ErrorState error={history.error} retry={() => void history.refetch()} /> : !history.data ? <Loading /> : !received.length ? <Empty>暂无收益记录</Empty> : <><p className="rx-note">显示最近1000条记录，包含已领取、待领取、已过期和已撤回状态。</p><div className="rx-table-wrap"><table className="rx-table no-mobile-stack"><thead><tr><th>收益类型</th><th>{teamOnly ? '来源与计算依据' : '记录编号'}</th><th>数量</th><th>生成时间</th><th>领取时间</th><th>状态</th></tr></thead><tbody>{received.map(row => <tr key={row.id}><td><RewardType row={row} /></td><td>{teamOnly ? <><span title={row.sourceWallet}>{row.sourceWallet ? short(row.sourceWallet) : '—'}</span><div className="rx-muted">按 {formatUnits(row.sourceAmountUnits || '0', 18, 6)} SVX 利息 × {row.rateBps == null ? '—' : (row.rateBps / 100) + '%'}</div></> : <span title={row.bizId || row.id}>{short(row.bizId || row.id)}</span>}</td><td>{formatUnits(row.amountUnits, row.asset === 'USDT' ? 6 : 18, 6)} {row.asset === 'USDT' ? 'USDT' : 'SVX'}</td><td>{date(row.createdAt || row.availableAt)}</td><td>{row.status === 'claimed' && row.claimedAt ? date(row.claimedAt) : '—'}</td><td>{row.status === 'claimed' ? '已领取' : row.status === 'pending' ? Number(row.availableAt) > now ? '待生效' : Number(row.expiresAt) <= now && row.periodKey !== 'principal' ? '已过期未领取' : '待领取' : row.status === 'expired' ? '已过期未领取' : row.status === 'reversed' ? '已撤回' : row.status}</td></tr>)}</tbody></table></div></>}</div>}
  </CardContent></Card>{action.dialog}</div>;
}
