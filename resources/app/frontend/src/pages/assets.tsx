import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Gate, PageHeading } from '@/components/common';
import { useWallet } from '@/hooks/use-wallet';
import { api, walletIdentity } from '@/lib/api';
import { formatDecimal, formatUnits, mulDecimal, sumDecimal } from '@/lib/utils';
import { depositUsdt, openUsdtWithdrawal } from '@/lib/wallet';
import type { CapitalRow, PlatformProfile, RevenueReport, WalletConfig, WalletProfile } from '@/types';

const NAMES: Record<string, string> = { USDT:'Tether', BTC:'Bitcoin', ETH:'Ethereum', BNB:'BNB', SOL:'Solana', XRP:'XRP', DOGE:'Dogecoin', A:'Solvex 平台原生代币' };
const disp = (symbol: string) => symbol === 'A' ? 'SVX' : symbol;
const logo = (symbol: string) => symbol === 'A' ? '/assets/brand/logo.svg' : `/assets/tokens/${symbol.toLowerCase()}.png?v=20261111-domain-solvex-1`;
const shortAddr = (value?: string) => value && value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value || '—';
const money = (value?: string | number) => formatDecimal(value, 2);
const signed = (value: string) => value.startsWith('-') ? value : '+' + value;
const negate = (value: string) => value.startsWith('-') ? value.slice(1) : '-' + value;
const isZero = (value: string) => /^0(?:\.0+)?$/.test(value.replace(/,/g, ''));
const time = (value?: number | string, short = false) => {
  const stamp = typeof value === 'number' ? value : Date.parse(String(value || ''));
  if (!Number.isFinite(stamp) || stamp <= 0) return '—';
  return new Date(stamp).toLocaleString('zh-CN', short ? { hour12:false, month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' } : { hour12:false });
};
const STATUS: Record<string, string> = { pending_review:'正在提现', pending_funds:'正在提现', pending_auto:'自动出款中', processing:'准备出款', signed:'等待广播', broadcast:'链上确认中', payout_failed:'出款失败', paid:'已到账', rejected:'已驳回·已退款', refunded:'已退回', pending:'确认中', confirmed:'已入账', credited:'已入账', expired:'已过期', loss:'亏损' };
const statusLabel = (status?: string) => STATUS[status || ''] || status || '处理中';
const TYPE_LABEL: Record<string, string> = { spot_trade:'现货成交', perp_trade:'合约成交', liquidation:'强制平仓', funding:'资金费', stake:'质押', unstake:'赎回质押', strategy_balance_consolidated:'策略划转', internal_strategy_settle:'策略结算', ai_copy_start:'加入跟单', ai_copy_redeem:'跟单赎回', aix_trade:'SVX 交易', deposit:'充值', withdrawal:'提现' };

function capitalView(item: CapitalRow) {
  const isFund = item.type === 'deposit' || item.type === 'withdrawal';
  const isAix = item.type === 'aix_trade';
  const net = item.netPnl ?? (item.pnl != null ? sumDecimal([String(item.pnl), negate(String(item.fee || '0'))]) : null);
  let value = '—', positive = true;
  if (isFund) {
    value = item.amount != null ? signed(money(item.amount))
      : item.size != null ? `${item.type === 'deposit' ? '+' : '−'}${formatDecimal(item.size, 8)} ${String(item.symbol || 'USDT').toUpperCase()}` : '—';
    positive = item.type === 'deposit';
  } else if (isAix) {
    value = item.size != null ? `${item.side === 'buy' ? '+' : '−'}${formatDecimal(item.size, 4)} SVX` : '—';
    positive = item.side === 'buy';
  } else if (net != null) {
    value = signed(money(net)); positive = !String(net).startsWith('-');
  } else if (item.amount != null) {
    value = signed(money(item.amount)); positive = !String(item.amount).startsWith('-');
  }
  return {
    typeLabel: TYPE_LABEL[item.type] || item.type || '账户变动',
    market: isFund ? String(item.symbol || 'USDT').toUpperCase() : item.symbol ? `${item.symbol}/USDT` : '—',
    side: isFund ? (item.type === 'deposit' ? '充入' : '提出') : item.side === 'buy' ? (isAix ? '买入' : '买入/做多') : item.side === 'sell' ? (isAix ? '卖出' : '卖出/做空') : '—',
    size: item.size == null ? '—' : formatDecimal(item.size, 8),
    price: item.price == null ? '—' : formatDecimal(item.price, isAix ? 6 : 2),
    fee: item.fee == null || isFund ? '—' : `${formatDecimal(item.fee, isAix ? 4 : 2)} ${isAix ? 'SVX' : 'USDT'}`,
    value, positive,
    status: isFund ? (item.type === 'deposit' ? '已到账' : statusLabel(item.status)) : item.liquidation ? '已强平' : '已完成',
  };
}

function RecordBlock({ title, children }: { title: string; children: ReactNode }) {
  return <div className="assets-record-block"><h3>{title}</h3>{children}</div>;
}
function RecordCard({ title, amount, positive, meta, details }: { title: ReactNode; amount: string; positive: boolean; meta: string; details: [string, string][] }) {
  return <details className="rec-card"><summary><div className="rec-head"><span className="rec-type">{title}</span><span className={'rec-amount ' + (positive ? 'up' : 'down')}>{amount}</span></div><div className="rec-meta"><span>{meta}</span><span className="rec-open" /></div></summary><div className="rec-detail">{details.map(([key, value]) => <div key={key}><i>{key}</i><b>{value}</b></div>)}</div></details>;
}
function EmptyCard({ text }: { text: string }) { return <div className="rec-card"><div className="rec-meta"><span>{text}</span></div></div>; }

export default function AssetsPage() {
  const wallet = useWallet();
  const client = useQueryClient();
  const identity = walletIdentity();
  const [view, setView] = useState<'balances' | 'records' | 'revenue'>('balances');
  const [query, setQuery] = useState('');
  const [hideZero, setHideZero] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);

  const walletQuery = useQuery({ queryKey: ['wallet-profile', identity], queryFn: () => api<WalletProfile>('wallet/profile'), enabled: wallet.authenticated });
  const platformQuery = useQuery({ queryKey: ['a-token-profile', identity], queryFn: () => api<PlatformProfile>('a-token/profile'), enabled: wallet.authenticated });
  const poolQuery = useQuery({ queryKey: ['svx-pool-price'], queryFn: () => api<{ priceUsdt?: string }>('a-token/pool', {}, false), staleTime: 60000 });
  const revenueQuery = useQuery({ queryKey: ['svx-revenue', identity], queryFn: () => api<RevenueReport>('a-token/revenue?limit=200'), enabled: wallet.authenticated && view === 'revenue' });
  const walletProfile = walletQuery.data, platform = platformQuery.data, balances = walletProfile?.balances;
  const markPrice = poolQuery.data?.priceUsdt || '0';
  const loading = walletQuery.isLoading || platformQuery.isLoading;
  const error = walletQuery.error || platformQuery.error;
  const symbols = useMemo(() => {
    const list = ['USDT', ...(platform?.symbols || []).filter(symbol => symbol !== 'USDT')];
    if (!list.includes('A')) list.splice(1, 0, 'A');
    return list;
  }, [platform?.symbols]);
  const rows = useMemo(() => symbols.map(symbol => {
    const account = platform?.account || {};
    const isUsdt = symbol === 'USDT';
    const available = isUsdt ? (account.availableMargin ?? balances?.USDT) : symbol === 'A' ? (balances?.A ?? platform?.spot?.A) : platform?.spot?.[symbol];
    const frozen = isUsdt ? account.reservedUsdt : platform?.spotFrozen?.[symbol];
    const price = isUsdt ? '1' : (platform?.marketPrices?.[symbol] || (symbol === 'A' ? markPrice : '0'));
    return { symbol, available: formatDecimal(available, 8), frozen: formatDecimal(frozen, 8), total: formatDecimal(available, 8), valuation: mulDecimal(available || '0', price) };
  }), [symbols, platform, balances, markPrice]);
  const totalEquity = platform?.account?.totalEquity || mulDecimal(balances?.A || '0', platform?.marketPrices?.A || markPrice);
  const parts = [
    { name:'可用资金', value: platform?.account?.availableMargin }, { name:'现货账户', value: platform?.account?.spotValue },
    { name:'合约账户', value: platform?.account?.positionEquity }, { name:'策略与跟单', value: platform?.account?.strategyValue },
    { name:'质押账户', value: platform?.account?.stakingValue },
  ];
  const denominator = Math.max(...parts.map(item => Math.max(0, Number(item.value) || 0)), 0);
  const sellQuota = platform?.sellQuota?.available;
  const visibleRows = rows.filter(item => {
    const keyword = query.trim().toUpperCase();
    return (!keyword || disp(item.symbol).includes(keyword) || item.symbol.includes(keyword) || (NAMES[item.symbol] || '').toUpperCase().includes(keyword)) && (!hideZero || !isZero(item.total));
  });

  function openFunding() { setDepositOpen(true); }
  const renderActions = (symbol: string) => <>
    {symbol === 'USDT' && <><button onClick={openFunding}>充值</button><button onClick={() => { openUsdtWithdrawal().catch(error => toast.error(error instanceof Error ? error.message : '提现模块加载失败')); }}>提现</button></>}
    {symbol === 'A' && <button onClick={() => { void window.switchTab('a-token-trade'); }}>SVX 交易</button>}
    {symbol !== 'USDT' && symbol !== 'A' && <button onClick={() => { void window.openTradePage('spot', symbol); }}>交易</button>}
  </>;

  if (!wallet.authenticated) return <div className="rx-page rx-stack"><PageHeading title="我的资产" subtitle="连接钱包后查看总资产、账户分布与资金记录。" /><Gate /></div>;
  if (error) return <div className="rx-error" role="alert"><span>{error.message}</span><Button variant="outline" size="sm" onClick={() => client.invalidateQueries()}>重试</Button></div>;

  const capital = platform?.capitalHistory || [], deposits = walletProfile?.deposits || [], withdrawals = walletProfile?.withdrawals || [];
  const rewards = walletProfile?.aiManagedRewards || [], revenue = revenueQuery.data;

  return <div className="account-shell"><div id="account-content">
    <div id="assets-dashboard-view">
      <section className="assets-overview">
        <div className="assets-total">
          <span className="assets-label">总资产估值</span>
          <strong><span>{loading ? '—' : money(totalEquity)}</span> <small>USDT</small></strong>
          <span className="assets-subvalue">≈ ${loading ? '—' : money(totalEquity)}</span>
          <div className="assets-quick-actions">
            <button className="assets-primary-action" onClick={openFunding}><span>＋</span>充值</button>
            <button className="assets-secondary-action" onClick={() => { openUsdtWithdrawal().catch(error => toast.error(error instanceof Error ? error.message : '提现模块加载失败')); }}><span>↑</span>提现</button>
            <button className="assets-secondary-action assets-records-shortcut" onClick={() => setView('records')}><span>≡</span>资金记录</button>
          </div>
        </div>
        <div className="assets-metrics">
          <div><span>可用余额</span><b><span>{money(balances?.USDT)}</span> USDT</b></div>
          <div><span>现货资产</span><b><span>{money(platform?.account?.spotValue)}</span> USDT</b></div>
          <div><span>合约权益</span><b><span>{money(platform?.account?.positionEquity)}</span> USDT</b></div>
          <div><span>策略与托管</span><b><span>{money(platform?.account?.strategyValue)}</span> USDT</b></div>
        </div>
      </section>

      <details className="assets-distribution">
        <summary className="assets-section-heading"><div><h3>账户分布</h3></div><span>展开查看 <span aria-hidden="true">⌄</span></span></summary>
        <div className="assets-allocation">{parts.map((item, index) => <div className="assets-allocation-item" key={item.name}><div className="assets-allocation-name"><span>{item.name}</span><b>{money(item.value)}</b></div><div className="assets-allocation-track"><div className="assets-allocation-fill" style={{ width: (denominator > 0 ? Math.max(0, Number(item.value) || 0) / denominator * 100 : 0).toFixed(2) + '%', background: ['#7034ef','#8a5cf3','#a788f6','#c3aef9','#ded2fc'][index] }} /></div></div>)}</div>
      </details>

      <section className="assets-main">
        <div className="assets-tabs" role="tablist">
          {(['balances', 'records', 'revenue'] as const).map(item => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item === 'balances' ? '资产列表' : item === 'records' ? '资金记录' : 'SVX 收益'}</button>)}
        </div>

        {view === 'balances' && <div>
          <div className="assets-list-tools">
            <label className="assets-search"><span>⌕</span><input type="search" placeholder="搜索币种" value={query} onChange={event => setQuery(event.target.value)} /></label>
            <label className="assets-zero-filter"><input type="checkbox" checked={hideZero} onChange={event => setHideZero(event.target.checked)} />隐藏零资产</label>
          </div>
          <div className="assets-table-wrap">
            <table className="assets-table no-mobile-stack"><thead><tr><th>币种</th><th>总额</th><th>可用</th><th>冻结</th><th>USDT 估值</th><th>操作</th></tr></thead><tbody>
              {visibleRows.map(item => {
                return <tr key={item.symbol}>
                  <td><div className="assets-coin"><span className={'assets-coin-icon ' + item.symbol.toLowerCase()}><span className="assets-coin-fallback">{disp(item.symbol).slice(0, 1)}</span><img src={logo(item.symbol)} alt={disp(item.symbol)} loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} /></span><span><b>{disp(item.symbol)}</b><small>{NAMES[item.symbol] || disp(item.symbol)}</small>{item.symbol === 'A' && <small style={{ display:'block', color:'#5f2bd9', fontSize:11, marginTop:2 }}>流通额度 {sellQuota ? formatDecimal(sellQuota, 2) : '—'}</small>}</span></div></td>
                  <td><span className="assets-total-amount">{item.total}</span><small className="assets-mobile-valuation">≈ {money(item.valuation)} USDT</small></td>
                  <td>{item.available}</td><td>{item.frozen}</td><td>{money(item.valuation)}</td>
                  <td className="assets-row-actions">
                    {renderActions(item.symbol)}
                  </td>
                </tr>;
              })}
              {!visibleRows.length && <tr><td colSpan={6} className="account-empty">{loading ? '正在读取资产' : '没有符合条件的资产'}</td></tr>}
            </tbody></table>
          </div>
          <div className="assets-mobile-list" aria-label="币种资产">
            {visibleRows.map(item => <details className="assets-mobile-coin" key={item.symbol}>
              <summary><span className="assets-coin"><span className={'assets-coin-icon ' + item.symbol.toLowerCase()}><img src={logo(item.symbol)} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} /></span><span><b>{disp(item.symbol)}</b><small>{item.symbol === 'A' ? 'Solvex' : NAMES[item.symbol] || item.symbol}</small></span></span><span className="assets-mobile-value"><strong>{item.total}</strong><small>≈ {money(item.valuation)} USDT</small></span><span className="assets-coin-chevron" aria-hidden="true">⌄</span></summary>
              <div className="assets-mobile-coin-details"><dl><div><dt>可用余额</dt><dd>{item.available} {disp(item.symbol)}</dd></div><div><dt>冻结金额</dt><dd>{item.frozen} {disp(item.symbol)}</dd></div>{item.symbol === 'A' && <div><dt>流通额度</dt><dd>{sellQuota ? formatDecimal(sellQuota, 2) : '—'} SVX</dd></div>}</dl><div className="assets-mobile-coin-actions">{renderActions(item.symbol)}</div></div>
            </details>)}
            {!visibleRows.length && <p className="account-empty">{loading ? '正在读取资产' : '没有符合条件的资产'}</p>}
          </div>
        </div>}

        {view === 'records' && <>
          <RecordBlock title="交易及账户流水">
            <div className="account-history"><table><thead><tr><th>时间</th><th>类型</th><th>市场</th><th>方向</th><th>数量</th><th>价格</th><th>手续费</th><th>盈亏 / 金额</th><th>状态</th></tr></thead><tbody>
              {capital.map((item, index) => { const row = capitalView(item); return <tr key={index}><td>{time(item.createdAt)}</td><td>{row.typeLabel}</td><td>{row.market}</td><td>{row.side}</td><td>{row.size}</td><td>{row.price}</td><td>{row.fee}</td><td className={row.positive ? 'up' : 'down'}>{row.value}</td><td>{row.status}</td></tr>; })}
              {!capital.length && <tr><td colSpan={9} className="account-empty">暂无交易及账户流水</td></tr>}
            </tbody></table></div>
            <div className="rec-cards">{capital.map((item, index) => { const row = capitalView(item); return <RecordCard key={index} title={row.typeLabel} amount={row.value} positive={row.positive} meta={time(item.createdAt, true)} details={[['市场', row.market], ['方向', row.side], ['数量', row.size], ['状态', row.status]]} />; })}{!capital.length && <EmptyCard text="暂无交易及账户流水" />}</div>
          </RecordBlock>

          <RecordBlock title="跟单收益">
            <div className="account-history"><table><thead><tr><th>入账时间</th><th>跟单批次</th><th>资产</th><th>收益</th><th>收益日期</th><th>状态</th></tr></thead><tbody>
              {rewards.map((row, index) => { const loss = row.status === 'loss' || String(row.amount || '').startsWith('-'); return <tr key={index}><td>{time(row.createdAt)}</td><td>{row.batchId ? row.batchId.slice(-8).toUpperCase() : '-'}</td><td>{row.asset || 'USDT'}</td><td className={loss ? 'down' : 'up'}>{loss ? '-' : '+'}{formatDecimal(row.amount, 8)}</td><td>{row.rewardDate || '-'}</td><td>{statusLabel(row.status)}</td></tr>; })}
              {!rewards.length && <tr><td colSpan={6} className="account-empty">暂无跟单收益</td></tr>}
            </tbody></table></div>
            <div className="rec-cards">{rewards.map((row, index) => { const loss = row.status === 'loss' || String(row.amount || '').startsWith('-'); return <RecordCard key={index} title="跟单收益" amount={(loss ? '-' : '+') + formatDecimal(row.amount, 8)} positive={!loss} meta={time(row.createdAt, true)} details={[['批次', row.batchId ? row.batchId.slice(-8).toUpperCase() : '-'], ['资产', row.asset || 'USDT'], ['收益日期', row.rewardDate || '-'], ['状态', statusLabel(row.status)]]} />; })}{!rewards.length && <EmptyCard text="暂无跟单收益" />}</div>
          </RecordBlock>

          <RecordBlock title="充值记录">
            <div className="account-history"><table><thead><tr><th>时间</th><th>网络</th><th>资产</th><th>数量</th><th>确认进度</th><th>状态</th><th>交易哈希</th></tr></thead><tbody>
              {deposits.map((row, index) => <tr key={index}><td>{time(row.createdAt)}</td><td>{row.networkName || row.network}</td><td>{row.asset}</td><td>{row.amount == null ? '检测中' : formatDecimal(row.amount, 8)}</td><td>{row.status === 'confirmed' ? '完成' : `${row.confirmations || 0}/${row.confirmationsRequired || 0}`}</td><td><span className={'status-chip ' + row.status}>{statusLabel(row.status)}</span></td><td>{row.txHash ? <a href={row.explorerUrl || '#'} target="_blank" rel="noopener" style={{ color:'#1c5cad' }}>{shortAddr(row.txHash)}</a> : '-'}</td></tr>)}
              {!deposits.length && <tr><td colSpan={7} className="account-empty">暂无充值记录</td></tr>}
            </tbody></table></div>
            <div className="rec-cards">{deposits.map((row, index) => <RecordCard key={index} title="充值" amount={'+' + formatDecimal(row.amount, 8) + ' ' + row.asset} positive meta={time(row.createdAt, true)} details={[['网络', row.networkName || row.network], ['状态', statusLabel(row.status)], ['确认', row.status === 'confirmed' ? '完成' : `${row.confirmations || 0}/${row.confirmationsRequired || 0}`], ['交易', row.txHash ? shortAddr(row.txHash) : '-']]} />)}{!deposits.length && <EmptyCard text="暂无充值记录" />}</div>
          </RecordBlock>

          <RecordBlock title="提现记录">
            <div className="account-history"><table><thead><tr><th>时间</th><th>网络</th><th>资产</th><th>数量</th><th>状态</th><th>交易哈希</th></tr></thead><tbody>
              {withdrawals.map((row, index) => <tr key={index}><td>{time(row.createdAt)}</td><td>{row.networkName || row.network || '-'}</td><td>{row.asset}</td><td>{formatDecimal(row.amount, 8)}</td><td><span className={'status-chip ' + row.status} title={row.reason}>{statusLabel(row.status)}</span></td><td>{row.txHash ? <a href={row.explorerUrl || '#'} target="_blank" rel="noopener" style={{ color:'#1c5cad' }}>{shortAddr(row.txHash)}</a> : '-'}</td></tr>)}
              {!withdrawals.length && <tr><td colSpan={6} className="account-empty">暂无提现记录</td></tr>}
            </tbody></table></div>
            <div className="rec-cards">{withdrawals.map((row, index) => <RecordCard key={index} title="提现" amount={'−' + formatDecimal(row.amount, 8) + ' ' + row.asset} positive={false} meta={time(row.createdAt, true)} details={[['网络', row.networkName || row.network || '-'], ['状态', statusLabel(row.status)], ['交易', row.txHash ? shortAddr(row.txHash) : '-']]} />)}{!withdrawals.length && <EmptyCard text="暂无提现记录" />}</div>
          </RecordBlock>
        </>}

        {view === 'revenue' && <>
          <RecordBlock title="SVX 收益汇总">
            <div className="aix-revenue-summary">
              {revenueQuery.isLoading ? '正在加载…' : <>
                <div className="aix-rev-total"><span className="lbl">累计 SVX 收益</span><span className="val">{formatDecimal(revenue?.total, 2)}<small>SVX</small></span></div>
                {[['昨日收益', 'yesterday'], ['矿池产出', 'miner'], ['能量释放', 'stake'], ['直推收益(10%)', 'direct'], ['间推/级差收益', 'team']].map(([title, key]) => <div className="aix-rev-item" key={key}><div className="lbl">{title}</div><div className="val">{formatDecimal(revenue?.stats?.[key], 2)} <small>SVX</small></div></div>)}
              </>}
            </div>
          </RecordBlock>
          <RecordBlock title="收益明细">
            <div className="account-history"><table><thead><tr><th>时间</th><th>收益类型</th><th>来源</th><th>比例</th><th>收益 (SVX)</th></tr></thead><tbody>
              {(revenue?.list || []).map((row, index) => <tr key={index}><td>{time(row.createdAt)}</td><td>{row.label || row.kind || '—'}</td><td>{row.detail || '—'}</td><td>{row.rate || '—'}</td><td className="up">+{formatDecimal(row.amount, 2)} SVX</td></tr>)}
              {!(revenue?.list || []).length && <tr><td colSpan={5} className="account-empty">暂无收益记录</td></tr>}
            </tbody></table></div>
            <div className="rec-cards">{(revenue?.list || []).map((row, index) => <RecordCard key={index} title={row.label || row.kind || '收益'} amount={'+' + formatDecimal(row.amount, 2) + ' SVX'} positive meta={time(row.createdAt, true)} details={[['来源', row.detail || '—'], ['比例', row.rate || '—']]} />)}{!(revenue?.list || []).length && <EmptyCard text={revenueQuery.isLoading ? '正在加载…' : '暂无收益记录'} />}</div>
          </RecordBlock>
        </>}
      </section>
    </div>

    {depositOpen && <DepositPanel onClose={() => setDepositOpen(false)} />}
  </div></div>;
}

