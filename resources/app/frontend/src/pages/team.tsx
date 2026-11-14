import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Award, ChevronDown, Copy, Network, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ResponsiveAmountForm } from '@/components/responsive-amount-form';
import { Empty, ErrorState, Gate, Loading, Metric, PageHeading, useAction } from '@/components/common';
import { useProfile } from '@/hooks/use-profile';
import { useWallet } from '@/hooks/use-wallet';
import { api, post } from '@/lib/api';
import { date, formatDecimal, percent, short, toUnits, units } from '@/lib/utils';
import type { Team, Referral, ReferralRow } from '@/types';
// 团队收益页只在对应 tab 用到，懒加载避免拖慢团队页首屏
const PendingPage = lazy(() => import('./pending'));
const tabs: Record<string, string> = { overview:'团队概览', members:'团队成员', rewards:'团队收益', upgrade:'升级舱', invite:'邀请好友', referrals:'交易返佣' };
function ReferralRewards() {
  const wallet = useWallet(), [claiming, setClaiming] = useState(false);
  const query = useQuery({ queryKey:['referral-rewards', wallet.address, wallet.revision], queryFn:({signal}) => api<Referral>('referrals/profile',{signal}), enabled:wallet.authenticated });
  const data = query.data;
  async function claim() {
    if (claiming) return;
    setClaiming(true);
    try { const result = await post<{ amount?: string; count?: number }>('referrals/claim', {}); toast.success(result.count ? `已领取 ${result.amount || '0'} USDT` : '暂无可领取奖励'); await query.refetch(); }
    catch (error) { toast.error(error instanceof Error ? error.message : '领取失败，请重试'); }
    finally { setClaiming(false); }
  }
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!data) return <Loading />;
  const rows = (data.rows || []).filter(row => row.level === 1);
  const amount = (value?: string, digits = 2) => Number(value || 0).toLocaleString('en-US', { minimumFractionDigits:digits, maximumFractionDigits:digits });
  return <div className="rx-stack rx-referral-rewards"><Card className="rx-metrics"><Metric label="有效直推" value={data.directValid ?? 0} unit="人" /><Metric label="无效直推" value={data.directInvalid ?? 0} unit="人" /><Metric label="已获得奖励" value={amount(data.earned)} unit="USDT" /><Metric label="可领取奖励" value={amount(data.claimable)} unit="USDT" /></Card><Card><CardHeader><CardTitle>推荐奖励</CardTitle><span className="rx-muted">直推奖励 {((data.directRate || 0) * 100).toFixed(0)}%</span></CardHeader><CardContent><p className="rx-note">交易手续费和 AI 跟单收益产生的推荐奖励会先进入可领取余额，领取后计入 USDT 账户。</p><Button disabled={claiming || Number(data.claimable || 0) <= 0} onClick={() => void claim()}>{claiming ? '领取中…' : Number(data.claimable || 0) > 0 ? '立即领取' : '暂无可领取奖励'}</Button></CardContent></Card><Card><CardHeader><CardTitle>推荐用户</CardTitle><span className="rx-muted">{rows.length} 位直推成员</span></CardHeader><CardContent>{!rows.length ? <Empty>暂无推荐用户</Empty> : <div className="rx-table-wrap"><table className="rx-table no-mobile-stack"><thead><tr><th>钱包地址</th><th>加入日期</th><th>交易量</th><th>交易手续费</th><th>跟单金额</th><th>您的奖励</th><th>状态</th></tr></thead><tbody>{rows.map((row: ReferralRow) => <tr key={row.wallet}><td><code>{row.shortAddress || row.wallet || '—'}</code></td><td>{row.joinedAt ? new Date(row.joinedAt).toLocaleDateString('zh-CN') : '—'}</td><td>{amount(row.totalVolume)} USDT</td><td>{amount(row.totalFees)} USDT</td><td>{amount(row.managedAmount)} USDT</td><td>{amount(row.myReward)} USDT</td><td>{row.valid ? <span className="rx-badge is-positive">有效</span> : <span className="rx-muted">无效</span>}</td></tr>)}</tbody></table></div>}</CardContent></Card></div>;
}
export default function TeamPage() {
  const [tab, setTab] = useState('overview'), wallet = useWallet(), profile = useProfile(), action = useAction();
  const team = useQuery({ queryKey:['team',wallet.address,wallet.revision], queryFn:({signal}) => api<Team>('a-token/team/profile',{signal}), enabled:wallet.authenticated });
  const referral = useQuery({ queryKey:['referral',wallet.address,wallet.revision], queryFn:({signal}) => api<Referral>('referrals/profile',{signal}), enabled:wallet.authenticated && tab === 'invite' });
  const t = team.data, p = profile.data;
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { tabsRef.current?.querySelector<HTMLElement>('[data-state=active]')?.scrollIntoView({ block:'nearest', inline:'nearest' }); }, [tab]);
  const refresh = () => { void team.refetch(); void profile.refetch(); if(tab === 'invite') void referral.refetch(); if(tab === 'referrals') window.dispatchEvent(new Event('referralrefresh')); };
  async function copy(value: string) { if (await window.copyTextSmart?.(value)) toast.success('已复制'); else toast.error('复制未成功，请长按内容复制'); }
  const link = referral.data?.code ? new URL(referral.data.link || '/?ref=' + encodeURIComponent(referral.data.code), location.origin).href : '';
  const render = () => {
    if (!wallet.authenticated) return <Gate />;
    if (tab === 'rewards') return <Suspense fallback={<Loading />}><PendingPage teamOnly /></Suspense>;
    if (tab === 'referrals') return <ReferralRewards />;
    if (tab === 'invite') return referral.error ? <ErrorState error={referral.error} retry={() => void referral.refetch()} /> : !referral.data ? <Loading /> : <div className="rx-invite-grid"><Card className="rx-invite-hero"><Network size={40} strokeWidth={1} /><span className="rx-kicker">GROW TOGETHER</span><h2>与你的团队<br />一起向前。</h2><p>分享专属邀请链接，连接更多伙伴。</p><div className="rx-invite-code">{referral.data.code || '—'}</div><Button variant="outline" disabled={!referral.data.code} onClick={() => void copy(referral.data!.code)}><Copy />复制邀请码</Button></Card><Card><CardHeader><CardTitle>邀请好友</CardTitle><Users size={18} /></CardHeader><CardContent><p className="rx-note">我的上级邀请码：<code>{t ? (t.directReferrerCode || '未绑定') : '加载中'}</code></p><label className="rx-field-label" htmlFor="invite-link">我的邀请链接</label><textarea className="rx-invite-link" id="invite-link" readOnly value={link} /><Button className="rx-full" disabled={!link} onClick={() => void copy(link)}><Copy />复制邀请链接</Button><div className="rx-info-block"><h3>推荐奖励</h3><p>矿池直推奖励按下级利息的 10% 计算。持有有效矿池才享有动态收益，能量释放不产生利息推广奖励。</p><p>团队级差取自己的等级比例减直接下级比例；同级不奖励并停止向上分配。</p></div></CardContent></Card></div>;
    if (tab === 'upgrade') {
      if (profile.error) return <ErrorState error={profile.error} retry={() => void profile.refetch()} />;
      if (!p?.upgrade) return <Loading />;
      const u = p.upgrade;
      return <div className="rx-stack"><Card className="rx-metrics"><Metric label="生效中" value={formatDecimal(u.activeA)} unit="SVX" /><Metric label="赎回等待中" value={formatDecimal(u.redeemingA)} unit="SVX" /><Metric label="已返还" value={formatDecimal(u.returnedA)} unit="SVX" /><Metric label="可用余额" value={formatDecimal(p.balances.A)} unit="SVX" /></Card><div className="rx-upgrade-grid"><Card><CardHeader><CardTitle>管理升级舱</CardTitle></CardHeader><CardContent><ResponsiveAmountForm mode="upgrade" /></CardContent></Card><Card><CardHeader><CardTitle>升级舱记录</CardTitle><span className="rx-muted">{u.positions.length} 笔</span></CardHeader><CardContent><p className="rx-note">升级舱用于等级判定，不产收益，生效本金计入上级团队业绩。赎回后冲销对应团队业绩并重算等级，本金 30 天后返还。</p>{!u.positions.length ? <Empty>暂无升级舱记录</Empty> : <div className="rx-table-wrap"><table className="rx-table no-mobile-stack"><thead><tr><th>本金</th><th>状态</th><th>进入时间</th><th>返还时间</th><th>操作</th></tr></thead><tbody>{u.positions.map(row => <tr key={row.id}><td>{formatDecimal(row.principalA)} SVX</td><td><span className="rx-badge">{row.status === 'active' ? '生效中' : row.status === 'redeeming' ? '赎回等待' : '已返还'}</span></td><td>{date(row.enteredAt)}</td><td>{date(row.returnAt)}</td><td><Button size="sm" variant="outline" disabled={row.status !== 'active' || action.busy} onClick={() => void action.run('整笔赎回升级舱', '赎回后冲销对应团队业绩并重算等级，本金 30 天后返还，不支持部分赎回。', async () => { await post('a-token/upgrade/redeem', { positionId:row.id }); return '已提交赎回，本金 30 天后返还'; })}>整笔赎回</Button></td></tr>)}</tbody></table></div>}</CardContent></Card></div></div>;
    }
    if (team.error) return <ErrorState error={team.error} retry={() => void team.refetch()} />;
    if (!t) return <Loading />;
    if (tab === 'members') return <div className="rx-stack"><Card className="rx-metrics"><Metric label="直推人数" value={t.directCount} unit="人" /><Metric label="有效用户" value={t.teamValidUsers ?? 0} unit="人" /><Metric label="团队总人数" value={t.teamCount} unit="人" /><Metric label="团队持有" value={formatDecimal(t.teamHoldA)} unit="SVX" /></Card><Card><CardHeader><CardTitle>直推成员</CardTitle><span className="rx-muted">{t.directs?.length || 0} 位成员</span></CardHeader><CardContent>{!t.directs?.length ? <Empty>暂无成员，分享邀请链接开启你的团队</Empty> : <div className="rx-table-wrap rx-team-members-desktop"><table className="rx-table no-mobile-stack"><thead><tr><th>成员钱包</th><th>身份</th><th>等级</th><th>升级舱</th><th>团队业绩</th><th>持有 SVX</th><th>直推人数</th><th>加入时间</th></tr></thead><tbody>{t.directs.map(member => <tr key={member.wallet}><td title={member.wallet}><code>{short(member.wallet)}</code></td><td>{member.validUser ? <span className="rx-badge is-positive">有效用户</span> : <span className="rx-muted">未激活</span>}</td><td><span className="rx-badge">V{member.level}</span></td><td>{formatDecimal(member.upgradeA)}</td><td>{formatDecimal(member.teamPerfA)}</td><td>{formatDecimal(member.personalA)}</td><td>{member.directCount}</td><td>{date(member.joinedAt)}</td></tr>)}</tbody></table></div>}<div className="rx-team-members-mobile">{t.directs?.map(member => <details className="rx-team-member" key={member.wallet}><summary><code>{short(member.wallet)}</code><span className="rx-badge">V{member.level}</span>{member.validUser && <span className="rx-badge is-positive">有效</span>}<small>详情 ⌄</small></summary><dl><div><dt>身份</dt><dd>{member.validUser ? '有效用户（持有矿池）' : '未激活'}</dd></div><div><dt>升级舱</dt><dd>{formatDecimal(member.upgradeA)} SVX</dd></div><div><dt>团队业绩</dt><dd>{formatDecimal(member.teamPerfA)} SVX</dd></div><div><dt>持有 SVX</dt><dd>{formatDecimal(member.personalA)}</dd></div><div><dt>直推人数</dt><dd>{member.directCount} 人</dd></div><div><dt>加入时间</dt><dd>{date(member.joinedAt)}</dd></div></dl></details>)}</div></CardContent></Card></div>;
    const activePool = p?.nodes?.some(n => n.status === 'active' && n.expiresAt > Date.now());
    return <div className="rx-stack rx-team-overview">
      <section className="rx-team-hero">
        <div><span className="rx-kicker">TOGETHER, WE GO FURTHER</span><h2>连接伙伴，共同成长。</h2><p>在这里，看见团队的每一步进展。</p><strong className="rx-team-mobile-level">V{t.level}<small>当前团队等级</small></strong><Button onClick={() => setTab('invite')}>邀请好友 <ArrowUpRight /></Button></div>
        <div className="rx-level-orbit" aria-label={'当前等级 V' + t.level}><span /><span /><div><Award size={30} strokeWidth={1.4} /><strong>V{t.level}</strong><small>团队等级</small></div></div>
      </section>
      <Card className="rx-metrics"><Metric label="团队人数" value={t.teamCount} unit="人" icon={<Users size={18} />} /><Metric label="直推人数" value={t.directCount} unit="人" /><Metric label="团队业绩" value={formatDecimal(t.teamPerfA)} unit="SVX" /><Metric label="动态收益资格" value={p ? activePool ? '已满足' : '未满足' : '—'} note="需持有有效矿池" /></Card>
      <div className="rx-team-grid">
        <Card className="rx-team-next"><CardHeader><CardTitle>成长进度</CardTitle><Network size={18} /></CardHeader><CardContent>
          {t.nextLevel ? <><div className="rx-team-next-heading"><span className="rx-next-label">下一等级</span><strong className="rx-next-level">{t.nextLevel.label}</strong></div>
            {[{ label:'个人升级舱', current:t.upgradeA, target:t.nextLevel.warehouse }, { label:'团队业绩', current:t.teamPerfA, target:t.nextLevel.teamPerf }].map(item => {
              const difference = toUnits(String(item.target)) - toUnits(item.current);
              return <div className="rx-target" key={item.label}><div className="rx-team-target-label"><span>{item.label}</span><small>{difference > 0n ? '还差 ' + formatDecimal(units(difference)) + ' SVX' : '已达标'}</small></div><div><strong>{formatDecimal(item.current)}</strong><small> / {formatDecimal(item.target)} SVX</small></div><div className="rx-progress" role="progressbar" aria-label={item.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(percent(item.current, item.target))}><i style={{ width: percent(item.current, item.target) + '%' }} /></div></div>;
            })}
            <Button className="rx-full" variant="outline" onClick={() => setTab('upgrade')}>管理升级舱 <ArrowUpRight /></Button><p className="rx-team-progress-note">两个条件需同时达标，升级舱不产收益。</p>
          </> : <Empty>已达到最高等级</Empty>}
        </CardContent></Card>
        <Card className="rx-team-rules"><details><summary><span><strong>团队等级规则</strong><small>V1 — V10 · 查看各级门槛与比例</small></span><ChevronDown size={18} /></summary><div className="rx-team-rules-body"><div className="rx-table-wrap"><table className="rx-table no-mobile-stack"><thead><tr><th>等级</th><th>个人升级舱</th><th>团队业绩</th><th>收益比例</th></tr></thead><tbody>{(t.TEAM_LEVELS || []).map(level => <tr key={level.level} className={level.level === t.level ? 'is-current' : ''}><td><span className="rx-badge">V{level.level}</span>{level.level === t.level && <small className="rx-current-label">当前</small>}</td><td>{formatDecimal(level.warehouse)} SVX</td><td>{formatDecimal(level.teamPerf)} SVX</td><td>{level.ratePct}%</td></tr>)}</tbody></table></div></div></details></Card>
      </div>
    </div>;
  };
  return <div className="rx-page rx-team-page"><PageHeading title="团队" subtitle="每一份连接，都让未来更进一步。"><Button variant="outline" size="icon" aria-label="刷新团队数据" onClick={refresh} disabled={!wallet.authenticated || team.isFetching}><RefreshCw /></Button></PageHeading><Tabs className="rx-team-navigation" value={tab} onValueChange={setTab}><TabsList ref={tabsRef} className="rx-team-tabs" aria-label="团队功能">{Object.entries(tabs).map(([key,label]) => <TabsTrigger key={key} value={key}>{label}</TabsTrigger>)}</TabsList></Tabs><div className="rx-tab-body" role="region" aria-label={tabs[tab]}>{render()}</div>{action.dialog}</div>;
}
