import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpRight, Check, ChevronRight, Clock3, Coins, Handshake, LockKeyhole, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { api, post, postSigned, walletIdentity } from '@/lib/api';
import { date, formatDecimal, percent, sumDecimal, toUnits, units } from '@/lib/utils';
import { useWallet } from '@/hooks/use-wallet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Empty, ErrorState, Gate, Loading, Metric, PageHeading, useAction } from '@/components/common';
import type { Team } from '@/types';
import './partner-plan.css';

interface Dividend { id: string; amountSvx: string; availableAt: number; expiresAt: number; status?: string }
interface DividendRecord { id: string; bizType: string; asset?: string; amountUnits: string; availableAt: number; expiresAt: number; status: string; claimedAt?: number }
interface Tier { key: string; label: string; priceUsdt: string; enabled: boolean; members: number; maxMembers: number; dividendPct: number; fundedTotalSvx: string; currentPool?: { progressPct: number; fundedSvx: string } }
interface PartnerState {
  tiers: Tier[];
  member?: { status: string; tier: string; tierLabel: string; principalUsdt: string; dividendSvx: string; s3Qualified: boolean; qualificationDeadline: number };
  dividends: Dividend[];
  pools: { id: string; tierLabel: string; seq: number; fundedSvx: string; status: string }[];
  feeBurn?: { totalFeeSvx: string; totalBurnSvx: string; totalPoolSvx: string; entries?: { id: string; createdAt: number; feeSvx: string; burnSvx: string; poolSvx: string }[] };
}
type DividendFilter = 'pending' | 'claimed' | 'expired' | 'reversed';
const filters: Record<DividendFilter, string> = { pending: '待领取', claimed: '已领取', expired: '已过期', reversed: '已撤回' };
const canClaim = (row: Dividend, now: number) => (!row.status || row.status === 'pending') && now >= row.availableAt && now < row.expiresAt;
const duration = (milliseconds: number) => {
  if (milliseconds <= 0) return '已截止';
  if (milliseconds >= 86400000) return `剩余 ${Math.ceil(milliseconds / 86400000)} 天`;
  const minutes = Math.ceil(milliseconds / 60000);
  return `剩余 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
};

function Table({ headings, children }: { headings: string[]; children: ReactNode }) { return <div className="rx-table-wrap pp-table"><table className="rx-table no-mobile-stack"><thead><tr>{headings.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function CompactEmpty({ children }: { children: ReactNode }) { return <div className="pp-empty"><Empty>{children}</Empty></div>; }

function QualificationProgress({ title, current, target }: { title: string; current: string; target: string }) {
  const currentUnits = toUnits(current), targetUnits = toUnits(target), complete = currentUnits >= targetUnits;
  const labelId = useId();
  return <div className={'pp-qualification-progress' + (complete ? ' is-complete' : '')}>
    <div className="pp-progress-title"><span id={labelId}>{title}</span><span>{complete ? <><Check size={12} />已完成</> : `还差 ${formatDecimal(units(targetUnits - currentUnits))} SVX`}</span></div>
    <div className="pp-progress-amount"><strong>{formatDecimal(current)}</strong><span>/ {formatDecimal(target)} SVX</span></div>
    <div className="pp-progress-track" role="progressbar" aria-labelledby={labelId} aria-valuenow={Math.floor(percent(current, target))} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${formatDecimal(current)} / ${formatDecimal(target)} SVX`}><i style={{ width: percent(current, target) + '%' }} /></div>
  </div>;
}

