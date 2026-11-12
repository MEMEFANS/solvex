const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["/app/assets/styles-CSs0zLco.css","/app/assets/earn-8iwl8Uax.js","/app/assets/react-B-598Ilj.js","/app/assets/query-DQJ3OEX_.js","/app/assets/tabs-mBTywrUd.js","/app/assets/radix-DQQTXSkJ.js","/app/assets/sonner-BQ78Ztqg.js","/app/assets/pending-Cf_pvxGS.js","/app/assets/lucide-BWrT5eOC.js","/app/assets/ethers-BuZF6ExS.js","/app/assets/style-utils-DSOPSYhy.js","/app/assets/earn-DBqPM1HV.css","/app/assets/team-BVwoT6p6.js","/app/assets/assets-BgzBU3AH.js","/app/assets/ranking-BOdiVE_C.js","/app/assets/support-CXzJiqDz.js","/app/assets/community-chat-De8bfuBh.js","/app/assets/community-chat-BZ1M77Mz.css","/app/assets/ai-managed-Da2hJBv5.js","/app/assets/partner-plan-Ehyh5sP8.js","/app/assets/partner-plan-Dkp4vAEo.css"])))=>i.map(i=>d[i]);
import{r as p,j as t,c as w,d as lt}from"./react-B-598Ilj.js";import{Q as ct,u as pt,a as ut}from"./query-DQJ3OEX_.js";import{B as bt,g as W,C as q,p as vt}from"./ethers-BuZF6ExS.js";import{t as L,T as ht}from"./sonner-BQ78Ztqg.js";import{S as mt,D as gt,a as ft,b as wt,c as xt,d as yt,e as kt,f as jt}from"./radix-DQQTXSkJ.js";import{t as St,c as Et,a as Tt}from"./style-utils-DSOPSYhy.js";import{X as Bt,W as G,A as X,L as Dt,I as Ct,C as It,M as Pt,a as Nt,P as At,S as Lt,b as _t,c as Ot,G as Ut,T as zt,U as Rt,B as Mt,H as Wt,d as qt,e as Vt,f as Ft}from"./lucide-BWrT5eOC.js";(function(){const a=document.createElement("link").relList;if(a&&a.supports&&a.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))n(r);new MutationObserver(r=>{for(const o of r)if(o.type==="childList")for(const d of o.addedNodes)d.tagName==="LINK"&&d.rel==="modulepreload"&&n(d)}).observe(document,{childList:!0,subtree:!0});function s(r){const o={};return r.integrity&&(o.integrity=r.integrity),r.referrerPolicy&&(o.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?o.credentials="include":r.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function n(r){if(r.ep)return;r.ep=!0;const o=s(r);fetch(r.href,o)}})();const E=()=>String(window.currentWalletConnection?.address||"").toLowerCase();function Gt(e){window.handleWalletButton(document.getElementById("wallet-connect-btn")||void 0)}async function C(){await window.loadPageFeature("wallet-funds");const e=window.solvexWalletBridge;if(!e?.deposit)throw new Error("资金模块加载失败，请刷新重试");return e}async function Se(e,a,s){const n=await C();return await n.ensureSession?.(),n.deposit(e,a,s)}async function Ee(){await C(),window.USDTWithdrawal?.open()}async function Xt(e){const a=E(),n=(await C()).provider();if(!n||!a)throw new Error("请先连接钱包");const r=String(await n.request({method:"personal_sign",params:[e,a]}));if(E()!==a)throw new Error("钱包已切换，请重新确认");return r}const $t=["function decimals() view returns(uint8)","function approve(address,uint256) returns(bool)","function allowance(address,address) view returns(uint256)"],Ht=["function usdt() view returns(address)","function blindboxPriceUsdt() view returns(uint256)","function currentSvxPerUsdt() view returns(uint256)","function deadlineSeconds() view returns(uint256)","function buyBlindboxAndAddLiquidity(bytes32,uint256,uint256)"];async function Te({contractAddress:e,usdtAddress:a,chainId:s,receiptKey:n,confirmations:r=3,onStatus:o}){const d=await C();await d.ensureSession?.();const i=d.provider();if(!i)throw new Error("请先连接支持 BSC 的钱包");const c=E(),l=new bt(i,"any"),u=await l.getNetwork();if(Number(u.chainId)!==s)throw new Error("请切换到 BNB Smart Chain 后再支付");const b=await l.getSigner(),m=await b.getAddress();if(m.toLowerCase()!==c.toLowerCase())throw new Error("钱包地址已切换，请重新连接");const v=W(e),g=W(a),h=new q(v,Ht,b);if((await h.usdt()).toLowerCase()!==g.toLowerCase())throw new Error("LP 合约 USDT 地址与页面配置不一致");const S=new q(g,$t,b),D=Number(await S.decimals()),P=vt("1",D);if(BigInt(await h.blindboxPriceUsdt())!==P)throw new Error("盲盒合约金额不是 1 USDT，请勿继续");const R=BigInt(await S.allowance(m,v));if(R<P&&(R>0n&&(o?.("请在钱包中确认清除不足的旧 USDT 授权"),await(await S.approve(v,0n)).wait()),o?.("请在钱包中授权合约使用 1 USDT"),await(await S.approve(v,P)).wait()),E().toLowerCase()!==c.toLowerCase())throw new Error("钱包已切换，请重新确认");const ot=await h.currentSvxPerUsdt(),M=await l.getBlock("latest");if(!M)throw new Error("读取链上报价失败，请刷新重试");const dt=BigInt(M.timestamp)+BigInt(await h.deadlineSeconds());o?.("请在钱包中确认：支付 1 USDT，并按约 0.1 USDT/SVX 加入流动性");const N=await h.buyBlindboxAndAddLiquidity(n,ot,dt);o?.("盲盒支付与加 LP 交易已提交："+N.hash);const A=await N.wait(Math.max(1,Number(r)));if(!A||Number(A.status)!==1)throw new Error("链上盲盒支付或加 LP 失败");return{transactionHash:N.hash,blockNumber:Number(A.blockNumber)}}const O=new ct({defaultOptions:{queries:{staleTime:15e3,retry:1,refetchOnWindowFocus:!0,gcTime:12e4},mutations:{retry:!1}}});function I(){return{address:String(window.currentWalletConnection?.address||"").toLowerCase(),authenticated:!!window.currentWalletProfile?.authenticated,revision:window.getWalletStateRevision?.()||0}}const k=()=>{const e=I();return e.address+":"+e.revision+":"+e.authenticated};async function Jt(e,a={},s=!0){const n=k();if(s&&!I().authenticated)throw new Error("请先连接并确认钱包");const r=new AbortController,o=()=>r.abort();a.signal?.addEventListener("abort",o,{once:!0}),a.signal?.aborted&&r.abort();const d=setTimeout(o,15e3);try{const i=await fetch("/api/"+e,{credentials:"same-origin",...a,signal:r.signal}),c=await i.json().catch(()=>{throw new Error("服务暂不可用，请稍后重试")});if(s&&n!==k())throw new Error("钱包状态已变化，请重新操作");if(!i.ok)throw Object.assign(new Error(c.error||"请求失败"),{status:i.status,code:c.code,requestId:i.headers.get("X-Request-Id")});return c}catch(i){throw i instanceof Error&&i.name==="AbortError"?new Error("请求超时，请刷新核对结果"):i}finally{clearTimeout(d),a.signal?.removeEventListener("abort",o)}}const $=(e,a,s)=>Jt(e,{method:"POST",headers:{"Content-Type":"application/json",...s},body:JSON.stringify(a)}),H=e=>e+"_"+crypto.randomUUID().replaceAll("-","");async function Be(e,a,s){const n="solvex:request:"+s,r=E()+":"+JSON.stringify(a);let o=null;try{o=JSON.parse(sessionStorage.getItem(n)||"null")}catch{}const d=o?.fingerprint===r&&o.id?o.id:H(s);sessionStorage.setItem(n,JSON.stringify({fingerprint:r,id:d}));const i=await $(e,a,{"Idempotency-Key":d});return sessionStorage.removeItem(n),i}async function De(e,a,s,n,r){const o=k(),d="solvex:signed:"+s,i=E()+":"+JSON.stringify(a);let c=null;try{c=JSON.parse(sessionStorage.getItem(d)||"null")}catch{}const l=c?.fingerprint===i&&c.id?c.id:H(s);sessionStorage.setItem(d,JSON.stringify({fingerprint:i,id:l}));const u=Date.now(),b=await Xt(n(l,u));if(k()!==o)throw new Error("钱包状态已变化，请重新操作");const m=await $(e,{...a,timestamp:u,signature:b},{"Idempotency-Key":l});return sessionStorage.removeItem(d),m}const Kt="modulepreload",Qt=function(e,a){return new URL(e,a).href},V={},x=function(a,s,n){let r=Promise.resolve();if(s&&s.length>0){let l=function(u){return Promise.all(u.map(b=>Promise.resolve(b).then(m=>({status:"fulfilled",value:m}),m=>({status:"rejected",reason:m}))))};const d=document.getElementsByTagName("link"),i=document.querySelector("meta[property=csp-nonce]"),c=i?.nonce||i?.getAttribute("nonce");r=l(s.map(u=>{if(u=Qt(u,n),u in V)return;V[u]=!0;const b=u.endsWith(".css"),m=b?'[rel="stylesheet"]':"";if(n)for(let g=d.length-1;g>=0;g--){const h=d[g];if(h.href===u&&(!b||h.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${u}"]${m}`))return;const v=document.createElement("link");if(v.rel=b?"stylesheet":Kt,b||(v.as="script"),v.crossOrigin="",v.href=u,c&&v.setAttribute("nonce",c),document.head.appendChild(v),b)return new Promise((g,h)=>{v.addEventListener("load",g),v.addEventListener("error",()=>h(new Error(`Unable to preload CSS for ${u}`)))})}))}function o(d){const i=new Event("vite:preloadError",{cancelable:!0});if(i.payload=d,window.dispatchEvent(i),!i.defaultPrevented)throw d}return r.then(d=>{for(const i of d||[])i.status==="rejected"&&o(i.reason);return a().catch(o)})},Yt=`<!DOCTYPE html>\r
<html lang="zh-CN">\r
<head>\r
<meta charset="utf-8" />\r
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />\r
<meta name="format-detection" content="telephone=no" />\r
<meta name="mobile-web-app-capable" content="yes" />\r
<meta name="apple-mobile-web-app-capable" content="yes" />\r
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />\r
<title>Solvex · 数字资产与量化生态</title>\r
<link rel="icon" type="image/png" sizes="32x32" href="/assets/brand/favicon-32.png?v=20261111-domain-solvex-logo-3">\r
<link rel="icon" type="image/png" sizes="64x64" href="/assets/brand/icon-64.png?v=20261111-domain-solvex-logo-3">\r
<link rel="alternate icon" href="/favicon.ico?v=20261111-domain-solvex-logo-3">\r
<link rel="apple-touch-icon" sizes="180x180" href="/assets/brand/icon-180.png?v=20261111-domain-solvex-logo-3">\r
<meta name="theme-color" content="#f5f7f8">\r
<link rel="modulepreload" href="/vendor/wallet/connector.js?v=20261111-domain-team-1">\r
<script src="/js/account-action-guard.js?v=20261111-domain-team-1"><\/script>\r
<script defer src="/js/theme.js?v=20261111-domain-light-3"><\/script>\r
<script>\r
(() => {\r
  const local = ['127.0.0.1', 'localhost', '::1'].includes(location.hostname);\r
  window.WG_OPERATOR_MODE = local && new URLSearchParams(location.search).get('operator') === '1';\r
  if (window.WG_OPERATOR_MODE) document.documentElement.classList.add('operator-mode');\r
})();\r
<\/script>\r
<!-- 首屏关键 CSS（render-blocking，仅 base/portal/mobile 三部分） -->\r
<link rel="stylesheet" href="/styles/critical.css?v=20261112-internal-kline-8">\r
<!-- 非首屏 CSS（media=print 异步下载，不阻塞渲染；8 个文件合并为 1 个请求） -->\r
<link rel="stylesheet" href="/styles/lazy.css?v=20261111-domain-team-1" media="print" onload="this.media='all'">\r
<link rel="stylesheet" href="/styles/solvex-design.css?v=20261111-domain-light-3">\r
<link rel="stylesheet" href="/styles/solvex-crystal.css?v=20261111-domain-light-3">\r
</head>\r
<body>\r
\r
<!-- ── Header ── -->\r
<div class="header">\r
  <div class="header-logo"><i class="brand-mark"></i> Solvex <small class="header-slogan" aria-hidden="true">有信号，不瞎猜 · Measure, don't guess.</small></div>\r
  <div class="header-sep operator-only"></div>\r
  <span class="hdot idle operator-only" id="hdr-de-dot" title=""></span><span id="hdr-de" class="badge badge-paper operator-only">DE: PAPER</span>\r
  <span class="hdot idle operator-only" id="hdr-ex-dot" title=""></span><span id="hdr-ex" class="badge badge-paper operator-only">EX: PAPER</span>\r
  <span class="hdot idle operator-only" id="hdr-rs-dot" title=""></span><span id="hdr-rs" class="badge badge-paper operator-only">RS: PAPER</span>\r
  <div class="main-tabs" role="navigation" aria-label="主导航">\r
    <button class="tab-btn active" data-nav-zh="矿池" onclick="switchTab('earn')">矿池</button>\r
    <button class="tab-btn" id="open-aix-mall" data-nav-zh="商城" onclick="switchTab('mall')">商城</button>\r
    <span class="tab-sep" aria-hidden="true"></span>\r
    <button class="tab-btn" data-nav-zh="交易" data-trade-nav="trade" onclick="openTradePage('spot')">交易</button>\r
    <button class="tab-btn" data-nav-zh="群聊" onclick="switchTab('community-chat')">群聊</button>\r
    <button class="tab-btn" data-nav-zh="SVX交易" onclick="switchTab('a-token-trade')">SVX交易</button>\r
    <span class="tab-sep" aria-hidden="true"></span>\r
    <button class="tab-btn" data-nav-zh="合约风云榜" onclick="switchTab('leaderboard')">合约风云榜</button>\r
    <button class="tab-btn" data-nav-zh="团队" onclick="switchTab('referrals')">团队</button>\r
    <span class="tab-sep" aria-hidden="true"></span>\r
    <button class="tab-btn" data-nav-zh="我的资产" onclick="switchTab('account')">我的资产</button>\r
    <button class="tab-btn" data-nav-zh="在线客服" onclick="switchTab('support')">在线客服</button>\r
    <button class="tab-btn" data-nav-zh="Ai量化" onclick="switchTab('ai-managed')">Ai量化</button>\r
    <button class="tab-btn operator-only" onclick="switchTab('portfolio')">投资组合</button>\r
    <button class="tab-btn operator-only" onclick="switchTab('vaults')">金库</button>\r
    <button class="tab-btn operator-only" onclick="switchTab('staking')">能量</button>\r
    <button class="tab-btn operator-only" onclick="switchTab('ledger')">机器人账本</button>\r
    <button class="tab-btn operator-only" onclick="switchTab('ai')">AI 助手</button>\r
  </div>\r
  <div class="header-right">\r
    <button id="lang-toggle" class="lang-toggle" type="button" title="切换语言" aria-label="切换语言">🌐</button>\r
    <div class="wallet-control">\r
      <button id="wallet-connect-btn" class="wallet-connect" aria-haspopup="menu" aria-expanded="false" onclick="handleWalletButton(this)">连接钱包</button>\r
      <div id="wallet-account-menu" class="wallet-account-menu" role="menu" hidden>\r
        <button id="wallet-menu-auth" type="button" role="menuitem" class="primary" onclick="verifyWalletFromMenu(this)">🔐 身份验证</button>\r
        <button type="button" role="menuitem" onclick="openWalletAccount()">钱包资金</button>\r
        <button type="button" role="menuitem" class="danger" onclick="disconnectWallet()">断开钱包</button>\r
      </div>\r
    </div>\r
    <span id="hdr-conn" class="conn warn operator-only" title="后端连接状态"><span class="cdot"></span><span id="hdr-conn-txt">连接中…</span></span>\r
    <span class="muted" id="hdr-time"></span>\r
    <button id="mobile-nav-toggle" class="mobile-nav-toggle" type="button" aria-label="打开导航菜单" aria-expanded="false" onclick="toggleMobileNav()"><span></span><span></span><span></span></button>\r
  </div>\r
</div>\r
\r
<!-- ── 平台公告横幅（后台「平台公告」可编辑，最多 2 条，中英双语；内容由 announcement.js 注入） ── -->\r
<div id="platform-announce-list" data-no-translate></div>\r
\r
<!-- 公告详情弹窗：点「展开」打开，点遮罩 / × / Esc 关闭 -->\r
<div id="platform-announce-modal" class="pa-modal" data-no-translate hidden>\r
  <div class="pa-modal-mask" data-pa-close></div>\r
  <div class="pa-modal-card" role="dialog" aria-modal="true" aria-labelledby="pa-modal-title">\r
    <div class="pa-modal-head">\r
      <b id="pa-modal-title">📢 平台公告</b>\r
      <button type="button" class="pa-modal-close" data-pa-close aria-label="关闭">×</button>\r
    </div>\r
    <div class="pa-modal-body" id="pa-modal-body"></div>\r
  </div>\r
</div>\r
\r
<div id="mobile-nav-backdrop" class="mobile-nav-backdrop" aria-hidden="true" onclick="toggleMobileNav(false)"></div>\r
\r
<div id="tab-trade" class="tab-panel">\r
  <div class="trade-terminal">\r
    <nav class="trade-section-nav" aria-label="交易市场">\r
      <button type="button" data-trade-section="spot" aria-pressed="true" class="active" onclick="openTradePage('spot')">现货</button>\r
      <button type="button" data-trade-section="perp" aria-pressed="false" onclick="openTradePage('perp')">合约</button>\r
      <button type="button" data-trade-section="stock" aria-pressed="false" onclick="openStockPage()">股票</button>\r
    </nav>\r
    <div class="terminal-marketbar">\r
      <button class="terminal-symbol market-trigger" id="trade-market-trigger" type="button"><span class="coin-mark"><img id="trade-symbol-logo" src="/assets/tokens/btc.png" alt="BTC"></span><div><b id="trade-symbol">BTC / USDT</b><span id="trade-product-label">永续合约</span></div><span class="market-chevron">⌄</span></button>\r
      <div class="ticker-stat ticker-price-stat"><select id="trade-price-mode" aria-label="价格类型"><option value="last" selected>最新价格</option><option value="mark">标记价格</option></select><b id="trade-mark-price">—</b></div>\r
      <div class="ticker-stat"><span>24h 涨跌</span><b id="trade-change">—</b></div>\r
      <div class="ticker-stat"><span>24h 最高</span><b id="trade-high">—</b></div>\r
      <div class="ticker-stat"><span>24h 最低</span><b id="trade-low">—</b></div>\r
      <div class="ticker-stat"><span>24h 成交额 (USDT)</span><b id="trade-volume">—</b></div>\r
      <div class="ticker-stat ticker-funding-stat" id="trade-funding-stat" hidden><span>资金费率 (8h) / 倒计时</span><b><span id="trade-funding-rate">—</span> · <span id="trade-funding-countdown">—:—:—</span></b></div>\r
    </div>\r
    <div class="terminal-grid">\r
      <section class="terminal-chart">\r
        <div class="terminal-toolbar">\r
          <div class="terminal-tabs" id="trade-chart-tabs"><button class="active" data-chart-view="chart">图表</button><button data-chart-view="details">详情</button></div>\r
          <div class="timeframe-tabs" id="trade-timeframes">\r
            <button data-sec="60">1m</button><button data-sec="300">5m</button><button data-sec="900">15m</button><button class="active" data-sec="3600">1h</button><button data-sec="14400">4h</button><button data-sec="86400">1D</button>\r
          </div>\r
        </div>\r
        <div class="chart-indicator-bar" id="trade-indicators"><span>主图</span><button class="indicator-toggle" data-period="7">MA(7)</button><button class="indicator-toggle" data-period="25">MA(25)</button><button class="indicator-toggle" data-period="99">MA(99)</button><button class="indicator-toggle" data-indicator="ema" data-period="7">EMA(7)</button><button class="indicator-toggle" data-indicator="ema" data-period="25">EMA(25)</button><button class="indicator-toggle" data-indicator="ema" data-period="99">EMA(99)</button><button class="indicator-toggle" data-indicator="boll">BOLL(20,2)</button><span>副图</span><button class="indicator-toggle" data-indicator="vol">VOL</button><button class="indicator-toggle" data-indicator="macd">MACD(12,26,9)</button><button class="indicator-toggle" id="trade-alert-btn" type="button" title="价格提醒" style="margin-left:auto">⏰ 提醒</button></div>\r
        <div id="trade-chart"></div>\r
        <div class="trade-chart-subview" id="trade-chart-details" hidden>\r
          <div><span>交易对</span><b id="trade-detail-symbol">BTC/USDT</b></div><div><span>产品</span><b id="trade-detail-product">现货</b></div>\r
          <div><span>最新价格</span><b id="trade-detail-price">—</b></div><div><span>24h 涨跌</span><b id="trade-detail-change">—</b></div>\r
          <div><span>24h 最高</span><b id="trade-detail-high">—</b></div><div><span>24h 最低</span><b id="trade-detail-low">—</b></div>\r
          <div><span>24h 成交额</span><b id="trade-detail-volume">—</b></div><div><span>结算资产</span><b>USDT</b></div>\r
        </div>\r
      </section>\r
      <aside class="orderbook-panel">\r
        <div class="terminal-section-title">\r
          <div class="terminal-tabs" id="trade-book-tabs">\r
            <button class="active" data-book-view="book" type="button">订单簿</button>\r
            <button data-book-view="trades" type="button">最近成交</button>\r
            <button data-book-view="depth" type="button">深度图</button>\r
          </div>\r
          <select id="trade-book-precision" class="book-precision-select" aria-label="订单簿聚合精度">\r
            <option value="0.01">0.01</option>\r
            <option value="0.1" selected>0.1</option>\r
            <option value="1">1</option>\r
            <option value="10">10</option>\r
            <option value="100">100</option>\r
          </select>\r
        </div>\r
        <div id="trade-book-panel" class="book-panel">\r
          <div id="trade-book-spread-bar" class="book-spread-bar" hidden>\r
            <span class="book-spread-bid"><em id="trade-book-bid-pct">0%</em></span>\r
            <span class="book-spread-ask"><em id="trade-book-ask-pct">0%</em></span>\r
          </div>\r
          <div class="book-head"><span>价格</span><span>数量</span><span>合计</span></div>\r
          <div id="trade-asks" class="book-rows"></div>\r
          <div class="book-mid" id="trade-book-mid">—</div>\r
          <div id="trade-bids" class="book-rows"></div>\r
        </div>\r
        <div id="trade-trades-panel" class="book-panel" hidden>\r
          <div class="book-head"><span>价格</span><span>数量</span><span>时间</span></div>\r
          <div id="trade-trades" class="book-rows trade-trades-list"></div>\r
        </div>\r
        <div id="trade-depth-panel" class="book-panel" hidden>\r
          <canvas id="trade-depth-canvas"></canvas>\r
        </div>\r
      </aside>\r
      <aside class="order-entry aentry">\r
        <div class="terminal-section-title">下单</div>\r
        <div class="side-switch"><button class="active" data-side="buy" id="trade-buy-label">做多</button><button data-side="sell" id="trade-sell-label">做空</button></div>\r
        <div class="order-type-tabs" id="trade-order-types"><button class="active" data-order-type="market">市价</button><button data-order-type="limit">限价</button><button data-order-type="trigger">条件</button></div>\r
        <div class="order-field order-tif-field" id="trade-tif-field" hidden><span>有效期</span><select id="trade-tif"><option value="GTC">GTC（撤前有效）</option><option value="IOC">IOC（即时成交剩余撤）</option><option value="FOK">FOK（全成或撤）</option><option value="POST">Post-Only（只做 Maker）</option></select><b></b></div>\r
        <label><span id="trade-available-label">平台可用保证金</span> <span id="trade-available-balance" style="cursor:pointer" title="点击填满数量">— USDT</span></label>\r
        <div class="order-field" id="trade-order-price-field"><span>价格</span><input id="trade-order-price" type="number" readonly><b>USDT</b></div>\r
        <div class="trigger-order-grid" id="trade-trigger-fields" hidden>\r
          <label><span>触发价</span><input id="trade-trigger-price" type="number" min="0" step="any"><b>USDT</b></label>\r
          <label><span>方向</span><select id="trade-trigger-direction"><option value="above">上涨到</option><option value="below">下跌到</option></select></label>\r
        </div>\r
        <div class="order-field"><span>数量</span><input id="trade-order-size" type="number"><b id="trade-order-asset">BTC</b></div>\r
        <div class="order-field order-field-action" id="trade-leverage-field"><span>杠杆</span><button id="trade-leverage-trigger" class="order-select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">3x</button><input id="trade-leverage" type="number" min="1" max="100" step="1" value="3" inputmode="numeric" aria-label="合约杠杆，1 到 100 倍" hidden><b></b></div>\r
        <div class="trade-popover leverage-popover" id="trade-leverage-popover" hidden><div class="popover-title">选择杠杆 <span>1x–100x</span></div><div class="leverage-grid" role="listbox" aria-label="杠杆档位"><button type="button" data-leverage-value="1">1x</button><button type="button" data-leverage-value="2">2x</button><button type="button" data-leverage-value="3">3x</button><button type="button" data-leverage-value="5">5x</button><button type="button" data-leverage-value="10">10x</button><button type="button" data-leverage-value="20">20x</button><button type="button" data-leverage-value="25">25x</button><button type="button" data-leverage-value="50">50x</button><button type="button" data-leverage-value="75">75x</button><button type="button" data-leverage-value="100">100x</button></div></div>\r
        <div class="order-field order-field-action" id="trade-margin-mode-field"><span>保证金</span><button id="trade-margin-mode-trigger" class="order-select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">逐仓</button><select id="trade-margin-mode" hidden><option value="isolated" selected>逐仓</option><option value="cross">全仓</option></select><b>模式</b></div>\r
        <div class="trade-popover margin-popover" id="trade-margin-popover" hidden><div class="popover-title">保证金模式 <span>风险独立计算</span></div><div class="margin-mode-grid"><button type="button" data-margin-mode="isolated"><b>逐仓</b><small>单独仓位风险</small></button><button type="button" data-margin-mode="cross"><b>全仓</b><small>共享合约余额</small></button></div></div>\r
        <label class="reduce-only-control" id="trade-reduce-only-field"><input id="trade-reduce-only" type="checkbox" hidden><button id="trade-reduce-only-toggle" type="button" role="switch" aria-checked="false"><i></i><span>只减仓</span></button><small>只准许减少现有仓位</small></label>\r
        <input class="amount-slider" type="range" min="0" max="100" value="0" aria-label="仓位比例">\r
        <div class="slider-labels"><button type="button" data-amount-percent="0">0%</button><button type="button" data-amount-percent="25">25%</button><button type="button" data-amount-percent="50">50%</button><button type="button" data-amount-percent="75">75%</button><button type="button" data-amount-percent="100">100%</button></div>\r
        <button class="terminal-order-btn" id="trade-order-btn" onclick="handleTradeOrder(this)">连接钱包</button>\r
        <button class="terminal-order-btn terminal-close-btn" id="trade-quick-close-btn" type="button" onclick="quickClosePerp(this)" hidden>市价平仓</button>\r
        <div class="quote-box">\r
          <div class="order-summary q-row"><span>订单价值</span><b id="trade-order-value">0.00 USDT</b></div>\r
          <div class="order-summary q-row"><span id="trade-receive-label">获得数量</span><b id="trade-receive-qty">— —</b></div>\r
          <div class="order-summary q-row" id="trade-opening-size-row" hidden><span>预计开仓数量</span><b id="trade-opening-size">0.00000000 BTC</b></div>\r
          <div class="order-summary q-row" id="trade-opening-margin-row" hidden><span>预计开仓保证金</span><b id="trade-opening-margin">0.00 USDT</b></div>\r
          <div class="order-summary q-row" id="trade-fee-row" hidden><span>预计手续费</span><b id="trade-fee">0.00 USDT</b></div>\r
          <div class="order-summary q-row"><span id="trade-summary-available-label">可用余额</span><b id="trade-summary-available">— USDT</b></div>\r
          <div class="order-summary q-row"><span>已用保证金</span><b id="trade-margin-used">— USDT</b></div>\r
          <div class="order-summary q-row"><span>保证金使用率</span><b id="trade-margin-usage">—</b></div>\r
        </div>\r
      </aside>\r
      <section class="terminal-bottom">\r
        <div class="terminal-tabs" id="trade-account-tabs"><button class="active" data-view="balances">资产</button><button data-view="positions">持仓</button><button data-view="orders">当前委托</button><button data-view="history">历史委托</button><button data-view="fills">成交历史</button></div>\r
        <div id="trade-account-content" class="terminal-account-content"></div>\r
      </section>\r
    </div>\r
  </div>\r
</div>\r
\r
<div id="tab-partner-plan" class="tab-panel"></div>\r
\r
<div id="tab-ai-managed" class="tab-panel">\r
  <main class="aim-page">\r
    <section class="aim-banner">\r
      <div class="aim-banner-copy">\r
        <span class="aim-status" id="aim-status">等待连接钱包</span>\r
        <h1>Solvex 合约跟单</h1>\r
        <div class="aim-rate"><strong>0.8%</strong><span>日化目标 · 自动复投</span></div>\r
        <div class="aim-tags"><span>随机间隔生成明细</span><span>随时赎回</span><span>平台内部结算</span></div>\r
      </div>\r
      <div class="aim-robot" role="img" aria-label="跟单机器人">\r
        <svg class="aim-bot" viewBox="0 0 120 100" aria-hidden="true">\r
          <defs>\r
            <linearGradient id="aimBotHead" x1="0" y1="0" x2="0" y2="1">\r
              <stop offset="0" stop-color="#eaf3f0"/><stop offset="1" stop-color="#dcebe6"/>\r
            </linearGradient>\r
            <linearGradient id="aimBotBody" x1="0" y1="0" x2="0" y2="1">\r
              <stop offset="0" stop-color="#e4efeb"/><stop offset="1" stop-color="#d6e6e1"/>\r
            </linearGradient>\r
            <radialGradient id="aimBotGlow" cx=".5" cy=".5" r=".5">\r
              <stop offset="0" stop-color="#0e9c88" stop-opacity=".16"/><stop offset="1" stop-color="#0e9c88" stop-opacity="0"/>\r
            </radialGradient>\r
          </defs>\r
          <ellipse class="aim-bot-halo" cx="60" cy="56" rx="46" ry="33" fill="url(#aimBotGlow)"/>\r
          <line x1="60" y1="7" x2="60" y2="16" stroke="#7f958f" stroke-width="2"/>\r
          <circle class="aim-bot-tip" cx="60" cy="6" r="3.5" fill="#a8700a"/>\r
          <rect x="21" y="29" width="7" height="15" rx="3" fill="#b7c9c4"/>\r
          <rect x="92" y="29" width="7" height="15" rx="3" fill="#b7c9c4"/>\r
          <rect class="aim-bot-shell" x="28" y="16" width="64" height="42" rx="11" fill="url(#aimBotHead)" stroke="#b3c7c2"/>\r
          <rect class="aim-bot-screen" x="35" y="23" width="50" height="28" rx="6" fill="#123a33" stroke="#0e9c8833"/>\r
          <rect class="aim-bot-eye" x="45" y="31" width="7" height="10" rx="3.5" fill="#0e9c88"/>\r
          <rect class="aim-bot-eye" x="68" y="31" width="7" height="10" rx="3.5" fill="#0e9c88"/>\r
          <path d="M55 45q5 3 10 0" fill="none" stroke="#0e9c88" stroke-width="1.6" stroke-linecap="round" opacity=".65"/>\r
          <rect x="55" y="58" width="10" height="6" rx="2" fill="#b7c9c4"/>\r
          <rect x="24" y="66" width="8" height="17" rx="4" fill="#e7f0ed" stroke="#a9bdb8"/>\r
          <rect x="88" y="66" width="8" height="17" rx="4" fill="#e7f0ed" stroke="#a9bdb8"/>\r
          <rect class="aim-bot-shell" x="33" y="64" width="54" height="29" rx="9" fill="url(#aimBotBody)" stroke="#a9bdb8"/>\r
          <rect class="aim-bot-screen" x="43" y="70" width="34" height="17" rx="4" fill="#123a33" stroke="#0e9c8828"/>\r
          <line x1="51" y1="73" x2="51" y2="84" stroke="#e7f0ed" stroke-width="1"/>\r
          <rect x="49" y="76" width="4" height="5" rx="1" fill="#0e9c88"/>\r
          <line x1="60" y1="73" x2="60" y2="84" stroke="#e7f0ed" stroke-width="1"/>\r
          <rect x="58" y="74" width="4" height="5" rx="1" fill="#a8700a"/>\r
          <line x1="69" y1="73" x2="69" y2="84" stroke="#e7f0ed" stroke-width="1"/>\r
          <rect class="aim-bot-candle" x="67" y="72" width="4" height="6" rx="1" fill="#0e9c88"/>\r
          <circle class="aim-bot-dot" cx="82" cy="74" r="2.2" fill="#a8700a"/>\r
        </svg>\r
      </div>\r
    </section>\r
\r
    <section class="aim-metrics" aria-label="跟单资产概览">\r
      <div><span>跟单总额</span><strong id="aim-balance">0 USDT</strong></div>\r
      <div><span>今日收益</span><strong id="aim-day-earned">0 USDT</strong></div>\r
      <div><span>累计收益</span><strong id="aim-total-earned">0 USDT</strong></div>\r
      <div><span>下次明细</span><strong id="aim-next-slot">—</strong></div>\r
    </section>\r
\r
    <section class="aim-controls">\r
      <div class="aim-control-main">\r
        <div class="aim-section-title"><div><h2>资金跟单</h2><span id="aim-available">可用余额 — USDT</span><span id="aim-quota" style="display:none;font-size:12px;color:#5b6b66"></span></div><span class="aim-compound">自动复投已开启</span></div>\r
        <div class="aim-deposit-row">\r
          <label for="aim-term">跟单期限</label>\r
          <select id="aim-term" class="aim-term"><option value="30">30 天 · 日化 0.4%</option><option value="90">90 天 · 日化 0.6%</option><option value="180">180 天 · 日化 0.8%</option><option value="360" selected>360 天 · 日化 1.2%</option></select>\r
          <label for="aim-amount">跟单金额</label>\r
          <div class="aim-amount-field"><input id="aim-amount" name="ai_managed_usdt_amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" autocomplete="transaction-amount" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-bwignore="true"><span>USDT</span><button id="aim-max" type="button">全部</button></div>\r
          <button class="aim-primary" id="aim-start" type="button">开始跟单</button>\r
          <button class="aim-secondary" id="aim-redeem" type="button" disabled>全部赎回</button>\r
        </div>\r
        <div class="aim-progress-head"><span>今日目标进度</span><b id="aim-progress-text">0 / 0 USDT</b></div>\r
        <div class="aim-progress"><i id="aim-progress-bar"></i></div>\r
        <p class="aim-disclosure">收益由平台内部结算；下方为合约跟单执行明细。</p>\r
      </div>\r
    </section>\r
\r
    <section class="aim-records">\r
      <div class="aim-section-title"><div><h2>跟单批次</h2><span>追加资金独立计算到期时间</span></div></div>\r
      <div class="aim-table-wrap"><table><thead><tr><th>批次</th><th>期限</th><th>投入 USDT</th><th>开始时间</th><th>到期时间</th><th>状态</th></tr></thead><tbody id="aim-batches"><tr><td colspan="6" class="aim-empty">暂无跟单批次</td></tr></tbody></table></div>\r
    </section>\r
\r
    <section class="aim-records">\r
      <div class="aim-section-title"><div><h2>策略执行明细</h2><span>当日达到 0.8% 后停止生成</span></div></div>\r
      <div class="aim-table-wrap">\r
        <table><thead><tr><th>时间</th><th>交易对</th><th>方向</th><th>参考价格</th><th>数量</th><th>本次收益</th><th>类型</th></tr></thead>\r
        <tbody id="aim-records"><tr><td colspan="7" class="aim-empty">暂无执行明细</td></tr></tbody></table>\r
      </div>\r
    </section>\r
  </main>\r
</div>\r
\r
<div id="tab-portfolio" class="tab-panel portal-page"></div>\r
<div id="tab-earn" class="tab-panel portal-page active">  <!-- 首屏静态骨架：JS 就绪前先画出页面结构（earn.js 就绪后以相同结构重绘，无闪烁） -->\r
  <div class="portal-shell">\r
    <header class="portal-heading"><div><h1>矿池</h1><p>探索 SVX 生态，管理你的每一份资产</p></div></header>\r
    <div class="earn-sub-tabs">\r
      <button class="earn-sub-tab active" type="button">矿池</button>\r
      <button class="earn-sub-tab" type="button">待领取</button>\r
      <button class="earn-sub-tab" type="button">能量</button>\r
      <button class="earn-sub-tab" type="button">股东</button>\r
      <button class="earn-sub-tab" type="button">盲盒</button>\r
      <button class="earn-sub-tab" type="button">超速驱动协议</button>\r
    </div>\r
    <div id="earn-content"><div class="portal-loading"><i></i><i></i><i></i><i></i><i></i><i></i></div></div>\r
  </div>\r
</div>\r
<div id="tab-vaults" class="tab-panel portal-page"></div>\r
<div id="tab-staking" class="tab-panel portal-page"></div>\r
<div id="tab-referrals" class="tab-panel portal-page"></div>\r
<div id="tab-community-chat" class="tab-panel portal-page"></div>\r
\r
<div id="tab-leaderboard" class="tab-panel portal-page"></div>\r
<div id="tab-a-token-trade" class="tab-panel portal-page"></div>\r
<div id="tab-support" class="tab-panel portal-page"></div>\r
<!-- Solvex 商城：站内标签页嵌入（iframe 同源，高度自适应；商城自身页头页脚在 ?embed=1 下隐藏） -->\r
<div id="tab-mall" class="tab-panel portal-page"><iframe id="mall-frame" src="/mall.html?embed=1&v=20261111-domain-light-3" title="Solvex 商城" style="width:100%;border:0;display:block;min-height:75vh;background:transparent" loading="lazy"></iframe></div>\r
<script>\r
addEventListener('message', e => {\r
  if (e.origin === location.origin && e.data?.type === 'mall-height') {\r
    const f = document.getElementById('mall-frame');\r
    if (f) f.style.height = Math.max(600, e.data.h + 4) + 'px';\r
  }\r
});\r
<\/script>\r
\r
<div class="market-picker-backdrop" id="trade-market-picker" hidden>\r
  <div class="market-picker-dialog">\r
    <div class="market-search"><span>⌕</span><input id="trade-market-search" placeholder="搜索市场" autocomplete="off"><button type="button" id="trade-market-close">×</button></div>\r
    <div class="market-category-tabs"><button data-market-product="perp" class="active">合约</button><button data-market-product="spot">现货</button><button data-market-scope="stock">股票</button><button data-market-category="favorites">自选</button></div>\r
    <div class="market-list-head"><span>市场</span><span>最后价格</span><span>24小时变化</span><span>24h 成交额 (USDT)</span></div>\r
    <div id="trade-market-list"></div>\r
  </div>\r
</div>\r
\r
\r
\r
\r
\r
<!-- TAB: 永久成交账本 -->\r
<div id="tab-ledger" class="tab-panel">\r
<div class="wrap">\r
  <div class="total-row" style="margin-top:4px">\r
    <div class="total-card"><div class="lbl">已保存成交</div><div class="val" id="ledger-records">0</div><div class="sub">永久明细</div></div>\r
    <div class="total-card"><div class="lbl">完成平仓</div><div class="val" id="ledger-completed">0</div><div class="sub">含回收成交</div></div>\r
    <div class="total-card"><div class="lbl">成交胜率</div><div class="val" id="ledger-winrate">—</div><div class="sub" id="ledger-winloss">胜 0 / 负 0</div></div>\r
    <div class="total-card"><div class="lbl">明细净盈亏</div><div class="val" id="ledger-pnl">0.00</div><div class="sub">手续费 <span id="ledger-fees">0.00</span></div></div>\r
  </div>\r
  <div class="panel">\r
    <div class="panel-title">网格机器人</div>\r
    <div class="bot-grid">\r
      <div class="bot-card">\r
        <div class="bot-head"><span class="bot-name">Decibel</span><span class="bot-state" id="bot-state-de">读取中…</span></div>\r
        <div class="bot-metrics">\r
          <div><span class="bot-lbl">市场</span><span class="bot-val" id="bot-market-de">—</span></div>\r
          <div><span class="bot-lbl">权益 (USDC)</span><span class="bot-val" id="bot-equity-de">—</span></div>\r
          <div><span class="bot-lbl">挂单</span><span class="bot-val" id="bot-orders-de">—</span></div>\r
          <div><span class="bot-lbl">累计盈亏</span><span class="bot-val" id="bot-pnl-de">—</span></div>\r
        </div>\r
        <div class="bot-actions">\r
          <button type="button" class="btn btn-ghost" id="bot-start-de" onclick="startBot('de', this)">启动</button>\r
          <button type="button" class="btn btn-ghost" id="bot-stop-de" onclick="stopBot('de', this)">停止</button>\r
        </div>\r
      </div>\r
      <div class="bot-card">\r
        <div class="bot-head"><span class="bot-name">Extended</span><span class="bot-state" id="bot-state-ex">读取中…</span></div>\r
        <div class="bot-metrics">\r
          <div><span class="bot-lbl">市场</span><span class="bot-val" id="bot-market-ex">—</span></div>\r
          <div><span class="bot-lbl">权益 (USDC)</span><span class="bot-val" id="bot-equity-ex">—</span></div>\r
          <div><span class="bot-lbl">挂单</span><span class="bot-val" id="bot-orders-ex">—</span></div>\r
          <div><span class="bot-lbl">累计盈亏</span><span class="bot-val" id="bot-pnl-ex">—</span></div>\r
        </div>\r
        <div class="bot-actions">\r
          <button type="button" class="btn btn-ghost" id="bot-start-ex" onclick="startBot('ex', this)">启动</button>\r
          <button type="button" class="btn btn-ghost" id="bot-stop-ex" onclick="stopBot('ex', this)">停止</button>\r
        </div>\r
      </div>\r
      <div class="bot-card">\r
        <div class="bot-head"><span class="bot-name">RISEx</span><span class="bot-state" id="bot-state-rs">读取中…</span></div>\r
        <div class="bot-metrics">\r
          <div><span class="bot-lbl">市场</span><span class="bot-val" id="bot-market-rs">—</span></div>\r
          <div><span class="bot-lbl">权益 (USDC)</span><span class="bot-val" id="bot-equity-rs">—</span></div>\r
          <div><span class="bot-lbl">挂单</span><span class="bot-val" id="bot-orders-rs">—</span></div>\r
          <div><span class="bot-lbl">累计盈亏</span><span class="bot-val" id="bot-pnl-rs">—</span></div>\r
        </div>\r
        <div class="bot-actions">\r
          <button type="button" class="btn btn-ghost" id="bot-start-rs" onclick="startBot('rs', this)">启动</button>\r
          <button type="button" class="btn btn-ghost" id="bot-stop-rs" onclick="stopBot('rs', this)">停止</button>\r
        </div>\r
      </div>\r
    </div>\r
  </div>\r
  <div class="panel">\r
    <div class="panel-title">完整成交账本</div>\r
    <div class="ledger-toolbar">\r
      <div><label for="ledger-exchange">交易所</label><select id="ledger-exchange" onchange="loadLedger(true)"><option value="all">全部交易所</option><option value="de">Decibel</option><option value="ex">Extended</option><option value="rs">RISEx</option></select></div>\r
      <button class="btn btn-ghost" onclick="loadLedger(true)">↻ 刷新</button>\r
      <button class="btn btn-ghost" onclick="exportLedger()">⇩ 导出 CSV</button>\r
    </div>\r
    <div class="trade-table-wrap"><table class="trade-table ledger-table"><thead><tr><th>时间</th><th>交易所</th><th>市场</th><th>类型</th><th>方向</th><th>成交价</th><th>数量</th><th>手续费</th><th>净盈亏</th></tr></thead><tbody id="ledger-body"><tr><td class="empty-row" colspan="9">正在读取账本…</td></tr></tbody></table></div>\r
    <div style="display:flex;justify-content:center;margin-top:12px"><button id="ledger-more" class="btn btn-ghost" style="width:auto;margin:0" onclick="loadLedger(false)">加载更多</button></div>\r
    <div class="muted ledger-note" id="ledger-note">账本独立保存在用户数据目录，重启、重新打包和重置账户都不会删除。旧版只会迁移当时仍保留的最近成交明细。</div>\r
  </div>\r
</div>\r
</div>\r
\r
<!-- ═══════════════════════════════════════════════════════════ -->\r
<!-- TAB: 个人中心 / 多链钱包 -->\r
<!-- ═══════════════════════════════════════════════════════════ -->\r
<div id="tab-account" class="tab-panel">\r
<div class="wrap account-shell">\r
  <div id="account-locked" class="panel account-locked">\r
    <h2>连接钱包进入个人中心</h2>\r
    <p class="muted">连接钱包即可进入；首次充值、提现或交易时再核对一次钱包，无需邮箱或其他账号。</p>\r
    <button id="account-connect-btn" class="btn btn-smart" onclick="connectWallet(this)">连接钱包</button>\r
  </div>\r
\r
  <div id="account-content" style="display:none">\r
    <div id="assets-dashboard-view">\r
    <section class="assets-header">\r
      <div>\r
        <h2>资产总览</h2>\r
        <div class="assets-wallet"><span class="assets-wallet-dot"></span><span id="account-address">—</span></div>\r
        <div class="assets-uid" id="account-uid-row" hidden>\r
          <span class="assets-uid-label">用户ID</span>\r
          <button type="button" class="assets-uid-copy" id="account-uid-btn" title="点击复制用户ID" onclick="copyAccountUid()">\r
            <span id="account-uid">—</span><span class="assets-uid-icon">⧉</span>\r
          </button>\r
        </div>\r
        <div id="account-partner-badge" class="partner-badge" hidden></div>\r
      </div>\r
      <div class="assets-header-actions">\r
        <button class="assets-icon-btn" title="刷新资产" aria-label="刷新资产" onclick="window.ExchangeAssets?.refresh()">↻</button>\r
        <button class="assets-text-btn" onclick="disconnectWallet()">断开钱包</button>\r
      </div>\r
    </section>\r
\r
    <section class="assets-overview">\r
      <div class="assets-total">\r
        <span class="assets-label">总资产估值</span>\r
        <strong><span id="assets-total-equity">0.00</span> <small>USDT</small></strong>\r
        <span class="assets-subvalue">≈ $<span id="assets-total-usd">0.00</span></span>\r
        <div class="assets-quick-actions">\r
          <button class="assets-primary-action" onclick="window.ExchangeAssets?.openFunding('deposit')"><span>＋</span>充值</button>\r
          <button class="assets-secondary-action" onclick="window.ExchangeAssets?.openFunding('withdraw')"><span>↑</span>提现</button>\r
          <button class="assets-secondary-action assets-records-shortcut" onclick="window.ExchangeAssets?.setView('records')"><span>≡</span>资金记录</button>\r
        </div>\r
      </div>\r
      <div class="assets-metrics">\r
        <div><span>可用余额</span><b><span id="account-usdc-balance">0</span> USDT</b></div>\r
        <div><span>现货资产</span><b><span id="assets-spot-value">0.00</span> USDT</b></div>\r
        <div><span>合约权益</span><b><span id="assets-contract-value">0.00</span> USDT</b></div>\r
        <div><span>策略与托管</span><b><span id="assets-strategy-value">0.00</span> USDT</b></div>\r
      </div>\r
    </section>\r
\r
    <section class="assets-distribution">\r
      <div class="assets-section-heading"><div><h3>账户分布</h3></div><span id="assets-updated-at">—</span></div>\r
      <div id="assets-allocation" class="assets-allocation"></div>\r
    </section>\r
\r
    <section class="assets-main">\r
      <div class="assets-tabs" role="tablist">\r
        <button class="active" data-assets-view="balances" onclick="window.ExchangeAssets?.setView('balances')">资产列表</button>\r
        <button data-assets-view="records" onclick="window.ExchangeAssets?.setView('records')">资金记录</button>\r
        <button data-assets-view="revenue" onclick="window.ExchangeAssets?.setView('revenue')">SVX 收益</button>\r
      </div>\r
\r
      <div id="assets-balances-view">\r
        <div class="assets-list-tools">\r
          <label class="assets-search"><span>⌕</span><input id="assets-search" type="search" placeholder="搜索币种" oninput="window.ExchangeAssets?.renderAssets()"></label>\r
          <label class="assets-zero-filter"><input id="assets-hide-zero" type="checkbox" onchange="window.ExchangeAssets?.renderAssets()">隐藏零资产</label>\r
        </div>\r
        <div class="assets-table-wrap">\r
          <table class="assets-table no-mobile-stack"><thead><tr><th>币种</th><th>总额</th><th>可用</th><th>冻结</th><th>USDT 估值</th><th>操作</th></tr></thead><tbody id="assets-table-body"><tr><td colspan="6" class="account-empty">正在读取资产</td></tr></tbody></table>\r
        </div>\r
      </div>\r
\r
      <div id="assets-records-view" hidden>\r
        <div class="assets-record-block">\r
          <h3>交易及账户流水</h3>\r
          <div class="account-history"><table><thead><tr><th>时间</th><th>类型</th><th>市场</th><th>方向</th><th>数量</th><th>价格</th><th>手续费</th><th>盈亏 / 金额</th><th>状态</th></tr></thead><tbody id="capital-history"><tr><td colspan="9" class="account-empty">暂无交易及账户流水</td></tr></tbody></table></div>\r
          <div class="rec-cards" id="capital-history-cards"></div>\r
        </div>\r
        <div class="assets-record-block">\r
          <h3>跟单收益</h3>\r
          <div class="account-history"><table><thead><tr><th>入账时间</th><th>跟单批次</th><th>资产</th><th>收益</th><th>收益日期</th><th>状态</th></tr></thead><tbody id="ai-managed-reward-history"><tr><td colspan="6" class="account-empty">暂无跟单收益</td></tr></tbody></table></div>\r
        </div>\r
        <div class="assets-record-block">\r
          <h3>充值记录</h3>\r
          <div class="account-history"><table><thead><tr><th>时间</th><th>网络</th><th>资产</th><th>数量</th><th>确认进度</th><th>状态</th><th>交易哈希</th></tr></thead><tbody id="deposit-history"><tr><td colspan="7" class="account-empty">暂无充值记录</td></tr></tbody></table></div>\r
        </div>\r
        <div class="assets-record-block">\r
          <h3>提现记录</h3>\r
          <div class="account-history"><table><thead><tr><th>时间</th><th>网络</th><th>资产</th><th>数量</th><th>状态</th><th>交易哈希</th></tr></thead><tbody id="withdraw-history"><tr><td colspan="6" class="account-empty">暂无提现记录</td></tr></tbody></table></div>\r
        </div>\r
      </div>\r
\r
      <div id="assets-revenue-view" hidden>\r
        <div class="assets-record-block">\r
          <h3>SVX 收益汇总</h3>\r
          <div id="aix-revenue-summary" class="aix-revenue-summary">正在加载…</div>\r
        </div>\r
        <div class="assets-record-block">\r
          <h3>收益明细</h3>\r
          <div class="account-history"><table><thead><tr><th>时间</th><th>收益类型</th><th>来源</th><th>比例</th><th>收益 (SVX)</th></tr></thead><tbody id="aix-revenue-list"><tr><td colspan="5" class="account-empty">暂无收益记录</td></tr></tbody></table></div>\r
          <div class="rec-cards" id="aix-revenue-cards"></div>\r
        </div>\r
      </div>\r
    </section>\r
    </div>\r
\r
    <section id="account-funding-forms" class="assets-funding" hidden>\r
      <header class="assets-funding-page-header">\r
        <button class="assets-back-button" onclick="window.ExchangeAssets?.closeFunding()" aria-label="返回资产总览">←</button>\r
        <div><h2 id="assets-funding-title">充值</h2><p>资产总览 / <span id="assets-funding-breadcrumb">充值</span></p></div>\r
      </header>\r
      <div id="assets-deposit-panel" class="assets-funding-pane">\r
        <div class="assets-section-heading"><div><h3>充值 USDT</h3><p>1 USDT 起充 · 跨链全额入账 0 手续费</p></div></div>\r
        <div class="account-form-row">\r
          <div><label for="deposit-network">充值网络</label><select id="deposit-network" onchange="updateDepositNetwork()"></select></div>\r
          <div><label for="deposit-amount">充值数量</label><input id="deposit-amount" type="text" inputmode="numeric" placeholder="最小 1 USDT（1 的整数倍）"></div>\r
        </div>\r
        <p id="deposit-wallet-balance" style="margin:8px 0 2px;font-size:14px;font-weight:600;color:#a8700a">钱包 USDT 余额 -</p>\r
        <button id="deposit-submit" class="btn btn-start" onclick="submitWalletDeposit()">从当前钱包充值</button>\r
        <div id="deposit-status" class="account-status"></div>\r
      </div>\r
      <div id="assets-withdraw-panel" class="assets-funding-pane">\r
        <div class="assets-section-heading"><div><h3>提现 USDT</h3><p>完成当前钱包签名验证后提交提现</p></div></div>\r
        <div class="account-form-row">\r
          <div><label for="withdraw-network">提现网络</label><select id="withdraw-network"></select></div>\r
          <div><label for="withdraw-amount">提现数量</label><input id="withdraw-amount" type="text" inputmode="decimal" placeholder="输入 USDT 数量"></div>\r
        </div>\r
        <p id="withdraw-rule-hint" style="margin:6px 0 0;font-size:12px;opacity:.72">单笔最小 1 USDT · 无手续费</p>\r
        <button id="withdraw-submit" class="btn btn-smart" onclick="submitWithdrawal()">提交提现申请</button>\r
        <div id="withdraw-status" class="account-status"></div>\r
      </div>\r
    </section>\r
  </div>\r
</div>\r
</div>\r
\r
<!-- ═══════════════════════════════════════════════════════════ -->\r
<!-- TAB: IP配置 -->\r
<!-- ═══════════════════════════════════════════════════════════ -->\r
<!-- ═══════════════════════════════════════════════════════════ -->\r
<!-- TAB: AI 助手 -->\r
<div id="tab-ai" class="tab-panel">\r
<div class="wrap" style="max-width:860px">\r
  <div class="panel" style="margin-top:4px">\r
    <div class="panel-title">本地量化分析配置</div>\r
    <p class="muted" style="margin-bottom:12px;line-height:1.6">\r
      使用内置技术指标和风险阈值分析，不安装模型、不使用在线 AI，也不需要 API Key。分析功能只给建议、风险通知和复盘，不能执行任何交易操作。\r
    </p>\r
    <div class="ai-grid">\r
      <div><label>哨兵巡检间隔（分钟，0=关闭）</label><input id="ai-sentinel-min" type="number" min="0" placeholder="5"></div>\r
      <div><label>行情报告间隔（分钟，0=关闭）</label><input id="ai-market-min" type="number" min="0" placeholder="30"></div>\r
      <div><label>日报生成时间（0-23 整点）</label><input id="ai-report-hour" type="number" min="0" max="23" placeholder="20"></div>\r
      <div><label>Telegram Bot Token（推送用，可选）</label><input id="ai-tg-token" name="telegram_bot_api_token" class="secret-text-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" placeholder="123456:ABC-..."></div>\r
      <div><label>Telegram Chat ID（可选）</label><input id="ai-tg-chat" placeholder="例：123456789"></div>\r
      <div><label>通用 Webhook（可选，POST {"text":...}）</label><input id="ai-webhook" placeholder="https://..."></div>\r
    </div>\r
    <div style="display:flex;gap:8px;margin-top:12px">\r
      <button class="btn btn-smart" style="margin:0;width:auto;padding:8px 22px" onclick="aiSaveConfig(this)">保存分析配置</button>\r
      <button class="btn btn-ghost" style="margin:0;width:auto;padding:8px 22px" onclick="aiTest(this)">检测规则引擎</button>\r
    </div>\r
    <div id="ai-cfg-status" class="muted" style="margin-top:8px;font-size:12px">—</div>\r
  </div>\r
\r
  <div class="panel">\r
    <div class="panel-title">🛡 风控哨兵<span id="ai-sent-badge"></span></div>\r
    <p class="muted" style="margin-bottom:8px">按设定间隔自动巡检三所状态（健康度/挂单同步/保证金/出区间/告警），发现问题推送通知。</p>\r
    <div id="ai-sentinel-box" class="ai-box muted">尚无巡检结果</div>\r
    <button class="btn btn-ghost" onclick="aiSentinelRun(this)" style="margin-top:10px;font-size:12px">立即巡检一次</button>\r
  </div>\r
\r
  <div class="panel">\r
    <div class="panel-title">🚨 出区间规则建议</div>\r
    <div id="ai-oor-box" class="ai-box muted">价格冲出网格区间时自动触发分析（平仓/回收/扩区间/维持），并推送通知；已配置的自动策略照常执行，AI 建议仅供复核。</div>\r
  </div>\r
\r
  <div class="panel">\r
    <div class="panel-title">📈 市况分析（当前适不适合跑网格）</div>\r
    <div style="display:flex;gap:8px;flex-wrap:wrap">\r
      <button class="btn btn-ghost" style="margin:0;width:auto;padding:7px 16px;font-size:12px" onclick="aiAnalyze('de', this)">分析 Decibel</button>\r
      <button class="btn btn-ghost" style="margin:0;width:auto;padding:7px 16px;font-size:12px" onclick="aiAnalyze('ex', this)">分析 Extended</button>\r
      <button class="btn btn-ghost" style="margin:0;width:auto;padding:7px 16px;font-size:12px" onclick="aiAnalyze('rs', this)">分析 RISEx</button>\r
    </div>\r
    <div id="ai-analyze-box" class="ai-box muted" style="margin-top:10px">综合 4小时/1小时/15分钟 三个周期的指标判断市况，给出区间/格数/间距建议。分析的是该所当前配置的市场。</div>\r
  </div>\r
\r
  <div class="panel">\r
    <div class="panel-title">📋 运行复盘日报</div>\r
    <div id="ai-report-box" class="ai-box muted">每天到点自动生成并推送；也可手动触发。</div>\r
    <button class="btn btn-ghost" onclick="aiReport(this)" style="margin-top:10px;font-size:12px">立即生成日报</button>\r
  </div>\r
\r
  <div class="panel">\r
    <div class="panel-title">只读分析助手</div>\r
    <p class="muted" style="margin-bottom:8px">本地规则引擎基于三所实时状态回答风险、盈亏和网格配置问题。这里只输出文字摘要，不提供任何交易执行入口。</p>\r
    <div id="ai-chatlog" class="ai-chatlog"></div>\r
    <div style="display:flex;gap:8px;margin-top:8px">\r
      <input id="ai-chat-input" placeholder="例：整体风险怎么样？盈亏表现如何？当前网格区间？" style="flex:1" onkeydown="if(event.key==='Enter')aiChatSend()">\r
      <button class="btn btn-smart" style="margin:0;width:auto;padding:8px 18px" onclick="aiChatSend()">发送</button>\r
    </div>\r
  </div>\r
</div>\r
</div>\r
\r
<!-- ═══════════════════════════════════════════════════════════ -->\r
<!-- JavaScript —— 首屏加载矿机与钱包；其他页面首次进入时加载 -->\r
<!-- ═══════════════════════════════════════════════════════════ -->\r
<!-- Dictionaries are loaded asynchronously by i18n.js; wallet startup does not wait for them. -->\r
<footer class="svx-site-footer"><div class="svx-footer-brand">Solvex <span>CONNECT. TRADE. EXPLORE.</span></div><div class="svx-footer-links"><button type="button" onclick="switchTab('support')">帮助与客服</button><button type="button" onclick="switchTab('community-chat')">加入社区</button><span>© Solvex</span></div></footer>\r
<nav class="svx-mobile-dock" aria-label="常用导航">\r
  <button type="button" data-page="earn" class="active" onclick="switchTab('earn')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/></svg><span>矿池</span></button>\r
  <button type="button" data-page="trade" onclick="openTradePage('spot')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v16M3 8h4v6H3M12 3v17m-2-13h4v5h-4m9-7v15m-2-9h4v6h-4"/></svg><span>交易</span></button>\r
  <button type="button" data-page="community-chat" onclick="switchTab('community-chat')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/></svg><span>群聊</span></button>\r
  <button type="button" data-page="referrals" onclick="switchTab('referrals')"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1"/></svg><span>团队</span></button>\r
  <button type="button" data-page="account" onclick="switchTab('account')"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="15" rx="3"/><path d="M3 9V6a3 3 0 0 1 3-3h12m3 8h-5v5h5"/><circle cx="17" cy="13.5" r=".5"/></svg><span>资产</span></button>\r
</nav>\r
<script defer src="/js/i18n.js?v=20261111-domain-team-1"><\/script>\r
<script defer src="/js/core.js?v=20261111-domain-team-1"><\/script>\r
<script defer src="/js/device-id.js?v=20261111-domain-team-1"><\/script>\r
<script defer src="/js/wallet.js?v=20261111-domain-team-1"><\/script>\r
<script defer src="/js/portal-shared.js?v=20261111-domain-team-1"><\/script>\r
<script defer src="/js/page-loader.js?v=20261112-internal-kline-8"><\/script>\r
<script defer src="/js/earn.js?v=20261111-domain-light-3"><\/script>\r
<script defer src="/js/announcement.js?v=20261111-domain-team-1"><\/script>\r
<!-- Wallet scripts are independent of the chart/trading download queue. -->\r
<script>\r
window.loadWalletConnector = function() {\r
  if (window.WGWalletConnector || window.__walletConnectorLoading) return;\r
  window.__walletConnectorLoading = true;\r
  const script = document.createElement('script');\r
  script.type = 'module';\r
  script.src = '/vendor/wallet/connector.js?v=20261111-domain-team-1';\r
  script.onload = script.onerror = () => { window.__walletConnectorLoading = false; };\r
  document.head.appendChild(script);\r
};\r
window.loadWalletConnector();\r
<\/script>\r
<script>\r
// Service Worker：静态资源缓存加速（二次访问），API 永不缓存\r
if ('serviceWorker' in navigator) {\r
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=20261112-internal-kline-8').catch(() => {}));\r
}\r
<\/script>\r
<script>\r
// 进平台默认显示矿机页（Portal 动态内容需触发一次 switchTab 才会加载）\r
// 上方 defer 脚本在 DOMContentLoaded 前按序执行完毕，此处监听事件保证在其后运行\r
document.addEventListener('DOMContentLoaded', () => {\r
  const page = new URLSearchParams(location.search).get('page');\r
  switchTab(page === 'ai-managed' ? page : 'earn').catch(error => console.error('默认页加载失败', error));\r
});\r
<\/script>\r
</body>\r
</html>\r
`,T={earn:"矿池",mall:"商城",trade:"交易","ai-managed":"Ai量化","a-token-trade":"SVX交易",leaderboard:"合约风云榜",referrals:"团队",account:"我的资产",support:"在线客服","community-chat":"群聊","partner-plan":"合伙人计划",portfolio:"投资组合",vaults:"金库",staking:"能量",ledger:"机器人账本",ai:"AI 助手"},Zt=()=>x(()=>Promise.resolve({}),__vite__mapDeps([0]),import.meta.url);function te(){window.WG_REACT_APP=!0;const e=new DOMParser().parseFromString(Yt,"text/html"),a=document.getElementById("legacy-root");["platform-announce-list","platform-announce-modal","trade-market-picker"].forEach(n=>{const r=e.getElementById(n);r&&a.append(r)}),e.querySelectorAll(".tab-panel").forEach(n=>{n.classList.remove("active"),(n.id==="tab-earn"||n.id==="tab-referrals"||n.id==="tab-account"||n.id==="tab-leaderboard"||n.id==="tab-support"||n.id==="tab-community-chat"||n.id==="tab-ai-managed"||n.id==="tab-partner-plan")&&n.replaceChildren(),a.append(n)});const s=document.createElement("div");s.hidden=!0,s.innerHTML='<span id="hdr-time"></span><span id="hdr-conn"></span><span id="hdr-conn-txt"></span><span id="hdr-de"></span><span id="hdr-ex"></span><span id="hdr-rs"></span><span id="hdr-de-dot"></span><span id="hdr-ex-dot"></span><span id="hdr-rs-dot"></span>',a.append(s),window.addEventListener("message",n=>{const r=document.getElementById("mall-frame");r&&n.origin===location.origin&&n.source===r.contentWindow&&n.data?.type==="mall-height"&&Number.isFinite(Number(n.data.h))&&(r.style.height=Math.max(600,Number(n.data.h)+4)+"px")}),window.WG_OPERATOR_MODE=["127.0.0.1","localhost","::1"].includes(location.hostname)&&new URLSearchParams(location.search).get("operator")==="1",document.documentElement.classList.toggle("operator-mode",!!window.WG_OPERATOR_MODE)}function ee(e){return new Promise((a,s)=>{const n=document.createElement("script");n.src="/js/"+e+".js?v=20261112-internal-kline-8",n.onload=()=>a(),n.onerror=()=>s(new Error("界面模块加载失败，请刷新重试")),document.body.append(n)})}async function ae(){for(const r of["account-action-guard","theme","i18n","core","device-id","wallet","portal-shared","page-loader","announcement"])await ee(r);window.Portal?.register("referrals",{load:()=>window.dispatchEvent(new Event("referralrefresh")),reset:()=>window.ReferralRewards?.reset()});const e=window.switchTab;let a=0;window.switchTab=async r=>{if(r==="shareholder"&&(r="partner-plan"),!T[r])return!1;const o=++a;if(["earn","referrals","leaderboard"].includes(r)||await Zt(),o!==a)return!1;const d=await e(r);if(d&&document.getElementById("tab-"+r)?.classList.contains("active")){const i="#/"+r;location.hash!==i&&!location.hash.startsWith(i+"/")&&history.pushState(null,"",i)}return d},window.earnSwitch=r=>{if(r==="team"){window.switchTab("referrals");return}if(r==="shareholder"){window.switchTab("partner-plan");return}history.replaceState(null,"","#/earn/"+r),document.getElementById("tab-earn")?.classList.contains("active")||window.switchTab("earn"),window.dispatchEvent(new CustomEvent("earntabchange",{detail:r}))};const s=document.createElement("script");s.type="module",s.src="/vendor/wallet/connector.js?v=20261111-domain-team-1",document.head.append(s);const n=()=>{const r=location.hash.replace("#/","")||new URLSearchParams(location.search).get("page")||"earn";if(r==="shareholder"||r==="earn/shareholder")return"partner-plan";const o=r.split("/")[0];return T[o]?o:"earn"};window.addEventListener("popstate",()=>{window.switchTab(n())}),await window.switchTab(n()),"serviceWorker"in navigator&&navigator.serviceWorker.register("/sw.js?v=20261112-internal-kline-8").catch(()=>{})}const z=/^-?\d+(?:\.\d+)?$/,J=e=>e.replace(/\B(?=(\d{3})+(?!\d))/g,",");function K(e){if(e==null||e==="")return 0n;if(typeof e=="bigint")return e;const a=String(e).trim();if(!/^-?\d+$/.test(a))throw new Error("金额格式无效："+a);return BigInt(a)}function Q(e,a=18){let s=K(e);const n=s<0n;n&&(s=-s);const r=10n**BigInt(a),o=String(s%r).padStart(a,"0").replace(/0+$/,"");return(n?"-":"")+String(s/r)+(o?"."+o:"")}function Ce(e,a=18){if(!new RegExp("^\\d+(?:\\.\\d{1,"+a+"})?$").test(e))throw new Error("请输入有效数量，最多 "+a+" 位小数");const[s,n=""]=e.split(".");return BigInt(s)*10n**BigInt(a)+BigInt((n+"0".repeat(a)).slice(0,a)||"0")}function Ie(e,a=18,s=2){if(e==null||e==="")return"—";let n=K(e);const r=n<0n;r&&(n=-n);const o=10n**BigInt(a);let d=n/o,i=n%o;if(s>0&&a>s){const l=10n**BigInt(a-s);let u=i/l;i%l*2n>=l&&(u+=1n);const b=10n**BigInt(s);u>=b&&(d+=1n,u-=b),i=u}else s>a?i*=10n**BigInt(s-a):s<=0&&(i*2n>=o&&(d+=1n),i=0n);const c=s>0?String(i).padStart(s,"0").replace(/0+$/,""):"";return(r&&(d>0n||i>0n)?"-":"")+J(String(d))+(c?"."+c:"")}function ne(e,a=2){if(e==null||e==="")return"—";const s=typeof e=="number"?Number.isFinite(e)?String(e):"":String(e).trim();if(!z.test(s))return"—";const n=s.startsWith("-");let[r,o=""]=(n?s.slice(1):s).split("."),d=BigInt(r||"0"),i=o;if(a<=0)i&&i[0]>="5"&&(d+=1n),i="";else if(i.length>a){const c=10n**BigInt(a);let l=BigInt(i.slice(0,a)||"0");i[a]>="5"&&(l+=1n),l>=c&&(d+=1n,l-=c),i=String(l).padStart(a,"0")}else i=i.padEnd(a,"0");return i=i.replace(/0+$/,""),(n&&(d>0n||i)?"-":"")+J(String(d))+(i?"."+i:"")}function Pe(e,a=18){const s=10n**BigInt(a);let n=0n;for(const r of e){const o=String(r??"").trim();if(!z.test(o))continue;const d=o.startsWith("-"),[i,c=""]=(d?o.slice(1):o).split("."),l=(c+"0".repeat(a)).slice(0,a);n+=(d?-1n:1n)*(BigInt(i||"0")*s+BigInt(l||"0"))}return Q(n,a)}function Ne(e,a,s=18){const n=d=>{const i=String(d??"").trim();if(!z.test(i))return null;const c=i.startsWith("-"),[l,u=""]=(c?i.slice(1):i).split("."),b=(u+"0".repeat(s)).slice(0,s);return(c?-1n:1n)*(BigInt(l||"0")*10n**BigInt(s)+BigInt(b||"0"))},r=n(e),o=n(a);return r==null||o==null?"—":Q(r*o/10n**BigInt(s),s)}function Ae(e,a){const s=Number(e),n=Number(a);return!Number.isFinite(s)||!Number.isFinite(n)||n<=0?0:Math.min(100,Math.max(0,s/n*100))}function B(...e){return St(Et(e))}const Le=(e,a=2)=>ne(e,a),_e=e=>e?e.slice(0,6)+"…"+e.slice(-4):"—",Oe=e=>e?new Date(e).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:!1}):"—",se=Tt("ui-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",{variants:{variant:{default:"bg-primary text-primary-foreground hover:bg-primary/90",outline:"border border-border bg-white hover:bg-muted",ghost:"hover:bg-muted text-muted-foreground",secondary:"bg-secondary text-secondary-foreground hover:bg-secondary/80",destructive:"bg-destructive text-white"},size:{default:"h-11 px-5 py-2",sm:"h-9 rounded-lg px-3 text-xs",icon:"size-10 p-0"}},defaultVariants:{variant:"default",size:"default"}}),j=p.forwardRef(({className:e,variant:a,size:s,asChild:n,type:r="button",...o},d)=>{const i=n?mt:"button";return t.jsx(i,{ref:d,type:r,className:B(se({variant:a,size:s}),e),...o})});j.displayName="Button";const Y=gt,Z=ft,tt=wt;function et({className:e,children:a,placement:s="center",...n}){const r=s==="center"?"left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2":s==="bottom"?"ui-sheet-bottom left-0 bottom-0":"left-0 top-0";return t.jsxs(xt,{children:[t.jsx(yt,{className:"ui-dialog-overlay fixed inset-0 z-[1500] bg-slate-950/30 backdrop-blur-sm"}),t.jsxs(kt,{className:B("ui-dialog fixed z-[1501] w-[calc(100%-32px)] max-w-md rounded-3xl border border-border bg-white p-7 shadow-xl",r,e),...n,children:[a,t.jsx(jt,{className:"ui-dialog-close absolute right-5 top-5 rounded-md p-1 text-muted-foreground hover:bg-muted","aria-label":"关闭",children:t.jsx(Bt,{size:18})})]})]})}function re({className:e,...a}){return t.jsx("div",{className:B("ui-card rounded-2xl border border-border bg-card text-card-foreground",e),...a})}function Ue({className:e,...a}){return t.jsx("div",{className:B("flex items-center justify-between gap-4 p-6 pb-4",e),...a})}function ze({className:e,...a}){return t.jsx("h2",{className:B("text-base font-semibold tracking-tight",e),...a})}function Re({className:e,...a}){return t.jsx("div",{className:B("p-6 pt-0",e),...a})}let at=I();const U=new Set;window.addEventListener("walletstatechange",()=>{at=I(),O.cancelQueries({predicate:e=>e.queryKey[0]!=="plans"}),O.removeQueries({predicate:e=>e.queryKey[0]!=="plans"}),U.forEach(e=>e())});function nt(){return p.useSyncExternalStore(e=>(U.add(e),()=>{U.delete(e)}),()=>at)}function Me({title:e,subtitle:a,children:s}){return t.jsxs("div",{className:"rx-heading",children:[t.jsxs("div",{children:[t.jsx("div",{className:"rx-kicker",children:"SOLVEX ECOSYSTEM"}),t.jsx("h1",{children:e}),t.jsx("p",{children:a})]}),t.jsx("div",{className:"rx-heading-actions",children:s})]})}function We({children:e}){return t.jsxs("div",{className:"rx-empty",children:[t.jsx(Ct,{size:28,strokeWidth:1.3}),t.jsx("span",{children:e})]})}function qe({description:e="连接并确认钱包，查看属于你的资产与记录"}={}){return t.jsxs(re,{className:"rx-gate",children:[t.jsx("span",{className:"rx-icon",children:t.jsx(G,{size:24})}),t.jsx("h2",{children:"连接你的钱包"}),t.jsx("p",{children:e}),t.jsxs(j,{onClick:()=>Gt(),children:["连接钱包 ",t.jsx(X,{})]})]})}function Ve({error:e,retry:a}){return t.jsxs("div",{className:"rx-error",role:"alert",children:[t.jsx(It,{size:18}),t.jsx("span",{children:e.message}),t.jsx(j,{variant:"outline",size:"sm",onClick:a,children:"重试"})]})}function f(){return t.jsxs("div",{className:"rx-loading",role:"status",children:[t.jsx(Dt,{className:"animate-spin",size:20}),t.jsx("span",{children:"正在同步数据"})]})}function Fe({label:e,value:a,unit:s,note:n,icon:r}){return t.jsxs("div",{className:"rx-metric",children:[t.jsxs("div",{children:[t.jsx("span",{children:e}),r]}),t.jsxs("strong",{children:[a,t.jsx("small",{children:s})]}),n&&t.jsx("p",{children:n})]})}let _=!1;function Ge(){const e=nt(),a=pt(),[s,n]=p.useState(!1),[r,o]=p.useState(null),d=p.useRef(null),i=p.useRef(!0),c=b=>{d.current?.(b),d.current=null,o(null)};p.useEffect(()=>{c(!1)},[e.address,e.revision]),p.useEffect(()=>(i.current=!0,()=>{i.current=!1,d.current?.(!1),d.current=null}),[]);async function l(b,m,v){if(_)return;if(!e.authenticated){L.error("请先连接并确认钱包");return}_=!0,n(!0);const g=k();try{if(!await new Promise(D=>{d.current=D,o({title:b,description:m})})||g!==k())return;const S=await v();if(g!==k())return;L.success(S),await a.invalidateQueries({predicate:D=>D.queryKey[0]!=="plans"}),window.Portal?.invalidate()}catch(h){g===k()&&L.error(h instanceof Error?h.message:"操作失败")}finally{_=!1,i.current&&n(!1)}}const u=t.jsx(Y,{open:!!r,onOpenChange:b=>{b||c(!1)},children:t.jsxs(et,{children:[t.jsx(Z,{className:"rx-dialog-title",children:r?.title}),t.jsx(tt,{className:"rx-dialog-description",children:r?.description}),t.jsxs("div",{className:"rx-dialog-actions",children:[t.jsx(j,{variant:"outline",onClick:()=>c(!1),children:"取消"}),t.jsx(j,{onClick:()=>c(!0),children:"确认操作"})]})]})});return{run:l,busy:s,dialog:u}}const ie=p.lazy(()=>x(()=>import("./earn-8iwl8Uax.js"),__vite__mapDeps([1,2,3,4,5,6,7,8,9,10,11]),import.meta.url)),oe=p.lazy(()=>x(()=>import("./team-BVwoT6p6.js"),__vite__mapDeps([12,2,3,6,4,5,7,8,9,10]),import.meta.url)),de=p.lazy(()=>x(()=>import("./assets-BgzBU3AH.js"),__vite__mapDeps([13,2,3,6,9,5,10,8]),import.meta.url)),le=p.lazy(()=>x(()=>import("./ranking-BOdiVE_C.js"),__vite__mapDeps([14,2,3,8,9,6,5,10]),import.meta.url)),ce=p.lazy(()=>x(()=>import("./support-CXzJiqDz.js"),__vite__mapDeps([15,2,3,6,9,5,10,8]),import.meta.url)),pe=p.lazy(()=>x(()=>import("./community-chat-De8bfuBh.js"),__vite__mapDeps([16,2,6,8,3,9,5,10,17]),import.meta.url)),ue=p.lazy(()=>x(()=>import("./ai-managed-Da2hJBv5.js"),__vite__mapDeps([18,2,3,6,9,5,10,8]),import.meta.url)),be=p.lazy(()=>x(()=>import("./partner-plan-Ehyh5sP8.js"),__vite__mapDeps([19,2,3,4,5,8,9,6,10,20]),import.meta.url)),st=[{page:"earn",Icon:At},{page:"mall",Icon:Lt},{page:"trade",Icon:_t},{page:"community-chat",Icon:Ot},{page:"a-token-trade",Icon:Ut},{page:"leaderboard",Icon:zt},{page:"referrals",Icon:Rt},{page:"account",Icon:G},{page:"ai-managed",Icon:Mt},{page:"support",Icon:Wt},{page:"partner-plan",Icon:qt}],ve={__html:'<button type="button" id="lang-toggle" aria-label="切换语言" title="切换语言">🌐</button>'},he={__html:'<div class="wallet-control"><button type="button" id="wallet-connect-btn" class="wallet-connect" aria-haspopup="menu" aria-expanded="false" onclick="handleWalletButton(this)">连接钱包</button><div id="wallet-account-menu" class="wallet-account-menu" role="menu" hidden><button id="wallet-menu-auth" type="button" role="menuitem" class="primary" onclick="verifyWalletFromMenu(this)">身份验证</button><button type="button" role="menuitem" onclick="openWalletAccount()">钱包资金</button><button type="button" role="menuitem" class="danger" onclick="disconnectWallet()">断开钱包</button></div></div>'};class y extends p.Component{state={failed:!1};static getDerivedStateFromError(){return{failed:!0}}componentDidCatch(a,s){console.error("页面渲染失败",a,s.componentStack)}render(){return this.state.failed?t.jsxs("div",{className:"rx-page rx-error",children:[t.jsx("span",{children:"页面暂时无法显示，请刷新重试。"}),t.jsx(j,{onClick:()=>location.reload(),children:"刷新页面"})]}):this.props.children}}function F({page:e,close:a}){const s=n=>{a?.(),n==="trade"?window.openTradePage("spot"):window.switchTab(n)};return t.jsxs(t.Fragment,{children:[t.jsx("div",{className:"rx-nav-label",children:"探索生态"}),t.jsx("nav",{className:"rx-nav","aria-label":"主导航",children:st.map((n,r)=>t.jsxs("div",{children:[(r===6||r===8)&&t.jsx("div",{className:"rx-nav-separator"}),t.jsxs("button",{type:"button",className:e===n.page?"is-active":"","aria-current":e===n.page?"page":void 0,"data-nav-page":n.page,onClick:()=>s(n.page),children:[t.jsx(n.Icon,{size:19,strokeWidth:1.7}),t.jsx("span",{children:T[n.page]}),e===n.page&&t.jsx("span",{className:"rx-nav-dot"})]})]},n.page))}),window.WG_OPERATOR_MODE&&t.jsx("nav",{className:"rx-nav","aria-label":"本地运营工具",children:["portfolio","vaults","staking","ledger","ai"].map(n=>t.jsx("button",{onClick:()=>s(n),children:T[n]},n))}),t.jsxs("div",{className:"rx-sidebar-bottom",children:[t.jsxs("div",{className:"rx-sidebar-help",children:[t.jsx(Ft,{size:23,strokeWidth:1.5}),t.jsx("strong",{children:"我们随时为你提供帮助"}),t.jsx("p",{children:"探索 Solvex，轻松开始。"}),t.jsxs("button",{onClick:()=>s("support"),children:["联系在线客服 ",t.jsx(X,{size:14})]})]}),t.jsxs("div",{className:"rx-sidebar-foot",children:[t.jsx("span",{children:"Solvex Ecosystem"}),t.jsxs("span",{children:["© ",new Date().getFullYear()]})]})]})]})}function me(){const[e,a]=p.useState("earn"),[s,n]=p.useState(!1),[r,o]=p.useState(""),[d,i]=p.useState(!1),c=nt();return p.useEffect(()=>{const l=u=>{const b=u.detail.current;a(b),i(!1),document.body.dataset.page=b};return window.addEventListener("pagechange",l),window.solvexRuntimeReady.then(()=>n(!0)).catch(u=>o(u.message)),()=>window.removeEventListener("pagechange",l)},[]),t.jsxs(t.Fragment,{children:[t.jsxs("aside",{className:"rx-sidebar",inert:!s,children:[t.jsxs("a",{className:"rx-brand",href:"#/earn",onClick:l=>{l.preventDefault(),window.switchTab("earn")},children:[t.jsx("img",{src:"/assets/brand/logo.svg",alt:""}),t.jsxs("strong",{children:["Solvex",t.jsx("span",{children:"A NEW ERA OF VALUE"})]})]}),t.jsx(F,{page:e})]}),t.jsxs("header",{className:"rx-topbar",children:[t.jsxs("div",{className:"rx-topbar-left",children:[t.jsx(j,{className:"rx-mobile-menu",variant:"ghost",size:"icon","aria-label":"打开导航",disabled:!s,onClick:()=>i(!0),children:t.jsx(Pt,{})}),t.jsxs("span",{className:"rx-topbar-brand",children:[t.jsx("img",{src:"/assets/brand/logo.svg",alt:""}),t.jsx("span",{children:"Solvex"})]}),t.jsxs("span",{className:"rx-breadcrumb",children:["生态空间 ",t.jsx(Nt,{size:13}),t.jsx("strong",{children:T[e]})]})]}),t.jsxs("div",{className:"rx-topbar-right",children:[t.jsxs("span",{className:"rx-session-state",children:[t.jsx("span",{className:"rx-status-dot "+(c.authenticated?"is-live":"")}),c.authenticated?"钱包已验证":"探索 Solvex"]}),t.jsx("div",{className:"rx-locale",inert:!s,dangerouslySetInnerHTML:ve}),t.jsx("div",{className:"rx-wallet",inert:!s,dangerouslySetInnerHTML:he})]})]}),t.jsx(Y,{open:d,onOpenChange:i,children:t.jsxs(et,{placement:"left",className:"rx-mobile-sheet",children:[t.jsx(Z,{className:"rx-mobile-brand",children:"Solvex"}),t.jsx(tt,{className:"sr-only",children:"选择要前往的功能"}),t.jsx(F,{page:e,close:()=>i(!1)})]})}),r&&t.jsxs("div",{className:"rx-runtime-error",role:"alert",children:[t.jsx("span",{children:r}),t.jsx(j,{onClick:()=>location.reload(),children:"重新加载"})]}),!s&&!r&&t.jsx("div",{className:"rx-startup",children:t.jsx(f,{})}),s&&e==="earn"&&w.createPortal(t.jsx(y,{children:t.jsx(p.Suspense,{fallback:t.jsx(f,{}),children:t.jsx(ie,{})})}),document.getElementById("tab-earn")),s&&e==="referrals"&&w.createPortal(t.jsx(y,{children:t.jsx(p.Suspense,{fallback:t.jsx(f,{}),children:t.jsx(oe,{})})}),document.getElementById("tab-referrals")),s&&e==="account"&&w.createPortal(t.jsx(y,{children:t.jsx(p.Suspense,{fallback:t.jsx(f,{}),children:t.jsx(de,{})})}),document.getElementById("tab-account")),s&&e==="leaderboard"&&w.createPortal(t.jsx(y,{children:t.jsx(p.Suspense,{fallback:t.jsx(f,{}),children:t.jsx(le,{})})}),document.getElementById("tab-leaderboard")),s&&e==="support"&&w.createPortal(t.jsx(y,{children:t.jsx(p.Suspense,{fallback:t.jsx(f,{}),children:t.jsx(ce,{})})}),document.getElementById("tab-support")),s&&e==="community-chat"&&w.createPortal(t.jsx(y,{children:t.jsx(p.Suspense,{fallback:t.jsx(f,{}),children:t.jsx(pe,{})})}),document.getElementById("tab-community-chat")),s&&e==="ai-managed"&&w.createPortal(t.jsx(y,{children:t.jsx(p.Suspense,{fallback:t.jsx(f,{}),children:t.jsx(ue,{})})}),document.getElementById("tab-ai-managed")),s&&e==="partner-plan"&&w.createPortal(t.jsx(y,{children:t.jsx(p.Suspense,{fallback:t.jsx(f,{}),children:t.jsx(be,{})})}),document.getElementById("tab-partner-plan")),t.jsx("nav",{className:"rx-mobile-dock","aria-label":"快捷导航",inert:!s,children:st.filter(l=>["earn","trade","community-chat","referrals","account"].includes(l.page)).map(l=>t.jsxs("button",{"aria-current":e===l.page?"page":void 0,onClick:()=>l.page==="trade"?void window.openTradePage("spot"):void window.switchTab(l.page),children:[t.jsx(l.Icon,{size:20,strokeWidth:1.6}),t.jsx("span",{children:l.page==="account"?"资产":T[l.page]})]},l.page))}),t.jsx(ht,{position:"top-center",richColors:!0,closeButton:!0}),t.jsxs("div",{className:"rx-page-tail","aria-hidden":"true",children:[t.jsx(Vt,{size:14})," SOLVEX / CONNECT. TRADE. EXPLORE."]})]})}document.body.classList.add("solvex-react");te();let rt,it;window.solvexRuntimeReady=new Promise((e,a)=>{rt=e,it=a});w.flushSync(()=>lt.createRoot(document.getElementById("root")).render(t.jsx(ut,{client:O,children:t.jsx(me,{})})));ae().then(()=>rt()).catch(e=>it(e));export{Ee as A,j as B,re as C,Y as D,We as E,Se as F,qe as G,De as H,Te as I,f as L,Fe as M,Me as P,x as _,Q as a,Ie as b,B as c,et as d,Z as e,ne as f,tt as g,Jt as h,Ge as i,Ue as j,ze as k,Re as l,Oe as m,Le as n,Ve as o,Be as p,Gt as q,$ as r,Pe as s,Ce as t,nt as u,_e as v,k as w,Ae as x,Zt as y,Ne as z};
