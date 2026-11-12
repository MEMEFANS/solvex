import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Box, Clock3, Coins, Gem, Pickaxe, Sparkles, Wallet, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, ErrorState, Loading, Metric, useAction } from '@/components/common';
import { PoolInvestDialog, type PoolTier } from '@/components/pool-invest-dialog';
import { ResponsiveAmountForm } from '@/components/responsive-amount-form';
import { MiningScene } from '@/components/mining-scene';
import { usePlans, useProfile } from '@/hooks/use-profile';
import { useWallet } from '@/hooks/use-wallet';
import { post } from '@/lib/api';
import { date, formatDecimal, formatUnits, number, sumDecimal, toUnits } from '@/lib/utils';
import { connectWallet } from '@/lib/wallet';
import { claimable } from './pending';

// 能量是投入类产品，并入矿池页；释放记录仍在这里管理。
function EnergySection() {
  const query = useProfile();
  if (query.error) return <section id="earn-energy" className="rx-play-section"><ErrorState error={query.error} retry={() => void query.refetch()} /></section>;
  if (!query.data) return <section id="earn-energy" className="rx-play-section"><Loading /></section>;
  const records = (query.data.stakes || []).filter(s => s.energy);
  const remaining = sumDecimal(records.filter(s => s.status === 'active').map(s => s.outstandingPrincipal));
  const released = sumDecimal(records.map(s => s.totalEarned));
  return <section id="earn-energy" className="rx-play-section">
    <div className="rx-section-heading"><div><span className="rx-kicker">ENERGY RELEASE</span><h2>能量</h2></div><span>投入 SVX，每日释放 1%，共 100 次</span></div>
    <div className="rx-stack">
      <Card className="rx-metrics rx-metrics-3">
        <Metric label="待释放额度" value={formatDecimal(remaining)} unit="SVX" />
        <Metric label="累计已释放" value={formatDecimal(released)} unit="SVX" />
        <Metric label="释放中" value={records.filter(s => s.status === 'active').length} unit="笔" />
      </Card>
      <div className="rx-energy-grid">
        <Card><CardHeader><CardTitle>投入能量</CardTitle><Zap size={18} /></CardHeader><CardContent><ResponsiveAmountForm mode="energy" /></CardContent></Card>
        <Card><CardHeader><CardTitle>我的能量</CardTitle><span className="rx-muted">{records.length} 笔</span></CardHeader><CardContent>{!records.length ? <Empty>暂无能量记录</Empty> : <div className="rx-positions rx-positions-scroll">{records.map(s => <div className="rx-position" key={s.id}><div className="rx-position-head"><span className="rx-icon"><Zap size={20} /></span><h3>能量</h3><span className="rx-badge">{s.status === 'active' ? '释放中' : '已释放完毕'}</span></div><div className="rx-position-principal"><span>原始额度</span><strong>{formatDecimal(s.principal)} <small>SVX</small></strong></div><div className="rx-position-stats"><div><span>每日释放</span><strong>{formatDecimal(s.dayEarned)} SVX</strong></div><div><span>剩余额度</span><strong>{formatDecimal(s.outstandingPrincipal)} SVX</strong></div></div><div className="rx-progress"><i style={{ width: Math.min(100, s.energyDays || 0) + '%' }} /></div><div className="rx-position-foot"><span>已释放 {formatDecimal(s.totalEarned)} SVX</span><span>{s.energyDays || 0} / 100 次</span></div></div>)}</div>}</CardContent></Card>
      </div>
    </div>
  </section>;
}