function DepositPanel({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const configQuery = useQuery({ queryKey: ['wallet-config'], queryFn: () => api<WalletConfig>('wallet/config', {}, false), staleTime: 60000 });
  const config = configQuery.data;
  const [networkId, setNetworkId] = useState('');
  const network = config?.networks?.find(item => item.id === (networkId || 'bsc')) || config?.networks?.[0];
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const address = window.solvexWalletBridge?.address() || '';
  const balanceQuery = useQuery({
    queryKey: ['wallet-deposit-balance', address, network?.id],
    queryFn: () => api<{ balance?: string }>(`wallet/deposit-balance?address=${encodeURIComponent(address)}&network=${encodeURIComponent(network?.id || '')}`, {}, false),
    enabled: Boolean(address && network?.id),
  });

  async function submit() {
    setBusy(true);
    setStatus('');
    try {
      const txHash = await depositUsdt(network?.id || '', amount, setStatus);
      setStatus(`交易已提交：${shortAddr(txHash)}`);
      setAmount('');
      await client.invalidateQueries();
    } catch (error) {
      setStatus(window.solvexWalletBridge?.depositErrorMessage?.(error) || (error instanceof Error ? error.message : '充值失败，请重试'));
    } finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent placement="bottom" className="assets-deposit-sheet">
    <DialogTitle className="rx-dialog-title">充值 USDT</DialogTitle>
    <DialogDescription className="assets-deposit-description">选择充值网络与数量，从当前连接的钱包转入。</DialogDescription>
    <div className="assets-funding-pane">
      <p className="assets-deposit-rule">1 USDT 起充 · 跨链全额入账 0 手续费</p>
      <div className="account-form-row">
        <div><label htmlFor="assets-deposit-network">充值网络</label><select id="assets-deposit-network" value={network?.id || ''} onChange={event => setNetworkId(event.target.value)}>{(config?.networks || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div><label htmlFor="assets-deposit-amount">充值数量</label><input id="assets-deposit-amount" type="text" inputMode="numeric" placeholder="最小 1 USDT（1 的整数倍）" value={amount} onChange={event => setAmount(event.target.value)} /></div>
      </div>
      <p style={{ margin:'8px 0 2px', fontSize:14, fontWeight:600, color:'#a8700a' }}>{balanceQuery.isLoading ? '钱包 USDT 余额读取中…' : balanceQuery.data?.balance != null ? `钱包 USDT 余额 ${formatDecimal(balanceQuery.data.balance, 6)} USDT` : address ? '钱包 USDT 余额 -' : '连接钱包后显示钱包 USDT 余额'}</p>
      <button className="btn btn-start" disabled={busy || !config?.depositEnabled} onClick={() => { void submit(); }}>从当前钱包充值</button>
      <div className="account-status" role="status">{configQuery.error ? '充值配置读取失败，请关闭后重试' : config && !config.depositEnabled ? '充值功能暂未开放' : status}</div>
    </div>
  </DialogContent></Dialog>;
}
