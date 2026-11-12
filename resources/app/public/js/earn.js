(() => {
  // 一次性迁移：旧品牌 axix_activation_* 的激活重试状态 → solvex_activation_*，避免升级后丢失未确认的激活。
  (function migrateLegacyActivationStorage() {
    try {
      const renames = {
        'axix_activation_retry_v1': 'solvex_activation_retry_v1',
        'axix_activation_aix_request_v1': 'solvex_activation_svx_request_v1',
      };
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('axix_activation_')) continue;
        const sep = key.indexOf(':');
        const base = sep === -1 ? key : key.slice(0, sep);
        const suffix = sep === -1 ? '' : key.slice(sep);
        const next = renames[base];
        if (!next) continue;
        const value = localStorage.getItem(key);
        if (value != null && localStorage.getItem(next + suffix) == null) localStorage.setItem(next + suffix, value);
        localStorage.removeItem(key);
      }
    } catch {}
  })();
  const P = Portal;
  const levelColors = ['#64748b','#0f766e','#0284c7','#4f46e5','#7c3aed','#a21caf','#be185d','#c2410c','#a16207','#15803d','#b91c1c'];
  const levelColor = level => levelColors[Math.max(0, Math.min(10, Number(level) || 0))];
  let currentSubTab = 'miner';
  let plansCache = null;
  let profileCache = null;
  let teamCache = null;
  let shareholderCache = null;
  let blindBoxCache = null;
  let refProfileCache = null;
  let plansRequest = null;
  const readRequests = new Map();
  // 加载失效序号：钱包连接/登录完成会强制重载本页，旧加载即使仍在请求中也不得再写 DOM，
  // 否则慢网下旧加载结束时会把游客态覆盖到新的已登录内容上。
  let loadSeq = 0;

  // profile 数据 stale-while-revalidate 缓存：二次进站秒开矿机/团队数据，后台静默更新。
  // 两分钟上限：只供首屏展示，每次进入仍刷新接口。
  const PROFILE_CACHE_KEY = 'solvex:profile:model-v3';
  const PROFILE_CACHE_MAX_MS = 120_000;
  function readProfileCache(addr) {
    try {
      const raw = localStorage.getItem(PROFILE_CACHE_KEY);
      if (!raw) return null;
      const { t, addr: cachedAddr, data } = JSON.parse(raw);
      if (!data || !Number.isFinite(t) || Date.now() - t > PROFILE_CACHE_MAX_MS) return null;
      // 必须有地址且完全匹配才命中：防止不同钱包看到别人的数据
      if (!addr || !cachedAddr || cachedAddr.toLowerCase() !== addr.toLowerCase()) return null;
      return data;
    } catch { return null; }
  }
  function writeProfileCache(addr, data) {
    try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ t: Date.now(), addr, data })); } catch {}
  }
  function clearProfileCache() {
    try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
  }

  // 钱包内置 DApp 浏览器经 Cloudflare 时常握手挂起：所有请求带超时，避免无限等待。
  // 手动 AbortController（不依赖 AbortSignal.timeout，兼容老内核 webview）。
  const fetchWithTimeout = async (url, options, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => { try { controller.abort(); } catch {} }, timeoutMs);
    try {
      return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('网络较慢，请求超时，请稍后重试');
      throw new Error('网络连接失败，请检查网络后重试');
    } finally { clearTimeout(timer); }
  };
  const api = async (path, options = {}, timeoutMs = 15000) => {
    const response = await fetchWithTimeout(`/api/a-token/${path}`, options, timeoutMs);
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('矿机服务暂时不可用，请稍后重试'); }
    if (!response.ok) throw Object.assign(new Error(payload.error || 'SVX 代币服务请求失败'), { status: response.status, code: payload.code });
    return payload;
  };
  const authApi = async (path, options = {}, timeoutMs = 15000) => {
    if (!window.currentWalletProfile?.authenticated && window.currentWalletConnection?.address
      && typeof ensurePlatformSession === 'function') await ensurePlatformSession();
    if (!window.currentWalletProfile?.authenticated) throw new Error('SESSION_REQUIRED');
    return api(path, options, timeoutMs);
  };
  function readEarnData(path, timeoutMs = 10000) {
    const key = `${String(window.currentWalletConnection?.address || '').toLowerCase()}:${path}`;
    if (readRequests.has(key)) return readRequests.get(key);
    const request = authApi(path, {}, timeoutMs).finally(() => {
      if (readRequests.get(key) === request) readRequests.delete(key);
    });
    readRequests.set(key, request);
    return request;
  }
  function readTeamCounts() {
    const address = window.currentWalletConnection?.address;
    return readEarnData('team/summary', 8000).catch(error => {
      // 升级期间，仍运行旧接口的本地/线上服务可以继续显示人数。
      if (![404, 405].includes(error.status) || !window.currentWalletProfile?.authenticated
        || window.currentWalletConnection?.address !== address) throw error;
      return readEarnData('team/profile');
    });
  }
  function teamData() {
    if (!profileCache?.teamLevel && !teamCache) return null;
    return { ...profileCache?.teamLevel, ...teamCache };
  }
  function saveCurrentProfile(address) {
    if (profileCache) writeProfileCache(address, { ...profileCache, teamLevel: teamData() });
  }
  function renderUpdatedData() {
    // 后台返回数据不能清空正在编辑的质押表单。
    if (!document.activeElement?.closest('input, select, textarea') && !document.getElementById('earn-stake-modal')) return renderSubTab();
  }
  const fmt = (v, d = 4) => Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: d }) : '0';
  const fmtA = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : '0.00'; };
  // 前端单位清洗：把文本中所有「N A」或「NA」连写的旧单位标签替换成「N SVX」。
  // 仅用于显示层，不改动数值、不做换算，保持 fmtA(v) 原值 1:1。
  const cleanSvxText = (s) => {
    if (s == null) return s;
    let t = String(s);
    // 浮点/整数 + 可选空格 + A，后面不是 X 或 I（避免误改 SVX、SVX 缩写）
    t = t.replace(/(\d+\.?\d*)\s*A(?![XI])/g, '$1 SVX');
    // 修掉前一次替换后可能产生的 SVXIX 重复（防双替换保护）
    t = t.replace(/SVXIX/g, 'SVX');
    return t;
  };
  const timeLeft = (ms) => {
    if (!ms || ms <= 0) return '已到期';
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    if (d > 0) return `${d}天${h}小时`;
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}小时${m}分`;
  };
  const escapeHtml = P.esc;
  const shortAddr = (a) => {
    if (!a) return '—';
    const s = String(a);
    return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
  };

  // 激活页顶部：参考设计 —— 我的上级地址 + 直推/团队人数大卡片 + 邀请链接
  function teamSummaryCard() {
    const team = teamData();
    const directCount = team?.directCount;
    const teamCount = team?.teamCount;
    const referrer = team?.directReferrer || null;
    const referrerHtml = referrer
      ? `<code title="${escapeHtml(referrer)}" class="ts-upline-addr">${escapeHtml(shortAddr(referrer))}</code>`
      : `<span class="ts-upline-none">${teamCount == null ? '加载中…' : '无推荐人'}</span>`;
    const refLink = refProfileCache?.code ? earnRefLink() : '';
    const inviteHtml = refLink
      ? `<div class="ts-invite">
          <span class="ts-invite-label">🔗 我的邀请链接</span>
          <div class="ts-invite-row">
            <code class="ts-invite-link" title="${escapeHtml(refLink)}">${escapeHtml(refLink)}</code>
            <button class="ts-invite-btn" onclick="window.earnCopyLink()">复制</button>
          </div>
        </div>`
      : '';
    return `
      <div class="ts-hero-card">
        <div class="ts-hero-top">
          <div class="ts-upline">
            <span class="ts-upline-label">我的上级</span>
            ${referrerHtml}
          </div>
        </div>
        <div class="ts-stat-grid">
          <div class="ts-stat-cell">
            <div class="ts-stat-num">${directCount == null ? '—' : Number(directCount).toLocaleString()}<small>人</small></div>
            <div class="ts-stat-label">直推人数</div>
            <span class="ts-stat-icon">👥</span>
          </div>
          <div class="ts-stat-cell">
            <div class="ts-stat-num">${teamCount == null ? '—' : Number(teamCount).toLocaleString()}<small>人</small></div>
            <div class="ts-stat-label">团队人数</div>
            <span class="ts-stat-icon">🌐</span>
          </div>
        </div>
        ${inviteHtml}
      </div>`;
  }

  // 直推明细列表：参考设计的紧凑卡片式列表
  function directReferralList() {
    const team = teamData();
    const directs = team?.directs || [];
    if (!Array.isArray(team?.directs) && Number(team?.directCount) > 0) {
      return '<div class="ts-empty">直推明细可在<button type="button" onclick="window.earnSwitch(\'team\')">团队页面</button>查看</div>';
    }
    if (directs.length === 0) {
      return `<div class="ts-empty">暂无直推用户，分享邀请链接邀请好友加入</div>`;
    }
    const rows = directs.slice(0, 30).map(d => {
      const lvlColor = levelColor(d.level);
      const lvlText = d.level > 0 ? 'A' + d.level : '未达标';
      return `
        <div class="dr-row">
          <div class="dr-avatar">${d.wallet ? String(d.wallet).slice(2, 4).toUpperCase() : '??'}</div>
          <div class="dr-info">
            <code class="dr-addr" title="${escapeHtml(d.wallet || '')}">${escapeHtml(d.shortAddress || shortAddr(d.wallet))}</code>
            <div class="dr-meta">
              <span class="dr-lvl" style="color:${lvlColor}">${lvlText}</span>
              <span class="dr-mine">${d.minerCount || 0} 台矿机</span>
              <span class="dr-bal">${fmtA(d.personalA)} SVX</span>
            </div>
          </div>
        </div>`;
    }).join('');
    return `
      <div class="dr-list">
        ${rows}
      </div>`;
  }

  function render() {
    if (window.WG_REACT_APP) {
      const legacy = document.getElementById('react-earn-legacy');
      if (legacy) legacy.innerHTML = '<div id="earn-content"></div>';
      return;
    }
    const root = document.getElementById('tab-earn');
    root.innerHTML = `<div class="portal-shell earn-shell">
      ${P.header('矿池', '探索 SVX 生态，管理你的每一份资产', '<button type="button" class="portal-button" onclick="switchTab(\'account\')">我的资产 <span aria-hidden="true">↗</span></button>')}
      <div class="earn-sub-tabs">
        <button class="earn-sub-tab${currentSubTab === 'miner' ? ' active' : ''}" onclick="window.earnSwitch('miner')">矿池</button>
        <button class="earn-sub-tab${currentSubTab === 'pending' ? ' active' : ''}" onclick="window.earnSwitch('pending')">待领取</button>
        <button class="earn-sub-tab${currentSubTab === 'staking' ? ' active' : ''}" onclick="window.earnSwitch('staking')">能量</button>
        <button class="earn-sub-tab${currentSubTab === 'shareholder' ? ' active' : ''}" onclick="window.earnSwitch('shareholder')">股东</button>
        <button class="earn-sub-tab${currentSubTab === 'blindbox' ? ' active' : ''}" onclick="window.earnSwitch('blindbox')">盲盒</button>
        <button class="earn-sub-tab earn-sub-tab--matchpool${currentSubTab === 'matchpool' ? ' active' : ''}" onclick="window.earnSwitch('matchpool')">超速驱动协议</button>
      </div>
      <div id="earn-content">${P.loading(6)}</div>
    </div>`;
  }

  // ── 矿机总览（仅在「矿机」tab 内展示） ──
  const fmtNum = (s, digits = 2) => { const n = Number(s || '0'); return isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : '0'; };

  function poolOverviewHtml() {
    const authed = !!window.currentWalletProfile?.authenticated;
    if (!authed) {
      return `<div class="pool-overview">
          <div class="pool-section">
            <div class="pool-section-title">⛏ 我的矿机总览</div>
            <div class="ev2-empty" style="padding:18px">连接钱包并登录平台后，这里只显示你自己的矿机数据</div>
          </div>
        </div>`;
    }
    const miners = profileCache?.miners || [];
    const active = miners.filter(m => m.status === 'active');
    const sum = (arr, field) => arr.reduce((s, m) => s + Number(m[field] || 0), 0);
    const mActive = active.length;
    const mHashrate = sum(active, 'dailyTarget');
    const mToday = sum(miners, 'dayEarned');
    const mPlanned = sum(active, 'remaining');
    const mLifetime = sum(miners, 'totalEarned');
    const mTeamTotal = teamData()?.totalEarnedA;
    return `
      <div class="pool-overview">
        <div class="pool-section">
          <div class="pool-section-title">⛏ 我的矿机总览</div>
          <div class="pool-grid">
            <div class="pool-cell">
              <div class="pool-cell-label">我的活跃矿机</div>
              <div class="pool-cell-value">${mActive} <small>台</small></div>
            </div>
            <div class="pool-cell">
              <div class="pool-cell-label">我的算力</div>
              <div class="pool-cell-value" style="color:var(--brand)">${fmtNum(mHashrate, 2)} <small>SVX/日</small></div>
            </div>
            <div class="pool-cell">
              <div class="pool-cell-label">今日已到账</div>
              <div class="pool-cell-value" style="color:var(--brand)">${fmtNum(mToday, 2)} <small>SVX</small></div>
            </div>
            <div class="pool-cell">
              <div class="pool-cell-label">运行中待产出</div>
              <div class="pool-cell-value" style="color:#d9b06b">${fmtNum(mPlanned, 2)} <small>SVX</small></div>
            </div>
            <div class="pool-cell">
              <div class="pool-cell-label">累计已到账</div>
              <div class="pool-cell-value">${fmtNum(mLifetime, 2)} <small>SVX</small></div>
            </div>
            <div class="pool-cell">
              <div class="pool-cell-label">累计团队分润</div>
              <div class="pool-cell-value" style="color:#d9b06b">${mTeamTotal == null ? '—' : fmtNum(mTeamTotal, 2)} <small>SVX</small></div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function refreshPoolOverview() {
    const host = document.getElementById('miner-pool-overview');
    if (!host) return;
    try {
      host.innerHTML = poolOverviewHtml();
    } catch (e) {
      host.innerHTML = `<div class="ev2-empty" style="padding:18px">矿机数据加载失败：${escapeHtml(e.message || e)}</div>`;
    }
  }

  let poolOverviewTimer = null;
  let earnRefreshBusy = false;
  function startPoolOverviewAutoRefresh() {
    if (poolOverviewTimer) clearInterval(poolOverviewTimer);
    // 每分钟获取最新到账数据；表单操作期间不重绘，避免清空用户输入。
    poolOverviewTimer = setInterval(async () => {
      if (document.hidden) return;
      if (!document.getElementById('tab-earn')?.classList.contains('active')) return;
      if (!window.currentWalletProfile?.authenticated || earnRefreshBusy) return;
      if (!['miner', 'matchpool'].includes(currentSubTab)) return;
      if (document.activeElement?.closest('input, select, textarea')) return;
      earnRefreshBusy = true;
      try {
        await load();
      } catch {} finally { earnRefreshBusy = false; }
    }, 60_000);
  }

  // ── 套餐配置 stale-while-revalidate：先用 localStorage 旧数据立即渲染，后台拉新覆盖 ──
  // plans 为准静态配置（套餐/开关），缓存上限 24h；开关类状态以后端接口实际返回为准（后端强制拦截）
  const PLANS_CACHE_KEY = 'solvex:plans:model-v3';
  const PLANS_CACHE_MAX_MS = 86_400_000;
  function readPlansCache() {
    try {
      const raw = localStorage.getItem(PLANS_CACHE_KEY);
      if (!raw) return null;
      const { t, data } = JSON.parse(raw);
      if (!data || !Number.isFinite(t) || Date.now() - t > PLANS_CACHE_MAX_MS) return null;
      return data;
    } catch { return null; }
  }
  function writePlansCache(data) {
    try { localStorage.setItem(PLANS_CACHE_KEY, JSON.stringify({ t: Date.now(), data })); } catch {}
  }

  // plans 是准静态套餐配置；弱网完全拉不到时用内置兜底先渲染，激活开关以后端实际拦截为准。
  const FALLBACK_PLANS = {
    activation: [
      { plan: '1', minerPlan: 'mini120', svx: '20', name: 'Mini 矿机', label: '20 SVX · Mini 矿机 · 100 SVX / 30天 · 每钱包终身一次' },
      { plan: '2', minerPlan: 'pro1500', svx: '400', name: 'Pro 矿机', label: '400 SVX · Pro 矿机 · 1500 SVX / 90天 · 激活无上限' }
    ],
    activationMeta: { cap: null, unlimited: true, activatedCount: 0 },
    paymentMode: 'svx_balance',
    collectionAddress: '',
    chainId: 56,
    confirmations: 12,
    activationEnabled: true,
    withdrawEnabled: false,
    staking: [
      { planId: 'energy', label: '能量', days: 100, dailyRateBps: 100, flexible: false, energy: true, minCoins: '0' }
    ],
    miner: [ { plan: 'mini120', days: 30 }, { plan: 'pro1500', days: 90 } ],
    _fallback: true
  };
  // 单次 8s 超时，失败再试一次；仍失败由调用方决定是否启用兜底。
  const fetchPlansFresh = () => api('plans', {}, 8000).catch(() => api('plans', {}, 8000));
  function refreshPlansInBackground() {
    if (plansRequest) return plansRequest;
    plansRequest = fetchPlansFresh().then(fresh => {
      plansCache = fresh;
      writePlansCache(fresh);
      if (document.getElementById('tab-earn')?.classList.contains('active')
        && !document.activeElement?.closest('input, select, textarea')) renderSubTab();
    }).catch(() => { if (plansCache?._fallback) startPlansRetry(); })
      .finally(() => { plansRequest = null; });
    return plansRequest;
  }
  let plansRetryTimer = null;
  function startPlansRetry() {
    if (plansRetryTimer) return;
    let tries = 0;
    plansRetryTimer = setInterval(async () => {
      tries += 1;
      if (tries > 10 || !plansCache?._fallback) { clearInterval(plansRetryTimer); plansRetryTimer = null; return; }
      try {
        const fresh = await api('plans', {}, 8000);
        plansCache = fresh;
        writePlansCache(fresh);
        clearInterval(plansRetryTimer);
        plansRetryTimer = null;
        if (document.getElementById('tab-earn')?.classList.contains('active')
          && !document.activeElement?.closest('input, select, textarea')) renderSubTab();
      } catch {}
    }, 15000);
  }
  // 弱网提示：仅在使用内置兜底数据时出现，低调灰色小字，避免引起用户担心
  function slowNetworkNotice() {
    if (!plansCache?._fallback) return '';
    return '<div style="margin:0 0 10px;text-align:center;font-size:11px;color:var(--mut);opacity:.75;line-height:1.5">正在更新矿机方案，付款前会核对最新配置</div>';
  }

  async function load() {
    const seq = ++loadSeq;
    const stale = () => seq !== loadSeq;
    const host = document.getElementById('earn-content');
    if (!host) return;
    // 矿机/团队统计每分钟更新一次。
    startPoolOverviewAutoRefresh();
    try {
      if (!plansCache) {
        // Render immediately; the two network attempts may take 16 seconds on a weak connection.
        plansCache = readPlansCache() || Object.assign({}, FALLBACK_PLANS);
        refreshPlansInBackground();
      }
    } catch (e) {
      if (!stale()) host.innerHTML = P.error(e.message, "Portal.load('earn',true)");
      return;
    }
    // 已被更新的加载取代：静默退出，不再写 DOM。
    if (stale()) return;

    // 已登录：拉取个人数据后渲染。
    if (window.currentWalletProfile?.authenticated) {
      retryPendingActivation();
      retrySvxActivation(); // 使用同一请求编号恢复未确认的 SVX 激活。
      // 先用 localStorage 缓存秒渲染，避免等待 API 时白屏
      const cachedProfile = readProfileCache(window.currentWalletConnection?.address);
      if (cachedProfile) {
        profileCache = cachedProfile;
        if (!teamCache) teamCache = cachedProfile.teamLevel || null;
      }
      // 先展示最新钱包状态，个人数据在后台刷新，不能把旧游客按钮留到请求结束。
      await renderSubTab();
      try {
        const address = window.currentWalletConnection?.address;
        const stillCurrent = () => !stale() && window.currentWalletProfile?.authenticated
          && window.currentWalletConnection?.address === address;
        const update = apply => async data => {
          if (!stillCurrent() || !data) return;
          apply(data);
          saveCurrentProfile(address);
          await renderUpdatedData();
        };
        // 人数与矿机各自返回即显示，不等待团队明细或邀请链接。
        const requests = [
          readEarnData('profile').then(update(data => { profileCache = data; })),
          readTeamCounts().then(update(data => { if (!data.error) teamCache = { ...teamCache, ...data }; })),
        ];
        if (currentSubTab === 'shareholder') {
          requests.push(readEarnData('shareholder', 10000).then(update(data => {
            if (!data.error) shareholderCache = data;
          })));
        }
        if (currentSubTab === 'blindbox') {
          requests.push(readEarnData('blindbox', 10000).then(update(data => {
            if (!data.error) blindBoxCache = data;
          })));
        }
        await Promise.allSettled(requests);
        return;
      } catch (e) {
        if (stale()) return;
        if (e.message === 'SESSION_REQUIRED') {
          // 登录态已失效：落到游客渲染
        } else {
          // profile 超时/失败不白屏：以空数据渲染，激活按钮可见；付款前有二次状态校验防重复支付
          profileCache = null;
          await renderSubTab();
          return;
        }
      }
    }

    // 未登录（含「已连接未签名」）：立即渲染游客内容，绝不阻塞等待可能很慢的签名登录。
    // 钱包初始化会自动发起登录；登录成功后 wallet.js refreshWalletDependents 强制重载本页，
    // 自动切换为已登录视图；用户也可直接点卡片上的按钮触发连接/签名，完成后同样自动刷新。
    profileCache = null;
    teamCache = null;
    shareholderCache = null;
    refProfileCache = null;
    if (!stale()) await renderSubTab();
  }

  // ── 浏览模式（游客） ──
  function renderGuestContent() {
    // 游客也可以先看矿池与质押布局；未连接钱包时只隐藏个人数据。
    if (currentSubTab === 'miner') {
      return renderNodes().replace('<button type="button" class="btn-stake" id="node-open-btn" style="margin-top:14px">开通矿池</button>', '<button type="button" class="btn-stake" style="margin-top:14px;opacity:.5;pointer-events:none">连接钱包后开通</button>');
    }
    if (currentSubTab === 'pending') {
      return '<div class="portal-gate"><strong>待领取</strong><span>连接并确认钱包后查看待领取收益与倒计时</span><button onclick="openPlatformAccount(this)">确认钱包</button></div>';
    }
    if (currentSubTab === 'shareholder') {
      return '<div class="portal-gate"><strong>股东分红</strong><span>连接并确认钱包后查看股东身份、分红资格与分池进度</span><button onclick="openPlatformAccount(this)">确认钱包</button></div>';
    }
    const stakePlans = plansCache?.staking || [];

    const walletConnected = Boolean(window.currentWalletConnection?.address);
    const walletConnectedHint = walletConnected
      ? '<div class="earn-wallet-hint" style="margin:0 0 10px;padding:10px 12px;border:1px solid rgba(14,156,136,.24);border-radius:10px;background:rgba(14,156,136,.08);color:#2f887d;text-align:center;font-size:12px">钱包已连接 · 请在钱包中确认身份后查看个人数据<button type="button" onclick="openPlatformAccount(this)" style="display:block;margin:8px auto 0;padding:7px 16px;border:1px solid #50d2c2;border-radius:8px;background:transparent;color:inherit;font:inherit">确认钱包</button></div>'
      : '';
    const stakeCards = stakePlans.map(p => stakeCardHtml(p, false)).join('');


    return `
      ${walletConnectedHint}
      <div class="earn-v2-head-banner">
        <h2>🎉 SVX 代币赚取生态 · 矿池 · 质押赚收益</h2>
        <p>买币进蓄能额度 · 蓄能额度开通矿池或质押 · 到期手动领取</p>
      </div>

      ${slowNetworkNotice()}

      <div class="cap-wrap"><div class="cap-title">矿池<small>蓄能额度币建仓 · 每日领取利息</small></div><p style="margin:8px 0 0;color:var(--mut);font-size:12px">节点不单独卖套餐：先在交易页买币进蓄能额度，再用蓄能额度币开通；蓄能额度币托管、到期返本息（不销毁），产出进入「待领取」，次日 UTC 00:00（北京 08:00）未领作废</p></div>

      <div class="earn-activation-v2-grid">${plansCache?.nodes ? `<div class="cap-card"><h3>${plansCache.nodes.days} 天</h3><p>${plansCache.nodes.lowRatePct}% / ${plansCache.nodes.midRatePct}% / ${plansCache.nodes.highRatePct}% 三档</p><small>门槛 ${plansCache.nodes.minCoins} 币起，按币数判档</small></div>` : P.empty('暂无矿池档位')}</div>

      <div class="portal-section" style="border-radius:14px;overflow:hidden">
        <div class="portal-section-head"><h2>能量释放</h2><span>每天释放原额度1%，释放完结束</span></div>
        <div class="stake-v2-grid" style="padding:16px">${stakeCards || P.empty('暂无质押套餐')}</div>
      </div>

      ${walletConnected
        ? '<div class="portal-gate"><strong>钱包已连接</strong><span>钱包已连接 · 请在钱包中确认身份后查看个人数据</span><button onclick="openPlatformAccount(this)">确认钱包</button></div>'
        : P.walletGate('连接并确认钱包后查看矿池、质押记录和团队数据')}
    `;
  }

  // ── 卡片构造 ──
  function activationCardHtml(p, showButton = true) {
    const isMini = p.plan === '1';
    const cls = isMini ? 'mini' : 'pro';
    const daily = isMini ? '3.33' : '16.67';
    const total = isMini ? '100' : '1500';
    const days = isMini ? '30' : '90';
    // Pro 卡片在「有效期」后显示 SVX 余额与可购台数（未登录显示占位）
    const balA = profileCache?.balances?.A;
    const maxBuy = balA != null ? Math.floor(Number(balA) / Number(p.svx)) : null;
    const balanceStats = isMini ? '' : `
            <div class="stat-item"><span>SVX 余额</span><strong>${balA != null ? fmtA(balA) + ' SVX' : '登录后可见'}</strong></div>
            <div class="stat-item"><span>可购台数</span><strong>${maxBuy == null ? '—' : (maxBuy > 0 ? maxBuy + ' 台' : '余额不足')}</strong></div>`;
    // Mini 包含历史激活与赠送，终身一次；Pro 始终支持再次激活。
    const myAct = isMini ? (profileCache?.activations || []).find(a => String(a.plan) === '1' && a.status !== 'rejected') : null;
    const miniOwned = isMini && (profileCache?.miners || []).some(m => m.plan === 'mini120');
    const activationEnabled = plansCache?.activationEnabled !== false;
    let btnHtml;
    if (!activationEnabled) {
      btnHtml = `<button class="btn-activate" style="pointer-events:none;opacity:.55;cursor:default">矿机激活暂未开放</button>`;
    } else if (!showButton) {
      const connected = Boolean(window.currentWalletConnection?.address);
      const label = connected ? '钱包已连接 · 确认身份后激活' : '连接钱包后激活';
      btnHtml = `<button class="btn-activate" type="button" onclick="${connected ? 'openPlatformAccount' : 'connectWallet'}(this)">${label}</button>`;
    } else if (miniOwned || myAct?.status === 'confirmed') {
      btnHtml = `<button class="btn-activate" style="pointer-events:none;opacity:.55;cursor:default">已激活 ✔</button>`;
    } else if (myAct?.status === 'pending') {
      btnHtml = `<button class="btn-activate" style="pointer-events:none;opacity:.55;cursor:default">激活确认中…</button>`;
    } else {
      btnHtml = `<button class="btn-activate" onclick="window.earnActivate('${escapeHtml(p.plan)}')">${activationInFlight ? '正在处理…' : '立即激活 · ' + escapeHtml(p.svx) + ' SVX'}</button>`;
    }
    return `
      <div class="act-card ${cls}">
        <div class="act-banner ${cls}">
          <div class="act-banner-row">
            <span class="act-plan-tag ${cls}">${isMini ? '⚡ MINI 矿机' : '👑 PRO 矿机'}</span>
            <span class="portal-chip"><span class="act-copy-full">SVX 激活 · ${days} 天</span><span class="act-copy-short">SVX · ${days}天</span></span>
          </div>
          <div class="act-miner-art ${cls}"><img src="/assets/miner-${isMini ? 'mini' : 'pro'}.svg?v=20261111-domain-solvex-1" alt="${isMini ? 'Mini' : 'Pro'} 矿机" loading="lazy"></div>
          <div class="act-plan-title"><span class="act-copy-full">${escapeHtml(cleanSvxText(p.label))}</span><span class="act-copy-short">${isMini ? 'Mini 矿机 · 30天' : 'Pro 矿机 · 90天'}</span></div>
          <div class="act-bnb">${escapeHtml(p.svx)}<small>SVX</small></div>
          <div class="act-arrow">
            <strong><span class="act-copy-full">${total} SVX 总产出</span><span class="act-copy-short">总量 ${total} SVX</span></strong>
            <div class="arrow-box">→</div>
            <strong><span class="act-copy-full">日产 ${daily} SVX</span><span class="act-copy-short">日产 ${daily} SVX</span></strong>
          </div>
        </div>
        <div class="act-body">
          <div class="act-stats">
            <div class="stat-item"><span>矿机总产出</span><strong>${total} SVX</strong></div>
            <div class="stat-item"><span>日产目标</span><strong>${daily} SVX/天</strong></div>
            <div class="stat-item"><span>有效期</span><strong>${days} 天</strong></div>
            ${balanceStats}
          </div>
          <p style="font-size:12px;color:var(--mut);margin:0 0 12px">${isMini ? '每钱包终身限激活一次' : '可重复激活、同时持有多台，无激活名额上限'} · 激活代币全额销毁</p>
          ${btnHtml}
        </div>
      </div>`;
  }
  function stakeCardHtml(p, showButton = true) {
    if (p.energy) return `<div class="stake-card svx-energy-card"><span class="stake-tag">能量释放</span><div class="stake-rate-big">1%<small>每日释放原额度</small></div><p>面向工作室，普通用户也可参与。后台充值或从蓄能额度投入，按原始额度（SVX 枚数）每天释放 1%，100 次释放完毕；按枚数计息、不按 USDT 市值折算，不额外产生利息。</p><p>每天 UTC 00:00（北京 08:00）开放领取，次日同一时点未领作废；不可提前赎回。</p><button class="btn-stake" onclick="window.earnStake('energy')" ${showButton?'':'disabled'}>投入能量</button></div>`;

    // 2026-11-09 P1：新三档按「周期总收益」展示，每天08:00领取利息，到期另领本金
    const maturity = Boolean(p.pendingMaturity);
    const totalRatePct = maturity && p.totalRateBps ? (Number(p.totalRateBps) / 100) : null;
    const monthlyRate = maturity && totalRatePct !== null
      ? (totalRatePct * 30 / Number(p.days || 30)).toFixed(1)
      : (p.days > 0 ? (Number(p.dailyRateBps) * 30 / 100).toFixed(0) : (Number(p.dailyRateBps) * 30 / 100).toFixed(1));
    const dailyRatePct = (Number(p.dailyRateBps) / 100).toFixed(2);
    const minA = p.minCoins ? `${p.minCoins} 币起` : '—';
    const maxA = p.maxCoins ? ` · 上限 ${p.maxCoins} 币` : '';
    const periodLabel = p.energy ? '每天 UTC 00:00（北京 08:00）释放，不能提前赎回' : maturity ? p.days + ' 天每日领取利息' : (p.flexible ? '随进随出' : p.days + ' 天到期');
    const expectedLabel = maturity && totalRatePct !== null
      ? '到期共 ' + totalRatePct + '%（含本金）'
      : (p.flexible ? '收益每日到账' : '到期共 ' + (Number(p.dailyRateBps) * Number(p.days) / 100).toFixed(1) + '%');
    const planClass = p.planId || 'current';
    const btnHtml = showButton
      ? `<button class="btn-stake" onclick="window.earnStake('${escapeHtml(p.planId)}')">投入能量</button>`
      : `<button class="btn-stake" style="opacity:.5;pointer-events:none">连接钱包</button>`;
    return `
      <div class="stake-card ${planClass}">
        <span class="stake-tag ${planClass}">${maturity ? '🔒 固定档 · ' + p.energy ? '每日释放1%' : p.days + ' 天' : (p.flexible ? '🟢 活期 · 灵活' : '🔒 固定档 · ' + p.days + ' 天')}</span>
        <div>
          <div class="stake-rate-big">${maturity && totalRatePct !== null ? totalRatePct : monthlyRate}%<small>${maturity ? '周期总收益' : '月化'}</small></div>
          <div class="stake-sub-rate">折合日利率 <b>${dailyRatePct}%</b> · ${periodLabel}</div>
        </div>
        <div class="stake-meta">
          <div class="meta-item"><span>门槛</span><b>${minA}${maxA}</b></div>
          <div class="meta-item"><span>扣币</span><b>蓄能额度余额</b></div>
          <div class="meta-item"><span>周期</span><b>${p.days} 天</b></div>
          <div class="meta-item"><span>结算</span><b>${maturity ? '到期挂待领取' : '每日自动'}</b></div>
          <div class="meta-item"><span>预期</span><b>${expectedLabel}</b></div>
        </div>
        ${btnHtml}
      </div>`;
  }

  // ── 超速驱动协议（2026-10-31）：蓄能额度 + 驱动额度 1:1 进池 → 到期出 2× 流通额度 ──
  let mpBusy = false;
  let mpTicker = null;
  let mpQuoteTimer = null;

  // 超速驱动协议专用样式（.mp- 前缀隔离，随 renderMatchPool 注入，重复注入内容相同无副作用）
  const MP_CSS = `<style>
    .mp-flow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}
    .mp-chip{padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid;white-space:nowrap}
    .mp-chip.match{color:#d9b06b;border-color:rgba(246,196,84,.35);background:rgba(246,196,84,.08)}
    .mp-chip.turbo{color:#0e46aa;border-color:rgba(138,180,255,.35);background:rgba(138,180,255,.08)}
    .mp-chip.usable{color:var(--brand);border-color:rgba(14,156,136,.35);background:rgba(14,156,136,.08)}
    .mp-arrow{color:#5b6b67;font-size:12px;font-weight:700}
    .mp-quota-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}
    .mp-quota{--ac:#f6c454;position:relative;padding:14px 16px 14px 19px;border-radius:14px;background:rgba(16,38,32,0.044000000000000004);border:1px solid rgba(217,228,224,0.07700000000000001)}
    .mp-quota::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:3px;background:var(--ac)}
    .mp-quota .q-top{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--mut)}
    .mp-quota .q-ico{font-size:15px}
    .mp-quota .q-num{margin-top:8px;font-size:24px;font-weight:700;color:var(--ac);line-height:1.1;word-break:break-all}
    .mp-quota .q-num small{font-size:12px;color:var(--mut);font-weight:400;margin-left:4px}
    .mp-quota .q-sub{margin-top:6px;font-size:11px;color:var(--mut)}
    .mp-dur{margin-top:14px;padding:14px 16px;border-radius:14px;background:rgba(16,38,32,0.044000000000000004);border:1px solid rgba(217,228,224,0.07700000000000001)}
    .mp-dur .d-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
    .mp-dur .d-day{font-size:15px;font-weight:700;color:var(--txt)}
    .mp-dur .d-lock{font-size:12px;color:var(--mut)}
    .mp-dur .d-lock b{color:#d9b06b;font-size:14px}
    .mp-bar{height:8px;border-radius:99px;background:rgba(16,38,32,0.07260000000000001);overflow:hidden;margin-top:10px}
    .mp-bar>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#f6c454,#50d2b8);transition:width .4s ease}
    .mp-dur .d-hint{margin-top:8px;font-size:11px;color:var(--mut)}
    .mp-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
    .mp-card{padding:16px;border-radius:14px;background:rgba(16,38,32,0.044000000000000004);border:1px solid rgba(217,228,224,0.07700000000000001)}
    .mp-card .c-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
    .mp-card .c-title{font-size:14px;font-weight:700;color:var(--txt)}
    .mp-card .c-tag{font-size:11px;color:var(--mut)}
    .mp-btn{display:inline-flex;align-items:center;justify-content:center;padding:0 16px;height:38px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;transition:filter .15s ease}
    .mp-btn:hover:not(:disabled){filter:brightness(1.12)}
    .mp-btn:disabled{opacity:.55;cursor:not-allowed}
    .mp-btn.gold{background:linear-gradient(135deg,#f6c454,#e8a13a);color:#1a1405}
    .mp-btn.teal{background:linear-gradient(135deg,#50d2b8,#2bb89b);color:#04211a}
    .mp-btn.ghost{position:static;background:rgba(16,38,32,0.09680000000000001);color:#487064;margin-left:6px}
    .mp-entries{display:flex;flex-direction:column;gap:10px;margin-top:14px}
    .mp-entry{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 16px;border-radius:14px;background:rgba(16,38,32,0.044000000000000004);border:1px solid rgba(217,228,224,0.07700000000000001)}
    .mp-entry .e-main{flex:1;min-width:0}
    .mp-entry .e-amt{font-size:17px;font-weight:700;color:var(--brand)}
    .mp-entry .e-amt small{font-size:11px;color:var(--mut);font-weight:400;margin-left:4px}
    .mp-entry .e-sub{margin-top:3px;font-size:11px;color:var(--mut)}
    .mp-entry .mp-bar{margin-top:8px;height:6px}
    .mp-entry .e-side{text-align:right;flex-shrink:0}
    .mp-entry .e-chip{display:inline-block;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:600}
    .mp-entry .e-chip.locked{color:#d9b06b;background:rgba(246,196,84,.1);border:1px solid rgba(246,196,84,.3)}
    .mp-entry .e-chip.done{color:var(--brand);background:rgba(14,156,136,.1);border:1px solid rgba(14,156,136,.3)}
    .mp-entry .e-time{margin-top:5px;font-size:11px;color:#5b6b67}
    .mp-empty{padding:26px 14px;text-align:center;color:var(--mut);font-size:12px;border:1px dashed rgba(217,228,224,0.132);border-radius:14px;margin-top:14px}
    .mp-empty .big-emoji{font-size:26px;margin-bottom:6px}
    .mp-sec-title{display:flex;align-items:center;justify-content:space-between;margin-top:20px;font-size:14px;font-weight:700;color:var(--txt)}
    .mp-sec-title span{font-size:11px;color:var(--mut);font-weight:400}
    @media(max-width:720px){.mp-quota-grid,.mp-actions{grid-template-columns:1fr}.mp-entry{flex-direction:column;align-items:stretch}.mp-entry .e-side{text-align:left;display:flex;align-items:center;justify-content:space-between;gap:8px}.mp-entry .e-time{margin-top:0}}
  </style>`;

  function renderMatchPool() {
    const mp = profileCache?.matchPool;
    if (!mp) return `<div class="ev2-empty" style="padding:18px">超速驱动协议数据加载中…</div>`;
    const matchAvail = Number(mp.matchQuota?.available || 0);
    const turboAvail = Number(mp.turboQuota || 0);
    const usableAvail = Number(mp.usableQuota?.available || 0);
    // 购买驱动额度用站内 USDT 余额支付，卡片上直接显示用户自己有多少 USDT
    const balUsdt = profileCache?.balances?.USDT ?? null;
    const tb = profileCache?.turbo || null;
    const nextHours = Number(mp.nextDurationHours || 24);
    const maxHours = Number(mp.maxDurationHours || 720);
    const balA = Number(profileCache?.balances?.A ?? 0);
    const enterMax = Math.min(matchAvail, turboAvail, balA);
    const dayIndex = mp.started ? Number(mp.dayIndex || 1) : 0;
    const durPct = Math.min(100, Math.round(nextHours / maxHours * 100));
    const nowMs = Date.now();

    const entriesHtml = (mp.entries || []).map(e => {
      const locked = e.status === 'locked';
      const span = Math.max(1, Number(e.maturesAt) - Number(e.createdAt));
      const elapsedPct = locked ? Math.min(100, Math.max(0, Math.round((nowMs - Number(e.createdAt)) / span * 100))) : 100;
      return `<div class="mp-entry">
        <div class="e-main">
          <div class="e-amt">+${fmtA(e.totalA)}<small>SVX 流通额度</small></div>
          <div class="e-sub">匹配 ${fmtA(e.matchA)} + 涡轮 ${fmtA(e.turboA)} · 锁 ${e.durationHours} 小时</div>
          <div class="mp-bar"><i style="width:${elapsedPct}%"></i></div>
        </div>
        <div class="e-side">
          ${locked
            ? `<span class="e-chip locked" data-mp-matures="${Number(e.maturesAt)}">⏱ ${timeLeft(Number(e.remainMs))} 后发放</span>`
            : `<span class="e-chip done">已发放</span>`}
          <div class="e-time">${new Date(Number(e.createdAt)).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 放入</div>
        </div>
      </div>`;
    }).join('') || `<div class="mp-empty"><div class="big-emoji">🌀</div>暂无超速驱动协议记录，放入后这里显示每笔锁定与倒计时</div>`;

    const purchaseRows = (mp.purchases || []).map(p => `<tr>
      <td data-label="支付">${fmtNum(p.usdtIn, 2)} USDT</td>
      <td data-label="获得"><b style="color:#0e46aa">+${fmtA(p.turboOut)}</b> <small>SVX 涡轮</small></td>
      <td data-label="成交价">$${escapeHtml(p.priceUsdt)}</td>
      <td data-label="时间">${new Date(Number(p.createdAt)).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
    </tr>`).join('') || `<tr><td colspan="4" class="ev2-empty">暂无购买记录</td></tr>`;

    return `${MP_CSS}
      <div class="earn-v2-head-banner">
        <h2>SVX 超速驱动协议</h2>
        <p style="margin:6px 0 0;font-size:12px;color:var(--mut)">1 枚 SVX 锁定 1 枚蓄能额度 + 1 枚驱动额度，合计 2 份协议额度；到期按 2 倍释放流通额度（1 匹配 + 1 涡轮），只有流通额度可卖出。蓄能额度不可直接卖出。</p>
        <div class="mp-flow">
          <span class="mp-chip match">蓄能额度</span><span class="mp-arrow">+</span>
          <span class="mp-chip turbo">驱动额度</span><span class="mp-arrow">→ 🔒 超速驱动协议 →</span>
          <span class="mp-chip usable">流通额度（2 倍）</span>
        </div>
      </div>

      <div class="mp-quota-grid">
        <div class="mp-quota" style="--ac:#f6c454">
          <div class="q-top"><span>蓄能额度</span><span class="q-ico">⛏️</span></div>
          <div class="q-num">${fmtA(matchAvail)}<small>SVX</small></div>
          <div class="q-sub">质押产出 · 不可直接卖出</div>
        </div>
        <div class="mp-quota" style="--ac:#8ab4ff">
          <div class="q-top"><span>驱动额度</span><span class="q-ico">🌀</span></div>
          <div class="q-num">${fmtA(turboAvail)}<small>SVX</small></div>
          <div class="q-sub">USDT 按实时价购买</div>
        </div>
        <div class="mp-quota" style="--ac:#50d2b8">
          <div class="q-top"><span>流通额度</span><span class="q-ico">✅</span></div>
          <div class="q-num">${fmtA(usableAvail)}<small>SVX</small></div>
          <div class="q-sub">超速驱动协议到期产出 · 可卖出</div>
        </div>
      </div>

      <div class="mp-dur">
        <div class="d-row">
          <span class="d-day">${mp.started ? `⏳ 第 ${dayIndex} 天` : '⏳ 计时未开始'}</span>
          <span class="d-lock">本次放入锁定 <b>${nextHours} 小时</b> / 封顶 ${maxHours} 小时</span>
        </div>
        <div class="mp-bar"><i style="width:${durPct}%"></i></div>
        <div class="d-hint">${mp.started ? '首次放入已开始计时：每日 +24h，无论是否使用' : '首次放入后开始计时：第1天锁24h，之后每日+24h，每天仅一次'}</div>
      </div>

      <div class="mp-actions">
        <div class="mp-card">
          <div class="c-head"><span class="c-title">🌀 购买驱动额度</span><span class="c-tag">$${escapeHtml(mp.priceUsdt || '0')} / SVX</span></div>
          <label class="stake-amount-label" for="mp-aix-input">购买数量（SVX 驱动额度）</label>
          <div class="stake-amount-field">
            <input id="mp-aix-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="输入要购买的 SVX 数量" oninput="window.mpQuoteInput()">
            <button type="button" class="mp-btn gold" style="margin:0 7px;height:40px" onclick="window.mpBuyTurbo()" ${mpBusy ? 'disabled' : ''}>${mpBusy ? '处理中…' : '一键购买'}</button>
          </div>
          <div class="stake-amount-hint">我的 USDT 余额：<b style="color:var(--brand)">${balUsdt == null ? '—' : '$' + fmtNum(balUsdt, 2)}</b> · 站内余额支付</div>
          <div id="mp-turbo-quote" class="stake-amount-hint">按实时价折算应付 USDT · 站内余额支付 · 需钱包签名</div>
        </div>
        <div class="mp-card">
          <div class="c-head"><span class="c-title">🔒 放入超速驱动协议</span><span class="c-tag">1 : 1 配比</span></div>
          <label class="stake-amount-label" for="mp-enter-input">放入数量（1 份蓄能额度 + 1 份驱动额度 + 等量 SVX 币）</label>
          <div class="stake-amount-field" style="grid-template-columns:minmax(0,1fr) auto auto">
            <input id="mp-enter-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="输入 SVX 数量">
            <button type="button" class="mp-btn ghost" style="margin:0 4px;height:40px;padding:0 12px" onclick="window.mpEnterMax()">Max</button>
            <button type="button" class="mp-btn teal" style="margin:0 7px 0 4px;height:40px" onclick="window.mpEnterPool()" ${mpBusy || mp.usedToday ? 'disabled' : ''}>${mp.usedToday ? '今日已使用' : mpBusy ? '处理中…' : '放入'}</button>
          </div>
          <div class="stake-amount-hint">最多 ${fmtA(enterMax)} SVX（受蓄能额度 / 驱动额度 / SVX 余额取小）· 锁 <b style="color:#d9b06b">${nextHours}h</b> → 到期释放 <b style="color:var(--brand)">2 倍协议额度</b>（1 匹配 + 1 涡轮）+ 2 倍 SVX 币</div>
        </div>
      </div>

      <div class="mp-sec-title">📒 已使用的超速驱动协议 <span>${(mp.entries || []).length} 条 · 到期自动发放到资产账户</span></div>
      <div class="mp-entries">${entriesHtml}</div>

      <div class="mp-sec-title">🧾 驱动额度购买记录 <span>${(mp.purchases || []).length} 条</span></div>
      <div class="portal-table-wrap" style="margin-top:10px">
        <table class="portal-table">
          <thead><tr><th>支付</th><th>获得</th><th>成交价</th><th>时间</th></tr></thead>
          <tbody>${purchaseRows}</tbody>
        </table>
      </div>`;
  }

  // 剩余时间倒计时：每 30s 就地刷新，不重绘表单
  function startMpTicker() {
    if (mpTicker) { clearInterval(mpTicker); mpTicker = null; }
    if (currentSubTab !== 'matchpool') return;
    mpTicker = setInterval(() => {
      if (currentSubTab !== 'matchpool' || !document.getElementById('tab-earn')?.classList.contains('active')) {
        clearInterval(mpTicker); mpTicker = null; return;
      }
      document.querySelectorAll('[data-mp-matures]').forEach(el => {
        const remain = Number(el.getAttribute('data-mp-matures') || 0) - Date.now();
        el.textContent = remain <= 0 ? '已到期 · 刷新页面后自动发放' : '⏱ ' + timeLeft(remain) + ' 后发放';
      });
    }, 30_000);
  }

  window.mpQuoteInput = () => {
    clearTimeout(mpQuoteTimer);
    mpQuoteTimer = setTimeout(async () => {
      const el = document.getElementById('mp-turbo-quote');
      const raw = String(document.getElementById('mp-aix-input')?.value || '').trim();
      if (!el) return;
      if (!raw || Number(raw) <= 0) { el.textContent = '按大盘价折算应付 USDT（买入 0 手续费）· 站内余额支付 · 需钱包签名'; return; }
      try {
        const q = await authApi('match-pool/quote?aix=' + encodeURIComponent(raw));
        if (document.getElementById('mp-turbo-quote') === el) el.textContent = q.hint || '';
      } catch (e) { el.textContent = e?.message || '报价失败'; }
    }, 400);
  };

  window.mpBuyTurbo = async () => {
    if (mpBusy) return;
    const aix = normalizeStakeAmount(document.getElementById('mp-aix-input')?.value);
    if (!aix) { showErr('请输入有效的 SVX 数量'); return; }
    const addr = String(window.currentWalletConnection?.address || '').toLowerCase();
    const provider = typeof connectedProvider !== 'undefined' ? connectedProvider : null;
    if (!addr || !provider) { showErr('请先连接钱包'); return; }
    mpBusy = true;
    try {
      // 先取实时报价拿到应付 USDT，签名锁定该金额；价格跳动时服务端会拒绝并提示重签
      const q = await authApi('match-pool/quote?aix=' + encodeURIComponent(aix));
      // 驱动额度按实时价从 SVX 交易盘口买入：盘口没有卖单时无法直接成交，
      // 先询问是否转为「委托求购」（按实时价冻结 USDT 挂单，等卖单出现后自动成交）
      const market = await api('pool').catch(() => null);
      if (!Number(market?.depth?.openSellCount || 0)) {
        const goOrder = await confirmDialog(
          '当前 SVX 交易盘口暂无卖单，无法买入 ' + q.aixIn + ' SVX 驱动额度。是否转为「委托求购」？'
          + '将按实时价 $' + q.priceUsdt + ' 冻结成交金额 ' + q.usdtCost + ' USDT（买入 0 手续费，合计 ' + q.usdtOut + ' USDT）挂单，有卖单时自动成交。',
          { title: '暂无卖单' },
        );
        if (!goOrder) return;
        const r = await authApi('orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ side: 'buy', orderType: 'market', amount: q.usdtCost }),
        });
        showOk(r?.orderStatus === 'FILLED'
          ? '已买入 ' + fmtNum(r?.aReceived, 4) + ' SVX（成交 ' + fmtNum(r?.usdtPaid || q.usdtCost, 2) + ' USDT，买入 0 手续费）'
          : '盘口暂无卖单 · 已挂委托求购，冻结 ' + fmtNum(r?.lockedUsdt || q.usdtOut, 2) + ' USDT（买入 0 手续费），有卖单后自动成交');
        profileCache = await authApi('profile').catch(() => profileCache);
        renderSubTab();
        return;
      }
      if (!await confirmDialog('购买 ' + q.aixIn + ' SVX 驱动额度：成交 ' + q.usdtCost + ' USDT，实付 ' + q.usdtOut + ' USDT（买入 0 手续费，大盘价 $' + q.priceUsdt + '），购买后不可退款。确认？')) return;
      const requestId = 'tbo_' + crypto.randomUUID().replaceAll('-', '');
      const timestamp = String(Date.now());
      const msg = 'Solvex 驱动额度购买确认：支付 ' + q.usdtOut + ' USDT，编号 ' + requestId + '，时间：' + timestamp;
      const signature = await provider.request({ method: 'personal_sign', params: [msg, addr] });
      const r = await authApi('match-pool/buy-turbo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
        body: JSON.stringify({ aix, timestamp, signature }),
      });
      showOk('购买成功：+' + r.turboOut + ' SVX 驱动额度（成交 ' + r.usdtIn + ' USDT，买入 0 手续费）');
      profileCache = await authApi('profile').catch(() => profileCache);
      renderSubTab();
    } catch (e) { showErr(friendlyError(e, '购买失败')); }
    finally { mpBusy = false; }
  };

  window.mpEnterMax = () => {
    const mp = profileCache?.matchPool;
    const input = document.getElementById('mp-enter-input');
    if (!mp || !input) return;
    const max = Math.min(Number(mp.matchQuota?.available || 0), Number(mp.turboQuota || 0));
    input.value = max > 0 ? max.toLocaleString('en-US', { maximumFractionDigits: 18, useGrouping: false }) : '';
  };

  window.mpEnterPool = async () => {
    if (mpBusy) return;
    const amount = normalizeStakeAmount(document.getElementById('mp-enter-input')?.value);
    if (!amount) { showErr('请输入有效的 SVX 数量'); return; }
    const hours = Number(profileCache?.matchPool?.nextDurationHours || 24);
    if (!await confirmDialog('确认放入 ' + amount + ' SVX 蓄能额度 + ' + amount + ' SVX 驱动额度 + 锁定 ' + amount + ' SVX 币？锁定 ' + hours + ' 小时，到期获得 ' + (Number(amount) * 2) + ' SVX 流通额度 + ' + (Number(amount) * 2) + ' SVX。')) return;
    mpBusy = true;
    try {
      const r = await authApi('match-pool/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      showOk('已放入超速驱动协议：锁定 ' + r.entry.durationHours + ' 小时，到期 +' + r.entry.totalA + ' SVX 流通额度');
      profileCache = await authApi('profile').catch(() => profileCache);
      renderSubTab();
    } catch (e) { showErr(friendlyError(e, '放入失败')); }
    finally { mpBusy = false; }
  };

  // ── 驱动额度涡轮（2026-11-09 P2）：驱动额度扣币，满 24h 释放等额卖出额度 ──
  window.tbEnterMax = () => {
    const v = Number(profileCache?.turbo?.betaBalance || 0);
    const input = document.getElementById('tb-enter-input');
    if (input) input.value = v > 0 ? String(v) : '';
  };

  window.turboEnter = async () => {
    if (mpBusy) return;
    const amount = normalizeStakeAmount(document.getElementById('tb-enter-input')?.value);
    if (!amount) { showErr('请输入有效的 SVX 数量'); return; }
    const beta = Number(profileCache?.turbo?.betaBalance || 0);
    if (Number(amount) > beta) { showErr('驱动额度可用不足：当前 ' + fmtA(beta) + ' SVX'); return; }
    if (!await confirmDialog('确认将 ' + amount + ' SVX 从驱动额度放进涡轮？锁定 24 小时，到期解锁等额币并释放等额卖出额度（额度自释放起 30 天有效）。')) return;
    mpBusy = true;
    try {
      const requestId = 'tbe_' + (globalThis.crypto?.randomUUID?.() || String(Date.now())).replaceAll('-', '');
      const r = await authApi('turbo/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
        body: JSON.stringify({ amount }),
      });
      showOk('已进涡轮：' + fmtA(r?.lock?.units || amount) + ' SVX，满 24 小时释放等额卖出额度');
      profileCache = await authApi('profile').catch(() => profileCache);
      renderSubTab();
    } catch (e) { showErr(friendlyError(e, '进涡轮失败')); }
    finally { mpBusy = false; }
  };

  // ── 入口分发 ──
  async function renderSubTab() {
    const host = document.getElementById('earn-content');
    if (!host) return;
    stopPendingTicker();
    if (!window.currentWalletProfile?.authenticated) {
      host.innerHTML = renderGuestContent();
      return;
    }
    switch (currentSubTab) {
      case 'miner': host.innerHTML = renderNodes(); bindNodeHandlers(); break;
      case 'pending': host.innerHTML = renderPending(); startPendingTicker(); break;
      case 'staking': host.innerHTML = renderStaking(); break;
      case 'shareholder': host.innerHTML = renderShareholder(); break;
      case 'blindbox': host.innerHTML = renderBlindBox(); break;
      case 'matchpool': host.innerHTML = renderMatchPool(); break;
    }
    startMpTicker();
  }

  // ── 矿池：建仓与报价（只从蓄能额度扣币） ──
  let nodeQuoteTimer = null;
  function bindNodeHandlers() {
    const input = document.getElementById('node-coins-input');
    const maxBtn = document.getElementById('node-max-btn');
    const openBtn = document.getElementById('node-open-btn');
    if (!input || !openBtn) return;
    if (maxBtn) maxBtn.addEventListener('click', () => {
      input.value = formatUnits18(profileCache?.zones?.alpha || '0');
      refreshNodeQuote();
    });
    input.addEventListener('input', () => {
      clearTimeout(nodeQuoteTimer);
      nodeQuoteTimer = setTimeout(refreshNodeQuote, 260);
    });
    openBtn.addEventListener('click', earnOpenNode);
  }

  async function refreshNodeQuote() {
    const coins = String(document.getElementById('node-coins-input')?.value || '').trim();
    const line = document.getElementById('node-quote-line');
    if (!line) return;
    if (!coins || !Number(coins)) { line.textContent = '按币数判定档位；每日领取利息，到期另领本金'; return; }
    try {
      const q = await authApi(`nodes/quote?coins=${encodeURIComponent(coins)}`);
      line.innerHTML = `档位 ${q.ratePct}% · ${q.days} 天 · 到期合计 <b>${fmtA(q.payout)}</b> 币（含本金 ${fmtA(q.coins)}）`;
    } catch (e) { line.textContent = friendlyError(e, '档位校验失败'); }
  }

  async function earnOpenNode() {
    const coins = String(document.getElementById('node-coins-input')?.value || '').trim();
    if (!coins) { showErr('请输入开通币数'); return; }
    try {
      await authApi('nodes/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coins }) });
      showOk('矿池已开通，到期后产出进入「待领取」');
      profileCache = await authApi('profile').catch(() => profileCache);
      renderSubTab();
    } catch (e) { showErr(friendlyError(e, '开通失败')); }
  }

  // ── 待领取：领取与倒计时 ──
  let pendingTicker = null;
  function stopPendingTicker() { if (pendingTicker) { clearInterval(pendingTicker); pendingTicker = null; } }
  function startPendingTicker() {
    stopPendingTicker();
    pendingTicker = setInterval(() => {
      document.querySelectorAll('[data-pending-expires]').forEach(el => {
        const ms = Number(el.dataset.pendingExpires) - Date.now();
        el.textContent = ms > 0 ? '剩余 ' + timeLeft(ms) : '已过期';
      });
    }, 1000);
  }

  async function reloadPending() {
    profileCache = await authApi('profile').catch(() => profileCache);
    renderSubTab();
  }

  window.earnClaimPending = async (id) => {
    try {
      await authApi('pending/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      showOk('领取成功，已计入主余额');
      await reloadPending();
    } catch (e) { showErr(friendlyError(e, '领取失败')); }
  };

  window.earnClaimAll = async () => {
    try {
      const r = await authApi('pending/claim-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const failed = (r?.claimed || []).filter(x => x.error).length;
      showOk(failed ? `部分领取完成，${failed} 条失败（可能已过期）` : '全部领取成功');
      await reloadPending();
    } catch (e) { showErr(friendlyError(e, '领取失败')); }
  };

  // ── 激活 v2 ──
  function renderActivation() {
    const plans = (plansCache?.activation || []).map(p => ({ ...p, label: cleanSvxText(p.label) }));
    const myActivations = profileCache?.activations || [];

    const planCards = plans.map(p => activationCardHtml(p, true)).join('');

    const myRows = myActivations.map(a => `<tr>
      <td data-label="套餐">${a.plan === '1' ? 'Mini 矿机' : 'Pro 矿机'} · ${['SVX','AIX'].includes(a.paymentAsset) ? escapeHtml(a.payload?.svx || a.payload?.aix || '') + ' SVX' : (a.plan === '1' ? '0.002' : '0.05') + ' BNB（历史）'}</td>
      <td data-label="规格"><span class="act-copy-full">${a.plan === '1' ? 'Mini 矿机（30天，日产约 3.3 SVX 共 100 SVX）' : 'Pro 矿机（90天，日产约 16.6 SVX 共 1500 SVX）'}</span><span class="act-copy-short">${a.plan === '1' ? '100 SVX · 30天' : '1500 SVX · 90天'}</span></td>
      <td data-label="支付凭证">${['SVX','AIX'].includes(a.paymentAsset) ? '<span title="' + escapeHtml(a.id) + '">可用 SVX · 已全额销毁</span>' : '<code title="' + escapeHtml(a.txHash || '') + '">' + escapeHtml(String(a.txHash || '').slice(0, 12)) + '…</code>'}</td>
      <td data-label="状态"><span class="status-chip ${a.status}">${({ pending: '链上确认中', confirmed: '已确认 ✔', rejected: '已驳回' })[a.status] || a.status}</span></td>
      <td data-label="确认时间">${a.confirmedAt ? new Date(a.confirmedAt).toLocaleString('zh-CN', { hour12: false }) : '-'}</td>
    </tr>`).join('') || `<tr><td colspan="5" class="ev2-empty"><div class="big-emoji">🎁</div>暂无激活记录，激活后矿机会立即出现在「矿机」页面</td></tr>`;

    return `
      <div class="earn-v2-head-banner">
        <h2>🚀 激活成为 SVX 生态用户</h2>
      </div>

      ${slowNetworkNotice()}

      ${teamSummaryCard()}

      <div class="cap-wrap"><div class="cap-title">SVX 激活矿机<small>Mini 终身限一次 · Pro 激活无上限</small></div><p style="margin:8px 0 0;color:var(--mut);font-size:12px">激活费用全额计入 SVX 交易大厅累计销毁${profileCache?.balances?.A != null ? ' · 可用余额 ' + fmtA(profileCache.balances.A) + ' SVX' : ''}</p></div>

      <div class="earn-activation-v2-grid">${planCards}</div>

      <div class="portal-section" style="border-radius:14px;overflow:hidden">
        <div class="portal-section-head">
          <h2>📒 我的激活记录</h2>
          <span>${myActivations.length} 条 · SVX 激活即时到账</span>
        </div>
        <div class="portal-table-wrap">
          <table class="portal-table">
            <thead><tr>
              <th>套餐</th><th>矿机规格</th><th>支付凭证</th><th>状态</th><th>确认时间</th>
            </tr></thead>
            <tbody>${myRows}</tbody>
          </table>
        </div>
      </div>

      <div class="portal-section" style="border-radius:14px;overflow:hidden;margin-top:18px">
        <div class="portal-section-head">
          <h2>👥 直推明细</h2>
          <span>${teamData()?.directCount ?? '—'} 位直推用户</span>
        </div>
        <div style="padding:12px">
          ${directReferralList()}
        </div>
      </div>`;
  }

  // ── 矿池（2026-11-09 P1）：只从蓄能额度扣币建仓，每日领取利息，到期另领本金 ──
  function renderNodes() {
    const term = profileCache?.nodeTerm || plansCache?.nodes || null;
    const zones = profileCache?.zones || { alpha: '0', beta: '0' };
    const nodes = profileCache?.nodes || [];
    const pending30 = profileCache?.pendingSummary || null;
    const alphaBalance = fmtA(formatUnits18(zones.alpha));
    const days = term?.days ?? 30;
    const activePools = window.currentWalletProfile?.authenticated ? nodes.filter(n=>n.status==='active').length : 0;

    const tierRows = term
      ? `<div class="svx-tiers">${[
          { name:'基础矿池', code:'01', rate:term.lowRatePct, min:term.minCoins, max:term.midCoins },
          { name:'进阶矿池', code:'02', rate:term.midRatePct, min:term.midCoins, max:term.highCoins },
          { name:'尊享矿池', code:'03', rate:term.highRatePct, min:term.highCoins }
        ].map((t,i)=>`<article class="svx-tier svx-tier-${i}"><div class="svx-tier-top"><span class="svx-tier-icon" aria-hidden="true">${t.code}</span><span>${days} 天周期</span></div><h3>${t.name}</h3><div class="svx-tier-rate">${t.rate}<small>%</small></div><p>周期总利息</p><div class="svx-tier-min"><strong>${fmt(t.min,0)}</strong> SVX 起</div><small>${t.max?`少于 ${fmt(t.max,0)} SVX`:'按投入数量自动匹配档位'}</small></article>`).join('')}</div>`
      : '<div class="ev2-empty" style="padding:14px">档位配置加载中…</div>';

    const cards = nodes.map(n => {
      const pct = Math.min(100, Number(n.progressPct || 0));
      const done = n.status !== 'active';
      return `<div class="miner-card ${done ? 'completed' : ''}">
        <div class="miner-card-accent pro"></div>
        <div class="miner-head">
          <div class="miner-title">
            <span class="miner-icon svx-node-icon" aria-hidden="true"></span>
            <div>
              <h3>矿池</h3>
              <small class="miner-plan-desc">${n.days || days} 天 · 收益 ${n.ratePct}%</small>
            </div>
          </div>
          <span class="state-pill ${done ? 'done' : 'running'}">${escapeHtml(n.statusLabel || (done ? '已到期' : '运行中'))}</span>
        </div>
        <div class="miner-total-row">
          <span class="miner-total-label">本金（蓄能额度）</span>
          <span class="miner-total-val">${fmtA(n.principal)} <small>币</small></span>
        </div>
        <div class="miner-stats-row">
          <div class="miner-stat"><span>周期总利息</span><strong class="positive">${fmtA(n.interest)} <small>币</small></strong></div>
          <div class="miner-stat"><span>本息合计</span><strong>${fmtA(n.payout)} <small>币</small></strong></div>
          <div class="miner-stat"><span>进度</span><strong>${pct.toFixed(2)}<small>%</small></strong></div>
        </div>
        <div class="progress-wrap"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div></div>
        <div class="progress-foot">
          <span class="miner-expire">${done ? '已到期，产出在「待领取」' : '⏱ ' + timeLeft(Number(n.expiresAt) - Date.now()) + ' 后到期，本金到期可单独领取'}</span>
        </div>
      </div>`;
    }).join('') || `<div class="ev2-empty" style="grid-column:1/-1"><span class="svx-empty-symbol" aria-hidden="true">◇</span><strong>开启你的第一份矿池</strong><span>买入 SVX 到蓄能额度，即可选择投入数量开通矿池。</span></div>`;

    return `
      <section class="svx-hero svx-mining-hero">
        <div class="svx-hero-copy">
          <span class="svx-eyebrow"><i></i> SOLVEX MINING</span>
          <h2>你的矿池<br><span>正在创造可能</span></h2>
          <p>深入数字矿境，开启你的探索。<br>买入 SVX，开通矿池，让矿工开始工作。</p>
          <div class="svx-hero-actions"><button type="button" class="svx-light-button" onclick="document.getElementById('node-coins-input').scrollIntoView({block:'center',behavior:'smooth'});document.getElementById('node-coins-input').focus({preventScroll:true})">开通矿池 <span aria-hidden="true">↗</span></button><button type="button" class="svx-text-button" onclick="switchTab('a-token-trade')">买入 SVX <span aria-hidden="true">→</span></button></div>
          <div class="svx-mine-status ${activePools?'is-running':''}"><i></i><span>${activePools?`矿工已就位 · ${activePools} 份矿池运行中`:'矿场待启动 · 开通后矿工入场'}</span></div>
        </div>
        <div class="svx-mining-scene is-static" data-mining-scene data-active-pools="${activePools}" data-scene-state="static"><div class="svx-scene-fallback"><span class="svx-crystal"></span><span>矿池${activePools?'运行中':'待启动'}</span></div></div>
        <div class="svx-mine-coordinate" aria-hidden="true"><span>SVX / MINING DISTRICT</span><b>01 — CRYSTAL VALLEY</b></div>
        <div class="svx-mine-bottom"><span><b>${days}</b> 天周期</span><span>每日手动领取</span><span>本金到期领取</span><small>矿场动效仅作展示，收益以账单为准</small></div>
      </section>
      <div class="portal-metrics svx-overview" aria-label="矿池资产概览">
        ${P.metric('蓄能额度可用余额',window.currentWalletProfile?.authenticated?`${alphaBalance} <small>SVX</small>`:'—','用于矿池与能量')}
        ${P.metric('运行中矿池',window.currentWalletProfile?.authenticated?`${nodes.filter(n=>n.status==='active').length} <small>份</small>`:'—','查看下方持仓记录')}
        ${P.metric('当前可领取',window.currentWalletProfile?.authenticated?`${fmtA(pending30?formatUnits18(pending30.claimableUnits):0)} <small>SVX</small>`:'—','在「待领取」中手动领取')}
        <div class="portal-metric svx-overview-action"><span>资产管理</span><button type="button" onclick="window.earnSwitch('pending')">查看待领取 <span aria-hidden="true">↗</span></button><small>每天 UTC 00:00（北京 08:00）开放</small></div>
      </div>
      <div class="svx-pool-workspace">
        <section class="svx-plans"><div class="svx-section-title"><div><span class="svx-eyebrow">POOL STRATEGIES</span><h2>找到适合你的矿池</h2></div><span>按投入数量自动分档</span></div>${tierRows}
          <div class="svx-pool-note"><span class="svx-note-mark" aria-hidden="true">i</span><p>利息每天 UTC 00:00（北京 08:00）进入待领取，次日同一时点未领取作废；本金到期手动领取，不作废。</p></div>
          <div class="svx-steps"><div><b>01</b><span>买入 SVX<small>选择蓄能额度余额</small></span></div><div><b>02</b><span>开通矿池<small>按币数匹配档位</small></span></div><div><b>03</b><span>每日领取<small>管理你的持仓</small></span></div></div>
        </section>
        <section class="portal-section svx-open-pool">
        <div class="portal-section-head"><h2>开通矿池</h2><span>使用蓄能额度余额</span></div>
        <div class="svx-pool-form">
          <div class="stake-plan-summary"><span>蓄能额度余额</span><strong>${alphaBalance} 币</strong><button type="button" class="svx-inline-link" onclick="switchTab('a-token-trade')">买入 SVX ↗</button></div>
          <label class="stake-amount-label" for="node-coins-input">开通币数（从蓄能额度扣除）</label>
          <div class="stake-amount-field">
            <input id="node-coins-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="例如 ${term?.minCoins || ''}">
            <button type="button" class="stake-max-btn" id="node-max-btn" title="使用全部蓄能额度余额">Max</button>
          </div>
          <div id="node-quote-line" class="stake-amount-hint">按币数判定档位；每日领取利息，到期另领本金</div>
          <button type="button" class="btn-stake" id="node-open-btn" style="margin-top:14px">开通矿池</button>
          <p class="svx-balance-note">驱动额度余额 ${fmtA(formatUnits18(zones.beta))} SVX · 只能进涡轮，不能质押或开矿池（两区不可互转）</p>
        </div>
        </section>
      </div>

      ${turboSection()}

      <div class="portal-section" style="border-radius:14px;overflow:hidden;margin-top:14px">
        <div class="portal-section-head"><h2>我的矿池</h2><span>${nodes.length} 份持仓 · 利息每日领取，本金到期领取</span></div>
        <div class="miner-v2-grid" style="padding:16px">${cards}</div>
      </div>`;
  }

  // ── 驱动额度涡轮：驱动额度买到的币进涡轮，满 24 小时释放等额卖出额度 ──
  function turboSection() {
    if (!window.currentWalletProfile?.authenticated) return '';
    const t = profileCache?.turbo || {};
    const beta = Number(t.betaBalance || 0);
    const locked = Number(t.lockedUnits || 0);
    const avail = Number(t.usableQuota?.available || 0);
    const nextAt = Number(t.nextReleaseAt || 0);
    const locks = Array.isArray(t.locks) ? t.locks.filter(l => l.status !== 'expired').slice(0, 6) : [];
    const rows = locks.map(l => {
      const isLocked = l.status === 'locked';
      const time = isLocked ? Number(l.releaseAt || 0) - Date.now() : Number(l.expireAt || 0) - Date.now();
      return `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px dashed rgba(148,163,184,.25);font-size:12.5px">
        <span style="color:var(--mut)">${isLocked ? '锁定中' : '已释放额度'}</span>
        <b style="font-variant-numeric:tabular-nums">${fmtA(l.remainingUnits)} SVX</b>
        <small style="color:var(--mut)">${isLocked ? '剩余 ' + timeLeft(time) + ' 释放' : '额度 ' + timeLeft(time) + ' 内有效'}</small>
      </div>`;
    }).join('');
    return `<div class="portal-section" style="border-radius:14px;overflow:hidden;margin-top:14px">
      <div class="portal-section-head"><h2>🌀 驱动额度 · 涡轮</h2><span>满 24 小时释放等额卖出额度</span></div>
      <div class="portal-metrics" aria-label="驱动额度涡轮概览">
        ${P.metric('驱动额度可用', `${fmtA(beta)} <small>SVX</small>`, '全部可进涡轮')}
        ${P.metric('锁定中', `${fmtA(locked)} <small>SVX</small>`, '满 24 小时释放')}
        ${P.metric('可卖额度', `${fmtA(avail)} <small>SVX</small>`, '释放后 30 天内有效')}
        ${P.metric('下次释放', nextAt ? timeLeft(nextAt - Date.now()) : '—', '按进涡轮时间计时')}
      </div>
      <div style="padding:14px 16px 18px">
        <label class="stake-amount-label" for="tb-enter-input">进涡轮数量（从驱动额度扣除）</label>
        <div class="stake-amount-field">
          <input id="tb-enter-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="例如 1000">
          <button type="button" class="stake-max-btn" onclick="window.tbEnterMax()" title="使用全部驱动额度余额">Max</button>
        </div>
        <div class="stake-amount-hint">进涡轮锁定 24 小时，到期把等额 SVX 释放到可用余额，并释放等额卖出额度；额度自释放起 30 天内有效，到期未用部分作废。</div>
        <button type="button" class="btn-stake" style="margin-top:14px" onclick="window.turboEnter()">进涡轮</button>
        ${rows ? `<div style="margin-top:14px">${rows}</div>` : ''}
        <p class="svx-balance-note">驱动额度币只能进涡轮产生卖出额度；蓄能额度币用于能量与矿池，不产生卖出额度，两区不可互转。</p>
      </div>
    </div>`;
  }

  // ── 待领取（北京时间08:00至次日08:00，超时作废） ──
  function renderPending() {
    const rows = profileCache?.pending || [];
    const s = profileCache?.pendingSummary || { claimableUnits: '0', waitingUnits: '0', expiringSoonUnits: '0' };
    const now = Date.now();
    const body = rows.map(r => {
      const expires = Number(r.expiresAt || 0);
      const principal=r.bizType==='node' && r.periodKey==='principal';
      const available = Number(r.availableAt || 0);
      const canClaim = now >= available && now < expires;
      const state = now >= expires ? '已过期' : (canClaim ? '可领取' : '待生效');
      const isUsdt = String(r.asset || 'A').toUpperCase() === 'USDT';
      const amountText = isUsdt
        ? fmtA((Number(BigInt(r.amountUnits || '0')) / 1e6).toFixed(6)) + ' USDT'
        : fmtA(r.amountUnits ? formatUnits18(r.amountUnits) : '0') + ' 币';
      return `<tr>
        <td data-label="类型">${principal?'矿池本金':escapeHtml(pendingTypeLabel(r.bizType))}</td>
        <td data-label="数量">${amountText}</td>
        <td data-label="蓄能额度">${fmtA(r.quotaUnits ? formatUnits18(r.quotaUnits) : '0')}</td>
        <td data-label="状态">${state}</td>
        <td data-label="倒计时">${principal?'到期可领，不作废':`<span data-pending-expires="${expires}">${now < expires ? '剩余 ' + timeLeft(expires - now) : '已过期'}</span>`}</td>
        <td data-label="操作">${canClaim ? `<button class="btn-stake" style="padding:6px 14px" onclick="window.earnClaimPending('${escapeHtml(r.id)}')">领取</button>` : '-'}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="6" class="ev2-empty"><div class="big-emoji">📬</div>暂无待领取收益</td></tr>`;

    return `
      <div class="portal-section" style="border-radius:14px;overflow:hidden">
        <div class="portal-section-head"><h2>待领取</h2><span>每天 UTC 00:00（北京 08:00）开放领取，次日同一时点作废；矿池本金不作废</span></div>
        <div style="padding:16px">
          <div class="pool-grid">
            <div class="pool-cell"><div class="pool-cell-label">可领取</div><div class="pool-cell-value" style="color:var(--brand)">${fmtA(formatUnits18(s.claimableUnits))} <small>币</small></div></div>
            <div class="pool-cell"><div class="pool-cell-label">待生效</div><div class="pool-cell-value">${fmtA(formatUnits18(s.waitingUnits))} <small>币</small></div></div>
            <div class="pool-cell"><div class="pool-cell-label">6 小时内过期</div><div class="pool-cell-value" style="color:#d9b06b">${fmtA(formatUnits18(s.expiringSoonUnits))} <small>币</small></div></div>
            <div class="pool-cell"><div class="pool-cell-label">USDT 可领（分红）</div><div class="pool-cell-value" style="color:var(--brand)">${fmtA((Number(BigInt(s.claimableUsdtUnits || '0')) / 1e6).toFixed(2))} <small>USDT</small></div></div>
          </div>
          <button type="button" class="btn-stake" style="margin-top:14px" onclick="window.earnClaimAll()">一键领取全部</button>
        </div>
      </div>
      <div class="portal-section" style="border-radius:14px;overflow:hidden;margin-top:14px">
        <div class="portal-section-head"><h2>明细</h2><span>领取后计入主余额；蓄能额度同步累加</span></div>
        <div class="table-wrap" style="padding:0 12px 12px"><table class="ev2-table">
          <thead><tr><th>类型</th><th>数量</th><th>蓄能额度</th><th>状态</th><th>倒计时</th><th>操作</th></tr></thead>
          <tbody>${body}</tbody>
        </table></div>
      </div>`;
  }

  function pendingTypeLabel(type) {
    return ({ miner: '矿机（存量）', stake: '能量', node: '矿池', blindbox: '盲盒', team: '团队', dividend: '分红' })[type] || type || '-';
  }

  // ── 质押 v2 ──
  function renderStaking() {
    const plans=plansCache?.staking||[];
    const records=(profileCache?.stakes||[]).filter(s=>s.energy);
    const active=records.filter(s=>s.status==='active');
    const remaining=active.reduce((n,s)=>n+Number(s.outstandingPrincipal||0),0);
    const released=records.reduce((n,s)=>n+Number(s.totalEarned||0),0);
    return `
      <div class="portal-metrics" style="margin-bottom:16px">
        ${P.metric('待释放额度',fmtA(remaining)+' SVX')}
        ${P.metric('累计已释放',fmtA(released)+' SVX','含未领取或已过期部分')}
        ${P.metric('释放中',active.length+' 笔')}
        ${P.metric('每日领取', 'UTC 00:00（北京 08:00）')}
      </div>
      <div class="portal-section"><div class="portal-section-head"><h2>能量释放</h2><span>按 SVX 枚数每天释放 1%</span></div>
        <div class="stake-v2-grid" style="padding:16px">${plans.filter(p=>p.energy).map(p=>stakeCardHtml(p,true)).join('')}</div></div>
      <div class="portal-section" style="margin-top:16px"><div class="portal-section-head"><h2>我的能量</h2><span>${records.length} 笔</span></div>
        <div class="stake-record-list" style="padding:16px">${records.map(s=>`
          <div class="stake-record-card"><div class="stake-record-head"><span class="stake-tag">能量</span><span>${s.status==='active'?'释放中':'已释放完毕'}</span></div>
          <div class="stake-record-meta">
            <div class="stake-record-item"><span>原始额度</span><b>${fmtA(s.principal)} SVX</b></div>
            <div class="stake-record-item"><span>每日释放</span><b>${fmtA(s.dayEarned)} SVX</b></div>
            <div class="stake-record-item"><span>累计已释放</span><b>${fmtA(s.totalEarned)} SVX</b></div>
            <div class="stake-record-item"><span>剩余额度</span><b>${fmtA(s.outstandingPrincipal)} SVX</b></div>
            <div class="stake-record-item"><span>释放进度</span><b>${Number(s.energyDays||0)} / 100 次</b></div>
          </div></div>`).join('')||'<div class="ev2-empty">暂无能量记录</div>'}</div></div>`;
  }

  // ── 盲盒（P4）：1 USDT 进 LP，随机 100–500 币，30 天每日领取 ──
  function renderBlindBox() {
    const s = blindBoxCache;
    if (!s) return P.loading(4);
    const box = s.box || null;
    const rules = s.rules || {};
    const pending = s.pending || [];
    const progress = box && Number(box.totalCoins) > 0
      ? Math.max(0, Math.min(100, (Number(box.issuedCoins) / Number(box.totalCoins)) * 100)) : 0;
    const claimRows = pending.map(r => `
      <tr>
        <td data-label="天数" style="padding:6px;color:#4b6c65">第 ${Number(r.dayIndex) + 1} 天</td>
        <td data-label="数量" style="padding:6px;color:var(--brand);font-weight:600">${fmtA(r.amountCoins)} SVX</td>
        <td data-label="过期" style="padding:6px;color:var(--mut)">${r.expiresAt ? new Date(r.expiresAt).toLocaleString('zh-CN', { hour12:false }) : '—'}</td>
        <td data-label="操作" style="padding:6px"><button class="btn-copy" onclick="window.blindBoxClaim('${escapeHtml(r.id)}')" style="padding:6px 12px;border-radius:8px;background:rgba(14,156,136,.16);border-color:rgba(14,156,136,.4);color:var(--brand);font-weight:700">领取</button></td>
      </tr>`).join('');
    return `
      <div class="team-hero">
        <h2>盲盒 · 1 USDT 开 100–500 SVX</h2>
        <p>注册后可支付 1 USDT 开启盲盒（全额进 LP 池），开盒随机 100–500 枚 SVX（0.1 USDT/枚）；30 天每日手动领取，次日 UTC 00:00（北京 08:00）未领当天作废。领取后进入主余额并获得蓄能额度，使用超速驱动协议获得卖出额度；不计团队业绩、不计推广收益。</p>
      </div>

      <div class="portal-metrics" style="margin-bottom:22px;border-radius:14px;overflow:hidden">
        ${P.metric('参与状态', s.joined ? '<b style="color:var(--brand)">已参与</b>' : '未参与', rules.limitPerUser === 1 ? '每个地址限 1 份' : '')}
        ${P.metric('每日固定额度', box ? `${fmtA(box.dailyQuotaCoins)} SVX` : '—', `总币数 / ${rules.claimDays || 30} 天`)}
        ${P.metric('今日待领取', `${fmtA(s.pendingCoins || '0')} SVX`, 'UTC 00:00（北京 08:00）至次日同一时点领取，过期作废')}
        ${P.metric('盲盒进度', box ? `${fmtA(box.issuedCoins)} / ${fmtA(box.totalCoins)}` : '—', box ? (box.status === 'completed' ? '已领完' : `第 ${Math.min(Number(box.dayIndex) + 1, Number(box.claimDays))} / ${box.claimDays} 天`) : '')}
      </div>

      ${s.joined ? `
      <div class="portal-card" style="margin-bottom:18px;padding:18px 20px;border-radius:14px;background:rgba(16,38,32,0.14)">
        <h4 style="margin:0 0 10px;color:var(--brand)">我的盲盒</h4>
        <div style="height:10px;border-radius:6px;background:rgba(0,0,0,.35);overflow:hidden;margin-bottom:10px">
          <div style="height:100%;width:${progress}%;background:linear-gradient(90deg,#50d2c2,#8fe0d6)"></div>
        </div>
        <p style="margin:0 0 6px;color:var(--mut);font-size:12px;line-height:1.7">
          总币数 ${fmtA(box.totalCoins)} SVX · 已生成 ${fmtA(box.issuedCoins)} · 剩余 ${fmtA(box.remainingCoins)}<br>
          每日固定额度 ${fmtA(box.dailyQuotaCoins)} SVX（总币数 / ${box.claimDays || 30} 天，不乘系数）<br>
          领取窗口：${box.currentWindowEndsAt ? new Date(box.currentWindowEndsAt).toLocaleString('zh-CN', { hour12:false }) : '—'} 前领取，过期作废。
        </p>
      </div>

      <div class="portal-card" style="margin-bottom:18px;padding:18px 20px;border-radius:14px;background:rgba(16,38,32,0.14);overflow-x:auto">
        <h4 style="margin:0 0 12px;color:var(--brand)">今日待领取</h4>
        ${claimRows ? `
        <table class="portal-table" style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="text-align:left;color:var(--mut);border-bottom:1px solid rgba(14,156,136,.2)">
            <th style="padding:6px">天数</th><th style="padding:6px">数量</th><th style="padding:6px">领取截止</th><th style="padding:6px">操作</th>
          </tr></thead>
          <tbody>${claimRows}</tbody>
        </table>
        <p style="margin:10px 0 0;color:var(--mut);font-size:12px">领取后进入SVX余额，同时获得蓄能额度，可用于超速驱动协议。</p>` : '<p style="margin:0;color:var(--mut);font-size:12px">今天暂时没有可领取额度（每天 UTC 00:00（北京 08:00）开放领取，次日同一时点未领作废）。</p>'}
      </div>` : `
      <div class="portal-card" style="margin-bottom:18px;padding:20px;border-radius:14px;background:rgba(16,38,32,0.14)">
        <h4 style="margin:0 0 10px;color:var(--brand)">参与盲盒</h4>
        <p style="margin:0 0 14px;color:var(--mut);font-size:12px;line-height:1.8">
          注册后可支付 1 USDT（全额进 LP 池）→ 随机获得 100–500 枚 SVX。<br>
          30 天内每天手动领取「总币数 ÷ 30」的固定额度；次日 UTC 00:00（北京 08:00）未领当天作废，不滚存。<br>
          每个地址仅限参与 1 次。
        </p>
        <button class="btn-copy" onclick="window.blindBoxJoin()" style="padding:10px 20px;border-radius:10px;background:rgba(14,156,136,.18);border-color:rgba(14,156,136,.45);color:var(--brand);font-weight:700">支付 ${rules.entryUsdt} USDT 开盲盒</button>
      </div>`}

      <div class="portal-card" style="padding:18px 20px;border-radius:14px;background:rgba(16,38,32,0.14)">
        <h4 style="margin:0 0 10px;color:var(--brand)">规则</h4>
        <p style="margin:0;color:var(--mut);font-size:12px;line-height:1.8">
          · 计价 0.1 USDT/枚，价值区间 10–50 USDT（100–500 枚）。<br>
          · 奖品范围 100–500 枚 SVX，具体档位概率不对外公开。<br>
          · 领取周期 30 天，每天手动领取；每日额度固定为「总币数 ÷ 30」，不乘任何系数。<br>
          · 次日 UTC 00:00（北京 08:00）未领，当天额度过期作废且不滚存；累计发放封顶总币数，领完即结束。<br>
          · 产出进入主余额并获得蓄能额度，通过超速驱动协议获得卖出额度；不计团队业绩与推广收益。
        </p>
      </div>`;
  }

  async function blindBoxReload() {
    blindBoxCache = await authApi('blindbox').catch(() => blindBoxCache);
    profileCache = await authApi('profile').catch(() => profileCache);
    renderSubTab();
  }

  window.blindBoxJoin = async () => {
    if (mpBusy) return;
    const entry = blindBoxCache?.rules?.entryUsdt || '1';
    if (!await confirmDialog(`确认支付 ${entry} USDT 参与盲盒？每个地址仅限 1 次，支付金额全额进入 LP 池。`)) return;
    mpBusy = true;
    try {
      const requestId = 'ablb_' + (globalThis.crypto?.randomUUID?.() || String(Date.now())).replaceAll('-', '');
      const timestamp = String(Date.now());
      const msg = `Solvex 盲盒参与确认：支付 1 USDT，编号 ${requestId}，时间：${timestamp}`;
      const addr = String(window.currentWalletConnection?.address || '').toLowerCase();
      const provider = typeof connectedProvider !== 'undefined' ? connectedProvider : null;
      if (!addr || !provider) { showErr('请先连接钱包'); return; }
      const signature = await provider.request({ method: 'personal_sign', params: [msg, addr] });
      await authApi('blindbox/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
        body: JSON.stringify({ timestamp, signature }),
      });
      showOk('盲盒已开启，记得每天领取');
      await blindBoxReload();
    } catch (e) { showErr(friendlyError(e, '参与盲盒失败')); }
    finally { mpBusy = false; }
  };

  window.blindBoxClaim = async (id) => {
    try {
      await authApi('pending/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      showOk('领取成功，SVX及蓄能额度已到账');
      await blindBoxReload();
    } catch (e) { showErr(friendlyError(e, '领取失败')); }
  };

  // ── 股东（新规）：500U / 1000U 两档付费身份，两档独立 500U 池 ──
  function renderShareholder() {
    const s = shareholderCache || profileCache?.shareholder || null;
    const member = s?.member || null;
    const active = member?.status === 'active';
    const usdt = v => `${fmtA(v)} USDT`;
    const tiers = s?.tiers || [];
    const dividends = s?.dividends || [];
    const pools = s?.pools || [];
    const burn = s?.feeBurn || null;
    const tierCard = (t) => {
      const pool = t.currentPool;
      const pct = pool ? Math.max(0, Math.min(100, Number(pool.progressPct) || 0)) : 0;
      const mine = active && member.tier === t.key;
      let action = '';
      if (t.enabled === false) {
        action = '<span style="color:#d9b06b">暂未开放 · 70%分红留存</span>';
      } else if (!active) {
        action = `<button class="btn-copy" onclick="window.shareholderJoin('${t.key}')" style="padding:9px 16px;border-radius:10px;background:rgba(14,156,136,.18);border-color:rgba(14,156,136,.45);color:var(--brand);font-weight:700">加入 ${t.label}（${fmtA(t.priceUsdt)} USDT）</button>`;
      } else if (mine) {
        action = `<span style="color:var(--brand);font-size:12px;font-weight:700">✓ 当前档位</span>`;
      } else if (member.tier === 't500' && t.key === 't1000') {
        action = `<button class="btn-copy" onclick="window.shareholderUpgrade()" style="padding:9px 16px;border-radius:10px;background:rgba(246,196,84,.14);border-color:rgba(246,196,84,.4);color:#d9b06b;font-weight:700">升档补 500 USDT</button>`;
      } else {
        action = `<span style="color:var(--mut);font-size:12px">不支持降档</span>`;
      }
      return `
        <div class="portal-card" style="padding:18px 20px;border-radius:14px;background:rgba(16,38,32,0.14)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h4 style="margin:0;color:var(--brand)">${t.label}</h4>
            <span style="color:var(--mut);font-size:12px">分红占比 ${Number(t.dividendPct)}%</span>
          </div>
          <p style="margin:0 0 10px;color:var(--mut);font-size:12px;line-height:1.6">加入价 ${fmtA(t.priceUsdt)} USDT · 每满 500 USDT 开新池（独立编号）· 股东 ${Number(t.members || 0)} 人（达标 ${Number(t.eligibleMembers || 0)}）</p>
          <div style="height:10px;border-radius:6px;background:rgba(0,0,0,.35);overflow:hidden;margin-bottom:8px">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#50d2c2,#8fe0d6)"></div>
          </div>
          <div style="display:flex;justify-content:space-between;color:var(--mut);font-size:12px;margin-bottom:10px">
            <span>第 ${pool?.seq ?? '—'} 池 · ${fmtA(pool?.fundedUsdt)} USDT</span>
            <span>累计归集 ${fmtA(t.fundedTotalUsdt)} USDT</span>
          </div>
          ${action}
        </div>`;
    };
    return `
      <div class="team-hero">
        <h2>股东分红 · 500U限100份</h2>
        <p>500U档全平台限100份，加入后30天内需达到V3；1000U档暂不开放，其70%分红留存。卖出交易手续费的 50%用于SVX销毁（销毁至剩余总量10%、即1亿枚后停止，之后该份额全部转合伙人分红）、50% 进分红池；分红池按 30%（500U 档）/ 70%（1000U 档）分，两档各有独立 500 USDT 池，池内按 V3 达标股东均分。</p>
      </div>

      <div class="portal-metrics" style="margin-bottom:22px;border-radius:14px;overflow:hidden">
        ${P.metric('我的档位', active ? `<b style="color:var(--brand)">${member.tierLabel}</b>` : (member?.status === 'withdrawn' ? '已撤回' : '未加入'))}
        ${P.metric('已付本金', member ? usdt(member.principalUsdt) : '—')}
        ${P.metric('累计分红', member ? usdt(member.dividendUsdt) : '—')}
        ${P.metric('V3 资格', active ? (member.s3Qualified ? '<b style="color:var(--brand)">已达标</b>' : '<b style="color:#d9b06b">未达标</b>') : '—', '团队业绩 ≥ 100,000 SVX')}
        ${P.metric('待领取分红', usdt((dividends || []).reduce((sum, d) => sum + Number(d.amountUsdt || 0), 0).toFixed(2)))}
        ${P.metric('销毁资金归集', burn ? `${fmtA(burn.totalBurnedUsdt)} USDT` : '—')}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:18px">
        ${tiers.map(tierCard).join('')}
      </div>

      <div class="portal-card" style="margin-bottom:18px;padding:18px 20px;border-radius:14px;background:rgba(16,38,32,0.14)">
        <h4 style="margin:0 0 8px;color:var(--brand)">我的股东身份</h4>
        ${active ? `
          <p style="margin:0 0 12px;color:var(--mut);font-size:12px;line-height:1.6">${member.tierLabel} · 已付本金 ${usdt(member.principalUsdt)} · 已领取分红 ${usdt(member.dividendUsdt)} · 加入时间 ${member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : '—'}</p>
          <button class="btn-copy" onclick="window.shareholderWithdraw()" style="padding:10px 18px;border-radius:10px;border-color:rgba(217,45,60,.4);color:#c62a37;background:rgba(217,45,60,.1);font-weight:700">撤回股东身份</button>
          <p style="margin:10px 0 0;color:var(--mut);font-size:12px">退回金额 = 已付本金 ${usdt(member.principalUsdt)} − 已领取分红 ${usdt(member.dividendUsdt)}；未领取分红作废。加入满30天仍未达V3将撤回分红权限。</p>
        ` : `
          <p style="margin:0;color:var(--mut);font-size:12px;line-height:1.6">股东500U档全平台限100份，每钱包一份。加入后30天内需满足V3双条件（升级舱5000 SVX、团队业绩10万SVX）；1000U档暂不开放，其70%分红先留存。</p>
        `}
      </div>

      <div class="portal-card" style="margin-bottom:18px;padding:18px 20px;border-radius:14px;background:rgba(16,38,32,0.14)">
        <h4 style="margin:0 0 12px;color:var(--brand)">待领取分红</h4>
        ${dividends.length ? `
        <table class="portal-table" style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="text-align:left;color:var(--mut);border-bottom:1px solid rgba(14,156,136,.2)">
            <th style="padding:6px">分池</th><th style="padding:6px">金额</th><th style="padding:6px">可领取时间</th><th style="padding:6px">过期时间</th>
          </tr></thead>
          <tbody>
            ${dividends.slice(0, 20).map(d => `<tr>
              <td data-label="分池" style="padding:6px;color:#4b6c65">${d.poolId}</td>
              <td data-label="金额" style="padding:6px;color:var(--brand);font-weight:600">${usdt(d.amountUsdt)}</td>
              <td data-label="可领取时间" style="padding:6px;color:var(--mut)">${d.availableAt ? new Date(d.availableAt).toLocaleString('zh-CN', { hour12:false }) : '—'}</td>
              <td data-label="过期时间" style="padding:6px;color:var(--mut)">${d.expiresAt ? new Date(d.expiresAt).toLocaleString('zh-CN', { hour12:false }) : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <p style="margin:10px 0 0;color:var(--mut);font-size:12px">分红进入「待领取」，每天 UTC 00:00（北京 08:00）开放领取，次日同一时点未领作废。</p>` : '<p style="margin:0;color:var(--mut);font-size:12px">暂无待领取分红。</p>'}
      </div>

      <div class="portal-card" style="margin-bottom:18px;padding:18px 20px;border-radius:14px;background:rgba(16,38,32,0.14);overflow-x:auto">
        <h4 style="margin:0 0 12px;color:var(--brand)">手续费销毁流水</h4>
        <p style="margin:0 0 10px;color:var(--mut);font-size:12px">${burn?.rule || '每笔卖出手续费 50% 销毁、50% 进分红池（买入 0 手续费）'} · 累计手续费 ${fmtA(burn?.totalFeeUsdt)} USDT · 已销毁 <b style="color:#c62a37">${fmtA(burn?.totalBurnedUsdt)} USDT</b> · 进池 ${fmtA(burn?.totalPoolUsdt)} USDT</p>
        ${(burn?.entries || []).length ? `
        <table class="portal-table" style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="text-align:left;color:var(--mut);border-bottom:1px solid rgba(14,156,136,.2)">
            <th style="padding:6px">时间</th><th style="padding:6px">来源</th><th style="padding:6px">手续费</th><th style="padding:6px">销毁 50%</th><th style="padding:6px">进池 50%</th>
          </tr></thead>
          <tbody>
            ${(burn?.entries || []).slice(0, 20).map(e => `<tr>
              <td data-label="时间" style="padding:6px;color:var(--mut)">${e.createdAt ? new Date(e.createdAt).toLocaleString('zh-CN', { hour12:false }) : '—'}</td>
              <td data-label="来源" style="padding:6px;color:#4b6c65">${escapeHtml(e.source)}</td>
              <td data-label="手续费" style="padding:6px;color:#477166">${fmtA(e.feeUsdt)} USDT</td>
              <td data-label="销毁" style="padding:6px;color:#c62a37">${fmtA(e.burnUsdt)} USDT</td>
              <td data-label="进池" style="padding:6px;color:var(--brand)">${fmtA(e.poolUsdt)} USDT</td>
            </tr>`).join('')}
          </tbody>
        </table>` : '<p style="margin:0;color:var(--mut);font-size:12px">暂无销毁流水。</p>'}
      </div>

      <div class="portal-card" style="margin-bottom:18px;padding:18px 20px;border-radius:14px;background:rgba(16,38,32,0.14);overflow-x:auto">
        <h4 style="margin:0 0 12px;color:var(--brand)">分池记录</h4>
        ${pools.length ? `
        <table class="portal-table" style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="text-align:left;color:var(--mut);border-bottom:1px solid rgba(14,156,136,.2)">
            <th style="padding:6px">档位</th><th style="padding:6px">池</th><th style="padding:6px">归集</th><th style="padding:6px">状态</th><th style="padding:6px">分红人数</th><th style="padding:6px">每人</th>
          </tr></thead>
          <tbody>
            ${pools.slice(0, 30).map(p => {
              const st = p.status === 'filling' ? '归集中' : p.status === 'closed' ? '待分红' : '已分红';
              const dist = p.distribution || null;
              return `<tr>
                <td data-label="档位" style="padding:6px;color:#4b6c65">${escapeHtml(p.tierLabel || p.tier)}</td>
                <td data-label="池" style="padding:6px;color:#4b6c65">#${p.seq}</td>
                <td data-label="归集" style="padding:6px;color:#477166">${fmtA(p.fundedUsdt)} USDT</td>
                <td data-label="状态" style="padding:6px;color:${p.status === 'settled' ? '#50d2c2' : p.status === 'closed' ? '#f6c454' : '#81918e'}">${st}</td>
                <td data-label="分红人数" style="padding:6px;color:var(--mut)">${dist ? dist.members : '—'}</td>
                <td data-label="每人" style="padding:6px;color:var(--mut)">${dist ? usdt(Number(dist.shareUnits) / 1e6) : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>` : '<p style="margin:0;color:var(--mut);font-size:12px">还没有股东池记录。</p>'}
      </div>`;
  }

  async function shareholderReload() {
    shareholderCache = await authApi('shareholder').catch(() => shareholderCache);
    profileCache = await authApi('profile').catch(() => profileCache);
    renderSubTab();
  }

  window.shareholderJoin = async (tierKey) => {
    if (mpBusy) return;
    const s = shareholderCache || profileCache?.shareholder || null;
    const tier = (s?.tiers || []).find(t => t.key === tierKey) || (tierKey === 't1000'
      ? { key: 't1000', label: '1000U 档', priceUsdt: '1000' }
      : { key: 't500', label: '500U 档', priceUsdt: '500' });
    if (!await confirmDialog(`确认支付 ${tier.priceUsdt} USDT 加入${tier.label}？未完成 V3（团队业绩 10 万 SVX）不参与分红；撤回时退回本金 − 已分红。`)) return;
    mpBusy = true;
    try {
      const requestId = 'ashm_' + (globalThis.crypto?.randomUUID?.() || String(Date.now())).replaceAll('-', '');
      const timestamp = String(Date.now());
      const msg = `Solvex 股东加入确认：${tier.label}，支付 ${tier.priceUsdt} USDT，编号 ${requestId}，时间：${timestamp}`;
      const addr = String(window.currentWalletConnection?.address || '').toLowerCase();
      const provider = typeof connectedProvider !== 'undefined' ? connectedProvider : null;
      const signature = await provider.request({ method: 'personal_sign', params: [msg, addr] });
      await authApi('shareholder/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
        body: JSON.stringify({ tier: tier.key, timestamp, signature }),
      });
      showOk(`已加入${tier.label}：${tier.priceUsdt} USDT`);
      await shareholderReload();
    } catch (e) { showErr(friendlyError(e, '加入股东失败')); }
    finally { mpBusy = false; }
  };

  window.shareholderUpgrade = async () => {
    if (mpBusy) return;
    if (!await confirmDialog('确认补 500 USDT 差价升到 1000U 档？升档后不可降档，分红按 1000U 档池（70%）分配。')) return;
    mpBusy = true;
    try {
      const requestId = 'ashu_' + (globalThis.crypto?.randomUUID?.() || String(Date.now())).replaceAll('-', '');
      const timestamp = String(Date.now());
      const msg = `Solvex 股东升档确认：补差价 500 USDT，编号 ${requestId}，时间：${timestamp}`;
      const addr = String(window.currentWalletConnection?.address || '').toLowerCase();
      const provider = typeof connectedProvider !== 'undefined' ? connectedProvider : null;
      const signature = await provider.request({ method: 'personal_sign', params: [msg, addr] });
      await authApi('shareholder/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
        body: JSON.stringify({ timestamp, signature }),
      });
      showOk('已升档到 1000U 档（补 500 USDT）');
      await shareholderReload();
    } catch (e) { showErr(friendlyError(e, '升档失败')); }
    finally { mpBusy = false; }
  };

  window.shareholderWithdraw = async () => {
    if (mpBusy) return;
    if (!await confirmDialog('确认撤回股东身份？撤回后立即失去分红资格，退回金额 = 本金 − 已分红，未领取的分红一并作废。')) return;
    mpBusy = true;
    try {
      await authApi('shareholder/withdraw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      showOk('已撤回股东身份，退款已入 USDT 余额');
      await shareholderReload();
    } catch (e) { showErr(friendlyError(e, '撤回失败')); }
    finally { mpBusy = false; }
  };

  // ── 全局交互 ──
  const showEarnTab = (tab) => {
    if (tab === 'team') return window.switchTab('referrals');
    currentSubTab = tab;
    document.querySelectorAll('.earn-sub-tab').forEach(b => b.classList.remove('active'));
    document.querySelector(`.earn-sub-tab[onclick="window.earnSwitch('${tab}')"]`)?.classList.add('active');
    if (tab === 'matchpool' || tab === 'shareholder' || tab === 'blindbox') load();
    else if (profileCache) renderSubTab();
    else load();
  };

  window.LegacyEarn = {
    show: tab => {
      if (window.WG_REACT_APP && !document.getElementById('earn-content')) render();
      showEarnTab(tab);
    },
    deactivate: () => { ++loadSeq; stopPendingTicker(); clearInterval(mpTicker); clearInterval(poolOverviewTimer); mpTicker = null; poolOverviewTimer = null; },
  };
  if (!window.WG_REACT_APP) window.earnSwitch = showEarnTab;

  let observedWallet = '';
  // 状态变化立即重绘，并使旧请求失效；完整 API 刷新由 wallet.js 触发。
  window.addEventListener('walletstatechange', event => {
    ++loadSeq;
    const wallet = String(event.detail?.address || '').toLowerCase();
    if (wallet !== observedWallet || !event.detail?.authenticated) {
      profileCache = null;
      teamCache = null;
      shareholderCache = null;
      refProfileCache = null;
      readRequests.clear();
    }
    observedWallet = wallet;
    if (plansCache && document.getElementById('tab-earn')?.classList.contains('active')) renderSubTab();
  });

  // 邀请链接：与「推荐」页一致的 /?ref=<推荐码>
  function earnRefLink() {
    const code = refProfileCache?.code || '';
    const link = refProfileCache?.link || `/?ref=${code}`;
    return `${location.origin}${link}`;
  }

  window.earnCopyCode = async () => {
    const code = refProfileCache?.code;
    if (!code) { showErr('暂无邀请码，请先连接钱包'); return; }
    const ok = await window.copyTextSmart?.(code);
    if (ok) showOk('邀请码已复制 · ' + code);
    else { await promptDialog('请长按邀请码全选复制', code); }
  };

  window.earnCopyLink = async () => {
    const link = earnRefLink();
    if (!refProfileCache?.code) { showErr('暂无邀请链接，请先连接钱包'); return; }
    const ok = await window.copyTextSmart?.(link);
    if (ok) showOk('邀请链接已复制');
    else { await promptDialog('请长按链接全选复制', link); }
  };

  // 兼容旧按钮命名
  window.earnCopyId = window.earnCopyCode;

  function friendlyError(e, fallback) {
    if (Number(e?.code) === 4001 || /denied|rejected|cancel/i.test(e?.message || '')) return '已取消';
    return e?.message === 'SESSION_REQUIRED' ? '请先连接并确认钱包' : (e?.message || fallback || '操作失败');
  }
  function showOk(msg) { if (typeof showToast === 'function') showToast(msg, 'ok'); else alert(msg); }
  function showErr(msg) { if (typeof showToast === 'function') showToast(msg, 'error'); else alert(msg); }

  function closeStakeModal() {
    const modal = document.getElementById('earn-stake-modal');
    if (modal) modal.remove();
    document.body.classList.remove('stake-modal-open');
  }

  function normalizeStakeAmount(raw) {
    const value = String(raw ?? '').trim().replace(/,/g, '');
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
    const [whole = '0', fraction = ''] = value.split('.');
    if (fraction.length > 18) return null;
    const normalizedWhole = whole.replace(/^0+(?=\d)/, '') || '0';
    const normalized = fraction ? `${normalizedWhole}.${fraction}` : normalizedWhole;
    return Number(normalized) > 0 ? normalized : null;
  }

  function openStakeModal(planId) {
    // 2026-11-09 P1：新三档，门槛取后端配置；扣币来源是「蓄能额度」，不再用主 A 余额
    const plan = (plansCache?.staking || []).find(p => p.planId === planId) || (plansCache?.staking || [])[0] || null;
    const min = plan?.minCoins || '0';
    const label = plan ? (plan.label || planId) : planId;
    closeStakeModal();

    const zoneAlphaUnits = String(profileCache?.zones?.alpha || '0');
    const availBalance = Number(formatUnits18(zoneAlphaUnits).replace(/,/g, ''));
    const balanceText = fmtA(availBalance);

    const modal = document.createElement('div');
    modal.id = 'earn-stake-modal';
    modal.className = 'stake-modal';
    modal.setAttribute('role', 'presentation');
    modal.innerHTML = `
      <div class="stake-dialog" role="dialog" aria-modal="true" aria-labelledby="stake-modal-title">
        <div class="stake-dialog-head">
          <div><span class="stake-dialog-kicker">SVX 能量</span><h3 id="stake-modal-title">${escapeHtml(label)}</h3></div>
          <button type="button" class="stake-dialog-close" data-stake-close aria-label="关闭">×</button>
        </div>
        <div class="stake-dialog-body">
          <div class="stake-plan-summary"><span>最低质押</span><strong>${min} 币</strong><small>从蓄能额度扣币，每日释放原额度1%，不能提前赎回</small></div>
          <label class="stake-amount-label" for="stake-amount-input">质押数量</label>
          <div class="stake-amount-field"><input id="stake-amount-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${min}" aria-describedby="stake-amount-hint"><button type="button" class="stake-max-btn" data-stake-max title="质押全部蓄能额度余额">Max</button></div>
          <div id="stake-amount-hint" class="stake-amount-hint">支持最多 18 位小数 · 最小 ${min} 币</div>
          <div class="stake-balance-line">蓄能额度可用 <b>${balanceText} 币</b></div>
          <div id="stake-amount-error" class="stake-amount-error" role="alert" aria-live="polite"></div>
          <div class="stake-quick-amounts" aria-label="快捷数量">
            <button type="button" data-stake-quick="${min}">${min} 币</button>
            <button type="button" data-stake-quick="${Number(min) * 2}">${Number(min) * 2} 币</button>
            <button type="button" data-stake-quick="${Number(min) * 5}">${Number(min) * 5} 币</button>
          </div>
        </div>
        <div class="stake-dialog-actions"><button type="button" class="stake-cancel" data-stake-close>取消</button><button type="button" class="stake-confirm" data-stake-submit>确认投入能量</button></div>
      </div>`;
    document.body.appendChild(modal);
    document.body.classList.add('stake-modal-open');

    const input = modal.querySelector('#stake-amount-input');
    const error = modal.querySelector('#stake-amount-error');
    const submit = modal.querySelector('[data-stake-submit]');
    const setError = message => { error.textContent = message || ''; input.classList.toggle('invalid', Boolean(message)); };
    const fillMax = () => {
      if (availBalance <= 0) { setError('可用余额不足'); return; }
      const maxStr = availBalance.toLocaleString('en-US', { maximumFractionDigits: 18, useGrouping: false });
      input.value = maxStr;
      input.focus();
      setError('');
    };
    const validate = () => {
      const amount = normalizeStakeAmount(input.value);
      if (!amount) { setError('请输入有效的币数'); return null; }
      if (Number(amount) < Number(min)) { setError(`最低质押 ${min} 币`); return null; }
      if (Number(amount) > availBalance) { setError(`蓄能额度余额不足，可用 ${balanceText} 币`); return null; }
      setError('');
      return amount;
    };
    modal.querySelectorAll('[data-stake-close]').forEach(button => button.addEventListener('click', closeStakeModal));
    modal.addEventListener('click', event => { if (event.target === modal) closeStakeModal(); });
    modal.querySelectorAll('[data-stake-quick]').forEach(button => button.addEventListener('click', () => { input.value = button.dataset.stakeQuick; input.focus(); setError(''); }));
    modal.querySelector('[data-stake-max]').addEventListener('click', fillMax);
    input.addEventListener('input', () => setError(''));
    input.addEventListener('keydown', event => { if (event.key === 'Enter') submit.click(); if (event.key === 'Escape') closeStakeModal(); });
    submit.addEventListener('click', async () => {
      const amount = validate();
      if (!amount) { input.focus(); return; }
      submit.disabled = true;
      submit.textContent = '提交中…';
      try { await earnDoStake(planId, amount); }
      finally { if (document.body.contains(modal)) { submit.disabled = false; submit.textContent = '确认投入能量'; } }
    });
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  window.earnStake = (planId) => openStakeModal(planId);

  function formatUnits18(uStr) {
    if (!uStr) return '0';
    const s = String(uStr).replace(/^-/, '').padStart(19, '0');
    const intPart = s.slice(0, s.length - 18) || '0';
    const decPart = s.slice(s.length - 18).replace(/0+$/, '');
    return intPart + (decPart ? '.' + decPart : '');
  }

  async function earnDoStake(planId, amount) {
    try {
      const r = await authApi('stake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId, principal: amount }) });
      const label = planId === 'energy' ? '能量' : planId;
      const displayA = r?.stake?.principalUnits ? formatUnits18(r.stake.principalUnits) : fmtA(amount);
      showOk(`质押成功 · ${label} ${displayA} 币，到期后收益进入「待领取」`);
      closeStakeModal();
      profileCache = await authApi('profile').catch(() => profileCache);
      renderSubTab();
    } catch (e) { showErr(friendlyError(e, '质押失败')); }
  }
  window.earnDoStake = earnDoStake;

  // 按记录 ID 合并本地激活历史，保留同一钱包的多次 Pro 激活。
  function applyActivationLocally(planKey, status, activation) {
    if (!profileCache) profileCache = {};
    if (!Array.isArray(profileCache.activations)) profileCache.activations = [];
    const list = profileCache.activations;
    const record = activation?.record || activation || {};
    const idx = record.id ? list.findIndex(a => a.id === record.id) : -1;
    const entry = { ...record, plan: planKey, status };
    if (idx >= 0) list[idx] = { ...list[idx], ...entry };
    else list.unshift(entry);
  }

  // 激活提交兜底：链上付款完成后若站内提交失败（网络抖动/会话过期），
  // 把 {wallet, plan, txHash} 存 localStorage，下次进站自动补交，避免"扣了BNB没矿机"的漏单。
  const ACT_RETRY_KEY = 'solvex_activation_retry_v1';
  const ACT_RETRY_MAX_TRIES = 5;
  function saveActivationRetry(wallet, planKey, txHash, tries = 0) {
    try { localStorage.setItem(ACT_RETRY_KEY, JSON.stringify({ wallet, plan: planKey, txHash, tries, at: Date.now() })); } catch {}
  }
  function readActivationRetry() {
    try { return JSON.parse(localStorage.getItem(ACT_RETRY_KEY) || 'null'); } catch { return null; }
  }
  function clearActivationRetry() { try { localStorage.removeItem(ACT_RETRY_KEY); } catch {} }

  // 下次进站自动补交：仅当当前登录钱包与存单一致；服务端已受理/已激活视为完成并清除；最多补交 5 次。
  async function retryPendingActivation() {
    const r = readActivationRetry();
    if (!r || !r.txHash) return;
    if (Date.now() - (r.at || 0) > 7 * 864e5) { clearActivationRetry(); return; }
    const cur = window.currentWalletConnection?.address
      || (typeof connectedWalletAddress !== 'undefined' ? connectedWalletAddress : '');
    if (!cur || String(cur).toLowerCase() !== String(r.wallet).toLowerCase()) return; // 换了钱包登录：不补交，等原钱包
    if ((r.tries || 0) >= ACT_RETRY_MAX_TRIES) return;
    try {
      saveActivationRetry(r.wallet, r.plan, r.txHash, (r.tries || 0) + 1);
      const result = await authApi('activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: r.plan, txHash: r.txHash }) });
      clearActivationRetry();
      showOk('检测到上次支付后提交未完成，已自动补交，链上确认后将自动发放矿机');
      applyActivationLocally(r.plan, result.activation?.status || 'pending', result.activation);
      pollActivationStatus();
      profileCache = await authApi('profile').catch(() => profileCache);
      renderSubTab();
    } catch (e) {
      // 已提交/已激活等"实质完成"的服务端错误：清除存单；其余错误保留，下次进站再试
      if (/已提交|已激活|仅可激活一次/.test(e?.message || '')) clearActivationRetry();
    }
  }

  // Keep the same request ID across timeouts, reloads and re-signing.
  const SVX_RETRY_KEY = 'solvex_activation_svx_request_v1';
  let activationInFlight = false;
  const activationWallet = () => String(window.currentWalletConnection?.address || '').toLowerCase();
  const svxRetryStorageKey = () => SVX_RETRY_KEY + ':' + activationWallet();
  function readSvxRetry() {
    try { return JSON.parse(localStorage.getItem(svxRetryStorageKey()) || 'null'); } catch { return null; }
  }
  function saveSvxRetry(r) {
    localStorage.setItem(SVX_RETRY_KEY + ':' + r.wallet, JSON.stringify(r));
  }
  function clearSvxRetry(r) {
    localStorage.removeItem(SVX_RETRY_KEY + ':' + r.wallet);
  }
  async function activationSucceeded(record, wallet) {
    if (wallet !== activationWallet()) return;
    applyActivationLocally(record.plan, record.status, record);
    clearProfileCache();
    window.dispatchEvent(new CustomEvent('svx:balance-changed'));
    const qty = Number(record.payload?.quantity) || 1;
    showOk('激活成功' + (qty > 1 ? '（' + qty + ' 台）' : '') + '，' + (Number(record.payload?.svx || record.payload?.aix || 0) * qty) + ' SVX 已全额销毁，矿机已发放');
    const fresh = await authApi('profile').catch(() => null);
    if (wallet !== activationWallet()) return;
    if (fresh) { profileCache = fresh; writeProfileCache(wallet, fresh); }
    renderSubTab();
  }
  async function svxRequestStatus(r) {
    return (await authApi('activation-request?plan=' + encodeURIComponent(r.plan) + '&requestId=' + encodeURIComponent(r.requestId))).record;
  }
  async function submitSvxRequest(r) {
    return (await authApi('activate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': r.requestId },
      body: JSON.stringify({ plan: r.plan, signature: r.signature, timestamp: r.timestamp, quantity: Number(r.quantity) || 1 }) })).activation.record;
  }
  async function retrySvxActivation() {
    const r = readSvxRetry();
    if (!r || r.wallet !== activationWallet() || activationInFlight) return;
    activationInFlight = true;
    let submitted = false;
    try {
      let record = await svxRequestStatus(r);
      if (r.wallet !== activationWallet()) return;
      if (!record && Date.now() - Number(r.timestamp) < 240000) { submitted = true; record = await submitSvxRequest(r); }
      if (record) { clearSvxRetry(r); await activationSucceeded(record, r.wallet); }
      else showOk('有一笔激活尚未确认，点击激活可继续同一笔请求');
    } catch (e) {
      if (submitted && e.status === 400) { clearSvxRetry(r); showErr(e.message); }
    }
    finally { activationInFlight = false; renderSubTab(); }
  }
  function closeProQuantityModal() {
    const modal = document.getElementById('earn-pro-qty-modal');
    if (modal) modal.remove();
    document.body.classList.remove('stake-modal-open');
  }

  // Pro 批量激活台数弹窗：确认 resolve(台数)，取消 resolve(null)。复用质押弹窗样式。
  function openProQuantityModal(plan) {
    return new Promise(resolve => {
      closeProQuantityModal();
      const per = Number(plan.svx);
      const perTotal = Number(plan.total);
      const perDaily = perTotal / Number(plan.days);
      const balA = profileCache?.balances?.A;
      const maxAffordable = Math.floor(Number(balA || 0) / per);
      const modal = document.createElement('div');
      modal.id = 'earn-pro-qty-modal';
      modal.className = 'stake-modal';
      modal.setAttribute('role', 'presentation');
      modal.innerHTML = `
        <div class="stake-dialog" role="dialog" aria-modal="true" aria-labelledby="pro-qty-title">
          <div class="stake-dialog-head">
            <div><span class="stake-dialog-kicker">SVX 激活</span><h3 id="pro-qty-title">Pro 矿机 · 选择台数</h3></div>
            <button type="button" class="stake-dialog-close" data-pro-qty-close aria-label="关闭">×</button>
          </div>
          <div class="stake-dialog-body">
            <div class="stake-plan-summary"><span>单价</span><strong>${per} SVX / 台</strong><small>每台 ${Number(plan.days)} 天总产出 ${perTotal} SVX · 激活代币全额销毁</small></div>
            <label class="stake-amount-label" for="pro-qty-input">购买台数（单次最多 100 台）</label>
            <div class="stake-amount-field"><input id="pro-qty-input" type="number" inputmode="numeric" min="1" max="100" step="1" value="1" autocomplete="off" aria-describedby="pro-qty-summary"><button type="button" class="stake-max-btn" data-pro-qty-max title="按余额可购上限">Max</button></div>
            <div class="stake-balance-line">SVX 余额 <b>${balA != null ? fmtA(balA) : '—'} SVX</b></div>
            <div id="pro-qty-summary" class="stake-amount-hint">合计销毁 ${per} SVX · 总产出 ${perTotal} SVX · 日产约 ${perDaily.toFixed(2)} SVX/天</div>
            <div id="pro-qty-error" class="stake-amount-error" role="alert" aria-live="polite"></div>
            <div class="stake-quick-amounts" aria-label="快捷台数">
              <button type="button" data-pro-qty-quick="1">1 台</button>
              <button type="button" data-pro-qty-quick="5">5 台</button>
              <button type="button" data-pro-qty-quick="10">10 台</button>
            </div>
          </div>
          <div class="stake-dialog-actions"><button type="button" class="stake-cancel" data-pro-qty-close>取消</button><button type="button" class="stake-confirm" data-pro-qty-submit>下一步</button></div>
        </div>`;
      document.body.appendChild(modal);
      document.body.classList.add('stake-modal-open');
      const input = modal.querySelector('#pro-qty-input');
      const errorEl = modal.querySelector('#pro-qty-error');
      const summary = modal.querySelector('#pro-qty-summary');
      const close = value => { closeProQuantityModal(); resolve(value); };
      const setError = message => { errorEl.textContent = message || ''; input.classList.toggle('invalid', Boolean(message)); };
      const readQty = () => Math.floor(Number(input.value));
      const updateSummary = () => {
        const q = Math.max(1, readQty() || 1);
        summary.textContent = `合计销毁 ${per * q} SVX · 总产出 ${perTotal * q} SVX · 日产约 ${(perDaily * q).toFixed(2)} SVX/天`;
      };
      const validate = () => {
        const q = readQty();
        if (!Number.isFinite(q) || q < 1) { setError('请输入有效台数'); return null; }
        if (q > 100) { setError('单次最多 100 台'); return null; }
        if (q > maxAffordable) { setError(`SVX 余额不足：最多可购 ${Math.max(0, maxAffordable)} 台`); return null; }
        setError('');
        return q;
      };
      modal.querySelectorAll('[data-pro-qty-close]').forEach(button => button.addEventListener('click', () => close(null)));
      modal.addEventListener('click', event => { if (event.target === modal) close(null); });
      modal.querySelectorAll('[data-pro-qty-quick]').forEach(button => button.addEventListener('click', () => { input.value = button.dataset.proQtyQuick; input.focus(); setError(''); updateSummary(); }));
      modal.querySelector('[data-pro-qty-max]').addEventListener('click', () => {
        const q = Math.min(100, maxAffordable);
        if (q < 1) { setError('SVX 余额不足，无法购买'); return; }
        input.value = q; input.focus(); setError(''); updateSummary();
      });
      input.addEventListener('input', () => { setError(''); updateSummary(); });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { const q = validate(); if (q) close(q); }
        if (event.key === 'Escape') close(null);
      });
      modal.querySelector('[data-pro-qty-submit]').addEventListener('click', () => {
        const q = validate();
        if (q) close(q); else input.focus();
      });
      requestAnimationFrame(() => { input.focus(); input.select(); });
    });
  }

  window.earnActivate = async (planKey) => {
    if (activationInFlight) return;
    activationInFlight = true;
    const wallet = activationWallet();
    const provider = typeof connectedProvider !== 'undefined' ? connectedProvider : null;
    const assertWallet = () => {
      if (!wallet || wallet !== activationWallet() || provider !== connectedProvider) throw new Error('钱包账户已切换，请重新验证');
    };
    let pending;
    let requestSent = false;
    try {
      pending = readSvxRetry();
      if (pending) {
        const record = await svxRequestStatus(pending);
        assertWallet();
        if (record) { clearSvxRetry(pending); await activationSucceeded(record, wallet); return; }
        // Finish the unresolved purchase before creating another one.
        planKey = pending.plan;
      }
      plansCache = await fetchPlansFresh();
      assertWallet();
      if (!['svx_balance', 'aix_balance'].includes(plansCache.paymentMode)) throw new Error('激活规则正在更新，请稍后刷新页面');
      if (plansCache.activationEnabled === false) throw new Error('矿机激活暂未开放');
      const plan = plansCache.activation.find(p => p.plan === planKey);
      if (!plan || !['20', '400'].includes(plan.svx)) throw new Error('激活套餐无效，请刷新页面');
      profileCache = await authApi('profile');
      assertWallet();
      if (planKey === '1' && ((profileCache.activations || []).some(a => a.plan === '1' && a.status !== 'rejected')
          || (profileCache.miners || []).some(m => m.plan === 'mini120'))) throw new Error('Mini 矿机每个钱包终身仅可激活一次');
      // 台数：Pro 弹窗选择（续单沿用 pending 保存的台数），Mini 固定 1 台
      let quantity = Number(pending?.quantity) || 1;
      if (planKey === '2' && !pending) {
        const picked = await openProQuantityModal(plan);
        assertWallet();
        if (!picked) return;
        quantity = picked;
      }
      const totalSvx = Number(plan.svx) * quantity;
      const units = value => { const [n, d = ''] = String(value || '0').split('.'); return BigInt(n) * 10n ** 18n + BigInt(d.padEnd(18, '0').slice(0,18)); };
      if (units(profileCache.balances?.A) < units(String(totalSvx))) throw new Error('可用 SVX 余额不足，激活 ' + quantity + ' 台需 ' + totalSvx + ' SVX');
      if (!provider) throw new Error('请先连接钱包');
      if (!await confirmDialog('确认使用可用余额中的 ' + totalSvx + ' SVX 激活 ' + quantity + ' 台 ' + plan.name + '？代币将全额销毁，' + plan.days + ' 天总产出 ' + (Number(plan.total) * quantity) + ' SVX。' + (pending ? '本次将继续上次未确认的激活。' : ''))) return;
      assertWallet();
      const requestId = pending?.requestId || ('act_' + crypto.randomUUID().replaceAll('-', ''));
      const timestamp = String(Date.now());
      const message = 'Solvex 矿池激活确认：套餐 ' + planKey + '，销毁 ' + totalSvx + ' SVX，编号 ' + requestId + '，时间：' + timestamp;
      const signature = await provider.request({ method: 'personal_sign', params: [message, wallet] });
      assertWallet();
      pending = { wallet, plan: planKey, requestId, timestamp, signature, quantity };
      saveSvxRetry(pending); // Persist before POST. A storage failure must never cause a purchase.
      requestSent = true;
      const record = await submitSvxRequest(pending);
      clearSvxRetry(pending);
      await activationSucceeded(record, wallet);
    } catch (e) {
      if (requestSent && pending && e.status === 400) clearSvxRetry(pending);
      showErr(friendlyError(e, '激活失败') + (requestSent && readSvxRetry() ? '；结果待确认，再次点击会核对同一笔激活，请勿另行付款' : ''));
    } finally { activationInFlight = false; renderSubTab(); }
  };

  // 激活提交后轮询状态:BSC 12 确认约 36 秒,每 8 秒查一次,最多 15 次(2 分钟);
  // 确认成功提示并刷新矿机列表,超时则提示稍后自动到账(服务端定时任务兜底)。
  async function pollActivationStatus() {
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 8000));
      try {
        const data = await authApi('activations');
        const mine = (data.activations || []).filter(a => a.status !== 'rejected');
        if (mine.some(a => a.status === 'confirmed')) {
          showOk('激活成功，矿机已发放');
          profileCache = await authApi('profile').catch(() => profileCache);
          renderSubTab();
          return;
        }
        if (!mine.some(a => a.status === 'pending')) return;
      } catch { return; }
    }
    showOk('链上确认仍在进行，矿机将在确认完成后自动发放，稍后刷新本页即可查看');
  }

  P.register('earn', { render, load, fail: e => { const h = document.getElementById('earn-content'); if (h) h.innerHTML = P.error(e.message, "Portal.load('earn',true)"); } });
})();
