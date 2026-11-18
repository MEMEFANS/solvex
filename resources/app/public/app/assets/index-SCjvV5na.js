const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["/app/assets/earn-DvUEZ8mK.js","/app/assets/react-B-598Ilj.js","/app/assets/query-DQJ3OEX_.js","/app/assets/tabs-BVRJjnHH.js","/app/assets/radix-DBpFBVDs.js","/app/assets/sonner-BQ78Ztqg.js","/app/assets/responsive-amount-form-Ow7fliCb.js","/app/assets/use-profile-Key8Q7xU.js","/app/assets/lucide-McBAODJn.js","/app/assets/pending-s38_6IBt.js","/app/assets/use-boundary-clock-ROFWAzsQ.js","/app/assets/style-utils-DSOPSYhy.js","/app/assets/earn-CN4G7tFw.css","/app/assets/team-D58h7eRy.js","/app/assets/assets-Cs50OFo0.js","/app/assets/ranking-Ccu4qvyd.js","/app/assets/support-B_dCNkWX.js","/app/assets/community-chat-BwI6ZLG0.js","/app/assets/community-chat-DaVhNOMu.css","/app/assets/ai-managed-D4xxce3X.js","/app/assets/partner-plan-BRa6f5WV.js","/app/assets/partner-plan-r3LV1W--.css","/app/assets/blindbox-CjyF8JFo.js","/app/assets/ethers-BuZF6ExS.js","/app/assets/blindbox--PwFT0ra.css","/app/assets/ecosystem-CHwfeHMv.js"])))=>i.map(i=>d[i]);
import{r as u,j as e,c as j,d as wt}from"./react-B-598Ilj.js";import{Q as xt,u as kt,a as St}from"./query-DQJ3OEX_.js";import{t as N,T as jt}from"./sonner-BQ78Ztqg.js";import{S as Et,D as Tt,a as Pt,b as Dt,c as Ct,d as It,e as Lt,f as _t}from"./radix-DBpFBVDs.js";import{t as Bt,c as At,a as Nt}from"./style-utils-DSOPSYhy.js";import{X as Rt,W as Z,A as Y,C as Ot,I as Mt,M as Ut,a as zt,P as Wt,S as qt,b as Ft,c as Vt,G as Gt,T as Qt,U as $t,H as Ht,B as Kt,d as Xt,e as Jt,f as Zt}from"./lucide-McBAODJn.js";(function(){const n=document.createElement("link").relList;if(n&&n.supports&&n.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))s(i);new MutationObserver(i=>{for(const l of i)if(l.type==="childList")for(const d of l.addedNodes)d.tagName==="LINK"&&d.rel==="modulepreload"&&s(d)}).observe(document,{childList:!0,subtree:!0});function a(i){const l={};return i.integrity&&(l.integrity=i.integrity),i.referrerPolicy&&(l.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?l.credentials="include":i.crossOrigin==="anonymous"?l.credentials="omit":l.credentials="same-origin",l}function s(i){if(i.ep)return;i.ep=!0;const l=a(i);fetch(i.href,l)}})();const G="solvex:module-recovery",Yt=6e4;let Q=!1;function tt(){const t=new URL(location.href);t.searchParams.set("__svx_reload",String(Date.now())),location.replace(t.href)}function et(t){const n=t instanceof Error?t.message:String(t);if(!/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading (?:CSS )?chunk .+ failed/i.test(n))return!1;if(Q)return!0;if(navigator.onLine===!1)return!1;const a=Date.now();let s=Number(new URL(location.href).searchParams.get("__svx_reload")||0);try{s=Math.max(s,Number(sessionStorage.getItem(G)||0))}catch{}if(a-s<Yt)return!1;Q=!0;try{sessionStorage.setItem(G,String(a))}catch{}return tt(),!0}window.addEventListener("vite:preloadError",t=>{et(t.payload)&&t.preventDefault()});const R=()=>String(window.currentWalletConnection?.address||"").toLowerCase();function te(t){window.handleWalletButton(document.getElementById("wallet-connect-btn")||void 0)}async function F(){await window.loadPageFeature("wallet-funds");const t=window.solvexWalletBridge;if(!t?.deposit)throw new Error("资金模块加载失败，请刷新重试");return t}async function Xe(t,n,a){const s=await F();return await s.ensureSession?.(),s.deposit(t,n,a)}async function Je(){await F();const t=window.USDTWithdrawal;if(!t?.open)throw new Error("提现模块加载失败，请刷新重试");t.open()}async function ee(t){const n=R(),s=(await F()).provider();if(!s||!n)throw new Error("请先连接钱包");const i=String(await s.request({method:"personal_sign",params:[t,n]}));if(R()!==n)throw new Error("钱包已切换，请重新确认");return i}const ae=900*1e3;function ne(t){for(const n of["profile","plans","team","referral","referral-rewards","wallet-profile","platform-profile","svx-revenue","svx-fund-records","ecosystem","partner-dividends","svx-pool-price","leaderboard","support-session","ai-managed"])t.setQueryDefaults([n],{gcTime:ae})}const se=t=>[401,403].includes(Number(t?.status));function ie(t){return t.data!==void 0&&!se(t.error)}const g=new xt({defaultOptions:{queries:{staleTime:15e3,retry:1,refetchOnWindowFocus:!0,gcTime:12e4},mutations:{retry:!1}}});ne(g);function I(){return{address:String(window.currentWalletConnection?.address||"").toLowerCase(),authenticated:!!window.currentWalletProfile?.authenticated,revision:window.getWalletStateRevision?.()||0}}const m=()=>{const t=I();return t.address+":"+t.revision+":"+t.authenticated};async function O(t,n={},a=!0){const s=m();if(a&&!I().authenticated)throw new Error("请先连接并确认钱包");const i=new AbortController,l=()=>i.abort();n.signal?.addEventListener("abort",l,{once:!0}),n.signal?.aborted&&i.abort();const d=setTimeout(l,15e3);try{const o=await fetch("/api/"+t,{credentials:"same-origin",...n,signal:i.signal}),c=await o.json().catch(()=>{throw new Error("服务暂不可用，请稍后重试")});if(a&&s!==m())throw new Error("钱包状态已变化，请重新操作");if(!o.ok)throw Object.assign(new Error(c.error||"请求失败"),{status:o.status,code:c.code,requestId:o.headers.get("X-Request-Id")});return c}catch(o){throw o instanceof Error&&o.name==="AbortError"?new Error("请求超时，请刷新核对结果"):o}finally{clearTimeout(d),n.signal?.removeEventListener("abort",l)}}const at=(t,n,a)=>O(t,{method:"POST",headers:{"Content-Type":"application/json",...a},body:JSON.stringify(n)}),nt=t=>t+"_"+crypto.randomUUID().replaceAll("-","");async function Ze(t,n,a){const s="solvex:request:"+a,i=R()+":"+JSON.stringify(n);let l=null;try{l=JSON.parse(sessionStorage.getItem(s)||"null")}catch{}const d=l?.fingerprint===i&&l.id?l.id:nt(a);sessionStorage.setItem(s,JSON.stringify({fingerprint:i,id:d}));const o=await at(t,n,{"Idempotency-Key":d});return sessionStorage.removeItem(s),o}async function Ye(t,n,a,s,i){const l=m(),d="solvex:signed:"+a,o=R()+":"+JSON.stringify(n);let c=null;try{c=JSON.parse(sessionStorage.getItem(d)||"null")}catch{}const r=c?.fingerprint===o&&c.id?c.id:nt(a);sessionStorage.setItem(d,JSON.stringify({fingerprint:o,id:r}));const p=Date.now(),b=await ee(s(r,p));if(m()!==l)throw new Error("钱包状态已变化，请重新操作");const v=await at(t,{...n,timestamp:p,signature:b},{"Idempotency-Key":r});return sessionStorage.removeItem(d),v}const oe=`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<meta name="format-detection" content="telephone=no" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<title>Solvex · 数字资产与量化生态</title>
<link rel="icon" type="image/png" sizes="32x32" href="/assets/brand/favicon-32.png?v=20261111-domain-solvex-logo-3">
<link rel="icon" type="image/png" sizes="64x64" href="/assets/brand/icon-64.png?v=20261111-domain-solvex-logo-3">
<link rel="alternate icon" href="/favicon.ico?v=20261111-domain-solvex-logo-3">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/brand/icon-180.png?v=20261111-domain-solvex-logo-3">
<meta name="theme-color" content="#f5f7f8">
<link rel="modulepreload" href="/vendor/wallet/connector.js?v=20261111-domain-team-1">
<script src="/js/account-action-guard.js?v=20261111-domain-team-1"><\/script>
<script defer src="/js/theme.js?v=20261114-logo-palette-1"><\/script>
<script>
(() => {
  const local = ['127.0.0.1', 'localhost', '::1'].includes(location.hostname);
  window.WG_OPERATOR_MODE = local && new URLSearchParams(location.search).get('operator') === '1';
  if (window.WG_OPERATOR_MODE) document.documentElement.classList.add('operator-mode');
})();
<\/script>
<!-- 首屏关键 CSS（render-blocking，仅 base/portal/mobile 三部分） -->
<link rel="stylesheet" href="/styles/critical.css?v=20261112-internal-kline-8">
<!-- 非首屏 CSS（media=print 异步下载，不阻塞渲染；8 个文件合并为 1 个请求） -->
<link rel="stylesheet" href="/styles/lazy.css?v=20261111-domain-team-1" media="print" onload="this.media='all'">
<link rel="stylesheet" href="/styles/solvex-design.css?v=20261111-domain-light-3">
<link rel="stylesheet" href="/styles/solvex-crystal.css?v=20261111-domain-light-3">
</head>
<body>

<!-- ── Header ── -->
<div class="header">
  <div class="header-logo"><i class="brand-mark"></i> Solvex <small class="header-slogan" aria-hidden="true">有信号，不瞎猜 · Measure, don't guess.</small></div>
  <div class="header-sep operator-only"></div>
  <span class="hdot idle operator-only" id="hdr-de-dot" title=""></span><span id="hdr-de" class="badge badge-paper operator-only">DE: PAPER</span>
  <span class="hdot idle operator-only" id="hdr-ex-dot" title=""></span><span id="hdr-ex" class="badge badge-paper operator-only">EX: PAPER</span>
  <span class="hdot idle operator-only" id="hdr-rs-dot" title=""></span><span id="hdr-rs" class="badge badge-paper operator-only">RS: PAPER</span>
  <div class="main-tabs" role="navigation" aria-label="主导航">
    <button class="tab-btn active" data-nav-zh="矿池" onclick="switchTab('earn')">矿池</button>
    <button class="tab-btn" id="open-aix-mall" data-nav-zh="商城" onclick="switchTab('mall')">商城</button>
    <span class="tab-sep" aria-hidden="true"></span>
    <button class="tab-btn" data-nav-zh="交易" data-trade-nav="trade" onclick="openTradePage('spot')">交易</button>
    <button class="tab-btn" data-nav-zh="群聊" onclick="switchTab('community-chat')">群聊</button>
    <button class="tab-btn" data-nav-zh="SVX交易" onclick="switchTab('a-token-trade')">SVX交易</button>
    <span class="tab-sep" aria-hidden="true"></span>
    <button class="tab-btn" data-nav-zh="合约风云榜" onclick="switchTab('leaderboard')">合约风云榜</button>
    <button class="tab-btn" data-nav-zh="团队" onclick="switchTab('referrals')">团队</button>
    <span class="tab-sep" aria-hidden="true"></span>
    <button class="tab-btn" data-nav-zh="我的资产" onclick="switchTab('account')">我的资产</button>
    <button class="tab-btn" data-nav-zh="在线客服" onclick="switchTab('support')">在线客服</button>
    <button class="tab-btn" data-nav-zh="Ai量化" onclick="switchTab('ai-managed')">Ai量化</button>
    <button class="tab-btn operator-only" onclick="switchTab('portfolio')">投资组合</button>
    <button class="tab-btn operator-only" onclick="switchTab('vaults')">金库</button>
    <button class="tab-btn operator-only" onclick="switchTab('staking')">能量</button>
    <button class="tab-btn operator-only" onclick="switchTab('ledger')">机器人账本</button>
    <button class="tab-btn operator-only" onclick="switchTab('ai')">AI 助手</button>
  </div>
  <div class="header-right">
    <button id="lang-toggle" class="lang-toggle" type="button" title="切换语言" aria-label="切换语言">🌐</button>
    <div class="wallet-control">
      <button id="wallet-connect-btn" class="wallet-connect" aria-haspopup="menu" aria-expanded="false" onclick="handleWalletButton(this)">连接钱包</button>
      <div id="wallet-account-menu" class="wallet-account-menu" role="menu" hidden>
        <button id="wallet-menu-auth" type="button" role="menuitem" class="primary" onclick="verifyWalletFromMenu(this)">🔐 身份验证</button>
        <button type="button" role="menuitem" onclick="openWalletAccount()">钱包资金</button>
        <button type="button" role="menuitem" class="danger" onclick="disconnectWallet()">断开钱包</button>
      </div>
    </div>
    <span id="hdr-conn" class="conn warn operator-only" title="后端连接状态"><span class="cdot"></span><span id="hdr-conn-txt">连接中…</span></span>
    <span class="muted" id="hdr-time"></span>
    <button id="mobile-nav-toggle" class="mobile-nav-toggle" type="button" aria-label="打开导航菜单" aria-expanded="false" onclick="toggleMobileNav()"><span></span><span></span><span></span></button>
  </div>
</div>

<!-- ── 平台公告横幅（后台「平台公告」可编辑，最多 2 条，中英双语；内容由 announcement.js 注入） ── -->
<div id="platform-announce-list" data-no-translate></div>

<!-- 公告详情弹窗：点「展开」打开，点遮罩 / × / Esc 关闭 -->
<div id="platform-announce-modal" class="pa-modal" data-no-translate hidden>
  <div class="pa-modal-mask" data-pa-close></div>
  <div class="pa-modal-card" role="dialog" aria-modal="true" aria-labelledby="pa-modal-title">
    <div class="pa-modal-head">
      <b id="pa-modal-title">📢 平台公告</b>
      <button type="button" class="pa-modal-close" data-pa-close aria-label="关闭">×</button>
    </div>
    <div class="pa-modal-body" id="pa-modal-body"></div>
  </div>
</div>

<div id="mobile-nav-backdrop" class="mobile-nav-backdrop" aria-hidden="true" onclick="toggleMobileNav(false)"></div>

<div id="tab-trade" class="tab-panel">
  <div class="trade-terminal">
    <nav class="trade-section-nav" aria-label="交易市场">
      <button type="button" data-trade-section="spot" aria-pressed="true" class="active" onclick="openTradePage('spot')">现货</button>
      <button type="button" data-trade-section="perp" aria-pressed="false" onclick="openTradePage('perp')">合约</button>
      <button type="button" data-trade-section="stock" aria-pressed="false" onclick="openStockPage()">股票</button>
    </nav>
    <div class="terminal-marketbar">
      <button class="terminal-symbol market-trigger" id="trade-market-trigger" type="button"><span class="coin-mark"><img id="trade-symbol-logo" src="/assets/tokens/btc.png" alt="BTC"></span><div><b id="trade-symbol">BTC / USDT</b><span id="trade-product-label">永续合约</span></div><span class="market-chevron">⌄</span></button>
      <div class="ticker-stat ticker-price-stat"><select id="trade-price-mode" aria-label="价格类型"><option value="last" selected>最新价格</option><option value="mark">标记价格</option></select><b id="trade-mark-price">—</b></div>
      <div class="ticker-stat"><span>24h 涨跌</span><b id="trade-change">—</b></div>
      <div class="ticker-stat"><span>24h 最高</span><b id="trade-high">—</b></div>
      <div class="ticker-stat"><span>24h 最低</span><b id="trade-low">—</b></div>
      <div class="ticker-stat"><span>24h 成交额 (USDT)</span><b id="trade-volume">—</b></div>
      <div class="ticker-stat ticker-funding-stat" id="trade-funding-stat" hidden><span>资金费率 (8h) / 倒计时</span><b><span id="trade-funding-rate">—</span> · <span id="trade-funding-countdown">—:—:—</span></b></div>
    </div>
    <div class="terminal-grid">
      <section class="terminal-chart">
        <div class="terminal-toolbar">
          <div class="terminal-tabs" id="trade-chart-tabs"><button class="active" data-chart-view="chart">图表</button><button data-chart-view="details">详情</button></div>
          <div class="timeframe-tabs" id="trade-timeframes">
            <button data-sec="60">1m</button><button data-sec="300">5m</button><button data-sec="900">15m</button><button class="active" data-sec="3600">1h</button><button data-sec="14400">4h</button><button data-sec="86400">1D</button>
          </div>
        </div>
        <div class="chart-indicator-bar" id="trade-indicators"><span>主图</span><button class="indicator-toggle" data-period="7">MA(7)</button><button class="indicator-toggle" data-period="25">MA(25)</button><button class="indicator-toggle" data-period="99">MA(99)</button><button class="indicator-toggle" data-indicator="ema" data-period="7">EMA(7)</button><button class="indicator-toggle" data-indicator="ema" data-period="25">EMA(25)</button><button class="indicator-toggle" data-indicator="ema" data-period="99">EMA(99)</button><button class="indicator-toggle" data-indicator="boll">BOLL(20,2)</button><span>副图</span><button class="indicator-toggle" data-indicator="vol">VOL</button><button class="indicator-toggle" data-indicator="macd">MACD(12,26,9)</button><button class="indicator-toggle" id="trade-alert-btn" type="button" title="价格提醒" style="margin-left:auto">⏰ 提醒</button></div>
        <div id="trade-chart"></div>
        <div class="trade-chart-subview" id="trade-chart-details" hidden>
          <div><span>交易对</span><b id="trade-detail-symbol">BTC/USDT</b></div><div><span>产品</span><b id="trade-detail-product">现货</b></div>
          <div><span>最新价格</span><b id="trade-detail-price">—</b></div><div><span>24h 涨跌</span><b id="trade-detail-change">—</b></div>
          <div><span>24h 最高</span><b id="trade-detail-high">—</b></div><div><span>24h 最低</span><b id="trade-detail-low">—</b></div>
          <div><span>24h 成交额</span><b id="trade-detail-volume">—</b></div><div><span>结算资产</span><b>USDT</b></div>
        </div>
      </section>
      <aside class="orderbook-panel">
        <div class="terminal-section-title">
          <div class="terminal-tabs" id="trade-book-tabs">
            <button class="active" data-book-view="book" type="button">订单簿</button>
            <button data-book-view="trades" type="button">最近成交</button>
            <button data-book-view="depth" type="button">深度图</button>
          </div>
          <select id="trade-book-precision" class="book-precision-select" aria-label="订单簿聚合精度">
            <option value="0.01">0.01</option>
            <option value="0.1" selected>0.1</option>
            <option value="1">1</option>
            <option value="10">10</option>
            <option value="100">100</option>
          </select>
        </div>
        <div id="trade-book-panel" class="book-panel">
          <div id="trade-book-spread-bar" class="book-spread-bar" hidden>
            <span class="book-spread-bid"><em id="trade-book-bid-pct">0%</em></span>
            <span class="book-spread-ask"><em id="trade-book-ask-pct">0%</em></span>
          </div>
          <div class="book-head"><span>价格</span><span>数量</span><span>合计</span></div>
          <div id="trade-asks" class="book-rows"></div>
          <div class="book-mid" id="trade-book-mid">—</div>
          <div id="trade-bids" class="book-rows"></div>
        </div>
        <div id="trade-trades-panel" class="book-panel" hidden>
          <div class="book-head"><span>价格</span><span>数量</span><span>时间</span></div>
          <div id="trade-trades" class="book-rows trade-trades-list"></div>
        </div>
        <div id="trade-depth-panel" class="book-panel" hidden>
          <canvas id="trade-depth-canvas"></canvas>
        </div>
      </aside>
      <aside class="order-entry aentry">
        <div class="terminal-section-title">下单</div>
        <div class="side-switch"><button class="active" data-side="buy" id="trade-buy-label">做多</button><button data-side="sell" id="trade-sell-label">做空</button></div>
        <div class="order-type-tabs" id="trade-order-types"><button class="active" data-order-type="market">市价</button><button data-order-type="limit">限价</button><button data-order-type="trigger">条件</button></div>
        <div class="order-field order-tif-field" id="trade-tif-field" hidden><span>有效期</span><select id="trade-tif"><option value="GTC">GTC（撤前有效）</option><option value="IOC">IOC（即时成交剩余撤）</option><option value="FOK">FOK（全成或撤）</option><option value="POST">Post-Only（只做 Maker）</option></select><b></b></div>
        <label><span id="trade-available-label">平台可用保证金</span> <span id="trade-available-balance" style="cursor:pointer" title="点击填满数量">— USDT</span></label>
        <div class="order-field" id="trade-order-price-field"><span>价格</span><input id="trade-order-price" type="number" readonly><b>USDT</b></div>
        <div class="trigger-order-grid" id="trade-trigger-fields" hidden>
          <label><span>触发价</span><input id="trade-trigger-price" type="number" min="0" step="any"><b>USDT</b></label>
          <label><span>方向</span><select id="trade-trigger-direction"><option value="above">上涨到</option><option value="below">下跌到</option></select></label>
        </div>
        <div class="order-field"><span>数量</span><input id="trade-order-size" type="number"><b id="trade-order-asset">BTC</b></div>
        <div class="order-field order-field-action" id="trade-leverage-field"><span>杠杆</span><button id="trade-leverage-trigger" class="order-select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">3x</button><input id="trade-leverage" type="number" min="1" max="100" step="1" value="3" inputmode="numeric" aria-label="合约杠杆，1 到 100 倍" hidden><b></b></div>
        <div class="trade-popover leverage-popover" id="trade-leverage-popover" hidden><div class="popover-title">选择杠杆 <span>1x–100x</span></div><div class="leverage-grid" role="listbox" aria-label="杠杆档位"><button type="button" data-leverage-value="1">1x</button><button type="button" data-leverage-value="2">2x</button><button type="button" data-leverage-value="3">3x</button><button type="button" data-leverage-value="5">5x</button><button type="button" data-leverage-value="10">10x</button><button type="button" data-leverage-value="20">20x</button><button type="button" data-leverage-value="25">25x</button><button type="button" data-leverage-value="50">50x</button><button type="button" data-leverage-value="75">75x</button><button type="button" data-leverage-value="100">100x</button></div></div>
        <div class="order-field order-field-action" id="trade-margin-mode-field"><span>保证金</span><button id="trade-margin-mode-trigger" class="order-select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">逐仓</button><select id="trade-margin-mode" hidden><option value="isolated" selected>逐仓</option><option value="cross">全仓</option></select><b>模式</b></div>
        <div class="trade-popover margin-popover" id="trade-margin-popover" hidden><div class="popover-title">保证金模式 <span>风险独立计算</span></div><div class="margin-mode-grid"><button type="button" data-margin-mode="isolated"><b>逐仓</b><small>单独仓位风险</small></button><button type="button" data-margin-mode="cross"><b>全仓</b><small>共享合约余额</small></button></div></div>
        <label class="reduce-only-control" id="trade-reduce-only-field"><input id="trade-reduce-only" type="checkbox" hidden><button id="trade-reduce-only-toggle" type="button" role="switch" aria-checked="false"><i></i><span>只减仓</span></button><small>只准许减少现有仓位</small></label>
        <input class="amount-slider" type="range" min="0" max="100" value="0" aria-label="仓位比例">
        <div class="slider-labels"><button type="button" data-amount-percent="0">0%</button><button type="button" data-amount-percent="25">25%</button><button type="button" data-amount-percent="50">50%</button><button type="button" data-amount-percent="75">75%</button><button type="button" data-amount-percent="100">100%</button></div>
        <button class="terminal-order-btn" id="trade-order-btn" onclick="handleTradeOrder(this)">连接钱包</button>
        <button class="terminal-order-btn terminal-close-btn" id="trade-quick-close-btn" type="button" onclick="quickClosePerp(this)" hidden>市价平仓</button>
        <div class="quote-box">
          <div class="order-summary q-row"><span>订单价值</span><b id="trade-order-value">0.00 USDT</b></div>
          <div class="order-summary q-row"><span id="trade-receive-label">获得数量</span><b id="trade-receive-qty">— —</b></div>
          <div class="order-summary q-row" id="trade-opening-size-row" hidden><span>预计开仓数量</span><b id="trade-opening-size">0.00000000 BTC</b></div>
          <div class="order-summary q-row" id="trade-opening-margin-row" hidden><span>预计开仓保证金</span><b id="trade-opening-margin">0.00 USDT</b></div>
          <div class="order-summary q-row" id="trade-fee-row" hidden><span>预计手续费</span><b id="trade-fee">0.00 USDT</b></div>
          <div class="order-summary q-row"><span id="trade-summary-available-label">可用余额</span><b id="trade-summary-available">— USDT</b></div>
          <div class="order-summary q-row"><span>已用保证金</span><b id="trade-margin-used">— USDT</b></div>
          <div class="order-summary q-row"><span>保证金使用率</span><b id="trade-margin-usage">—</b></div>
        </div>
      </aside>
      <section class="terminal-bottom">
        <div class="terminal-tabs" id="trade-account-tabs"><button class="active" data-view="balances">资产</button><button data-view="positions">持仓</button><button data-view="orders">当前委托</button><button data-view="history">历史委托</button><button data-view="fills">成交历史</button></div>
        <div id="trade-account-content" class="terminal-account-content"></div>
      </section>
    </div>
  </div>
</div>

<div id="tab-partner-plan" class="tab-panel"></div>

<div id="tab-ai-managed" class="tab-panel">
  <main class="aim-page">
    <section class="aim-banner">
      <div class="aim-banner-copy">
        <span class="aim-status" id="aim-status">等待连接钱包</span>
        <h1>Solvex 合约跟单</h1>
        <div class="aim-rate"><strong>0.8%</strong><span>日化目标 · 自动复投</span></div>
        <div class="aim-tags"><span>随机间隔生成明细</span><span>随时赎回</span><span>平台内部结算</span></div>
      </div>
      <div class="aim-robot" role="img" aria-label="跟单机器人">
        <svg class="aim-bot" viewBox="0 0 120 100" aria-hidden="true">
          <defs>
            <linearGradient id="aimBotHead" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#eaf3f0"/><stop offset="1" stop-color="#dcebe6"/>
            </linearGradient>
            <linearGradient id="aimBotBody" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#e4efeb"/><stop offset="1" stop-color="#d6e6e1"/>
            </linearGradient>
            <radialGradient id="aimBotGlow" cx=".5" cy=".5" r=".5">
              <stop offset="0" stop-color="#0e9c88" stop-opacity=".16"/><stop offset="1" stop-color="#0e9c88" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <ellipse class="aim-bot-halo" cx="60" cy="56" rx="46" ry="33" fill="url(#aimBotGlow)"/>
          <line x1="60" y1="7" x2="60" y2="16" stroke="#7f958f" stroke-width="2"/>
          <circle class="aim-bot-tip" cx="60" cy="6" r="3.5" fill="#a8700a"/>
          <rect x="21" y="29" width="7" height="15" rx="3" fill="#b7c9c4"/>
          <rect x="92" y="29" width="7" height="15" rx="3" fill="#b7c9c4"/>
          <rect class="aim-bot-shell" x="28" y="16" width="64" height="42" rx="11" fill="url(#aimBotHead)" stroke="#b3c7c2"/>
          <rect class="aim-bot-screen" x="35" y="23" width="50" height="28" rx="6" fill="#123a33" stroke="#0e9c8833"/>
          <rect class="aim-bot-eye" x="45" y="31" width="7" height="10" rx="3.5" fill="#0e9c88"/>
          <rect class="aim-bot-eye" x="68" y="31" width="7" height="10" rx="3.5" fill="#0e9c88"/>
          <path d="M55 45q5 3 10 0" fill="none" stroke="#0e9c88" stroke-width="1.6" stroke-linecap="round" opacity=".65"/>
          <rect x="55" y="58" width="10" height="6" rx="2" fill="#b7c9c4"/>
          <rect x="24" y="66" width="8" height="17" rx="4" fill="#e7f0ed" stroke="#a9bdb8"/>
          <rect x="88" y="66" width="8" height="17" rx="4" fill="#e7f0ed" stroke="#a9bdb8"/>
          <rect class="aim-bot-shell" x="33" y="64" width="54" height="29" rx="9" fill="url(#aimBotBody)" stroke="#a9bdb8"/>
          <rect class="aim-bot-screen" x="43" y="70" width="34" height="17" rx="4" fill="#123a33" stroke="#0e9c8828"/>
          <line x1="51" y1="73" x2="51" y2="84" stroke="#e7f0ed" stroke-width="1"/>
          <rect x="49" y="76" width="4" height="5" rx="1" fill="#0e9c88"/>
          <line x1="60" y1="73" x2="60" y2="84" stroke="#e7f0ed" stroke-width="1"/>
          <rect x="58" y="74" width="4" height="5" rx="1" fill="#a8700a"/>
          <line x1="69" y1="73" x2="69" y2="84" stroke="#e7f0ed" stroke-width="1"/>
          <rect class="aim-bot-candle" x="67" y="72" width="4" height="6" rx="1" fill="#0e9c88"/>
          <circle class="aim-bot-dot" cx="82" cy="74" r="2.2" fill="#a8700a"/>
        </svg>
      </div>
    </section>

    <section class="aim-metrics" aria-label="跟单资产概览">
      <div><span>跟单总额</span><strong id="aim-balance">0 USDT</strong></div>
      <div><span>今日收益</span><strong id="aim-day-earned">0 USDT</strong></div>
      <div><span>累计收益</span><strong id="aim-total-earned">0 USDT</strong></div>
      <div><span>下次明细</span><strong id="aim-next-slot">—</strong></div>
    </section>

    <section class="aim-controls">
      <div class="aim-control-main">
        <div class="aim-section-title"><div><h2>资金跟单</h2><span id="aim-available">可用余额 — USDT</span><span id="aim-quota" style="display:none;font-size:12px;color:#5b6b66"></span></div><span class="aim-compound">自动复投已开启</span></div>
        <div class="aim-deposit-row">
          <label for="aim-term">跟单期限</label>
          <select id="aim-term" class="aim-term"><option value="30">30 天 · 日化 0.4%</option><option value="90">90 天 · 日化 0.6%</option><option value="180">180 天 · 日化 0.8%</option><option value="360" selected>360 天 · 日化 1.2%</option></select>
          <label for="aim-amount">跟单金额</label>
          <div class="aim-amount-field"><input id="aim-amount" name="ai_managed_usdt_amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" autocomplete="transaction-amount" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-bwignore="true"><span>USDT</span><button id="aim-max" type="button">全部</button></div>
          <button class="aim-primary" id="aim-start" type="button">开始跟单</button>
          <button class="aim-secondary" id="aim-redeem" type="button" disabled>全部赎回</button>
        </div>
        <div class="aim-progress-head"><span>今日目标进度</span><b id="aim-progress-text">0 / 0 USDT</b></div>
        <div class="aim-progress"><i id="aim-progress-bar"></i></div>
        <p class="aim-disclosure">收益由平台内部结算；下方为合约跟单执行明细。</p>
      </div>
    </section>

    <section class="aim-records">
      <div class="aim-section-title"><div><h2>跟单批次</h2><span>追加资金独立计算到期时间</span></div></div>
      <div class="aim-table-wrap"><table><thead><tr><th>批次</th><th>期限</th><th>投入 USDT</th><th>开始时间</th><th>到期时间</th><th>状态</th></tr></thead><tbody id="aim-batches"><tr><td colspan="6" class="aim-empty">暂无跟单批次</td></tr></tbody></table></div>
    </section>

    <section class="aim-records">
      <div class="aim-section-title"><div><h2>策略执行明细</h2><span>当日达到 0.8% 后停止生成</span></div></div>
      <div class="aim-table-wrap">
        <table><thead><tr><th>时间</th><th>交易对</th><th>方向</th><th>参考价格</th><th>数量</th><th>本次收益</th><th>类型</th></tr></thead>
        <tbody id="aim-records"><tr><td colspan="7" class="aim-empty">暂无执行明细</td></tr></tbody></table>
      </div>
    </section>
  </main>
</div>

<div id="tab-portfolio" class="tab-panel portal-page"></div>
<div id="tab-earn" class="tab-panel portal-page active">  <!-- 首屏静态骨架：JS 就绪前先画出页面结构（earn.js 就绪后以相同结构重绘，无闪烁） -->
  <div class="portal-shell">
    <header class="portal-heading"><div><h1>矿池</h1><p>探索 SVX 生态，管理你的每一份资产</p></div></header>
    <div class="earn-sub-tabs">
      <button class="earn-sub-tab active" type="button">矿池</button>
      <button class="earn-sub-tab" type="button">待领取</button>
      <button class="earn-sub-tab" type="button">能量</button>
      <button class="earn-sub-tab" type="button">股东</button>
      <button class="earn-sub-tab" type="button">盲盒</button>
      <button class="earn-sub-tab" type="button">超速驱动协议</button>
    </div>
    <div id="earn-content"><div class="portal-loading"><i></i><i></i><i></i><i></i><i></i><i></i></div></div>
  </div>
</div>
<div id="tab-vaults" class="tab-panel portal-page"></div>
<div id="tab-staking" class="tab-panel portal-page"></div>
<div id="tab-referrals" class="tab-panel portal-page"></div>
<div id="tab-community-chat" class="tab-panel portal-page"></div>

<div id="tab-leaderboard" class="tab-panel portal-page"></div>
<div id="tab-a-token-trade" class="tab-panel portal-page"></div>
<div id="tab-support" class="tab-panel portal-page"></div>
<!-- Solvex 商城：站内标签页嵌入（iframe 同源，高度自适应；商城自身页头页脚在 ?embed=1 下隐藏） -->
<div id="tab-mall" class="tab-panel portal-page"><iframe id="mall-frame" src="/mall.html?embed=1&v=20261114-logo-palette-1" title="Solvex 商城" style="width:100%;border:0;display:block;min-height:75vh;background:transparent" loading="lazy"></iframe></div>
<script>
addEventListener('message', e => {
  if (e.origin === location.origin && e.data?.type === 'mall-height') {
    const f = document.getElementById('mall-frame');
    if (f) f.style.height = Math.max(600, e.data.h + 4) + 'px';
  }
});
<\/script>

<div class="market-picker-backdrop" id="trade-market-picker" hidden>
  <div class="market-picker-dialog">
    <div class="market-search"><span>⌕</span><input id="trade-market-search" placeholder="搜索市场" autocomplete="off"><button type="button" id="trade-market-close">×</button></div>
    <div class="market-category-tabs"><button data-market-product="perp" class="active">合约</button><button data-market-product="spot">现货</button><button data-market-scope="stock">股票</button><button data-market-category="favorites">自选</button></div>
    <div class="market-list-head"><span>市场</span><span>最后价格</span><span>24小时变化</span><span>24h 成交额 (USDT)</span></div>
    <div id="trade-market-list"></div>
  </div>
</div>





<!-- TAB: 永久成交账本 -->
<div id="tab-ledger" class="tab-panel">
<div class="wrap">
  <div class="total-row" style="margin-top:4px">
    <div class="total-card"><div class="lbl">已保存成交</div><div class="val" id="ledger-records">0</div><div class="sub">永久明细</div></div>
    <div class="total-card"><div class="lbl">完成平仓</div><div class="val" id="ledger-completed">0</div><div class="sub">含回收成交</div></div>
    <div class="total-card"><div class="lbl">成交胜率</div><div class="val" id="ledger-winrate">—</div><div class="sub" id="ledger-winloss">胜 0 / 负 0</div></div>
    <div class="total-card"><div class="lbl">明细净盈亏</div><div class="val" id="ledger-pnl">0.00</div><div class="sub">手续费 <span id="ledger-fees">0.00</span></div></div>
  </div>
  <div class="panel">
    <div class="panel-title">网格机器人</div>
    <div class="bot-grid">
      <div class="bot-card">
        <div class="bot-head"><span class="bot-name">Decibel</span><span class="bot-state" id="bot-state-de">读取中…</span></div>
        <div class="bot-metrics">
          <div><span class="bot-lbl">市场</span><span class="bot-val" id="bot-market-de">—</span></div>
          <div><span class="bot-lbl">权益 (USDC)</span><span class="bot-val" id="bot-equity-de">—</span></div>
          <div><span class="bot-lbl">挂单</span><span class="bot-val" id="bot-orders-de">—</span></div>
          <div><span class="bot-lbl">累计盈亏</span><span class="bot-val" id="bot-pnl-de">—</span></div>
        </div>
        <div class="bot-actions">
          <button type="button" class="btn btn-ghost" id="bot-start-de" onclick="startBot('de', this)">启动</button>
          <button type="button" class="btn btn-ghost" id="bot-stop-de" onclick="stopBot('de', this)">停止</button>
        </div>
      </div>
      <div class="bot-card">
        <div class="bot-head"><span class="bot-name">Extended</span><span class="bot-state" id="bot-state-ex">读取中…</span></div>
        <div class="bot-metrics">
          <div><span class="bot-lbl">市场</span><span class="bot-val" id="bot-market-ex">—</span></div>
          <div><span class="bot-lbl">权益 (USDC)</span><span class="bot-val" id="bot-equity-ex">—</span></div>
          <div><span class="bot-lbl">挂单</span><span class="bot-val" id="bot-orders-ex">—</span></div>
          <div><span class="bot-lbl">累计盈亏</span><span class="bot-val" id="bot-pnl-ex">—</span></div>
        </div>
        <div class="bot-actions">
          <button type="button" class="btn btn-ghost" id="bot-start-ex" onclick="startBot('ex', this)">启动</button>
          <button type="button" class="btn btn-ghost" id="bot-stop-ex" onclick="stopBot('ex', this)">停止</button>
        </div>
      </div>
      <div class="bot-card">
        <div class="bot-head"><span class="bot-name">RISEx</span><span class="bot-state" id="bot-state-rs">读取中…</span></div>
        <div class="bot-metrics">
          <div><span class="bot-lbl">市场</span><span class="bot-val" id="bot-market-rs">—</span></div>
          <div><span class="bot-lbl">权益 (USDC)</span><span class="bot-val" id="bot-equity-rs">—</span></div>
          <div><span class="bot-lbl">挂单</span><span class="bot-val" id="bot-orders-rs">—</span></div>
          <div><span class="bot-lbl">累计盈亏</span><span class="bot-val" id="bot-pnl-rs">—</span></div>
        </div>
        <div class="bot-actions">
          <button type="button" class="btn btn-ghost" id="bot-start-rs" onclick="startBot('rs', this)">启动</button>
          <button type="button" class="btn btn-ghost" id="bot-stop-rs" onclick="stopBot('rs', this)">停止</button>
        </div>
      </div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">完整成交账本</div>
    <div class="ledger-toolbar">
      <div><label for="ledger-exchange">交易所</label><select id="ledger-exchange" onchange="loadLedger(true)"><option value="all">全部交易所</option><option value="de">Decibel</option><option value="ex">Extended</option><option value="rs">RISEx</option></select></div>
      <button class="btn btn-ghost" onclick="loadLedger(true)">↻ 刷新</button>
      <button class="btn btn-ghost" onclick="exportLedger()">⇩ 导出 CSV</button>
    </div>
    <div class="trade-table-wrap"><table class="trade-table ledger-table"><thead><tr><th>时间</th><th>交易所</th><th>市场</th><th>类型</th><th>方向</th><th>成交价</th><th>数量</th><th>手续费</th><th>净盈亏</th></tr></thead><tbody id="ledger-body"><tr><td class="empty-row" colspan="9">正在读取账本…</td></tr></tbody></table></div>
    <div style="display:flex;justify-content:center;margin-top:12px"><button id="ledger-more" class="btn btn-ghost" style="width:auto;margin:0" onclick="loadLedger(false)">加载更多</button></div>
    <div class="muted ledger-note" id="ledger-note">账本独立保存在用户数据目录，重启、重新打包和重置账户都不会删除。旧版只会迁移当时仍保留的最近成交明细。</div>
  </div>
</div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- TAB: 个人中心 / 多链钱包 -->
<!-- ═══════════════════════════════════════════════════════════ -->
<div id="tab-account" class="tab-panel">
<div class="wrap account-shell">
  <div id="account-locked" class="panel account-locked">
    <h2>连接钱包进入个人中心</h2>
    <p class="muted">连接钱包即可进入；首次充值、提现或交易时再核对一次钱包，无需邮箱或其他账号。</p>
    <button id="account-connect-btn" class="btn btn-smart" onclick="connectWallet(this)">连接钱包</button>
  </div>

  <div id="account-content" style="display:none">
    <div id="assets-dashboard-view">
    <section class="assets-header">
      <div>
        <h2>资产总览</h2>
        <div class="assets-wallet"><span class="assets-wallet-dot"></span><span id="account-address">—</span></div>
        <div class="assets-uid" id="account-uid-row" hidden>
          <span class="assets-uid-label">用户ID</span>
          <button type="button" class="assets-uid-copy" id="account-uid-btn" title="点击复制用户ID" onclick="copyAccountUid()">
            <span id="account-uid">—</span><span class="assets-uid-icon">⧉</span>
          </button>
        </div>
        <div id="account-partner-badge" class="partner-badge" hidden></div>
      </div>
      <div class="assets-header-actions">
        <button class="assets-icon-btn" title="刷新资产" aria-label="刷新资产" onclick="window.ExchangeAssets?.refresh()">↻</button>
        <button class="assets-text-btn" onclick="disconnectWallet()">断开钱包</button>
      </div>
    </section>

    <section class="assets-overview">
      <div class="assets-total">
        <span class="assets-label">总资产估值</span>
        <strong><span id="assets-total-equity">0.00</span> <small>USDT</small></strong>
        <span class="assets-subvalue">≈ $<span id="assets-total-usd">0.00</span></span>
        <div class="assets-quick-actions">
          <button class="assets-primary-action" onclick="window.ExchangeAssets?.openFunding('deposit')"><span>＋</span>充值</button>
          <button class="assets-secondary-action" onclick="window.ExchangeAssets?.openFunding('withdraw')"><span>↑</span>提现</button>
          <button class="assets-secondary-action assets-records-shortcut" onclick="window.ExchangeAssets?.setView('records')"><span>≡</span>资金记录</button>
        </div>
      </div>
      <div class="assets-metrics">
        <div><span>可用余额</span><b><span id="account-usdc-balance">0</span> USDT</b></div>
        <div><span>现货资产</span><b><span id="assets-spot-value">0.00</span> USDT</b></div>
        <div><span>合约权益</span><b><span id="assets-contract-value">0.00</span> USDT</b></div>
        <div><span>策略与托管</span><b><span id="assets-strategy-value">0.00</span> USDT</b></div>
      </div>
    </section>

    <section class="assets-distribution">
      <div class="assets-section-heading"><div><h3>账户分布</h3></div><span id="assets-updated-at">—</span></div>
      <div id="assets-allocation" class="assets-allocation"></div>
    </section>

    <section class="assets-main">
      <div class="assets-tabs" role="tablist">
        <button class="active" data-assets-view="balances" onclick="window.ExchangeAssets?.setView('balances')">资产列表</button>
        <button data-assets-view="records" onclick="window.ExchangeAssets?.setView('records')">资金记录</button>
        <button data-assets-view="revenue" onclick="window.ExchangeAssets?.setView('revenue')">SVX 收益</button>
      </div>

      <div id="assets-balances-view">
        <div class="assets-list-tools">
          <label class="assets-search"><span>⌕</span><input id="assets-search" type="search" placeholder="搜索币种" oninput="window.ExchangeAssets?.renderAssets()"></label>
          <label class="assets-zero-filter"><input id="assets-hide-zero" type="checkbox" onchange="window.ExchangeAssets?.renderAssets()">隐藏零资产</label>
        </div>
        <div class="assets-table-wrap">
          <table class="assets-table no-mobile-stack"><thead><tr><th>币种</th><th>总额</th><th>可用</th><th>冻结</th><th>USDT 估值</th><th>操作</th></tr></thead><tbody id="assets-table-body"><tr><td colspan="6" class="account-empty">正在读取资产</td></tr></tbody></table>
        </div>
      </div>

      <div id="assets-records-view" hidden>
        <div class="assets-record-block">
          <h3>交易及账户流水</h3>
          <div class="account-history"><table><thead><tr><th>时间</th><th>类型</th><th>市场</th><th>方向</th><th>数量</th><th>价格</th><th>手续费</th><th>盈亏 / 金额</th><th>状态</th></tr></thead><tbody id="capital-history"><tr><td colspan="9" class="account-empty">暂无交易及账户流水</td></tr></tbody></table></div>
          <div class="rec-cards" id="capital-history-cards"></div>
        </div>
        <div class="assets-record-block">
          <h3>跟单收益</h3>
          <div class="account-history"><table><thead><tr><th>入账时间</th><th>跟单批次</th><th>资产</th><th>收益</th><th>收益日期</th><th>状态</th></tr></thead><tbody id="ai-managed-reward-history"><tr><td colspan="6" class="account-empty">暂无跟单收益</td></tr></tbody></table></div>
        </div>
        <div class="assets-record-block">
          <h3>充值记录</h3>
          <div class="account-history"><table><thead><tr><th>时间</th><th>网络</th><th>资产</th><th>数量</th><th>确认进度</th><th>状态</th><th>交易哈希</th></tr></thead><tbody id="deposit-history"><tr><td colspan="7" class="account-empty">暂无充值记录</td></tr></tbody></table></div>
        </div>
        <div class="assets-record-block">
          <h3>提现记录</h3>
          <div class="account-history"><table><thead><tr><th>时间</th><th>网络</th><th>资产</th><th>数量</th><th>状态</th><th>交易哈希</th></tr></thead><tbody id="withdraw-history"><tr><td colspan="6" class="account-empty">暂无提现记录</td></tr></tbody></table></div>
        </div>
      </div>

      <div id="assets-revenue-view" hidden>
        <div class="assets-record-block">
          <h3>SVX 收益汇总</h3>
          <div id="aix-revenue-summary" class="aix-revenue-summary">正在加载…</div>
        </div>
        <div class="assets-record-block">
          <h3>收益明细</h3>
          <div class="account-history"><table><thead><tr><th>时间</th><th>收益类型</th><th>来源</th><th>比例</th><th>收益 (SVX)</th></tr></thead><tbody id="aix-revenue-list"><tr><td colspan="5" class="account-empty">暂无收益记录</td></tr></tbody></table></div>
          <div class="rec-cards" id="aix-revenue-cards"></div>
        </div>
      </div>
    </section>
    </div>

    <section id="account-funding-forms" class="assets-funding" hidden>
      <header class="assets-funding-page-header">
        <button class="assets-back-button" onclick="window.ExchangeAssets?.closeFunding()" aria-label="返回资产总览">←</button>
        <div><h2 id="assets-funding-title">充值</h2><p>资产总览 / <span id="assets-funding-breadcrumb">充值</span></p></div>
      </header>
      <div id="assets-deposit-panel" class="assets-funding-pane">
        <div class="assets-section-heading"><div><h3>充值 USDT</h3><p>1 USDT 起充 · 跨链全额入账 0 手续费</p></div></div>
        <div class="account-form-row">
          <div><label for="deposit-network">充值网络</label><select id="deposit-network" onchange="updateDepositNetwork()"></select></div>
          <div><label for="deposit-amount">充值数量</label><input id="deposit-amount" type="text" inputmode="numeric" placeholder="最小 1 USDT（1 的整数倍）"></div>
        </div>
        <p id="deposit-wallet-balance" style="margin:8px 0 2px;font-size:14px;font-weight:600;color:#a8700a">钱包 USDT 余额 -</p>
        <button id="deposit-submit" class="btn btn-start" onclick="submitWalletDeposit()">从当前钱包充值</button>
        <div id="deposit-status" class="account-status"></div>
      </div>
      <div id="assets-withdraw-panel" class="assets-funding-pane">
        <div class="assets-section-heading"><div><h3>提现 USDT</h3><p>完成当前钱包签名验证后提交提现</p></div></div>
        <div class="account-form-row">
          <div><label for="withdraw-network">提现网络</label><select id="withdraw-network"></select></div>
          <div><label for="withdraw-amount">提现数量</label><input id="withdraw-amount" type="text" inputmode="decimal" placeholder="输入 USDT 数量"></div>
        </div>
        <p id="withdraw-rule-hint" style="margin:6px 0 0;font-size:12px;opacity:.72">单笔最小 1 USDT · 无手续费</p>
        <button id="withdraw-submit" class="btn btn-smart" onclick="submitWithdrawal()">提交提现申请</button>
        <div id="withdraw-status" class="account-status"></div>
      </div>
    </section>
  </div>
</div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- TAB: IP配置 -->
<!-- ═══════════════════════════════════════════════════════════ -->
<!-- ═══════════════════════════════════════════════════════════ -->
<!-- TAB: AI 助手 -->
<div id="tab-ai" class="tab-panel">
<div class="wrap" style="max-width:860px">
  <div class="panel" style="margin-top:4px">
    <div class="panel-title">本地量化分析配置</div>
    <p class="muted" style="margin-bottom:12px;line-height:1.6">
      使用内置技术指标和风险阈值分析，不安装模型、不使用在线 AI，也不需要 API Key。分析功能只给建议、风险通知和复盘，不能执行任何交易操作。
    </p>
    <div class="ai-grid">
      <div><label>哨兵巡检间隔（分钟，0=关闭）</label><input id="ai-sentinel-min" type="number" min="0" placeholder="5"></div>
      <div><label>行情报告间隔（分钟，0=关闭）</label><input id="ai-market-min" type="number" min="0" placeholder="30"></div>
      <div><label>日报生成时间（0-23 整点）</label><input id="ai-report-hour" type="number" min="0" max="23" placeholder="20"></div>
      <div><label>Telegram Bot Token（推送用，可选）</label><input id="ai-tg-token" name="telegram_bot_api_token" class="secret-text-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" placeholder="123456:ABC-..."></div>
      <div><label>Telegram Chat ID（可选）</label><input id="ai-tg-chat" placeholder="例：123456789"></div>
      <div><label>通用 Webhook（可选，POST {"text":...}）</label><input id="ai-webhook" placeholder="https://..."></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-smart" style="margin:0;width:auto;padding:8px 22px" onclick="aiSaveConfig(this)">保存分析配置</button>
      <button class="btn btn-ghost" style="margin:0;width:auto;padding:8px 22px" onclick="aiTest(this)">检测规则引擎</button>
    </div>
    <div id="ai-cfg-status" class="muted" style="margin-top:8px;font-size:12px">—</div>
  </div>

  <div class="panel">
    <div class="panel-title">🛡 风控哨兵<span id="ai-sent-badge"></span></div>
    <p class="muted" style="margin-bottom:8px">按设定间隔自动巡检三所状态（健康度/挂单同步/保证金/出区间/告警），发现问题推送通知。</p>
    <div id="ai-sentinel-box" class="ai-box muted">尚无巡检结果</div>
    <button class="btn btn-ghost" onclick="aiSentinelRun(this)" style="margin-top:10px;font-size:12px">立即巡检一次</button>
  </div>

  <div class="panel">
    <div class="panel-title">🚨 出区间规则建议</div>
    <div id="ai-oor-box" class="ai-box muted">价格冲出网格区间时自动触发分析（平仓/回收/扩区间/维持），并推送通知；已配置的自动策略照常执行，AI 建议仅供复核。</div>
  </div>

  <div class="panel">
    <div class="panel-title">📈 市况分析（当前适不适合跑网格）</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-ghost" style="margin:0;width:auto;padding:7px 16px;font-size:12px" onclick="aiAnalyze('de', this)">分析 Decibel</button>
      <button class="btn btn-ghost" style="margin:0;width:auto;padding:7px 16px;font-size:12px" onclick="aiAnalyze('ex', this)">分析 Extended</button>
      <button class="btn btn-ghost" style="margin:0;width:auto;padding:7px 16px;font-size:12px" onclick="aiAnalyze('rs', this)">分析 RISEx</button>
    </div>
    <div id="ai-analyze-box" class="ai-box muted" style="margin-top:10px">综合 4小时/1小时/15分钟 三个周期的指标判断市况，给出区间/格数/间距建议。分析的是该所当前配置的市场。</div>
  </div>

  <div class="panel">
    <div class="panel-title">📋 运行复盘日报</div>
    <div id="ai-report-box" class="ai-box muted">每天到点自动生成并推送；也可手动触发。</div>
    <button class="btn btn-ghost" onclick="aiReport(this)" style="margin-top:10px;font-size:12px">立即生成日报</button>
  </div>

  <div class="panel">
    <div class="panel-title">只读分析助手</div>
    <p class="muted" style="margin-bottom:8px">本地规则引擎基于三所实时状态回答风险、盈亏和网格配置问题。这里只输出文字摘要，不提供任何交易执行入口。</p>
    <div id="ai-chatlog" class="ai-chatlog"></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input id="ai-chat-input" placeholder="例：整体风险怎么样？盈亏表现如何？当前网格区间？" style="flex:1" onkeydown="if(event.key==='Enter')aiChatSend()">
      <button class="btn btn-smart" style="margin:0;width:auto;padding:8px 18px" onclick="aiChatSend()">发送</button>
    </div>
  </div>
</div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- JavaScript —— 首屏加载矿机与钱包；其他页面首次进入时加载 -->
<!-- ═══════════════════════════════════════════════════════════ -->
<!-- Dictionaries are loaded asynchronously by i18n.js; wallet startup does not wait for them. -->
<footer class="svx-site-footer"><div class="svx-footer-brand">Solvex <span>CONNECT. TRADE. EXPLORE.</span></div><div class="svx-footer-links"><button type="button" onclick="switchTab('support')">帮助与客服</button><button type="button" onclick="switchTab('community-chat')">加入社区</button><span>© Solvex</span></div></footer>
<nav class="svx-mobile-dock" aria-label="常用导航">
  <button type="button" data-page="earn" class="active" onclick="switchTab('earn')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/></svg><span>矿池</span></button>
  <button type="button" data-page="trade" onclick="openTradePage('spot')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v16M3 8h4v6H3M12 3v17m-2-13h4v5h-4m9-7v15m-2-9h4v6h-4"/></svg><span>交易</span></button>
  <button type="button" data-page="community-chat" onclick="switchTab('community-chat')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/></svg><span>群聊</span></button>
  <button type="button" data-page="referrals" onclick="switchTab('referrals')"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1"/></svg><span>团队</span></button>
  <button type="button" data-page="account" onclick="switchTab('account')"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="15" rx="3"/><path d="M3 9V6a3 3 0 0 1 3-3h12m3 8h-5v5h5"/><circle cx="17" cy="13.5" r=".5"/></svg><span>资产</span></button>
</nav>
<script defer src="/js/i18n.js?v=20261111-domain-team-1"><\/script>
<script defer src="/js/core.js?v=20261111-domain-team-1"><\/script>
<script defer src="/js/device-id.js?v=20261111-domain-team-1"><\/script>
<script defer src="/js/wallet.js?v=20261115-entry-signature-1"><\/script>
<script defer src="/js/portal-shared.js?v=20261111-domain-team-1"><\/script>
<script defer src="/js/page-loader.js?v=20261112-internal-kline-8"><\/script>
<script defer src="/js/earn.js?v=20261111-domain-light-3"><\/script>
<script defer src="/js/announcement.js?v=20261111-domain-team-1"><\/script>
<!-- Wallet scripts are independent of the chart/trading download queue. -->
<script>
window.loadWalletConnector = function() {
  if (window.WGWalletConnector || window.__walletConnectorLoading) return;
  window.__walletConnectorLoading = true;
  const script = document.createElement('script');
  script.type = 'module';
  script.src = '/vendor/wallet/connector.js?v=20261111-domain-team-1';
  script.onload = script.onerror = () => { window.__walletConnectorLoading = false; };
  document.head.appendChild(script);
};
window.loadWalletConnector();
<\/script>
<script>
// Service Worker：静态资源缓存加速（二次访问），API 永不缓存
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=20261112-sw-immutable-9').catch(() => {}));
}
<\/script>
<script>
// 进平台默认显示矿机页（Portal 动态内容需触发一次 switchTab 才会加载）
// 上方 defer 脚本在 DOMContentLoaded 前按序执行完毕，此处监听事件保证在其后运行
document.addEventListener('DOMContentLoaded', () => {
  const page = new URLSearchParams(location.search).get('page');
  switchTab(page === 'ai-managed' ? page : 'earn').catch(error => console.error('默认页加载失败', error));
});
<\/script>
</body>
</html>
`,L={earn:"矿池",mall:"商城",trade:"交易","ai-managed":"Ai量化","a-token-trade":"SVX交易",leaderboard:"合约风云榜",referrals:"团队",account:"我的资产",support:"在线客服","community-chat":"群聊","partner-plan":"合伙人计划",portfolio:"投资组合",vaults:"金库",staking:"能量",ledger:"机器人账本",ai:"AI 助手"};function W(){const t=location.hash.replace("#/","")||new URLSearchParams(location.search).get("page")||"earn";if(t==="shareholder"||t==="earn/shareholder")return{page:"partner-plan",section:""};const[n,a=""]=t.split("/");return{page:typeof L[n]=="string"?n:"earn",section:a}}const re=t=>"/js/"+t+".js?v="+(t==="theme"?"20261114-logo-palette-1":t==="wallet"?"20261115-entry-startup-1":t==="page-loader"?"20261118-svx-illustration-1":"20261114-market-retry-1"),le="/vendor/wallet/connector.js?v=20261113-runtime-dedupe-2",de="/app/assets/styles-Dh61FWUA.css";let D;const st=()=>getComputedStyle(document.documentElement).getPropertyValue("--solvex-legacy-ready").trim()==="1";function $(t){return new Promise((n,a)=>{const s=document.createElement("link"),i=new URL(de,location.href);t&&i.searchParams.set("__svx_style_retry",String(Date.now())),s.rel="stylesheet",s.href=i.href,s.dataset.solvexLegacy="1";let l=!1,d;const o=r=>{l||(l=!0,clearTimeout(c),clearTimeout(d),s.onload=null,s.onerror=null,r?(s.remove(),a(r)):n())},c=setTimeout(()=>o(new Error("页面样式加载超时")),15e3);s.onerror=()=>o(new Error("页面样式加载失败")),s.onload=()=>{const r=Date.now()+1e3,p=()=>{st()?o():Date.now()>=r?o(new Error("页面样式未生效")):d=setTimeout(p,40)};d=setTimeout(p,0)},document.head.append(s)})}function H(){if(st())return Promise.resolve();if(D)return D;const t=$(!1).catch(()=>$(!0));return D=t,t.then(()=>{D===t&&(D=void 0)},()=>{D===t&&(D=void 0)}),t}function ce(){window.WG_REACT_APP=!0;const t=new DOMParser().parseFromString(oe,"text/html"),n=document.getElementById("legacy-root");["platform-announce-list","platform-announce-modal","trade-market-picker"].forEach(s=>{const i=t.getElementById(s);i&&n.append(i)}),t.querySelectorAll(".tab-panel").forEach(s=>{s.classList.remove("active"),(s.id==="tab-earn"||s.id==="tab-referrals"||s.id==="tab-account"||s.id==="tab-leaderboard"||s.id==="tab-support"||s.id==="tab-community-chat"||s.id==="tab-ai-managed"||s.id==="tab-partner-plan")&&s.replaceChildren(),n.append(s)});const a=document.createElement("div");a.hidden=!0,a.innerHTML='<span id="hdr-time"></span><span id="hdr-conn"></span><span id="hdr-conn-txt"></span><span id="hdr-de"></span><span id="hdr-ex"></span><span id="hdr-rs"></span><span id="hdr-de-dot"></span><span id="hdr-ex-dot"></span><span id="hdr-rs-dot"></span>',n.append(a),window.addEventListener("message",s=>{const i=document.getElementById("mall-frame");i&&s.origin===location.origin&&s.source===i.contentWindow&&s.data?.type==="mall-height"&&Number.isFinite(Number(s.data.h))&&(i.style.height=Math.max(600,Number(s.data.h)+4)+"px")}),window.WG_OPERATOR_MODE=["127.0.0.1","localhost","::1"].includes(location.hostname)&&new URLSearchParams(location.search).get("operator")==="1",document.documentElement.classList.toggle("operator-mode",!!window.WG_OPERATOR_MODE)}const B=new Map;function pe(t){return t==="wallet"?!!window.solvexWalletBridge:t==="page-loader"?typeof window.loadPageFeature=="function":t==="portal-shared"?!!window.Portal:t==="theme"?!!window.WGTheme:t==="i18n"?!!window.I18n:!1}function k(t){const n="/js/"+t+".js",a=re(t),s=[...document.scripts].find(o=>{try{return new URL(o.src,location.href).pathname===n}catch{return!1}}),i=new URL(n,location.href).href,l=B.get(i);if(l)return l;if(s){const o=new Promise((c,r)=>{if(s.dataset.solvexLoaded==="1"||pe(t)){c();return}s.addEventListener("load",()=>c(),{once:!0}),s.addEventListener("error",()=>r(new Error("界面模块加载失败，请刷新重试")),{once:!0})});return B.set(i,o),o.catch(()=>B.delete(i)),o}const d=new Promise((o,c)=>{const r=document.createElement("script");r.src=a,r.dataset.solvexRuntime="1",r.onload=()=>{r.dataset.solvexLoaded="1",o()},r.onerror=()=>{r.remove(),c(new Error("界面模块加载失败，请刷新重试"))},document.body.append(r)});return B.set(i,d),d.catch(()=>B.delete(i)),d}let A;async function ue(){return A||(A=be().catch(t=>{throw A=void 0,t}),A)}async function be(){const{page:t}=W(),n=["earn","referrals","leaderboard"].includes(t)?Promise.resolve():H(),a=Promise.all([k("theme"),k("i18n")]),s=Promise.all([k("account-action-guard"),k("core"),k("device-id"),k("portal-shared"),k("page-loader")]);if(![...document.scripts].some(o=>{try{return new URL(o.src,location.href).pathname==="/vendor/wallet/connector.js"}catch{return!1}})){const o=document.createElement("script");o.type="module",o.src=le,o.dataset.solvexRuntime="1",document.head.append(o)}await Promise.all([n,a,s.then(()=>k("wallet"))]),window.Portal?.register("referrals",{load:()=>window.dispatchEvent(new Event("referralrefresh")),reset:()=>window.ReferralRewards?.reset()});const i=window.switchTab;let l=0;window.switchTab=async o=>{if(o==="shareholder"&&(o="partner-plan"),!L[o])return!1;const c=++l;if(!["earn","referrals","leaderboard"].includes(o))try{await H()}catch{return c===l&&N.error("页面资源暂时加载失败，请重试",{id:"legacy-style-load",action:{label:"重试",onClick:()=>{window.switchTab(o)}}}),!1}if(c!==l)return!1;N.dismiss("legacy-style-load");const r=await i(o);if(r&&document.getElementById("tab-"+o)?.classList.contains("active")){const p="#/"+o;location.hash!==p&&!location.hash.startsWith(p+"/")&&history.pushState(null,"",p)}return r},window.earnSwitch=o=>{if(o==="team"){window.switchTab("referrals");return}if(o==="shareholder"){window.switchTab("partner-plan");return}history.replaceState(null,"","#/earn/"+o),document.getElementById("tab-earn")?.classList.contains("active")||window.switchTab("earn"),window.dispatchEvent(new CustomEvent("earntabchange",{detail:o}))};const d=()=>W().page;window.addEventListener("popstate",()=>{window.switchTab(d())}),await window.switchTab(d()),k("announcement").catch(()=>{}),"serviceWorker"in navigator&&navigator.serviceWorker.register("/sw.js?v=20261116-style-recovery-1").catch(()=>{})}const V=/^-?\d+(?:\.\d+)?$/,it=t=>t.replace(/\B(?=(\d{3})+(?!\d))/g,",");function ot(t){if(t==null||t==="")return 0n;if(typeof t=="bigint")return t;const n=String(t).trim();if(!/^-?\d+$/.test(n))throw new Error("金额格式无效："+n);return BigInt(n)}function rt(t,n=18){let a=ot(t);const s=a<0n;s&&(a=-a);const i=10n**BigInt(n),l=String(a%i).padStart(n,"0").replace(/0+$/,"");return(s?"-":"")+String(a/i)+(l?"."+l:"")}function ta(t,n=18){if(!new RegExp("^\\d+(?:\\.\\d{1,"+n+"})?$").test(t))throw new Error("请输入有效数量，最多 "+n+" 位小数");const[a,s=""]=t.split(".");return BigInt(a)*10n**BigInt(n)+BigInt((s+"0".repeat(n)).slice(0,n)||"0")}function ea(t,n=18,a=2){if(t==null||t==="")return"—";let s=ot(t);const i=s<0n;i&&(s=-s);const l=10n**BigInt(n);let d=s/l,o=s%l;if(a>0&&n>a){const r=10n**BigInt(n-a);let p=o/r;o%r*2n>=r&&(p+=1n);const b=10n**BigInt(a);p>=b&&(d+=1n,p-=b),o=p}else a>n?o*=10n**BigInt(a-n):a<=0&&(o*2n>=l&&(d+=1n),o=0n);const c=a>0?String(o).padStart(a,"0").replace(/0+$/,""):"";return(i&&(d>0n||o>0n)?"-":"")+it(String(d))+(c?"."+c:"")}function ve(t,n=2){if(t==null||t==="")return"—";const a=typeof t=="number"?Number.isFinite(t)?String(t):"":String(t).trim();if(!V.test(a))return"—";const s=a.startsWith("-");let[i,l=""]=(s?a.slice(1):a).split("."),d=BigInt(i||"0"),o=l;if(n<=0)o&&o[0]>="5"&&(d+=1n),o="";else if(o.length>n){const c=10n**BigInt(n);let r=BigInt(o.slice(0,n)||"0");o[n]>="5"&&(r+=1n),r>=c&&(d+=1n,r-=c),o=String(r).padStart(n,"0")}else o=o.padEnd(n,"0");return o=o.replace(/0+$/,""),(s&&(d>0n||o)?"-":"")+it(String(d))+(o?"."+o:"")}function aa(t,n=18){const a=10n**BigInt(n);let s=0n;for(const i of t){const l=String(i??"").trim();if(!V.test(l))continue;const d=l.startsWith("-"),[o,c=""]=(d?l.slice(1):l).split("."),r=(c+"0".repeat(n)).slice(0,n);s+=(d?-1n:1n)*(BigInt(o||"0")*a+BigInt(r||"0"))}return rt(s,n)}function na(t,n,a=18){const s=d=>{const o=String(d??"").trim();if(!V.test(o))return null;const c=o.startsWith("-"),[r,p=""]=(c?o.slice(1):o).split("."),b=(p+"0".repeat(a)).slice(0,a);return(c?-1n:1n)*(BigInt(r||"0")*10n**BigInt(a)+BigInt(b||"0"))},i=s(t),l=s(n);return i==null||l==null?"—":rt(i*l/10n**BigInt(a),a)}function sa(t,n){const a=Number(t),s=Number(n);return!Number.isFinite(a)||!Number.isFinite(s)||s<=0?0:Math.min(100,Math.max(0,a/s*100))}function C(...t){return Bt(At(t))}const ia=(t,n=2)=>ve(t,n),oa=t=>t?t.slice(0,6)+"…"+t.slice(-4):"—",ra=t=>t?new Date(t).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:!1}):"—",he=Nt("ui-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",{variants:{variant:{default:"bg-primary text-primary-foreground hover:bg-primary/90",outline:"border border-border bg-card hover:bg-muted",ghost:"hover:bg-muted text-muted-foreground",secondary:"bg-secondary text-secondary-foreground hover:bg-secondary/80",destructive:"bg-destructive text-white"},size:{default:"h-11 px-5 py-2",sm:"h-9 rounded-lg px-3 text-xs",icon:"size-10 p-0"}},defaultVariants:{variant:"default",size:"default"}}),E=u.forwardRef(({className:t,variant:n,size:a,asChild:s,type:i="button",...l},d)=>{const o=s?Et:"button";return e.jsx(o,{ref:d,type:i,className:C(he({variant:n,size:a}),t),...l})});E.displayName="Button";const lt=Tt,dt=Pt,ct=Dt;function pt({className:t,children:n,placement:a="center",...s}){const i=a==="center",l=i?"ui-dialog-center":a==="bottom"?"ui-sheet-bottom fixed left-0 bottom-0":"fixed left-0 top-0",d=e.jsxs(Ct,{className:C("ui-dialog z-[1501] w-[calc(100%-32px)] max-w-md rounded-3xl border border-border bg-white p-7 shadow-xl",l,t),...s,children:[n,e.jsx(It,{className:"ui-dialog-close absolute right-5 top-5 rounded-md p-1 text-muted-foreground hover:bg-muted","aria-label":"关闭",children:e.jsx(Rt,{size:18})})]});return e.jsxs(Lt,{children:[e.jsx(_t,{className:C("ui-dialog-overlay fixed inset-0 z-[1500] bg-slate-950/30 backdrop-blur-sm",i&&"ui-dialog-frame"),children:i?d:null}),i?null:d]})}function me({className:t,...n}){return e.jsx("div",{className:C("ui-card rounded-2xl border border-border bg-card text-card-foreground",t),...n})}function la({className:t,...n}){return e.jsx("div",{className:C("flex items-center justify-between gap-4 p-6 pb-4",t),...n})}function da({className:t,...n}){return e.jsx("h2",{className:C("text-base font-semibold tracking-tight",t),...n})}function ca({className:t,...n}){return e.jsx("div",{className:C("p-6 pt-0",t),...n})}let ut=I();const q=new Set,K=t=>!["plans","svx-pool-price"].includes(String(t[0]));window.addEventListener("walletstatechange",()=>{ut=I(),g.cancelQueries({predicate:t=>K(t.queryKey)}),g.removeQueries({predicate:t=>K(t.queryKey)}),q.forEach(t=>t())});function bt(){return u.useSyncExternalStore(t=>(q.add(t),()=>{q.delete(t)}),()=>ut)}function ge(t,n){const{address:a,revision:s,authenticated:i}=n,l=`${a}:${s}:${i}`,d=[["profile",a,s],...["wallet-profile","platform-profile","svx-revenue","svx-fund-records","ai-managed"].map(o=>[o,l])];return["claim","pool","upgrade","partner"].includes(t)&&d.push(["team",a,s],["referral",a,s],["referral-rewards",a,s]),["claim","partner","upgrade"].includes(t)&&d.push(["ecosystem","shareholder",a,s],["partner-dividends",a,s]),t==="claim"&&d.push(["ecosystem","blindbox",a,s],["team-received",a,s]),["claim","upgrade","drive"].includes(t)&&d.push(["ecosystem","match-pool",a,s]),t==="drive"&&d.push(["drive-quote",a,s],["svx-pool-price"]),t==="deposit"&&d.push(["wallet-deposit-balance",a]),d}async function fe(t,n,a){await Promise.all(ge(n,a).map(s=>t.invalidateQueries({queryKey:s})))}function pa({title:t,subtitle:n,children:a}){return e.jsxs("div",{className:"rx-heading",children:[e.jsxs("div",{children:[e.jsx("div",{className:"rx-kicker",children:"SOLVEX ECOSYSTEM"}),e.jsx("h1",{children:t}),e.jsx("p",{children:n})]}),e.jsx("div",{className:"rx-heading-actions",children:a})]})}function ua({children:t}){return e.jsxs("div",{className:"rx-empty",children:[e.jsx(Mt,{size:28,strokeWidth:1.3}),e.jsx("span",{children:t})]})}function ba({description:t="连接并确认钱包，查看属于你的资产与记录"}={}){return e.jsxs(me,{className:"rx-gate",children:[e.jsx("span",{className:"rx-icon",children:e.jsx(Z,{size:24})}),e.jsx("h2",{children:"连接你的钱包"}),e.jsx("p",{children:t}),e.jsxs(E,{onClick:()=>te(),children:["连接钱包 ",e.jsx(Y,{})]})]})}function va({error:t,retry:n}){return e.jsxs("div",{className:"rx-error",role:"alert",children:[e.jsx(Ot,{size:18}),e.jsx("span",{children:t.message}),e.jsx(E,{variant:"outline",size:"sm",onClick:n,children:"重试"})]})}function S(){return e.jsxs("div",{className:"rx-loading rx-page-skeleton",role:"status","aria-label":"正在加载页面",children:[e.jsx("span",{}),e.jsx("span",{}),e.jsx("span",{})]})}const vt=()=>g.getQueryCache().getAll().filter(t=>t.isActive()&&t.state.error&&ie(t.state)),ye=()=>vt().map(t=>t.queryHash+":"+t.state.errorUpdatedAt).join("|"),we=t=>g.getQueryCache().subscribe(t);function xe(){return u.useSyncExternalStore(we,ye)?e.jsxs("div",{className:"rx-cache-notice",role:"status",children:[e.jsx("span",{children:"更新暂未完成，当前显示上次加载的内容"}),e.jsx(E,{size:"sm",variant:"ghost",onClick:()=>{for(const n of vt())g.refetchQueries({queryKey:n.queryKey,exact:!0})},children:"重试更新"})]}):null}function ha({label:t,value:n,unit:a,note:s,icon:i}){return e.jsxs("div",{className:"rx-metric",children:[e.jsxs("div",{children:[e.jsx("span",{children:t}),i]}),e.jsxs("strong",{children:[n,e.jsx("small",{children:a})]}),s&&e.jsx("p",{children:s})]})}let z=!1;function ma(t){const n=bt(),a=kt(),[s,i]=u.useState(!1),[l,d]=u.useState(null),o=u.useRef(null),c=u.useRef(!0),r=v=>{o.current?.(v),o.current=null,d(null)};u.useEffect(()=>{r(!1)},[n.address,n.revision]),u.useEffect(()=>(c.current=!0,()=>{c.current=!1,o.current?.(!1),o.current=null}),[]);async function p(v,h,y,w=t||"all"){if(z)return;if(!n.authenticated){N.error("请先连接并确认钱包");return}z=!0,i(!0);const M=m();try{if(!await new Promise(_=>{o.current=_,d({title:v,description:h})})||M!==m())return;const yt=await y();if(M!==m())return;N.success(yt),w==="all"?(await a.invalidateQueries({predicate:_=>_.queryKey[0]!=="plans"}),window.Portal?.invalidate()):w!=="none"&&(typeof w=="string"?await fe(a,w,n):await Promise.all(w.map(_=>a.invalidateQueries({queryKey:_}))),window.Portal?.invalidate())}catch(U){M===m()&&N.error(U instanceof Error?U.message:"操作失败")}finally{z=!1,c.current&&i(!1)}}const b=e.jsx(lt,{open:!!l,onOpenChange:v=>{v||r(!1)},children:e.jsxs(pt,{children:[e.jsx(dt,{className:"rx-dialog-title",children:l?.title}),e.jsx(ct,{className:"rx-dialog-description",children:l?.description}),e.jsxs("div",{className:"rx-dialog-actions",children:[e.jsx(E,{variant:"outline",onClick:()=>r(!1),children:"取消"}),e.jsx(E,{onClick:()=>r(!0),children:"确认操作"})]})]})});return{run:p,busy:s,dialog:b}}const ke="modulepreload",Se=function(t,n){return new URL(t,n).href},X={},x=function(n,a,s){let i=Promise.resolve();if(a&&a.length>0){let r=function(p){return Promise.all(p.map(b=>Promise.resolve(b).then(v=>({status:"fulfilled",value:v}),v=>({status:"rejected",reason:v}))))};const d=document.getElementsByTagName("link"),o=document.querySelector("meta[property=csp-nonce]"),c=o?.nonce||o?.getAttribute("nonce");i=r(a.map(p=>{if(p=Se(p,s),p in X)return;X[p]=!0;const b=p.endsWith(".css"),v=b?'[rel="stylesheet"]':"";if(s)for(let y=d.length-1;y>=0;y--){const w=d[y];if(w.href===p&&(!b||w.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${p}"]${v}`))return;const h=document.createElement("link");if(h.rel=b?"stylesheet":ke,b||(h.as="script"),h.crossOrigin="",h.href=p,c&&h.setAttribute("nonce",c),document.head.appendChild(h),b)return new Promise((y,w)=>{h.addEventListener("load",y),h.addEventListener("error",()=>w(new Error(`Unable to preload CSS for ${p}`)))})}))}function l(d){const o=new Event("vite:preloadError",{cancelable:!0});if(o.payload=d,window.dispatchEvent(o),!o.defaultPrevented)throw d}return i.then(d=>{for(const o of d||[])o.status==="rejected"&&l(o.reason);return n().catch(l)})},f={earn:()=>x(()=>import("./earn-DvUEZ8mK.js"),__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12]),import.meta.url),referrals:()=>x(()=>import("./team-D58h7eRy.js"),__vite__mapDeps([13,1,2,5,3,4,6,7,8,11]),import.meta.url),account:()=>x(()=>import("./assets-Cs50OFo0.js"),__vite__mapDeps([14,1,2,5,7,4,11,8]),import.meta.url),leaderboard:()=>x(()=>import("./ranking-Ccu4qvyd.js"),__vite__mapDeps([15,1,2,8,5,4,11]),import.meta.url),support:()=>x(()=>import("./support-B_dCNkWX.js"),__vite__mapDeps([16,1,2,5,4,11,8]),import.meta.url),"community-chat":()=>x(()=>import("./community-chat-BwI6ZLG0.js"),__vite__mapDeps([17,1,5,8,2,4,11,18]),import.meta.url),"ai-managed":()=>x(()=>import("./ai-managed-D4xxce3X.js"),__vite__mapDeps([19,1,2,5,4,11,8]),import.meta.url),"partner-plan":()=>x(()=>import("./partner-plan-BRa6f5WV.js"),__vite__mapDeps([20,1,10,2,3,4,8,5,11,21]),import.meta.url),blindbox:()=>x(()=>import("./blindbox-CjyF8JFo.js"),__vite__mapDeps([22,1,2,23,8,5,4,11,24]),import.meta.url),play:()=>x(()=>import("./ecosystem-CHwfeHMv.js"),__vite__mapDeps([25,1,2,7,8,5,4,11]),import.meta.url)};function je(t,n=()=>!1){let a=!1,s=!1,i=0,l=0,d=0;const o=navigator.connection,c=()=>o?.saveData||["slow-2g","2g","3g"].includes(o?.effectiveType||"")||!!(o?.downlink&&o.downlink<1.5),r=(v=800)=>{window.clearTimeout(i),a||(i=window.setTimeout(p,v))};function p(){if(a||s||d>=t.length||c()||document.hidden||!navigator.onLine)return;if(n()||document.readyState!=="complete"||document.querySelector(".tab-panel.active .rx-loading, .rx-startup")||[...document.querySelectorAll('img[fetchpriority="high"]')].some(y=>y.getClientRects().length&&!y.complete)){r();return}const v=()=>{l=0,!(a||document.hidden||!navigator.onLine||c())&&(s=!0,t[d++]().catch(()=>{}).finally(()=>{s=!1,r()}))},h=window.requestIdleCallback;typeof h=="function"?l=h.call(window,v):i=window.setTimeout(v,500)}const b=()=>{window.clearTimeout(i),l&&(window.cancelIdleCallback?.(l),l=0),!document.hidden&&navigator.onLine&&r()};return document.addEventListener("visibilitychange",b),window.addEventListener("online",b),window.addEventListener("offline",b),r(1500),()=>{a=!0,window.clearTimeout(i),l&&window.cancelIdleCallback?.(l),document.removeEventListener("visibilitychange",b),window.removeEventListener("online",b),window.removeEventListener("offline",b)}}async function ht(t,{foreground:n=!1}={}){const a=I(),s=m(),i=navigator.connection;if(!a.authenticated||!a.address||document.hidden||!navigator.onLine||!n&&(i?.saveData||["slow-2g","2g","3g"].includes(i?.effectiveType||"")))return;const l=r=>[r,a.address,a.revision],d=r=>["ecosystem",r,a.address,a.revision],o={earn:[[l("profile"),"a-token/profile"]],miner:[[l("profile"),"a-token/profile"]],pending:[[l("profile"),"a-token/profile"]],blindbox:[[d("blindbox"),"a-token/blindbox"],[l("profile"),"a-token/profile"]],play:[[d("match-pool"),"a-token/match-pool"],[l("profile"),"a-token/profile"]],referrals:[[l("team"),"a-token/team/profile"],[l("profile"),"a-token/profile"]],account:[[["wallet-profile",s],"wallet/profile"],[["platform-profile",s],"platform/profile"],[l("profile"),"a-token/profile"]],"partner-plan":[[d("shareholder"),"a-token/shareholder"],[l("team"),"a-token/team/profile"]],leaderboard:[[["leaderboard",s],"platform/leaderboard",!1]],"ai-managed":[[["ai-managed",s],"ai-managed/state"]]},c=async([r,p,b=!0])=>{s!==m()||document.hidden||!navigator.onLine||g.getQueryState(r)?.data===void 0&&await g.prefetchQuery({queryKey:r,queryFn:({signal:v})=>O(p,{signal:v},b),retry:!1})};if(n)await Promise.all((o[t]||[]).map(c));else for(const r of o[t]||[])await c(r)}async function Ee(t){document.hidden||!navigator.onLine||(["earn","miner","staking"].includes(t)?await g.prefetchQuery({queryKey:["plans"],queryFn:({signal:n})=>O("a-token/plans",{signal:n},!1),staleTime:6e4,retry:!1}):["blindbox","account","play"].includes(t)&&await g.prefetchQuery({queryKey:["svx-pool-price"],queryFn:({signal:n})=>O("a-token/pool",{signal:n},!1),staleTime:15e3,retry:!1}))}const Te=u.lazy(f.earn),Pe=u.lazy(f.referrals),De=u.lazy(f.account),Ce=u.lazy(f.leaderboard),Ie=u.lazy(f.support),Le=u.lazy(f["community-chat"]),_e=u.lazy(f["ai-managed"]),Be=u.lazy(f["partner-plan"]);async function P(t){if(!I().authenticated)return;const n=m(),a=f[t];a&&(await a().catch(()=>{}),n===m()&&await ht(t))}const Ae=()=>je([()=>P("referrals"),()=>P("account"),()=>P("blindbox"),()=>P("community-chat")],()=>g.isFetching()>0),mt=[{page:"earn",Icon:Wt},{page:"mall",Icon:qt},{page:"trade",Icon:Ft},{page:"community-chat",Icon:Vt},{page:"a-token-trade",Icon:Gt},{page:"leaderboard",Icon:Qt},{page:"referrals",Icon:$t},{page:"account",Icon:Z},{page:"support",Icon:Ht},{page:"ai-managed",Icon:Kt},{page:"partner-plan",Icon:Xt}],Ne={__html:'<button type="button" id="lang-toggle" aria-label="切换语言" title="切换语言">🌐</button>'},Re={__html:'<div class="wallet-control"><button type="button" id="wallet-connect-btn" class="wallet-connect" aria-haspopup="menu" aria-expanded="false" onclick="handleWalletButton(this)">连接钱包</button><div id="wallet-account-menu" class="wallet-account-menu" role="menu" hidden><button id="wallet-menu-auth" type="button" role="menuitem" class="primary" onclick="verifyWalletFromMenu(this)">身份验证</button><button type="button" role="menuitem" onclick="openWalletAccount()">钱包资金</button><button type="button" role="menuitem" class="danger" onclick="disconnectWallet()">断开钱包</button></div></div>'};class T extends u.Component{state={failed:!1};static getDerivedStateFromError(){return{failed:!0}}componentDidCatch(n,a){et(n)||console.error("页面渲染失败",n,a.componentStack)}render(){return this.state.failed?e.jsxs("div",{className:"rx-page rx-error",children:[e.jsx("span",{children:"页面加载遇到问题，请重新加载。"}),e.jsx(E,{onClick:tt,children:"加载最新页面"})]}):e.jsxs(e.Fragment,{children:[e.jsx(xe,{}),this.props.children]})}}function J({page:t,close:n}){const a=i=>{n?.(),i==="trade"?window.openTradePage("spot"):window.switchTab(i)},s=new Set(["leaderboard","account"]);return e.jsxs(e.Fragment,{children:[e.jsx("div",{className:"rx-nav-label",children:"探索生态"}),e.jsx("nav",{className:"rx-nav","aria-label":"主导航",children:mt.map(i=>e.jsxs("div",{children:[s.has(i.page)&&e.jsx("div",{className:"rx-nav-separator"}),e.jsxs("button",{type:"button",className:t===i.page?"is-active":"","aria-current":t===i.page?"page":void 0,"data-nav-page":i.page,onPointerEnter:()=>{P(i.page)},onFocus:()=>{P(i.page)},onClick:()=>a(i.page),children:[e.jsx(i.Icon,{size:19,strokeWidth:1.7}),e.jsx("span",{children:L[i.page]}),t===i.page&&e.jsx("span",{className:"rx-nav-dot"})]})]},i.page))}),window.WG_OPERATOR_MODE&&e.jsx("nav",{className:"rx-nav","aria-label":"本地运营工具",children:["portfolio","vaults","staking","ledger","ai"].map(i=>e.jsx("button",{onClick:()=>a(i),children:L[i]},i))}),e.jsxs("div",{className:"rx-sidebar-bottom",children:[e.jsxs("div",{className:"rx-sidebar-help",children:[e.jsx(Zt,{size:23,strokeWidth:1.5}),e.jsx("strong",{children:"我们随时为你提供帮助"}),e.jsx("p",{children:"探索 Solvex，轻松开始。"}),e.jsxs("button",{onClick:()=>a("support"),children:["联系在线客服 ",e.jsx(Y,{size:14})]})]}),e.jsxs("div",{className:"rx-sidebar-foot",children:[e.jsx("span",{children:"Solvex Ecosystem"}),e.jsxs("span",{children:["© ",new Date().getFullYear()]})]})]})]})}function Oe(){const[t,n]=u.useState("earn"),[a,s]=u.useState(!1),[i,l]=u.useState(""),[d,o]=u.useState(!1),c=bt();return u.useEffect(()=>{const r=p=>{const b=p.detail.current;n(b),o(!1),document.body.dataset.page=b};return window.addEventListener("pagechange",r),window.solvexRuntimeReady.then(()=>s(!0)).catch(p=>l(p.message)),()=>window.removeEventListener("pagechange",r)},[]),u.useEffect(()=>{if(a&&c.authenticated)return Ae()},[a,c.authenticated,c.address,c.revision]),e.jsxs(e.Fragment,{children:[e.jsxs("aside",{className:"rx-sidebar",inert:!a,children:[e.jsxs("a",{className:"rx-brand",href:"#/earn",onClick:r=>{r.preventDefault(),window.switchTab("earn")},children:[e.jsx("img",{src:"/assets/brand/logo.svg",alt:""}),e.jsxs("strong",{children:["Solvex",e.jsx("span",{children:"A NEW ERA OF VALUE"})]})]}),e.jsx(J,{page:t})]}),e.jsxs("header",{className:"rx-topbar",children:[e.jsxs("div",{className:"rx-topbar-left",children:[e.jsx(E,{className:"rx-mobile-menu",variant:"ghost",size:"icon","aria-label":"打开导航",disabled:!a,onClick:()=>o(!0),children:e.jsx(Ut,{})}),e.jsxs("span",{className:"rx-topbar-brand",children:[e.jsx("img",{src:"/assets/brand/logo.svg",alt:""}),e.jsx("span",{children:"Solvex"})]}),e.jsxs("span",{className:"rx-breadcrumb",children:["生态空间 ",e.jsx(zt,{size:13}),e.jsx("strong",{children:L[t]})]})]}),e.jsxs("div",{className:"rx-topbar-right",children:[e.jsxs("span",{className:"rx-session-state",children:[e.jsx("span",{className:"rx-status-dot "+(c.authenticated?"is-live":"")}),c.authenticated?"钱包已验证":"探索 Solvex"]}),e.jsx("div",{className:"rx-locale",inert:!a,dangerouslySetInnerHTML:Ne}),e.jsx("div",{className:"rx-wallet",inert:!a,dangerouslySetInnerHTML:Re})]})]}),e.jsx(lt,{open:d,onOpenChange:o,children:e.jsxs(pt,{placement:"left",className:"rx-mobile-sheet",children:[e.jsx(dt,{className:"rx-mobile-brand",children:"Solvex"}),e.jsx(ct,{className:"sr-only",children:"选择要前往的功能"}),e.jsx(J,{page:t,close:()=>o(!1)})]})}),i&&e.jsxs("div",{className:"rx-runtime-error",role:"alert",children:[e.jsx("span",{children:i}),e.jsx(E,{onClick:()=>location.reload(),children:"重新加载"})]}),!a&&!i&&e.jsx("div",{className:"rx-startup",children:e.jsx(S,{})}),a&&t==="earn"&&j.createPortal(e.jsx(T,{children:e.jsx(u.Suspense,{fallback:e.jsx(S,{}),children:e.jsx(Te,{})})}),document.getElementById("tab-earn")),a&&t==="referrals"&&j.createPortal(e.jsx(T,{children:e.jsx(u.Suspense,{fallback:e.jsx(S,{}),children:e.jsx(Pe,{})})}),document.getElementById("tab-referrals")),a&&t==="account"&&j.createPortal(e.jsx(T,{children:e.jsx(u.Suspense,{fallback:e.jsx(S,{}),children:e.jsx(De,{})})}),document.getElementById("tab-account")),a&&t==="leaderboard"&&j.createPortal(e.jsx(T,{children:e.jsx(u.Suspense,{fallback:e.jsx(S,{}),children:e.jsx(Ce,{})})}),document.getElementById("tab-leaderboard")),a&&t==="support"&&j.createPortal(e.jsx(T,{children:e.jsx(u.Suspense,{fallback:e.jsx(S,{}),children:e.jsx(Ie,{})})}),document.getElementById("tab-support")),a&&t==="community-chat"&&j.createPortal(e.jsx(T,{children:e.jsx(u.Suspense,{fallback:e.jsx(S,{}),children:e.jsx(Le,{})})}),document.getElementById("tab-community-chat")),a&&t==="ai-managed"&&j.createPortal(e.jsx(T,{children:e.jsx(u.Suspense,{fallback:e.jsx(S,{}),children:e.jsx(_e,{})})}),document.getElementById("tab-ai-managed")),a&&t==="partner-plan"&&j.createPortal(e.jsx(T,{children:e.jsx(u.Suspense,{fallback:e.jsx(S,{}),children:e.jsx(Be,{})})}),document.getElementById("tab-partner-plan")),e.jsx("nav",{className:"rx-mobile-dock","aria-label":"快捷导航",inert:!a,children:mt.filter(r=>["earn","trade","community-chat","referrals","account"].includes(r.page)).map(r=>e.jsxs("button",{"aria-current":t===r.page?"page":void 0,onPointerEnter:()=>{P(r.page)},onFocus:()=>{P(r.page)},onClick:()=>r.page==="trade"?void window.openTradePage("spot"):void window.switchTab(r.page),children:[e.jsx(r.Icon,{size:20,strokeWidth:1.6}),e.jsx("span",{children:r.page==="account"?"资产":L[r.page]})]},r.page))}),e.jsx(jt,{position:"top-center",richColors:!0,closeButton:!0}),e.jsxs("div",{className:"rx-page-tail","aria-hidden":"true",children:[e.jsx(Jt,{size:14})," SOLVEX / CONNECT. TRADE. EXPLORE."]})]})}function Me(){const t=()=>{const{page:n,section:a}=W(),s=f[n];s&&s().catch(()=>{});const i=n==="earn"?a==="matchpool"?"play":a==="staking"?"miner":a||"miner":n;n==="earn"&&["blindbox","play"].includes(i)&&f[i]().catch(()=>{}),Ee(i),I().authenticated&&ht(i,{foreground:!0})};return t(),window.addEventListener("walletstatechange",t),()=>window.removeEventListener("walletstatechange",t)}const Ue=new Set(["runtime","wallet-signature","wallet-verification"]),ze=new Set(["/api/a-token/plans","/api/a-token/profile","/api/a-token/pool","/api/a-token/blindbox","/api/a-token/team/profile","/api/a-token/shareholder","/api/a-token/match-pool","/api/wallet/profile","/api/wallet/session","/api/wallet/login-challenge","/api/wallet/login-sign","/api/platform/profile","/api/platform/leaderboard","/api/community/groups","/api/community/session","/api/community/messages","/api/ai-managed/state"]);function We(){if(window.solvexPerformance)return;const t=[],n=[],a={fcp:0,lcp:0,cls:0},s=(c,r)=>{!Number.isFinite(r.ms)||r.ms<0||(c.push({...r,ms:Math.round(r.ms)}),c.length>80&&c.shift())};if(window.solvexPerformance={start(c){if(!Ue.has(c))return()=>{};const r=performance.now();let p=!1;return()=>{p||(p=!0,s(t,{name:c,ms:performance.now()-r}))}},snapshot(){const c=performance.getEntriesByType("navigation")[0];return{vitals:{...a},phases:t.map(r=>({...r})),api:n.map(r=>({...r})),navigation:c?{ttfb:Math.round(c.responseStart),tls:c.secureConnectionStart?Math.round(c.connectEnd-c.secureConnectionStart):0,protocol:c.nextHopProtocol}:null}}},typeof PerformanceObserver>"u")return;const i=(c,r)=>{try{new PerformanceObserver(p=>r(p.getEntries())).observe({type:c,buffered:!0})}catch{}};i("paint",c=>{for(const r of c)r.name==="first-contentful-paint"&&(a.fcp=Math.round(r.startTime))}),i("largest-contentful-paint",c=>{for(const r of c)a.lcp=Math.round(r.startTime)});let l=0,d=0,o=0;i("layout-shift",c=>{for(const r of c){const p=r;p.hadRecentInput||((!l||p.startTime-d>1e3||p.startTime-l>5e3)&&(l=p.startTime,o=0),d=p.startTime,o+=p.value,a.cls=Math.max(a.cls,o))}}),i("resource",c=>{for(const r of c)try{const p=new URL(r.name);if(p.origin!==location.origin||!ze.has(p.pathname))continue;const b=r.responseStatus;s(n,{name:p.pathname,ms:r.duration,...b?{status:b}:{}})}catch{}})}document.body.classList.add("solvex-react");We();const qe=t=>t.preventDefault();for(const t of["gesturestart","gesturechange","gestureend"])document.addEventListener(t,qe,{passive:!1});ce();let gt,ft;window.solvexRuntimeReady=new Promise((t,n)=>{gt=t,ft=n});j.flushSync(()=>wt.createRoot(document.getElementById("root")).render(e.jsx(St,{client:g,children:e.jsx(Oe,{})})));Me();const Fe=window.solvexPerformance?.start("runtime");ue().then(()=>gt()).catch(t=>ft(t)).finally(Fe);export{sa as A,E as B,me as C,lt as D,ua as E,na as F,ba as G,Je as H,I,Xe as J,Ye as K,S as L,ha as M,R as N,pa as P,x as _,rt as a,ea as b,C as c,pt as d,dt as e,ve as f,ct as g,O as h,ma as i,ie as j,la as k,da as l,ca as m,ia as n,ra as o,Ze as p,va as q,fe as r,te as s,ta as t,bt as u,aa as v,m as w,at as x,ht as y,oa as z};
