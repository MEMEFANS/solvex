﻿﻿﻿(() => {
  const P = Portal;
  let poolStats = null;
  let profile = null;
  let currentSide = 'buy';
  let currentOrderType = 'market';       // 兼容旧引用；2026-11-09 P2 起挂单已下线
  let currentZone = 'alpha';             // 一键买入口：alpha=蓄能额度（质押/节点），beta=驱动额度
  let accountTab = 'balances';           // 底部账户面板 tab：balances/positions/orders/fills
  let atradePeriod = '15m';
  let atradeChart = null, atradeChartHost = null;
  let atradeCandleSeries = null;
  let atradeKlineTimer = null;
  let atradeChartResizeObserver = null;
  let atradeChartResizeHandler = null;
  let atradeChartViewportHandler = null;
  let atradeLastTime = 0;
  let atradeDataSeq = 0; // 请求世代号：丢弃切换周期后才返回的过期响应
  let atradeLoadedPeriod = null;
  const atradeBarSpacing = { '1m':12, '5m':12, '15m':12, '1h':11, '4h':10, '1d':9 };
  // 按像素保持蜡烛宽度：先展示最近行情，历史可向左拖动查看。
  // 日线历史较少时允许左侧留白，避免 fitContent / fixLeftEdge 将几根蜡烛拉满屏。
  const atradeTimeScaleOptions = period => ({
    timeVisible:period !== '1d', secondsVisible:false,
    rightOffset:4, barSpacing:atradeBarSpacing[period], minBarSpacing:3, maxBarSpacing:32,
    fixLeftEdge:false, fixRightEdge:false, lockVisibleTimeRangeOnResize:false,
    shiftVisibleRangeOnNewBar:true,
  });
  let atradeOrdersTimer = null;          // 我的委托 5s 轮询
  let atradeStatsTimer = null;
  let atradeStatsSeq = 0;
  let myOrdersCache = [];
  // 报价请求序号：输入、买卖方向或订单类型快速切换时，忽略过期响应，
  // 避免旧报价覆盖当前表单内容。
  let quoteRequestId = 0;

  const api = async (path, options) => {
    if (!options?.method || options.method === 'GET') return P.readJSON(`/api/a-token/${path}`, options);
    const response = await fetch(`/api/a-token/${path}`, options);
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('交易服务暂时不可用，请稍后重试'); }
    if (!response.ok) throw new Error(payload.error || 'SVX 代币交易请求失败');
    return payload;
  };
  const authApi = async (path, options = {}) => {
    if (!window.currentWalletProfile?.authenticated && window.currentWalletConnection?.address
      && typeof ensurePlatformSession === 'function') await ensurePlatformSession();
    if (!window.currentWalletProfile?.authenticated) throw new Error('SESSION_REQUIRED');
    return api(path, options);
  };
  const fmtA = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '0'; };
  const fmtUsdt = (v) => { const n = Number(v); return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0.00'; };
  // 委托价 / 成交价：SVX 池价带 7-8 位小数（如 0.10001927），只显示 4 位会被截成 $0.1000，
  // 用户按 $0.1 心算会以为 100U 应得 1000 SVX，与实际（按真实池价约 999.8）不符。统一显示 6 位。
  const fmtPrice4 = (v) => { const n = Number(v); return Number.isFinite(n) ? `$${n.toFixed(6)}` : '—'; };
  function showOk(msg) { if (typeof showToast === 'function') showToast(msg, 'ok'); else alert(msg); }
  function showErr(msg) { if (typeof showToast === 'function') showToast(msg, 'error'); else alert(msg); }
  function friendlyError(e, fallback) {
    if (Number(e?.code) === 4001 || /denied|rejected|cancel/i.test(e?.message || '')) return '已取消';
    return e?.message === 'SESSION_REQUIRED' ? '请先连接并确认钱包' : (e?.message || fallback || '交易失败');
  }
  const esc = P.esc;
  const orderMedia = matchMedia('(max-width: 768px)');
  window.atradeCloseOrder = () => {
    const sheet = document.getElementById('svx-order-sheet');
    if (sheet?.matches(':modal')) sheet.close();
  };
  window.atradeOpenOrder = side => {
    const sheet = document.getElementById('svx-order-sheet');
    if (!sheet) { showErr('交易数据正在同步，请稍后重试'); return; }
    if (side !== currentSide) window.atradeSide(side);
    if (orderMedia.matches) {
      if (!sheet.matches(':modal')) { sheet.close(); sheet.showModal(); }
    } else sheet.scrollIntoView({ block:'nearest', behavior:'smooth' });
  };
  orderMedia.addEventListener('change', () => {
    const sheet = document.getElementById('svx-order-sheet');
    if (!sheet) return;
    sheet.close();
    if (!orderMedia.matches) sheet.show();
  });
  document.addEventListener('click', event => {
    const sheet = document.getElementById('svx-order-sheet');
    if (event.target !== sheet || !sheet.matches(':modal')) return;
    const rect = sheet.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) sheet.close();
  });

  function render() {
    const root = document.getElementById('tab-a-token-trade');
    if (!root) return;
    root.innerHTML = `<div class="portal-shell">
      <div id="atrade-content">${P.loading(6)}</div>
    </div>`;
  }

  let loadSeq = 0;
  const active = () => P.active('a-token-trade');
  function stopPolling() {
    window.atradeCloseOrder();
    for (const timer of [atradeOrdersTimer, atradeKlineTimer, atradeStatsTimer]) clearInterval(timer);
    atradeStatsTimer = null;
    ++atradeStatsSeq;
    atradeOrdersTimer = atradeKlineTimer = null;
    clearTimeout(quoteTimer);
    ++quoteRequestId;
  }
  function activate() {
    if (!active() || !poolStats || atradeStatsTimer) return;
    refreshPoolStats();
    atradeStatsTimer = setInterval(refreshPoolStats, 5000);
    atradeOrdersTimer = setInterval(() => {
      if (!active() || !profile) return;
      if (accountTab === 'orders') window.atradeRefreshOrders();
      else atradeRefreshBalances();
    }, 5000);
    const chartHost = document.getElementById('atrade-chart');
    if (atradeCandleSeries && chartHost === atradeChartHost) {
      window.atradeRefreshKline().catch(() => {});
      atradeKlineTimer = setInterval(() => { if (active()) window.atradeRefreshKline().catch(() => {}); }, 10000);
    } else {
      const seq = loadSeq;
      window.loadPageCharts?.().then(() => {
        if (active() && seq === loadSeq) window.atradeInitChart();
      }).catch(() => { if (active()) chartHost.textContent = '图表加载失败，请刷新重试'; });
    }
  }
  async function refreshPoolStats() {
    if (!active()) return;
    const seq = ++atradeStatsSeq;
    try {
      const stats = await api('pool');
      if (!active() || seq !== atradeStatsSeq) return;
      poolStats = stats;
      const today = document.getElementById('atrade-burn-today');
      const total = document.getElementById('atrade-burn-total');
      if (today) today.textContent = fmtA(stats.todayBurned) + ' SVX';
      if (total) total.textContent = fmtA(stats.totalBurned) + ' SVX';
    } catch { /* Retain the last successful public stats during a network outage. */ }
  }
  window.addEventListener('svx:balance-changed', refreshPoolStats);
  async function load(context = { isCurrent:() => true }) {
    const host = document.getElementById('atrade-content');
    if (!host) return;
    const seq = ++loadSeq, wallet = P.walletKey();
    const valid = () => seq === loadSeq && context.isCurrent() && wallet === P.walletKey();
    stopPolling();
    let drawn = false, accountError = null;
    const paintAccount = () => {
      if (!valid() || !drawn || !profile) return;
      host.querySelector('.atrade-cell-entry').innerHTML = orderPanel();
      host.querySelector('.balance-bar')?.remove();
      const mount = document.getElementById('atrade-account-mount');
      if (mount) mount.innerHTML = accountSection();
      const liquidity = document.getElementById('atrade-liquidity-total');
      if (liquidity) liquidity.textContent = profile.liquidity?.enabled ? '已开放' : '待开放';
      window.atradeSide(currentSide);
      window.atradeRenderAccount();
    };
    const account = authApi('profile').then(prof => {
      if (!valid()) return;
      profile = prof;
      paintAccount();
    }).catch(error => {
      accountError = error;
      if (valid() && drawn && error.message !== 'SESSION_REQUIRED') {
        host.querySelector('.atrade-cell-entry').innerHTML = P.error(error.message, "Portal.load('a-token-trade',true)");
      }
    });
    await api('pool').then(stats => {
      if (!valid()) return;
      poolStats = stats;
      host.innerHTML = renderPoolOnly(false);
      drawn = true;
      if (window.currentWalletProfile?.authenticated && !profile) host.querySelector('.atrade-cell-entry').innerHTML = P.loading(2);
      paintAccount();
      if (accountError && accountError.message !== 'SESSION_REQUIRED') host.querySelector('.atrade-cell-entry').innerHTML = P.error(accountError.message, "Portal.load('a-token-trade',true)");
      activate();
    });
    await account;
  }

  // ── 价格条 ──
  function topInfoBar() {
    const s = poolStats || {};
    const p = profile || null;
    const price = Number(s.priceUsdt || 0.1);
    const priceStr = price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    const volA = Number(s.todayVolumeA || 0);
    const volUsdt = s.todayVolumeUsdt == null ? volA * price : Number(s.todayVolumeUsdt);
    const burned = Number(s.totalBurned || 0);
    const dividendPool = Number(s.dividendPool || 0);
    const high24h = Number(s.todayHigh || price);
    const low24h = Number(s.todayLow || price);
    const recentTrades = s.recentTrades || [];
    let changePct = 0;
    const refChange = s.changePct24h == null ? NaN : Number(s.changePct24h);
    if (Number.isFinite(refChange)) {
      // 后端按真实价格轨迹（24h 前 K 线）算的涨跌
      changePct = refChange;
    } else if (recentTrades.length >= 2) {
      // 后端字段缺失时的兜底：最新成交价相对较早成交价（新-旧，涨为正）
      const first = Number(recentTrades[0].priceUsdt || price);
      const last = Number(recentTrades[recentTrades.length - 1].priceUsdt || price);
      if (first > 0) changePct = (last - first) / first * 100;
    }
    const up = changePct >= 0;
    const cls = up ? 'up' : 'down';

    // 顶部余额四格（USDT/SVX/等级/UID）已移除：余额在下单面板显示，等级/UID 在赚币页显示，游客仅保留连接钱包按钮
    const balanceBar = p
      ? ''
      : `<div class="balance-bar">
          <button class="balance-cta" type="button" onclick="connectWallet(this)">🔗 连接钱包</button>
        </div>`;

    return `<div class="atrade-spot-price-strip">
      <div class="atrade-pair-name">
        <div class="pair-icon" style="overflow:hidden"><img src="/assets/brand/logo.svg" alt="SVX" style="width:100%;height:100%;object-fit:cover"></div>
        <div class="atrade-pair-copy">
          <h2><span>SVX / USDT</span><span class="change-pill atrade-asset-badge" style="margin-left:8px;background:rgba(14,156,136,0.12);color:var(--brand);border:1px solid rgba(14,156,136,0.3);font-weight:700;padding:2px 8px;border-radius:999px;font-size:10px">生态资产</span></h2>
          <small>SVX / 泰达币 · 平台内账本交易（提现时才发生链上转账）</small>
        </div>
      </div>
      <div class="price-big">
        <div class="num ${cls}">$${priceStr}<small style="font-size:13px;color:var(--mut);margin-left:8px;font-weight:500">USDT</small></div>
        <div class="sub">
          <span class="change-pill price-change ${cls}">${up ? '+' : ''}${changePct.toFixed(2)}%</span>
          <span class="price-range-item">24h 最高 <b style="color:var(--txt)">$${high24h.toFixed(6)}</b></span>
          <span class="price-range-item">24h 最低 <b style="color:var(--txt)">$${low24h.toFixed(6)}</b></span>
        </div>
      </div>
      <div class="svx-market-details"><div class="atrade-spot-meta">
        <div class="meta-kv"><span>今日交易量（SVX）</span><b>${fmtA(volA)} SVX</b></div>
        <div class="meta-kv"><span>今日成交额</span><b>${fmtUsdt(volUsdt)}</b></div>
        <div class="meta-kv"><span>今日销毁数量</span><b id="atrade-burn-today" style="color:#c62a37">${fmtA(Number(s.todayBurned || 0))} SVX</b></div>
        <div class="meta-kv"><span title="含矿机激活全额销毁">累计销毁 SVX</span><b id="atrade-burn-total" style="color:#c62a37">${fmtA(burned)} SVX</b></div>
      </div></div>
      ${balanceBar}
    </div>`;
  }

  // ── 左：一键交易面板（蓄能额度 / 驱动额度两个买入口）──
  function orderPanel() {
    const p = profile || {};
    const balUsdt = Number(p.balances?.USDT || 0);
    const balA = Number(p.balances?.A || 0);
    const price = Number(poolStats?.priceUsdt || 0.1);
    const quotaAvail = Number(profile?.sellQuota?.available || 0);
    const sellMax = Math.max(0, Math.min(balA, quotaAvail));
    // 卖出只展示「流通额度」一个口径（2026-11-12）：不再同时显示 SVX 余额/可卖上限，
    // 实际可成交数量仍由后端按余额与流通额度取小校验，placeholder 保留该上限提示。
    const showBalance = (side) => side === 'buy' ? fmtUsdt(balUsdt) : fmtA(quotaAvail) + ' SVX';
    const placeholder = (side) => side === 'buy'
      ? `最多支付 ${fmtUsdt(balUsdt)}（买入 0 手续费）`
      : `最多卖出 ${fmtA(sellMax)} SVX`;
    const zoneName = ({alpha:'蓄能额度',beta:'驱动额度',market:'自由交易（驱动额度）'})[currentZone];

    return `<dialog id="svx-order-sheet" class="svx-order-sheet" aria-labelledby="svx-order-title" ${orderMedia.matches ? '' : 'open'}>
      <header class="svx-order-sheet-head"><div><h2 id="svx-order-title">SVX 交易</h2><p>核对方向、分区与预计到账金额</p></div><button type="button" onclick="window.atradeCloseOrder()" aria-label="关闭交易面板">✕</button></header>
      <aside class="aentry">
      <div class="aentry-title">一键交易<small>SVX / USDT · 大盘价 $${price.toFixed(6)}</small></div>
      <div class="aentry-switch">
        <button type="button" data-side="buy" class="active buy" onclick="window.atradeSide('buy')">买入 SVX</button>
        <button type="button" data-side="sell" class="sell" onclick="window.atradeSide('sell')">卖出 SVX</button>
      </div>
      <div class="aentry-type" id="atrade-zone-switch" ${currentSide === 'buy' ? '' : 'hidden'} aria-label="买入分区">
        <button type="button" data-zone="alpha" class="${currentZone === 'alpha' ? 'active' : ''}" onclick="window.atradeZone('alpha')">蓄能额度</button>
        <button type="button" data-zone="beta" class="${currentZone === 'beta' ? 'active' : ''}" onclick="window.atradeZone('beta')">驱动额度</button>
      </div>
      <label class="aentry-avail" title="点击填满数量"><span id="atrade-balance-label">${currentSide === 'buy' ? '可用' : '流通额度'}</span><b id="atrade-balance-val" style="cursor:pointer" onclick="window.atradeSliderFill(100)">${showBalance(currentSide)}</b></label>

      <label id="atrade-input-label" class="aentry-amt-label">${currentSide === 'buy' ? `支付 USDT 数量（进${zoneName}）` : '卖出 SVX 数量（消耗流通额度）'}</label>
      <div class="aentry-field">
        <span>数量</span>
        <input id="atrade-input-amount" aria-labelledby="atrade-input-label" type="number" min="0" step="any" autocomplete="off" inputmode="decimal" placeholder="${placeholder(currentSide)}" oninput="window.atradeInputChanged()">
        <b id="atrade-input-unit">${currentSide === 'buy' ? 'USDT' : 'SVX'}</b>
      </div>

      <input class="aentry-slider" id="atrade-slider" type="range" min="0" max="100" value="0" aria-label="仓位比例" oninput="window.atradeSliderChanged(this.value)">
      <div class="aentry-pcts">
        <button type="button" data-pct="0"   onclick="window.atradeSliderFill(0)">0%</button>
        <button type="button" data-pct="25"  onclick="window.atradeSliderFill(25)">25%</button>
        <button type="button" data-pct="50"  onclick="window.atradeSliderFill(50)">50%</button>
        <button type="button" data-pct="75"  onclick="window.atradeSliderFill(75)">75%</button>
        <button type="button" data-pct="100" onclick="window.atradeSliderFill(100)">100%</button>
      </div>

      <div class="aentry-quote" id="atrade-quote-box-buy"  ${currentSide === 'buy'  ? '' : 'hidden'}>${quoteBoxBuy()}</div>
      <div class="aentry-quote" id="atrade-quote-box-sell" ${currentSide === 'sell' ? '' : 'hidden'}>${quoteBoxSell()}</div>

      <button class="terminal-order-btn" id="atrade-order-btn" onclick="window.atradeSubmit()">
        ${profile ? atradeSubmitButtonLabel() : '连接钱包开始交易'}
      </button>

      <div class="aentry-sum"><span>订单价值</span><b id="atrade-summary-value">$0.00</b></div>
      <div class="aentry-sum"><span>预计平台交易费</span><b id="atrade-summary-fee">0 USDT</b></div>
      <div class="aentry-sum match"><span>成交方式</span><b style="font-size:11px;font-weight:500;color:var(--mut)">按大盘价即时成交 · 不挂单</b></div>
      <details class="svx-trade-rules"><summary>交易规则与费用说明</summary>
        <p>自由交易须达到 500,000 USDT 平台流动性准备金，并由运营开启；未开放时仅支持蓄能额度/驱动额度一键买入。</p>
        <p>平台内买入不收手续费；卖出按成交额收 5% 交易费（50% 销毁 / 50% 合伙人分红）。SVX 提现到链上后，代币合约在卖出时另有 5% 转账税（买入 0），两者分开计算。</p>
        <p>蓄能额度：买入后留在蓄能额度，用于能量/矿池，不产生流通额度；驱动额度：买入后留在驱动额度，进超速驱动满 24 小时释放等额流通额度，两者不可互转。</p>
        <p>卖出需驱动额度超速驱动释放的流通额度，最低 1 SVX。</p>
      </details>
    </aside></dialog>`;
  }
  function atradeSubmitButtonLabel() {
    return currentSide === 'buy'
      ? `立即买入（${({alpha:'蓄能额度',beta:'驱动额度',market:'自由交易'})[currentZone]}）`
      : '立即卖出 SVX';
  }

  function quoteBoxBuy() {
    return `<div class="q-row"><span>可获得 SVX</span><b class="gain" id="q-buy-a">—</b></div>
      <div class="q-row" id="q-buy-beta-row" ${currentZone === 'alpha' ? 'hidden' : ''}><span>驱动额度</span><b style="color:#8a5508" id="q-buy-beta">${fmtA(profile?.turbo?.betaBalance || 0)} SVX</b></div>
      <div class="q-row"><span>成交单价</span><b id="q-buy-price">—</b></div>
      <div class="q-row"><span>平台交易费（买入 0）</span><b class="loss" id="q-buy-fee">—</b></div>
      <div class="q-row"><span>合计支付</span><b id="q-buy-total">—</b></div>`;
  }
  // 平台交易费标签：按成交 USDT 金额 5%，50%销毁 / 50%股东分红（profile 下发费率档案）
  function sellFeeLabel() {
    const sf = profile?.sellFee;
    if (sf?.feePct) return `平台交易费 (${sf.feePct} · 成交 USDT 金额)`;
    return '平台交易费 (5% · 成交 USDT 金额)';
  }
  function quoteBoxSell() {
    // 流通额度已在输入框上方展示，这里只保留成交金额与费用，避免重复两个额度口径。
    return `<div class="q-row"><span>净得 USDT</span><b class="gain" id="q-sell-usdt">—</b></div>
      <div class="q-row"><span id="q-sell-fee-lbl">${sellFeeLabel()}</span><b class="loss" id="q-sell-fee">—</b></div>
      <div class="q-row"><span>&nbsp;&nbsp;· 平台费 50%销毁 / 50%股东分红</span><b style="color:#8a5508" id="q-sell-pool">—</b></div>`;
  }

  // ── 右：账户/池数据卡片（v11 重布局：已上提到顶部 topInfoBar，rightPanel 删除）──

  // ── 底部：账户面板（登录用户）· 资产/持仓/当前委托/成交历史 ──
  function accountSection() {
    const p = profile || null;
    if (!p) return '';
    const labels = { balances: '资产', positions: '持仓', orders: '当前委托', fills: '成交历史' };
    const tabs = Object.entries(labels).map(([view, label]) =>
      `<button type="button" class="${accountTab === view ? 'active' : ''}" data-aview="${view}" onclick="window.atradeAccountTab('${view}')">${label}</button>`
    ).join('');
    return `<div class="portal-section atrade-account" style="border-radius:14px;overflow:hidden;margin-top:18px">
      <div class="terminal-tabs" id="atrade-account-tabs">${tabs}</div>
      <div id="atrade-account-content" class="terminal-account-content" style="height:auto;min-height:120px;max-height:320px"></div>
    </div>`;
  }

  // ── 登录后完整渲染（K线 + 一键下单）──
  function renderContent() {
    return `${topInfoBar()}
      <div class="atrade-terminal">
        <div class="atrade-terminal-grid">
          <section class="atrade-cell atrade-cell-chart">${chartSection()}</section>
          <aside class="atrade-cell atrade-cell-entry">${orderPanel()}</aside>
        </div>
        ${accountSection()}
      </div>${mobileActions()}`;
  }

  // ── 游客：无账户信息，但依然能看行情 + 连钱包按钮 ──
  function renderPoolOnly(authFailed) {
    return `${topInfoBar()}
      <div class="atrade-terminal">
        <div class="atrade-terminal-grid">
          <section class="atrade-cell atrade-cell-chart">${chartSection()}</section>
          <aside class="atrade-cell atrade-cell-entry">${orderPanel()}</aside>
        </div>
        <div id="atrade-account-mount">${P.walletGate('连接并确认钱包后，即可使用 USDT 买入 SVX 或卖出 SVX 换回 USDT')}</div>
      </div>${mobileActions()}`;
  }

  function mobileActions() {
    return '<div class="svx-mobile-actions" aria-label="SVX 快捷交易"><button type="button" class="svx-mobile-buy" onclick="window.atradeOpenOrder(\'buy\')">买入 SVX <span>买入手续费 0</span></button><button type="button" class="svx-mobile-sell" onclick="window.atradeOpenOrder(\'sell\')">卖出 SVX <span>按流通额度卖出</span></button></div>';
  }

  // ── K 线区域 ──
  function chartSection() {
    const periods = [
      { id: '1m', label: '1 分' },
      { id: '5m', label: '5 分' },
      { id: '15m', label: '15 分' },
      { id: '1h', label: '1 时' },
      { id: '4h', label: '4 时' },
      { id: '1d', label: '日' },
    ];
    const tabs = periods.map(p => `<button type="button" data-period="${p.id}" class="${atradePeriod === p.id ? 'active' : ''}" onclick="window.atradeSwitchPeriod('${p.id}')">${p.label}</button>`).join('');
    return `
      <section class="atrade-chart-card atrade-chart-section">
        <div class="atrade-chart-toolbar">
          <div class="atrade-chart-tabs">${tabs}</div>
          <span class="muted" style="font-size:11px;margin-left:auto">SVX / USDT · ${profile?.liquidity?.enabled ? '实时行情' : '内盘行情'}</span>
        </div>
        <div id="atrade-chart" class="atrade-chart-host"></div>
      </section>
    `;
  }

  // ═══════════════════════════════════════════════════════
  //  交互
  // ═══════════════════════════════════════════════════════

  window.atradeSide = (side) => {
    quoteRequestId += 1;
    clearTimeout(quoteTimer);
    currentSide = side === 'sell' ? 'sell' : 'buy';
    // tab 样式（SVX下单面板的买卖切换是 .aentry-switch，注意别写成主终端的 .side-switch）
    document.querySelectorAll('.aentry-switch button[data-side]').forEach(b => {
      const s = b.dataset.side;
      b.classList.toggle('active', s === currentSide);
      b.classList.toggle('buy', s === 'buy');
      b.classList.toggle('sell', s === 'sell');
    });
    // quote box 显隐（用 hidden 属性，避免 inline display 破坏 display:grid 以及 margin-collapse）
    const buyBox  = document.getElementById('atrade-quote-box-buy');
    const sellBox = document.getElementById('atrade-quote-box-sell');
    if (buyBox)  buyBox.hidden  = currentSide !== 'buy';
    if (sellBox) sellBox.hidden = currentSide !== 'sell';
    // labels / units
    const p = profile || {};
    const balUsdt = Number(p.balances?.USDT || 0);
    const balA = Number(p.balances?.A || 0);
    const quotaAvail = Number(p.sellQuota?.available || 0);
    const sellMax = Math.max(0, Math.min(balA, quotaAvail));
    const balVal = document.getElementById('atrade-balance-val');
    const inpLabel = document.getElementById('atrade-input-label');
    const inpUnit = document.getElementById('atrade-input-unit');
    const inp = document.getElementById('atrade-input-amount');
    const btn = document.getElementById('atrade-order-btn');
    const zoneSwitch = document.getElementById('atrade-zone-switch');
    if (zoneSwitch) zoneSwitch.hidden = currentSide !== 'buy';
    if (balVal)   balVal.textContent   = currentSide === 'buy' ? fmtUsdt(balUsdt) : fmtA(quotaAvail) + ' SVX';
    const balLabel = document.getElementById('atrade-balance-label');
    if (balLabel) balLabel.textContent = currentSide === 'buy' ? '可用' : '流通额度';
    if (inpLabel) inpLabel.textContent = currentSide === 'buy'
      ? `支付 USDT 数量（进${({alpha:'蓄能额度',beta:'驱动额度',market:'自由交易'})[currentZone]}）`
      : '卖出 SVX 数量（消耗流通额度）';
    if (inpUnit)  inpUnit.textContent  = currentSide === 'buy' ? 'USDT' : 'SVX';
    if (inp) {
      inp.placeholder = currentSide === 'buy'
        ? `最多支付 ${fmtUsdt(balUsdt)}（买入 0 手续费）`
        : `最多卖出 ${fmtA(sellMax)} SVX`;
      inp.value = '';
    }
    if (btn) {
      btn.className = 'terminal-order-btn' + (currentSide === 'sell' ? ' sell' : '');
      btn.textContent = profile ? atradeSubmitButtonLabel() : '连接钱包开始交易';
    }
    // 挂单已下线：不再处理限价输入与订单类型
    // slider 归零
    const slider = document.getElementById('atrade-slider');
    if (slider) slider.value = 0;
    // summary 清空
    const sv = document.getElementById('atrade-summary-value'); if (sv) sv.textContent = '$0.00';
    const sf = document.getElementById('atrade-summary-fee');   if (sf) sf.textContent = '0 USDT';
    // quote 清空
    const e = (id) => document.getElementById(id);
    if (currentSide === 'buy') {
      if (e('q-buy-a'))     e('q-buy-a').textContent = '—';
      if (e('q-buy-price')) e('q-buy-price').textContent = '—';
      if (e('q-buy-fee'))   e('q-buy-fee').textContent = '—';
      if (e('q-buy-total')) e('q-buy-total').textContent = '—';
    } else {
      if (e('q-sell-usdt')) e('q-sell-usdt').textContent = '—';
      if (e('q-sell-fee'))  e('q-sell-fee').textContent  = '—';
      if (e('q-sell-pool')) e('q-sell-pool').textContent = '—';
    }
  };

  // 挂买挂卖已下线（2026-11-09 P2）：保留空实现，避免旧 DOM 残留 onclick 报错
  window.atradeOrderType = () => {};

  window.atradeZone = (zone) => {
    currentZone = ['beta','market'].includes(zone) ? zone : 'alpha';
    quoteRequestId += 1;
    clearTimeout(quoteTimer);
    document.querySelectorAll('#atrade-zone-switch [data-zone]').forEach(b => {
      b.classList.toggle('active', b.dataset.zone === currentZone);
    });
    const inpLabel = document.getElementById('atrade-input-label');
    if (inpLabel && currentSide === 'buy') {
      inpLabel.textContent = `支付 USDT 数量（进${({alpha:'蓄能额度',beta:'驱动额度',market:'自由交易'})[currentZone]}）`;
    }
    const btn = document.getElementById('atrade-order-btn');
    if (btn) btn.textContent = profile ? atradeSubmitButtonLabel() : '连接钱包开始交易';
    const betaRow = document.getElementById('q-buy-beta-row');
    if (betaRow) betaRow.hidden = currentZone === 'alpha';
    const ainp = document.getElementById('atrade-input-amount');
    if (ainp && ainp.value) window.atradeInputChanged(true);
  };

  // ── 滑条 → 输入框 ──
  function maxAmount() {
    const p = profile || {};
    if (currentSide === 'buy') {
      // 买入 0 手续费：可买成交金额 = USDT 余额（向下取 2 位）
      const usdt = Number(p.balances?.USDT || 0);
      return Math.floor(usdt * 100) / 100;
    }
    // 卖出同时受 SVX 余额与流通额度限制（涡轮释放的额度）
    const balA = Number(p.balances?.A || 0);
    const quota = Number(p.sellQuota?.available || 0);
    return Math.max(0, Math.min(balA, quota));
  }
  window.atradeSliderFill = (pct) => {
    const slider = document.getElementById('atrade-slider');
    if (slider) slider.value = String(pct);
    window.atradeSliderChanged(pct);
  };
  window.atradeSliderChanged = (pctVal) => {
    const pct = Number(pctVal) || 0;
    const max = maxAmount();
    let v = max * (pct / 100);
    // 买入时小数点保留 4 位（USDT）
    v = currentSide === 'buy' ? (Math.floor(v * 1e4) / 1e4) : (Math.floor(v * 1e8) / 1e8);
    const input = document.getElementById('atrade-input-amount');
    if (input) {
      input.value = v > 0 ? String(v) : '';
      window.atradeInputChanged(true);
    }
  };

  // ── 输入变化 → 调报价 → 更新 UI ──
  let quoteTimer = null;
  window.atradeInputChanged = async (fromSlider = false) => {
    const requestId = ++quoteRequestId;
    const input = document.getElementById('atrade-input-amount');
    const slider = document.getElementById('atrade-slider');
    const max = maxAmount();
    if (input && slider && !fromSlider && max > 0) {
      const n = Number(input.value || 0);
      const pct = Math.min(100, (n / max) * 100);
      slider.value = String(pct);
    }
    // 摘要 & 报价
    const sv = document.getElementById('atrade-summary-value');
    const sf = document.getElementById('atrade-summary-fee');
    if (!input) return;
    const amt = input.value?.trim();
    if (!amt) {
      if (sv) sv.textContent = '$0.00';
      if (sf) sf.textContent = '0 USDT';
      // 清空 quote 展示
      const e = (id) => document.getElementById(id);
      if (currentSide === 'buy') {
        if (e('q-buy-a'))     e('q-buy-a').textContent = '—';
        if (e('q-buy-price')) e('q-buy-price').textContent = '—';
        if (e('q-buy-fee'))   e('q-buy-fee').textContent = '—';
        if (e('q-buy-total')) e('q-buy-total').textContent = '—';
      } else {
        if (e('q-sell-usdt')) e('q-sell-usdt').textContent = '—';
        if (e('q-sell-fee'))  e('q-sell-fee').textContent  = '—';
        if (e('q-sell-pool')) e('q-sell-pool').textContent = '—';
      }
      return;
    }

    // HTML number 输入在部分 WebView 仍可能产生非数字文本；不要把无效值
    // 发送给 API，也不要让上一笔报价继续停留在摘要中。
    if (!(Number(amt) > 0) || !Number.isFinite(Number(amt))) {
      if (sv) sv.textContent = '$0.00';
      if (sf) sf.textContent = '请输入有效数量';
      return;
    }

    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(async () => {
      try {
        // 一键买/一键卖报价：按大盘价，买入 0 手续费，卖出 5% 进股东池
        const q = await api(`zone/quote?side=${currentSide}&zone=${currentZone}&amount=${encodeURIComponent(amt)}`);
        if (requestId !== quoteRequestId) return;
        const e = (id) => document.getElementById(id);
        if (currentSide === 'buy') {
          if (e('q-buy-a'))     e('q-buy-a').textContent     = `${fmtA(q.aOut)} SVX`;
          if (e('q-buy-price')) e('q-buy-price').textContent = q.priceUsdt != null ? fmtPrice4(q.priceUsdt) : '—';
          const fee = Number(q.feeUsdt || 0);   // 买入 0 手续费
          const total = q.totalUsdt != null ? Number(q.totalUsdt) : Number(q.usdtIn || q.amountUsdt || 0);
          if (e('q-buy-fee'))   e('q-buy-fee').textContent = `${fmtUsdt(fee)} USDT`;
          if (e('q-buy-total')) e('q-buy-total').textContent = `${fmtUsdt(total)} USDT`;
          if (sv) sv.textContent = fmtUsdt(q.amountUsdt || q.usdtIn || 0);
          if (sf) sf.textContent = `${fmtUsdt(fee)} USDT（买入免手续费）`;
        } else {
          if (e('q-sell-usdt')) e('q-sell-usdt').textContent = fmtUsdt(q.usdtOut);
          const feeLbl = e('q-sell-fee-lbl');
          if (feeLbl && q.feePct) feeLbl.textContent = `平台交易费 (${q.feePct} · 成交 USDT 金额)`;
          const feeUsdt = Number(q.feeUsdt || 0);
          if (e('q-sell-fee'))  e('q-sell-fee').textContent  = `-${fmtUsdt(feeUsdt)} USDT`;
          if (e('q-sell-pool')) e('q-sell-pool').textContent = `-${fmtUsdt(feeUsdt)} USDT`;
          if (sv) sv.textContent = fmtUsdt(q.amountUsdt || (q.aIn ? (Number(q.aIn) * Number(q.priceUsdt || 0)) : 0));
          if (sf) sf.textContent = `${fmtUsdt(feeUsdt)} USDT（平台费 50%销毁 / 50%股东分红）`;
        }
      } catch (e) {
        // 忽略
      }
    }, 300);
  };

  // ── 一键买 / 一键卖（2026-11-09 P2：取消挂买挂卖）──
  window.atradeSubmit = async () => {
    if (!profile) {
      if (typeof showToast === 'function') showToast('请先连接并确认钱包', 'error');
      else alert('请先连接并确认钱包');
      return;
    }
    const inp = document.getElementById('atrade-input-amount');
    const amt = inp?.value?.trim();
    if (!amt) { showErr(currentSide === 'buy' ? '请输入支付 USDT 数量' : '请输入卖出 SVX 数量'); return; }
    if (!(Number(amt) > 0) || !Number.isFinite(Number(amt))) { showErr('请输入有效数量'); return; }
    const max = maxAmount();
    if (Number(amt) > max + 1e-9) {
      showErr(currentSide === 'buy'
        ? `USDT 余额不足（当前最多可买 ${fmtUsdt(max)} 成交额）`
        : `超过可卖上限（余额与流通额度取小：${fmtA(max)} SVX）`);
      return;
    }
    if (currentSide === 'sell' && Number(amt) < 1) { showErr('SVX 卖出最低 1 个起'); return; }
    if (!connectedProvider || !connectedWalletAddress) { showErr('请先连接钱包'); return; }

    const zoneName = ({alpha:'蓄能额度',beta:'驱动额度',market:'自由交易（驱动额度）'})[currentZone];
    try {
      const q = await api(`zone/quote?side=${currentSide}&zone=${currentZone}&amount=${encodeURIComponent(amt)}`);
      const requestId = 'azt_' + (globalThis.crypto?.randomUUID?.().replaceAll('-', '') || `${Date.now()}${Math.floor(Math.random() * 1e6)}`);
      const timestamp = String(Date.now());
      let message, path, body;
      if (currentSide === 'buy') {
        // 签名消息绑定用户输入金额（与价格 tick 无关），避免报价后价格变动导致验签失败
        message = `Solvex ${zoneName}买币确认：支付 ${amt} USDT（买入手续费 0），编号 ${requestId}，时间：${timestamp}`;
        path = 'zone/buy';
        body = { zone: currentZone, amount: amt, timestamp };
      } else {
        message = `Solvex 一键卖出确认：卖出 ${amt} SVX，编号 ${requestId}，时间：${timestamp}`;
        path = 'zone/sell';
        body = { amount: amt, timestamp };
      }
      const signature = await connectedProvider.request({ method: 'personal_sign', params: [message, connectedWalletAddress] });
      const r = await authApi(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
        body: JSON.stringify({ ...body, signature }),
      });
      if (currentSide === 'buy') {
        showOk(`买入成功 · ${fmtUsdt(r.usdtCost || amt)} USDT 买入 ${fmtA(r.aOut)} SVX 进${r.zoneLabel || zoneName}（买入手续费 0）`);
      } else {
        showOk(`卖出成功 · 卖出 ${fmtA(r.aIn || amt)} SVX，净得 ${fmtUsdt(r.netUsdt)} USDT（平台交易费 ${fmtUsdt(r.feeUsdt)} USDT，50%销毁/50%股东分红）`);
      }
      if (inp) inp.value = '';
      const slider = document.getElementById('atrade-slider');
      if (slider) slider.value = 0;
      await load();
    } catch (e) { showErr(friendlyError(e, currentSide === 'buy' ? '买入失败' : '卖出失败')); }
  };

  // ── 我的委托：拉取列表 + 渲染 ──
  window.atradeRefreshOrders = async () => {
    if (!profile || !active()) return;
    const wallet = P.walletKey(), seq = loadSeq;
    try {
      const res = await authApi('orders?limit=200');
      if (wallet !== P.walletKey() || seq !== loadSeq) return;
      myOrdersCache = res?.orders || [];
      window.atradeRenderAccount();
    } catch (e) {
      // ignore
    }
    // 顺带刷新冻结中资金展示（对手方吃单/成交也会改变冻结额）
    atradeRefreshBalances();
  };

  // 委托轮询时轻量刷新 profile（顶部余额四格已移除，这里仅刷新数据与底部账户面板）
  async function atradeRefreshBalances() {
    if (!profile || !active()) return;
    const wallet = P.walletKey(), seq = loadSeq;
    if (typeof authApi !== 'function') return;
    try {
      const p = await authApi('profile');
      if (wallet !== P.walletKey() || seq !== loadSeq) return;
      profile = p;
      // 资产/持仓 tab 激活时同步刷新账户面板
      if (accountTab === 'balances' || accountTab === 'positions') window.atradeRenderAccount();
    } catch (e) { /* ignore */ }
  }
  // ── 底部账户面板：资产/持仓/当前委托/成交历史 ──
  window.atradeAccountTab = (view) => {
    accountTab = ['balances', 'positions', 'orders', 'fills'].includes(view) ? view : 'balances';
    document.querySelectorAll('#atrade-account-tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.aview === accountTab);
    });
    window.atradeRenderAccount();
    if (accountTab === 'orders') window.atradeRefreshOrders();
  };

  window.atradeRenderAccount = () => {
    const host = document.getElementById('atrade-account-content');
    if (!host) return;
    const p = profile || {};
    const price = Number(poolStats?.priceUsdt || 0.1);
    const balU = Number(p.balances?.USDT || 0), balA = Number(p.balances?.A || 0);
    const lockU = Number(p.locked?.usdt || 0), lockA = Number(p.locked?.a || 0);
    const zTime = d => new Date(d).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');

    if (accountTab === 'balances') {
      host.innerHTML = `<table class="terminal-data-table"><thead><tr><th>资产</th><th>余额</th><th>冻结中</th><th>市值</th></tr></thead><tbody>
        <tr><td data-label="资产" class="asset-name">USDT</td><td data-label="余额">${fmtUsdt(balU)}</td><td data-label="冻结中">${fmtUsdt(lockU)}</td><td data-label="市值">${fmtUsdt(balU)}</td></tr>
        <tr><td data-label="资产" class="asset-name">SVX</td><td data-label="余额">${fmtA(balA)}</td><td data-label="冻结中">${fmtA(lockA)}</td><td data-label="市值">${fmtUsdt(balA * price)}</td></tr>
      </tbody></table>`;
      return;
    }
    if (accountTab === 'positions') {
      if (!(balA > 0)) { host.innerHTML = '<div class="terminal-empty">暂无 SVX 持仓</div>'; return; }
      host.innerHTML = `<table class="terminal-data-table"><thead><tr><th>市场</th><th>持仓数量</th><th>冻结中</th><th>现价</th><th>市值</th></tr></thead><tbody>
        <tr><td data-label="市场">SVX/USDT</td><td data-label="持仓数量">${fmtA(balA)} SVX</td><td data-label="冻结中">${fmtA(lockA)} SVX</td><td data-label="现价">${fmtPrice4(price)}</td><td data-label="市值">${fmtUsdt(balA * price)}</td></tr>
      </tbody></table>`;
      return;
    }
    if (accountTab === 'orders') {
      const list = Array.isArray(myOrdersCache) ? myOrdersCache : [];
      const filtered = list.filter(o => o.orderStatus === 'OPEN');
      if (!filtered.length) { host.innerHTML = '<div class="terminal-empty">暂无当前委托</div>'; return; }
      const rows = filtered.map(o => {
        const filled = o.side === 'buy'
          ? `${fmtUsdt(Number(o.filledUsdt || 0))} USDT`
          : `${fmtA(Number(o.filledA || 0))} SVX`;
        // 挂单中：委托量显示「剩余未成交」（随成交递减，成交多少减多少）；
        // 已结束的委托：显示原始委托量（剩余 + 累计成交，否则 FILLED/CANCELLED 单会显示成 0 或退回部分）
        const size = o.orderStatus === 'OPEN'
          ? (o.side === 'buy' ? `${fmtUsdt(Number(o.inputUsdt || 0))} USDT` : `${fmtA(Number(o.inputA || 0))} SVX`)
          : (o.side === 'buy'
              ? `${fmtUsdt(Number(o.inputUsdt || 0) + Number(o.filledUsdt || 0))} USDT`
              : `${fmtA(Number(o.inputA || 0) + Number(o.filledA || 0))} SVX`);
        const status = o.orderStatus === 'OPEN' ? '<span style="color:#8a5508">挂单中</span>'
          : o.orderStatus === 'FILLED' ? '<span style="color:var(--brand)">已成交</span>'
          : o.orderStatus === 'CANCELLED' ? '<span style="color:var(--mut)">已撤单</span>'
          : `<span>${o.orderStatus}</span>`;
        const action = o.orderStatus === 'OPEN'
          ? `<button class="table-action" onclick="window.atradeCancelOrder('${o.orderId}')">撤单</button>`
          : (o.fillPriceUsdt ? `<span style="color:var(--mut)">${fmtPrice4(o.fillPriceUsdt)}</span>` : '—');
        const orderTypeLabel = o.orderType === 'market' ? '市价' : '限价';
        return `<tr><td data-label="时间">${zTime(o.createdAt)}</td><td data-label="方向" class="${o.side === 'buy' ? 'up' : 'down'}">${o.side === 'buy' ? '买入' : '卖出'}</td><td data-label="类型">${orderTypeLabel}</td><td data-label="委托价">${fmtPrice4(o.orderPriceUsdt)}</td><td data-label="委托量">${size}</td><td data-label="已成交">${filled}</td><td data-label="状态">${status}</td><td data-label="操作">${action}</td></tr>`;
      }).join('');
      const head = '<th>时间</th><th>方向</th><th>类型</th><th>委托价</th><th>委托量</th><th>已成交</th><th>状态</th><th>操作</th>';
      host.innerHTML = `<table class="terminal-data-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
      return;
    }
    // fills · 成交历史
    const trades = p.trades || [];
    if (!trades.length) { host.innerHTML = '<div class="terminal-empty">暂无成交记录</div>'; return; }
    const rows = trades.map(t => `<tr><td data-label="时间">${zTime(t.createdAt)}</td><td data-label="方向" class="${t.side === 'buy' ? 'up' : 'down'}">${t.side === 'buy' ? '买入' : '卖出'}</td><td data-label="价格">${fmtPrice4(t.priceUsdt)}</td><td data-label="数量">${fmtA(t.size)} SVX</td><td data-label="成交额">${fmtUsdt(t.amountUsdt)}</td><td data-label="销毁" style="color:#c62a37">${t.burn ? `${fmtA(t.burn)} SVX` : '—'}</td><td data-label="入A10池" style="color:#8a5508">${t.dividend ? `${fmtA(t.dividend)} SVX` : '—'}</td></tr>`).join('');
    host.innerHTML = `<table class="terminal-data-table"><thead><tr><th>时间</th><th>方向</th><th>价格</th><th>数量</th><th>成交额</th><th>销毁</th><th>入A10池</th></tr></thead><tbody>${rows}</tbody></table>`;
  };
  window.atradeCancelOrder = async (orderId) => {
    if (!orderId || !await confirmDialog('确定要撤单吗？冻结资产将原路退回。')) return;
    try {
      const r = await authApi(`orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' });
      showOk(`撤单成功 · 退回 ${Number(r.refundUsdt)>0 ? fmtUsdt(r.refundUsdt)+' USDT' : fmtA(r.refundA)+' A'}`);
      await load();
    } catch (e) { showErr(friendlyError(e, '撤单失败')); }
  };

  // ── K 线交互 ──
  window.atradeInitChart = () => {
    const host = document.getElementById('atrade-chart');
    if (!host || typeof LightweightCharts === 'undefined' || !active()) return;
    atradeChartHost = host;
    // 页面刷新/下单后会重建 K 线实例，先清理旧的观察器与监听器，
    // 防止每次重载都叠加 resize 回调并持有旧 DOM 闭包。
    atradeChartResizeObserver?.disconnect?.();
    atradeChartResizeObserver = null;
    if (atradeChartResizeHandler) window.removeEventListener('resize', atradeChartResizeHandler);
    if (atradeChartViewportHandler) window.visualViewport?.removeEventListener?.('resize', atradeChartViewportHandler);
    atradeChartResizeHandler = null;
    atradeChartViewportHandler = null;
    if (atradeChart) { try { atradeChart.remove(); } catch {} atradeChart = null; atradeCandleSeries = null; }
    if (atradeKlineTimer) { clearInterval(atradeKlineTimer); atradeKlineTimer = null; }

    const theme = window.WGTheme?.chartOptions?.() || {
      layout:{ background:{ type:'solid', color:'#0b1113' }, textColor:'#91a19b' },
      grid:{ vertLines:{ color:'#19211f' }, horzLines:{ color:'#19211f' } },
      rightPriceScale:{ borderColor:'#202a27' }, timeScale:{ borderColor:'#202a27' },
    };
    const tzOpts = (typeof window.wgChartTzOptions === 'function') ? window.wgChartTzOptions() : { localization:{}, timeScale:{} };
    atradeChart = LightweightCharts.createChart(host, {
      width: host?.clientWidth || 600,
      height: host?.clientHeight || 360,
      layout:{ ...theme.layout, fontFamily:'-apple-system, Segoe UI, sans-serif' },
      grid:theme.grid,
      crosshair:{ mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale:{ ...theme.rightPriceScale, scaleMargins:{ top:0.08, bottom:0.08 } },
      timeScale:{ ...theme.timeScale, ...tzOpts.timeScale, ...atradeTimeScaleOptions(atradePeriod) },
      localization:{ locale:'zh-CN', ...tzOpts.localization },
    });
    // base.css turns ordinary mobile tables into stacked cards. Lightweight
    // Charts uses a private table to place the candle pane and price scale
    // beside each other, so opt that internal table out of the card rules.
    host.querySelectorAll('.tv-lightweight-charts table').forEach(table => table.classList.add('no-mobile-stack'));
    // 手动接管尺寸同步：autoSize 在 iOS / 窄屏容器下测量不准（手机端 K 线偏移/留白）
    const fitAtradeChart = () => {
      if (!atradeChart) return;
      const w = host?.clientWidth || 0;
      const h = host?.clientHeight || 360;
      if (w > 0) atradeChart.applyOptions({ width:w, height:h });
    };
    if (window.ResizeObserver && host) {
      atradeChartResizeObserver = new ResizeObserver(fitAtradeChart);
      atradeChartResizeObserver.observe(host);
    }
    atradeChartResizeHandler = fitAtradeChart;
    atradeChartViewportHandler = fitAtradeChart;
    window.addEventListener('resize', atradeChartResizeHandler);
    window.visualViewport?.addEventListener?.('resize', atradeChartViewportHandler);
    fitAtradeChart();
    atradeCandleSeries = atradeChart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor:'#4fd1b5', downColor:'#f06f75', borderVisible:false, wickUpColor:'#4fd1b5', wickDownColor:'#f06f75',
      // 内盘横盘时保留至少 0.2% 的纵轴范围：小蜡烛可见，微波也不会拉满整张图。
      // 后台主动调大行情后仍按实际高低价扩展，不会裁掉真实波动。
      autoscaleInfoProvider: (original) => {
        const info = original();
        const range = info?.priceRange;
        if (!range) return info;
        const center = (range.minValue + range.maxValue) / 2;
        const referencePrice = Number(poolStats?.priceUsdt || center);
        const minimumVisibleSpan = referencePrice * 0.002;
        if (!(minimumVisibleSpan > 0) || range.maxValue - range.minValue >= minimumVisibleSpan) return info;
        return {
          ...info,
          priceRange: {
            minValue: center - minimumVisibleSpan / 2,
            maxValue: center + minimumVisibleSpan / 2,
          },
        };
      },
    });
    atradeCandleSeries.priceScale().applyOptions({
      autoScale:true,
    });
    atradeCandleSeries.applyOptions({
      priceFormat:{ type:'price', precision:4, minMove: 0.0001 },
    });

    window.atradeLoadKline(atradePeriod);

    atradeKlineTimer = setInterval(() => {
      if (!active()) return;
      window.atradeRefreshKline().catch(err => console.warn('[A Trade Chart] refresh fail', err?.message || err));
    }, 10_000);
  };

  window.atradeSwitchPeriod = async (period) => {
    if (!Object.hasOwn(atradeBarSpacing, period)) return;
    atradePeriod = period;
    document.querySelectorAll('.atrade-chart-tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.period === period);
    });
    await window.atradeLoadKline(period);
  };

  window.atradeLoadKline = async (period) => {
    if (!atradeCandleSeries) return;
    const seq = ++atradeDataSeq;
    const series = atradeCandleSeries;
    atradeLoadedPeriod = null;
    const res = await api(`kline?period=${encodeURIComponent(period)}&limit=500`);
    // 网络往返期间用户又切了周期/图表被销毁：本响应过期，丢弃
    if (seq !== atradeDataSeq || series !== atradeCandleSeries || period !== atradePeriod) return;
    const candles = (res?.candles || []).map(c => ({
      time: Number(c.time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }));
    // 内盘阶段（自由交易未开放、50 万 LP 后才接链上）：还没有成交记录时 K 线不能空白，
    // 用平台内盘指导价铺满最近 60 个周期，让行情图立即可见；价格全部取当前内盘价，
    // 不编造涨跌幅与成交量，后续有真实内盘成交就由成交 K 线逐根替换。
    if (!candles.length) {
      const price = Number(poolStats?.priceUsdt || 0);
      if (price > 0) {
        const sec = ({ '1m':60, '5m':300, '15m':900, '1h':3600, '4h':14400, '1d':86400 })[period] || 900;
        const now = Math.floor(Date.now() / 1000 / sec) * sec;
        for (let i = 59; i >= 0; i--) {
          candles.push({ time: now - i * sec, open: price, high: price, low: price, close: price });
        }
      }
    }
    series.setData(candles);
    atradeLastTime = candles[candles.length - 1]?.time || 0;
    atradeLoadedPeriod = period;
    const timeScale = atradeChart.timeScale();
    timeScale.applyOptions(atradeTimeScaleOptions(period));
    timeScale.scrollToPosition(4, false);
  };

  window.atradeRefreshKline = async () => {
    if (!atradeCandleSeries || !active() || atradeLoadedPeriod !== atradePeriod) return;
    const reqPeriod = atradePeriod;
    const seq = atradeDataSeq, series = atradeCandleSeries;
    const res = await api(`kline?period=${encodeURIComponent(reqPeriod)}&limit=5`);
    // 往返期间切了周期/图表被销毁：旧周期响应丢弃，避免 update 早于新数据首根的 bar
    if (seq !== atradeDataSeq || series !== atradeCandleSeries || reqPeriod !== atradeLoadedPeriod) return;
    const candles = res?.candles || [];
    if (!candles.length) return;
    // 增量：最后 1-2 根 update，如有新 bar 则追加
    const sorted = candles.map(c => ({ time: Number(c.time), open: +c.open, high: +c.high, low: +c.low, close: +c.close }))
      .sort((a,b) => a.time - b.time);
    for (const bar of sorted) {
      // 单根异常（如早于图表最早一根）不影响其余 bar 更新
      try { atradeCandleSeries.update(bar); } catch {}
    }
    atradeLastTime = sorted[sorted.length - 1].time;
  };

  P.register('a-token-trade', { render, load, activate, deactivate:stopPolling, reset() { stopPolling(); ++loadSeq; profile = null; myOrdersCache = []; const host = document.getElementById('atrade-content'); if (host) host.innerHTML = P.loading(6); }, fail: e => { const h = document.getElementById('atrade-content'); if (h) h.innerHTML = P.error(e.message, "Portal.load('a-token-trade',true)"); } });
})();
