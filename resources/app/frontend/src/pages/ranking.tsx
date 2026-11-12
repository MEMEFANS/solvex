import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, ErrorState, Loading, Metric, PageHeading } from '@/components/common';
import { useWallet } from '@/hooks/use-wallet';
import { api, walletIdentity } from '@/lib/api';
import { formatDecimal } from '@/lib/utils';
import type { Leaderboard } from '@/types';

const POSITIVE = '#0f7b5e', NEGATIVE = '#c2334a';
// 收益/ROI 为负时标红，其余标绿（颜色只做展示，不参与任何计算）
const tone = (value?: string) => String(value || '').trim().startsWith('-') ? NEGATIVE : POSITIVE;
const roiText = (value?: string) => {
  const text = formatDecimal(value, 2);
  return text === '—' || /^0(?:\.0+)?$/.test(String(value ?? '0').trim()) ? '—' : text + '%';
};

export default function RankingPage() {
  const wallet = useWallet();
  const identity = walletIdentity();
  const query = useQuery({ queryKey: ['leaderboard', identity], queryFn: ({ signal }) => api<Leaderboard>('platform/leaderboard', { signal }, false) });
  const payload = query.data, rows = payload?.items || [], current = payload?.current, top = rows[0];
  return <div className="rx-page">
    <PageHeading title="合约风云榜" subtitle="按合约跟单累计收益排名">
      <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw />刷新排名</Button>
    </PageHeading>
    {query.error ? <ErrorState error={query.error} retry={() => void query.refetch()} /> : !payload ? <Loading /> : <div className="rx-stack">
      <Card className="rx-metrics rx-metrics-3">
        <Metric label="跟单账户" value={rows.length} unit="个" note={`共 ${payload.total || 0} 个有跟单收益账户`} icon={<Trophy size={18} />} />
        <Metric label="榜首 30D 收益" value={top ? formatDecimal(top.earned30d, 2) : '—'} unit="USDT" note={top ? `${roiText(top.roi30d)} ROI` : '暂无数据'} />
        <Metric label="我的排名" value={current ? `第 ${current.rank} 名` : '未上榜'} note={current ? `30D 收益 ${formatDecimal(current.earned30d, 2)} USDT` : wallet.authenticated ? '暂无跟单收益' : '连接钱包后显示'} />
      </Card>
      <Card>
        <CardHeader><CardTitle>合约跟单收益排名</CardTitle><span className="rx-muted">仅统计合约跟单</span></CardHeader>
        <CardContent>
          {!rows.length ? <Empty>暂无跟单收益账户</Empty> : <div className="rx-table-wrap"><table className="rx-table no-mobile-stack">
            <thead><tr><th>排名</th><th>账户</th><th>累计跟单收益</th><th>30D 跟单收益</th><th>30D ROI</th><th>30D 跟单交易量</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.address || row.rank} className={row.isCurrent ? 'is-current' : ''}>
              <td><span className="rx-badge">{row.rank}</span></td>
              <td title={row.address}><code>{row.shortAddress || '—'}</code>{row.isCurrent && <small className="rx-current-label">我的排名</small>}</td>
              <td style={{ color: POSITIVE, fontWeight: 600 }}>{formatDecimal(row.earned, 2)}</td>
              <td style={{ color: tone(row.earned30d) }}>{formatDecimal(row.earned30d, 2)}</td>
              <td style={{ color: tone(row.roi30d) }}>{roiText(row.roi30d)}</td>
              <td>{formatDecimal(row.volume30d, 2)}</td>
            </tr>)}</tbody>
          </table></div>}
          <p className="rx-note">本榜仅统计合约跟单（AI 托管）的投入 USDT 与收益，不含现货交易、质押、矿池、推荐佣金、手续费返佣。30D ROI = 30D 跟单收益 ÷ 跟单投入 USDT。</p>
        </CardContent>
      </Card>
    </div>}
  </div>;
}