function PartnerContent({ data, team, teamError, retryTeam, refresh }: { data: PartnerState; team?: Team; teamError: Error | null; retryTeam: () => void; refresh: () => Promise<unknown> }) {
  const action = useAction(), wallet = useWallet(), member = data.member, active = member?.status === 'active';
  const [now, setNow] = useState(Date.now());
  const [recordTab, setRecordTab] = useState('dividends');
  const [dividendFilter, setDividendFilter] = useState<DividendFilter>('pending');
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const history = useQuery({
    queryKey: ['partner-dividends', wallet.address, wallet.revision, dividendFilter],
    queryFn: ({ signal }) => api<{ pending: DividendRecord[] }>(`a-token/pending?status=${dividendFilter}&limit=1000`, { signal }),
    enabled: wallet.authenticated && recordTab === 'dividends' && dividendFilter !== 'pending',
  });
  const pending = data.dividends || [], ready = pending.filter(row => canClaim(row, now));
  const readyTotal = sumDecimal(ready.map(row => row.amountSvx), 6);
  const nextExpiry = ready.length ? Math.min(...ready.map(row => row.expiresAt)) : 0;
  const future = pending.filter(row => (!row.status || row.status === 'pending') && row.availableAt > now).sort((a, b) => a.availableAt - b.availableAt);
  const readyIds = new Set(ready.map(row => row.id));
  const requirement = team?.TEAM_LEVELS?.find(level => level.level === 3);
  const deadline = active ? member.qualificationDeadline : 0;
  const qualified = active ? member.s3Qualified : team ? toUnits(team.upgradeA) >= toUnits(String(requirement?.warehouse ?? '5000')) && toUnits(team.teamPerfA) >= toUnits(String(requirement?.teamPerf ?? '100000')) && team.level >= 3 : false;
  const pendingHistory = pending.map(row => ({ ...row, status: row.status || 'pending' }));
  const historicalRows = (history.data?.pending || []).filter(row => row.bizType === 'dividend' && row.asset === 'A').map(row => ({ ...row, amountSvx: units(row.amountUnits, 18) }));
  const records = dividendFilter === 'pending' ? pendingHistory : [...new Map([
    ...(dividendFilter === 'expired' ? pendingHistory.filter(row => row.status === 'pending' && now >= row.expiresAt) : []), ...historicalRows,
  ].map(row => [row.id, row])).values()];
  const availableTiers = (data.tiers || []).filter(tier => tier.enabled || active && member.tier === tier.key);
  const reservedTiers = (data.tiers || []).filter(tier => !tier.enabled && !(active && member.tier === tier.key));

  const join = (tier: Tier) => void action.run('加入合伙人', '支付 ' + tier.priceUsdt + ' USDT 加入' + tier.label + '。加入后 30 天内需满足 V3 双条件：升级舱 5,000 SVX、团队业绩 100,000 SVX。', async () => {
    await postSigned('a-token/shareholder/join', { tier: tier.key }, 'partner', (id, ts) => 'Solvex 股东加入确认：' + tier.label + '，支付 ' + tier.priceUsdt + ' USDT，编号 ' + id + '，时间：' + ts);
    return '已加入合伙人';
  });
  const claimDividends = (ids: string[]) => {
    const rows = pending.filter(row => ids.includes(row.id) && canClaim(row, Date.now()));
    if (!rows.length) return;
    const total = sumDecimal(rows.map(row => row.amountSvx), 6), identity = walletIdentity();
    void action.run('领取合伙人分红', `确认领取 ${rows.length} 笔分红，共 ${formatDecimal(total, 6)} SVX 到主余额？`, async () => {
      let completed = 0;
      try {
        // 仅领取用户在合伙人页面选择的分红。
        for (const row of rows) {
          if (walletIdentity() !== identity) throw new Error('钱包已切换，请重新核对记录');
          try { await post('a-token/pending/claim', { id: row.id }); completed += 1; }
          catch (error) {
            if (!completed) throw error;
            return `已领取 ${completed} 笔，其余未完成：${error instanceof Error ? error.message : '请刷新核对明细'}`;
          }
        }
        return `已领取 ${completed} 笔分红，已计入 SVX 主余额`;
      } finally { if (walletIdentity() === identity) void refresh(); }
    });
  };
  const showDividends = () => { setRecordTab('dividends'); setDividendFilter('pending'); document.getElementById('partner-records')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  return <div className="rx-stack pp-content" data-native-ecosystem="shareholder">
    <Card className="rx-metrics rx-metrics-3"><Metric label="我的身份" value={active ? member.tierLabel : '未加入'} /><Metric label="已领取分红" value={formatDecimal(member?.dividendSvx ?? '0', 6)} unit="SVX" /><Metric label="V3 资格" value={active ? qualified ? '已达标' : '待达标' : !team ? '同步中' : qualified ? '已满足条件' : '待完成'} /></Card>

    <Card className="pp-dividend-hero" data-partner-dividends>
      <div className="pp-dividend-copy"><span className="pp-eyebrow"><span className="pp-live-dot" />当前可领取分红</span><div className="pp-dividend-total"><strong>{formatDecimal(readyTotal, 6)}</strong><span>SVX</span></div><p>{ready.length ? <><Clock3 size={13} />{ready.length} 笔待领取 · 最早截止 {date(nextExpiry)}</> : future.length ? <><Clock3 size={13} />下一笔开放 {date(future[0].availableAt)}</> : <><Coins size={13} />暂无可领取分红，结算后会在这里显示</>}</p></div>
      <div className="pp-dividend-actions"><Button data-partner-claim disabled={action.busy || !ready.length} onClick={() => claimDividends(ready.map(row => row.id))}><ArrowDownToLine size={17} />领取分红{ready.length > 0 && <span>{ready.length}</span>}</Button><button type="button" className="pp-text-button" onClick={showDividends}>查看分红记录 <ChevronRight size={13} /></button></div>
      <div className="pp-dividend-timing"><span>北京时间 08:00 结算 · 次日 08:00 前手动领取</span><span>到账资产 SVX · 进入主余额</span></div>
    </Card>

    <div className="pp-dashboard">
      <div className="pp-plan-column">
        {availableTiers.map(tier => {
          const full = tier.maxMembers > 0 && tier.members >= tier.maxMembers, mine = active && member.tier === tier.key;
          return <Card className={'pp-tier-card' + (mine ? ' is-current' : '')} key={tier.key}>
            <div className="pp-tier-heading"><span className="pp-tier-icon"><Handshake size={22} strokeWidth={1.6} /></span><div><h2>{formatDecimal(tier.priceUsdt)} <small>USDT / 份</small></h2><p>合伙人计划</p></div><span className={'pp-status-pill' + (mine ? ' is-good' : '')}>{mine ? '当前档位' : full ? '名额已满' : tier.enabled ? '开放加入' : '暂不开放'}</span></div>
            <div className="pp-tier-share"><div><strong>{tier.dividendPct}<small>%</small></strong><span>该档分红池占比</span></div><p>按本档符合资格的合伙人分配</p></div>
            <div className="pp-tier-seats"><div><span>{tier.maxMembers > 0 ? `全平台限 ${tier.maxMembers} 份` : '本档参与名额'}</span><strong>{tier.maxMembers > 0 ? <>剩余 <b>{Math.max(0, tier.maxMembers - tier.members)}</b> 份</> : `${tier.members} 人已加入`}</strong></div>{tier.maxMembers > 0 && <><div className="pp-progress-track pp-seat-track"><i style={{ width: percent(tier.members, tier.maxMembers) + '%' }} /></div><small>已加入 {tier.members} / {tier.maxMembers} 份</small></>}</div>
            <Button className="pp-join-button" disabled={action.busy || active || !tier.enabled || full} onClick={() => join(tier)}>{!tier.enabled ? '暂不开放' : mine ? '已加入 · 当前档位' : active ? '已加入合伙人' : full ? '名额已满' : '加入 ' + tier.label}{!active && tier.enabled && !full && <ArrowUpRight size={16} />}</Button>
            <div className="pp-tier-pool"><span>本档当前归集 <b>{formatDecimal(tier.currentPool?.fundedSvx ?? '0')} SVX</b></span><span>累计 {formatDecimal(tier.fundedTotalSvx)} SVX</span></div>
          </Card>;
        })}
        {reservedTiers.map(tier => <Card className="pp-reserved-tier" key={tier.key}><span className="pp-reserved-icon"><LockKeyhole size={17} /></span><div><strong>{formatDecimal(tier.priceUsdt)} USDT 档</strong><p>该档分红池占比 {tier.dividendPct}% · 分红留存</p></div><Button variant="outline" size="sm" disabled>暂不开放</Button></Card>)}
      </div>

      <Card className="pp-qualification-card" data-partner-qualification>
        <div className="pp-card-heading"><span className="pp-section-icon"><ShieldCheck size={20} /></span><div><h2>V3 资格进度</h2><p>升级舱与团队业绩需同时满足</p></div>{(team || active) && <span className={'pp-status-pill' + (qualified ? ' is-good' : '')}>{qualified ? '已达标' : '待达标'}</span>}</div>
        <div className={'pp-qualification-deadline' + (active && !qualified && deadline <= now ? ' is-overdue' : '')}><Clock3 size={15} /><div><strong>{active ? qualified ? '资格已满足，请保持 V3 条件' : duration(deadline - now) : '加入后 30 天内完成资格'}</strong><span>{active ? `达标截止 ${date(deadline)} · 北京时间` : '可先查看当前进度，再决定加入'}</span></div></div>
        {teamError ? <ErrorState error={teamError} retry={retryTeam} /> : !team ? <div className="pp-qualification-loading"><Loading /></div> : <div className="pp-progress-list"><QualificationProgress title="个人升级舱" current={team.upgradeA} target={String(requirement?.warehouse ?? '5000')} /><QualificationProgress title="团队业绩" current={team.teamPerfA} target={String(requirement?.teamPerf ?? '100000')} /></div>}
        <div className="pp-qualification-footer"><span><Sparkles size={13} />升级舱投入不计收益</span><Button variant="outline" size="sm" onClick={() => void window.switchTab('referrals')}>查看团队 <ArrowUpRight size={13} /></Button></div>
      </Card>
    </div>

    <Card className="pp-records-card" id="partner-records">
      <div className="pp-records-heading"><h2>收支与记录</h2><span>分红结算与资金归集明细</span></div>
      <Tabs value={recordTab} onValueChange={setRecordTab}>
        <TabsList className="pp-record-tabs" aria-label="合伙人记录"><TabsTrigger value="dividends">分红记录</TabsTrigger><TabsTrigger value="fees">手续费记录</TabsTrigger><TabsTrigger value="pools">分红池记录</TabsTrigger></TabsList>
        <TabsContent value="dividends" className="pp-record-panel">
          <div className="pp-record-toolbar"><p>领取窗口内操作，过期分红作废。</p><label><span className="sr-only">分红状态</span><select aria-label="分红状态" value={dividendFilter} onChange={event => setDividendFilter(event.target.value as DividendFilter)}>{Object.entries(filters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          {dividendFilter !== 'pending' && history.error ? <ErrorState error={history.error} retry={() => void history.refetch()} /> : dividendFilter !== 'pending' && !history.data ? <Loading /> : !records.length ? <CompactEmpty>{dividendFilter === 'pending' ? '暂无待领取分红' : `暂无${filters[dividendFilter]}分红记录`}</CompactEmpty> : <Table headings={['分红金额', '开放领取', dividendFilter === 'claimed' ? '领取时间' : '领取截止', '状态', ...(dividendFilter === 'pending' ? ['操作'] : [])]}>{records.map(row => {
            const readyNow = readyIds.has(row.id) && canClaim(row, now);
            const status = row.status === 'pending' ? now >= row.expiresAt ? '已过期' : now < row.availableAt ? '待开放' : '待领取' : filters[row.status as DividendFilter] || '已结束';
            return <tr key={row.id}><td className="pp-numeric">{formatDecimal(row.amountSvx, 6)} <small>SVX</small></td><td>{date(row.availableAt)}</td><td>{date(dividendFilter === 'claimed' && 'claimedAt' in row ? Number(row.claimedAt) : row.expiresAt)}</td><td><span className={'pp-record-status' + (readyNow ? ' is-ready' : '')}>{status}</span></td>{dividendFilter === 'pending' && <td><Button size="sm" variant="outline" disabled={action.busy || !readyNow} onClick={() => claimDividends([row.id])}>领取</Button></td>}</tr>;
          })}</Table>}
          {dividendFilter !== 'pending' && <p className="pp-history-note">显示近期收益记录中的合伙人分红。</p>}
        </TabsContent>
        <TabsContent value="fees" className="pp-record-panel">
          <p className="pp-fee-rule">卖出手续费按成交 SVX 数量扣 5%：50% 用于销毁，50% 进入合伙人分红池；买入手续费为 0。</p>
          <div className="pp-fee-totals"><div><span>累计手续费</span><strong>{formatDecimal(data.feeBurn?.totalFeeSvx ?? '0')} <small>SVX</small></strong></div><div><span>累计销毁</span><strong>{formatDecimal(data.feeBurn?.totalBurnSvx ?? '0')} <small>SVX</small></strong></div><div><span>分红归集</span><strong>{formatDecimal(data.feeBurn?.totalPoolSvx ?? '0')} <small>SVX</small></strong></div></div>
          {!data.feeBurn?.entries?.length ? <CompactEmpty>暂无手续费记录</CompactEmpty> : <Table headings={['时间', '手续费', '销毁', '分红归集']}>{data.feeBurn.entries.slice(0, 100).map(row => <tr key={row.id}><td>{date(row.createdAt)}</td><td>{formatDecimal(row.feeSvx, 6)}</td><td>{formatDecimal(row.burnSvx, 6)}</td><td>{formatDecimal(row.poolSvx, 6)}</td></tr>)}</Table>}
        </TabsContent>
        <TabsContent value="pools" className="pp-record-panel">
          <p className="pp-fee-rule">30% / 70% 为各档在合伙人分红池中的分配占比，个人分红以实际结算为准。</p>
          {!data.pools?.length ? <CompactEmpty>暂无分红池记录</CompactEmpty> : <Table headings={['档位', '池序号', '归集金额（SVX）', '状态']}>{data.pools.slice(0, 100).map(row => <tr key={row.id}><td>{row.tierLabel}</td><td>#{row.seq}</td><td className="pp-numeric">{formatDecimal(row.fundedSvx, 6)}</td><td><span className="pp-record-status">{row.status === 'settled' ? '已分红' : row.status === 'closed' ? '待分红' : '归集中'}</span></td></tr>)}</Table>}
        </TabsContent>
      </Tabs>
    </Card>

    {active && <details className="pp-membership-management"><summary>身份管理 <ChevronRight size={13} /></summary><div><p>撤回后全额返还 USDT 本金，未领取分红作废。</p><Button variant="outline" size="sm" disabled={action.busy} onClick={() => void action.run('撤回合伙人身份', '本金 ' + member.principalUsdt + ' USDT 全额返还；未领取分红作废。', async () => { await post('a-token/shareholder/withdraw', {}); return '合伙人身份已撤回'; })}>撤回身份</Button></div></details>}
    {action.dialog}
  </div>;
}

export default function PartnerPlanPage() {
  const wallet = useWallet(), client = useQueryClient();
  const query = useQuery({ queryKey: ['ecosystem', 'shareholder', wallet.address, wallet.revision], queryFn: ({ signal }) => api<PartnerState>('a-token/shareholder', { signal }), enabled: wallet.authenticated, refetchInterval: 60000 });
  const team = useQuery({ queryKey: ['team', wallet.address, wallet.revision], queryFn: ({ signal }) => api<Team>('a-token/team/profile', { signal }), enabled: wallet.authenticated, refetchInterval: 60000 });
  const refresh = () => Promise.allSettled([query.refetch(), team.refetch(), client.invalidateQueries({ queryKey: ['partner-dividends'] })]);
  return <div className="rx-page rx-partner-plan">
    <PageHeading title="合伙人计划" subtitle="你的合伙人身份、资格进度与分红。"><Button variant="outline" size="icon" aria-label="刷新合伙人计划" disabled={!wallet.authenticated || query.isFetching || team.isFetching} onClick={() => void refresh()}><RefreshCw size={17} /></Button></PageHeading>
    {!wallet.authenticated ? <Gate description="连接并确认钱包，查看合伙人计划与分红权益" /> : query.error ? <ErrorState error={query.error} retry={() => void query.refetch()} /> : !query.data ? <Loading /> : <PartnerContent key={wallet.address + ':' + wallet.revision} data={query.data} team={team.data} teamError={team.error} retryTeam={() => void team.refetch()} refresh={refresh} />}
  </div>;
}