export default function PoolPage({ changeTab }: { changeTab: (value: string) => void }) {
  const profile = useProfile(), plans = usePlans(), wallet = useWallet(), action = useAction();
  const [invest, setInvest] = useState<PoolTier | null>(null);
  const p = profile.data, term = p?.nodeTerm || plans.data?.nodes;
  const nodes = p?.nodes || [];
  const activeNodes = nodes.filter(n => n.status === 'active' && Number(n.expiresAt) > Date.now());
  const active = activeNodes.length;
  const loading = wallet.authenticated && profile.isPending && !profile.error;
  const tiers: (PoolTier & { Icon: typeof Box })[] = term ? [
    { title: '铜矿', min: term.minCoins, max: term.midCoins, rate: term.lowRatePct, tone: 'copper', Icon: Box },
    { title: '银矿', min: term.midCoins, max: term.highCoins, rate: term.midRatePct, tone: 'silver', Icon: Gem },
    { title: '金矿', min: term.highCoins, rate: term.highRatePct, tone: 'gold', Icon: Sparkles },
  ] : [];
  const sceneCounts = { copper: 0, silver: 0, gold: 0 };
  for (const node of activeNodes) {
    const principal = toUnits(String(node.principal));
    const tier = tiers.find(t => principal >= toUnits(String(t.min)) && (t.max === undefined || principal < toUnits(String(t.max))));
    if (tier?.tone) sceneCounts[tier.tone] += 1;
  }
  const connect = () => connectWallet();
  function investTier(tier: PoolTier) {
    if (!wallet.authenticated) { connect(); return; }
    setInvest(tier);
  }
  const amount = (value: string | number) => loading ? <Skeleton className="rx-value-skeleton" /> : p ? value : '—';
  const summary = p?.pendingSummary;
  const claimUsdt = BigInt(summary?.claimableUsdtUnits || '0');
  const canClaim = (p?.pending || []).some(row => claimable(row, Date.now()));
  const claimAll = () => void action.run('领取全部收益', '确认领取当前所有可领取记录？已过期的记录无法领取。', async () => {
    const result = await post<{ claimed?: { error?: string }[] }>('a-token/pending/claim-all', {});
    const failed = (result.claimed || []).filter(r => r.error).length;
    return failed ? '部分领取完成，' + failed + ' 条未领取，请核对明细' : '领取完成，已计入主余额';
  });
  const scene = <MiningScene authenticated={wallet.authenticated} counts={sceneCounts} activeCount={active} loading={loading} error={Boolean(profile.error)} onConnect={connect} />;
  const positions = <Card className="rx-pool-holdings">
    <CardHeader><CardTitle>我的矿池</CardTitle><span className="rx-muted">{p ? nodes.length + ' 份持仓' : '同步持仓'}</span></CardHeader>
    <CardContent>
      {loading ? <div className="rx-position-skeleton" role="status" aria-label="正在同步矿池持仓"><Skeleton /><Skeleton /><Skeleton /></div> : profile.error && !p ? <Empty>数据暂未同步，请点击上方重试</Empty> : !nodes.length ?
        <div className="rx-pool-empty"><span className="rx-icon"><Pickaxe size={25} /></span><h3>你的第一份矿池，等待开启</h3><p>买入 SVX 到蓄能额度后，在上方选择矿池卡片投入。</p><div><Button variant="outline" onClick={() => void window.switchTab('a-token-trade')}>买入 SVX</Button></div></div> :
        <div className="rx-positions">{nodes.map(node => <div className="rx-position" key={node.id}>
          <div className="rx-position-head"><span className="rx-icon"><Pickaxe size={20} /></span><div><h3>SVX 矿池</h3><small>{node.days} 天 · 总利息 {node.ratePct}%</small></div><span className={'rx-badge ' + (node.status === 'active' ? 'is-positive' : '')}>{node.statusLabel || (node.status === 'active' ? '运行中' : '已到期')}</span></div>
          <div className="rx-position-principal"><span>投入本金</span><strong>{formatDecimal(node.principal)} <small>SVX</small></strong></div>
          <div className="rx-position-stats"><div><span>周期总利息</span><strong>{formatDecimal(node.interest)} SVX</strong></div><div><span>到期时间</span><strong>{date(node.expiresAt)}</strong></div></div>
          <div className="rx-progress" role="progressbar" aria-label="矿池周期进度" aria-valuenow={Math.max(0, Math.min(100, node.progressPct || 0))} aria-valuemin={0} aria-valuemax={100}><i style={{ width: Math.max(0, Math.min(100, node.progressPct || 0)) + '%' }} /></div>
          <div className="rx-position-foot"><span>周期进度</span><span>{number(node.progressPct)}%</span></div>
        </div>)}</div>}
    </CardContent>
  </Card>;
  // 待领取从独立页签收进矿池顶部：一眼看到总额，直接一键领取，明细再进「领取」。
  const claimStrip = <section className="rx-claim-strip" aria-label="待领取收益">
    <div className="rx-claim-main">
      <span className="rx-claim-icon"><Coins size={20} /></span>
      <div className="rx-claim-copy">
        <span className="rx-claim-label"><span className={'rx-status-dot ' + (canClaim ? 'is-live' : '')} />待领取</span>
        <strong>{amount(formatUnits(summary?.claimableUnits))}<small>SVX</small></strong>
        {claimUsdt > 0n && <span className="rx-claim-usdt">+ {formatUnits(summary?.claimableUsdtUnits, 6)} USDT 分红</span>}
      </div>
    </div>
    <div className="rx-claim-actions">
      <Button onClick={claimAll} disabled={!canClaim || action.busy}>一键领取</Button>
      <Button variant="ghost" onClick={() => changeTab('pending')}>明细 <ArrowRight size={15} /></Button>
    </div>
    {action.dialog}
  </section>;
  return <div className="rx-stack rx-pool-page">
    {wallet.authenticated ? <>
      {profile.error && <ErrorState error={profile.error} retry={() => void profile.refetch()} />}
      <section className="rx-pool-summary" aria-label="账户概览">
        {claimStrip}
        <Card className="rx-metrics" aria-busy={loading}>
          <Metric label="蓄能额度可用余额" value={amount(formatUnits(p?.zones.alpha))} unit="SVX" icon={<Wallet size={18} />} />
          <Metric label="运行中矿池" value={amount(active)} unit="份" icon={<Pickaxe size={18} />} />
          <Metric label="待生效收益" value={amount(formatUnits(summary?.waitingUnits))} unit="SVX" icon={<Clock3 size={18} />} />
          <Metric label="6 小时内过期" value={amount(formatUnits(summary?.expiringSoonUnits))} unit="SVX" icon={<Coins size={18} />} />
        </Card>
      </section>
    </> : <Card className="rx-getting-started">
      <div><span>01</span><div><h3>连接钱包</h3><p>查看你的余额与持仓</p></div></div>
      <div><span>02</span><div><h3>准备 SVX</h3><p>在 SVX 交易中买入至蓄能额度</p></div></div>
      <div><span>03</span><div><h3>投入矿池</h3><p>在矿池卡片中选择数量</p></div></div>
    </Card>}
    <div className="rx-pool-live is-panorama"><div className="rx-pool-live-scene">{scene}</div></div>
    <section className="rx-pool-tiers-section" aria-labelledby="rx-pool-tiers-title">
      <div className="rx-section-heading"><div><span className="rx-kicker">EXPLORE THE POOLS</span><h2 id="rx-pool-tiers-title">选择你的矿池</h2></div><span>按投入数量自动分档</span></div>
      {plans.error && !term ? <ErrorState error={plans.error} retry={() => void plans.refetch()} /> : !term ? <Loading /> :
        <div className="rx-tiers">{tiers.map((t, i) => <Card className={'rx-tier rx-tier-' + i} data-tone={t.tone} key={t.title}>
          <div className="rx-tier-top"><span className="rx-tier-icon"><t.Icon size={22} strokeWidth={1.5} /></span><span>{term.days} 天周期</span></div>
          <h3>{t.title}</h3><div className="rx-tier-rate">{t.rate}<span>%</span></div><p>周期总利息</p>
          <div className="rx-tier-min"><strong>{formatDecimal(t.min, 0)}</strong> SVX 起</div><small>{t.max ? '少于 ' + formatDecimal(t.max, 0) + ' SVX' : '按投入数量匹配档位'}</small>
          <Button className="rx-tier-invest" variant="outline" onClick={() => investTier(t)}>投入矿池 <ArrowUpRight /></Button>
        </Card>)}</div>}
      <p className="rx-pool-note"><Clock3 size={15} />利息每日 08:00 进入待领取；本金到期可领，不作废。</p>
    </section>
    {wallet.authenticated && positions}
    {wallet.authenticated && <EnergySection />}
    <PoolInvestDialog tier={invest} tiers={tiers} term={term ?? null} open={Boolean(invest)} onOpenChange={next => { if (!next) setInvest(null); }} />
  </div>;
}
