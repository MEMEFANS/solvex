import { createAixTransaction } from './a-token-ledger.js';
import { formatUnits } from 'ethers';
import { nextSettlementAt } from './a-token-time.js';
import { readAixIncome, splitStakePayment, beijingDayStart } from './a-token-income.js';

const A_TOKEN_DECIMALS = 18;
const USDT_DECIMALS = 6;
const A = (n) => BigInt(n) * 10n ** BigInt(A_TOKEN_DECIMALS);

// LV1-LV10 双条件等级（2026-11-09 P3 用户确认）：
// 必须同时满足「个人升级仓金额」与「团队业绩」才可达到对应等级。
// rateBps = 自身级差比例（5% → 50%）；级差奖励 = 自身比例 − 直接下级比例。
export const TEAM_LEVELS = [
  { level: 1,  warehouseUnits: A(1000),     teamPerfUnits: A(6000),       rateBps: 500, label: 'V1' },
  { level: 2,  warehouseUnits: A(3000),     teamPerfUnits: A(30000),      rateBps: 1000, label: 'V2' },
  { level: 3,  warehouseUnits: A(5000),     teamPerfUnits: A(100000),     rateBps: 1500, label: 'V3' },
  { level: 4,  warehouseUnits: A(10000),    teamPerfUnits: A(500000),     rateBps: 2000, label: 'V4' },
  { level: 5,  warehouseUnits: A(20000),    teamPerfUnits: A(2000000),    rateBps: 2500, label: 'V5' },
  { level: 6,  warehouseUnits: A(40000),    teamPerfUnits: A(5000000),    rateBps: 3000, label: 'V6' },
  { level: 7,  warehouseUnits: A(80000),    teamPerfUnits: A(20000000),   rateBps: 3500, label: 'V7' },
  { level: 8,  warehouseUnits: A(160000),   teamPerfUnits: A(50000000),   rateBps: 4000, label: 'V8' },
  { level: 9,  warehouseUnits: A(320000),   teamPerfUnits: A(100000000),  rateBps: 4500, label: 'V9' },
  { level: 10, warehouseUnits: A(640000),   teamPerfUnits: A(500000000),  rateBps: 5000, label: 'V10' },
];
// 前端展示用（Number，禁止把 BigInt 直接放进 JSON）
const TEAM_LEVELS_VIEW = TEAM_LEVELS.map(t => ({
  level: t.level,
  label: t.label,
  warehouse: Number(formatUnits(t.warehouseUnits, A_TOKEN_DECIMALS)),
  teamPerf: Number(formatUnits(t.teamPerfUnits, A_TOKEN_DECIMALS)),
  ratePct: t.rateBps / 100,
}));

const DIRECT_STAKE_RATE_BPS = 1000n; // 直推 10%：按下级质押收益计算（2026-11-09 新规）


export function createATokenTeamService({ database, walletService, rotationAddresses = '', rotationHideViewers = '', reportingExclusions = null, pendingService = null, clock = () => Date.now() }) {
  const transaction = createAixTransaction(database, walletService);
  const k = (v) => String(v || '').toLowerCase();
  // 轮换收款地址（逗号分隔，含套餐专属格式 '2:0x..'）用于展示统计排除：
  // 只对链上收款地址生效、不计入上级看到的「激活矿机数」台数；未配置则不隐藏。
  const hiddenRotationSet = new Set(String(rotationAddresses || '').split(',')
    .map(entry => k(String(entry).split(':').pop().trim()))
    .filter(addr => /^0x[0-9a-f]{40}$/.test(addr)));
  // 需要隐去轮换激活统计的查看者（逗号分隔）：这些地址本人查看团队页时，
  // 其整棵下级里经轮换收款地址确认的激活不计入「团队激活矿机」；其他查看者不受影响。
  if (reportingExclusions !== null && (!Array.isArray(reportingExclusions.transactionHashes) || !Array.isArray(reportingExclusions.viewers)
    || !reportingExclusions.transactionHashes.every(hash => /^0x[0-9a-f]{64}$/i.test(hash))
    || !reportingExclusions.viewers.every(addr => /^0x[0-9a-f]{40}$/i.test(addr)))) {
    throw new Error('Invalid Pro reporting exclusions configuration');
  }
  if (reportingExclusions?.collectionAddresses !== undefined &&
      (!Array.isArray(reportingExclusions.collectionAddresses) ||
       !reportingExclusions.collectionAddresses.every(addr => /^0x[0-9a-f]{40}$/i.test(addr)))) {
    throw new Error('Invalid Pro reporting collection addresses');
  }
  const reportingCollections = new Set((reportingExclusions?.collectionAddresses || []).map(k));
  const reportingTxs = reportingExclusions === null ? null : new Set(reportingExclusions.transactionHashes.map(k));
  const reportingViewers = reportingExclusions === null ? rotationHideViewers : reportingExclusions.viewers.join(',');
  const hiddenViewerSet = new Set(String(reportingViewers || '').split(',')
    .map(addr => k(String(addr).trim()))
    .filter(addr => /^0x[0-9a-f]{40}$/.test(addr)));
  // 轮换地址确认激活归属钱包（lower(wallet) -> {mini,pro}，每笔对应一台矿机）。
  // 激活会持续新增，故带 TTL 缓存，避免每次请求都按收款地址回查。
  const HIDDEN_ACTIVATION_TTL = 30_000;
  let _hiddenActByWallet = null;
  let _hiddenActBuiltAt = 0;
  function hiddenActivationsByWallet() {
    const now = Date.now();
    if (_hiddenActByWallet && now - _hiddenActBuiltAt < HIDDEN_ACTIVATION_TTL) return _hiddenActByWallet;
    const map = new Map();
    // A verified transaction list overrides the expected collection address stored at submit time.
    if (reportingTxs) {
      const proWallets = database.listATokenMinerWalletsByPlan('pro1500');
      const include = row => {
        if (row?.status !== 'confirmed' || String(row.plan) !== '2' || row.paymentAsset === 'AIX' || row.paymentAsset === 'SVX' || !proWallets.has(k(row.wallet))) return;
        const hasBnbMiner = database.listATokenMiners(row.wallet).some(miner =>
          miner.plan === 'pro1500' && !String(miner.activationId || '').startsWith('ata_aix_'));
        if (hasBnbMiner) map.set(k(row.wallet), { mini: 0, pro: 1 });
      };
      for (const hash of reportingTxs) include(database.getATokenActivationByTx(hash));
      // New payments join the historical list only when their actual chain recipient was verified.
      for (const address of reportingCollections) {
        for (const row of database.listConfirmedATokenActivationsByCollection?.(address) || []) {
          if (k(row.payload?.verifiedCollectionAddress) === address) include(row);
        }
      }
      _hiddenActByWallet = map;
      _hiddenActBuiltAt = now;
      return map;
    }
    for (const addr of hiddenRotationSet) {
      for (const row of database.listConfirmedATokenActivationsByCollection?.(addr) || []) {
        const w = k(row?.wallet);
        if (!w) continue;
        const cur = map.get(w) || { mini: 0, pro: 0 };
        if (String(row?.plan) === '1') cur.mini += 1; else cur.pro += 1;
        map.set(w, cur);
      }
    }
    _hiddenActByWallet = map;
    _hiddenActBuiltAt = now;
    return map;
  }
  // 某查看者整棵下级中，轮换地址激活的台数（按档位）
  function hiddenRotationSubtreeCounts(downlines) {
    const acc = { mini: 0, pro: 0, users: 0 };
    if (!downlines?.size) return acc;
    const miniWallets = reportingTxs ? database.listATokenMinerWalletsByPlan('mini120') : null;
    for (const [w, c] of hiddenActivationsByWallet()) {
      if (downlines.has(w)) {
        const visiblePro = reportingTxs && database.listATokenMiners(w).filter(m => m.plan === 'pro1500').length > c.pro;
        acc.mini += c.mini; acc.pro += visiblePro ? 0 : c.pro;
        // A member with a visible Mini miner still counts as an activated member.
        acc.users += reportingTxs ? (miniWallets.has(w) || visiblePro ? 0 : 1) : c.mini + c.pro;
      }
    }
    return acc;
  }
  // 该钱包经轮换收款地址确认的激活笔数（每笔对应一台矿机）
  function hiddenMinerCountFor(wallet, viewer) {
    if (reportingTxs) return hiddenViewerSet.has(k(viewer)) ? (hiddenActivationsByWallet().get(k(wallet))?.pro || 0) : 0;
    if (!hiddenRotationSet.size) return 0;
    const rows = database.listATokenActivationsByWallet?.(wallet) || [];
    let hidden = 0;
    for (const row of rows) {
      if (row?.status === 'confirmed' && hiddenRotationSet.has(k(row?.payload?.collectionAddress))) hidden += 1;
    }
    return hidden;
  }

  // ── 推荐链：返回 [直推人, 间推人, 三推人, ...] ──
  // 热路径缓存（2026-10-12 0 点卡死优化）：0 点 6000+ 台矿机发奖时每台都要沿链查上级，
  // 旧实现每次全量取 6500+ 行推荐关系 + 逐跳 find（实测 11.4ms/次 ×6000 ≈ 68s 纯扫描阻塞）。
  // 改为 parentMap 一次构建（0.1ms）、查询 O(链长)（实测 6000 次 ≈ 30ms），TTL 15s 惰性刷新。
  // 新注册绑定的邀请关系最多 15s 后生效；矿机产出最早在绑定后下一个 0 点，不影响发奖正确性。
  const REFERRAL_CHAIN_TTL = 15_000;
  let _chainParent = null;   // lower(wallet) -> 推荐人地址（原始大小写）
  let _chainRawWallet = null; // lower(wallet) -> wallet（原始大小写）
  let _chainBuiltAt = 0;
  function ensureChainMaps() {
    const now = Date.now();
    if (_chainParent && now - _chainBuiltAt < REFERRAL_CHAIN_TTL) return;
    const links = activeLinks();
    const parent = new Map();
    const raw = new Map();
    for (const item of links) {
      const w = k(item.wallet);
      if (w) {
        raw.set(w, item.wallet);
        if (item.referrerWallet) parent.set(w, item.referrerWallet);
      }
    }
    _chainParent = parent;
    _chainRawWallet = raw;
    _chainBuiltAt = now;
  }
  // 推荐链向上追溯的最大层数（2026-11-12 调整：团队分润最多向上发 30 代 → 链走 30 代）
  const MAX_REWARD_CHAIN_DEPTH = 30;
  // 级差只发前 30 代（链位置 0~29）
  const LEVEL_DIFF_MAX_DEPTH = 30;
  // 团队奖只发前 9 代（链位置 0~8，首个有级别上级拿满档）
  const TEAM_AWARD_MAX_DEPTH = 9;
  // 团队业绩要覆盖整条推荐链（全团队都算），因此允许调用方传入更大的层数上限。
  const TEAM_PERF_MAX_DEPTH = 1000;
  function getReferralChain(address, maxDepth = MAX_REWARD_CHAIN_DEPTH) {
    ensureChainMaps();
    const chain = [];
    let cur = k(address);
    const visited = new Set([cur]);
    const limit = Math.max(1, Number(maxDepth) || MAX_REWARD_CHAIN_DEPTH);
    while (chain.length < limit) {
      const referrerRaw = _chainParent.get(cur);
      if (!referrerRaw) break;
      const rk = k(referrerRaw);
      // 上级在推荐表中不存在对应行时终止（与旧 links.find 语义一致）
      const referrerWallet = _chainRawWallet.get(rk);
      if (!referrerWallet || visited.has(rk)) break;
      visited.add(rk);
      chain.push(referrerWallet);
      cur = rk;
    }
    return chain;
  }

  // ── 个人持有 A（18 decimals units, BigInt）：钱包余额 + 质押中本金 ──
  // 本人级别判定用：质押不降级别、赎回不升级别，只有真正卖出/转出 SVX 才下降
  // 2026-09-27 起矿机剩余未产出不再计入个人业绩（矿机≠持仓）；团队业绩仍保留下级矿机剩余口径
  // 2026-11-12 起能量（energy）不计入持币业绩：它只是本金分期返还，不算持仓
  function getPersonalHeld(address) {
    try {
      let total = walletService.balanceUnits(address, 'A');
      for (const s of database.listATokenStakes(address)) {
        if (s.planId === 'energy') continue;
        if (s.status === 'active') total += splitStakePayment(s, s.totalEarnedUnits).outstanding;
      }
      return total;
    } catch { return 0n; }
  }

  // ── 下级质押中本金 + 矿机剩余未产出（18 decimals units, BigInt）──
  // 团队业绩用：下级质押本金 + 矿机剩余量；产出后递减，赎回则下降
  // 2026-11-12 起能量（energy）同样不计入团队持币口径
  function getStakedPrincipal(address) {
    try {
      let total = 0n;
      for (const s of database.listATokenStakes(address)) {
        if (s.planId === 'energy') continue;
        if (s.status === 'active') total += splitStakePayment(s, s.totalEarnedUnits).outstanding;
      }
      for (const m of database.listATokenMiners(address)) {
        if (m.status === 'active') {
          const remaining = BigInt(m.totalUnits || '0') - BigInt(m.totalEarnedUnits || '0');
          if (remaining > 0n) total += remaining;
        }
      }
      return total;
    } catch { return 0n; }
  }

  // ── 封禁账号剔除（2026-10-29）──
  // 团伙树挂在封禁账号之下：团队业绩/等级/分润遍历一律双向过滤封禁账号的链接——
  // 既杜绝向封禁账号发放任何奖励，也把封禁根之下的整棵子树从全量快照/日结中剪除。
  function isBanned(address) {
    try { return Boolean(walletService?.isAccountBlocked?.(address)); } catch { return false; }
  }
  // 团队上下文缓存（15s TTL）：activeLinks 过滤（3.4 万行 × 封禁判定）与
  // planMinerWallets（两次 3.5 万行 SQL 扫描）原本每次团队页/快照请求都重算。
  // 新绑定/新激活最迟 15s 后反映到团队统计（绑定与激活本身即时落库，不受影响）。
  const TEAM_CTX_TTL_MS = 15_000;
  let _activeLinksCache = null;
  function activeLinks() {
    if (_activeLinksCache && Date.now() - _activeLinksCache.at < TEAM_CTX_TTL_MS) return _activeLinksCache.links;
    const links = database.listReferralLinks().filter(item => !isBanned(item.wallet) && !isBanned(item.referrerWallet));
    _activeLinksCache = { links, at: Date.now() };
    return links;
  }

  // ── 推荐树：referrer -> [直推...] 一次构建，供批量快照/递归复用 ──
  // 按入参 links 的引用做记忆化：同一批（缓存命中的）links 只建一次树。
  let _treeCache = null;
  function buildReferralTree(links) {
    if (_treeCache?.links === links) return _treeCache.childrenMap;
    const childrenMap = new Map();
    for (const item of links) {
      const key = k(item.referrerWallet);
      if (!key) continue;
      if (!childrenMap.has(key)) childrenMap.set(key, []);
      childrenMap.get(key).push(item.wallet);
    }
    _treeCache = { links, childrenMap };
    return childrenMap;
  }

  // ── 后台手动设置的「团队展示数据」（仅前端展示，绝不参与等级/费率/分润等经济计算）──
  // 虚拟会员开通矿机即视为持有对应 SVX 业绩：Mini=100 SVX、Pro=1500 SVX（与真实新矿机满额一致）
  const VIRTUAL_MINI_HOLD_UNITS = 100n * 10n ** BigInt(A_TOKEN_DECIMALS);
  const VIRTUAL_PRO_HOLD_UNITS = 1500n * 10n ** BigInt(A_TOKEN_DECIMALS);

  let _planMinerCache = null;
  function planMinerWallets() {
    if (_planMinerCache && Date.now() - _planMinerCache.at < TEAM_CTX_TTL_MS) return { mini:_planMinerCache.mini, pro:_planMinerCache.pro };
    const result = {
      mini: database.listATokenMinerWalletsByPlan?.('mini120') || new Set(),
      pro: database.listATokenMinerWalletsByPlan?.('pro1500') || new Set(),
    };
    _planMinerCache = { at: Date.now(), mini:result.mini, pro:result.pro };
    return result;
  }

  // 真实团队统计：人数按去重钱包计；Mini/Pro 按矿机档位分别统计（同一人开两档则各计一次）
  function realTeamStats(address, linksArg = null) {
    const links = linksArg || database.listReferralLinks();
    const childrenMap = buildReferralTree(links);
    const { mini, pro } = planMinerWallets();
    const ak = k(address);
    const directSet = new Set((childrenMap.get(ak) || []).map(w => k(w)).filter(w => w && w !== ak));
    // 间推：直推的直推（去重，排除本人与直推）
    const indirectSet = new Set();
    for (const d of directSet) {
      for (const g of (childrenMap.get(d) || [])) {
        const gk = k(g);
        if (gk && gk !== ak && !directSet.has(gk)) indirectSet.add(gk);
      }
    }
    // 全部下级（迭代遍历；团队口径含直推，与 profile() 的 teamCount/teamMini/teamPro 一致）
    const downlines = new Set(directSet);
    const stack = [...directSet];
    while (stack.length) {
      const cur = stack.pop();
      for (const w of (childrenMap.get(cur) || [])) {
        const wk = k(w);
        if (wk && wk !== ak && !downlines.has(wk)) { downlines.add(wk); stack.push(wk); }
      }
    }
    let directMini = 0, directPro = 0, teamMini = 0, teamPro = 0;
    for (const w of directSet) {
      if (mini.has(w)) directMini += 1;
      if (pro.has(w)) directPro += 1;
    }
    for (const w of downlines) {
      if (mini.has(w)) teamMini += 1;
      if (pro.has(w)) teamPro += 1;
    }
    return {
      directCount: directSet.size, indirectCount: indirectSet.size, teamCount: downlines.size,
      directMini, directPro, teamMini, teamPro,
      directSet, indirectSet, downlines, childrenMap,
    };
  }

  // 后台查询：某地址整个团队（含各级下线）的 mini/pro 激活数，并按直推拆分，便于按直推排除
  // excludeList：要排除的直推钱包（排除其本人及其整棵子树），用于看「去掉某个直推后」的净数
  function teamActivationBreakdown(address, excludeList = []) {
    const links = activeLinks();
    const stats = realTeamStats(address, links);
    const { mini, pro: rawPro } = planMinerWallets();
    const hidden = reportingTxs && hiddenViewerSet.has(k(address))
      ? new Map([...hiddenActivationsByWallet()].filter(([w, c]) => database.listATokenMiners(w).filter(m => m.plan === 'pro1500').length <= c.pro)) : new Map();
    const pro = new Set([...rawPro].filter(w => !hidden.has(w)));
    const hiddenPro = [...stats.downlines].filter(w => rawPro.has(w) && hidden.has(w)).length;
    const hiddenDirectPro = [...stats.directSet].filter(w => rawPro.has(w) && hidden.has(w)).length;
    const ak = k(address);
    const childrenMap = stats.childrenMap;
    const directRows = [];
    for (const d of stats.directSet) {
      // 该直推的整棵子树（含直推本人；不跨回查询地址）
      const set = new Set([d]);
      const stack = [d];
      while (stack.length) {
        const cur = stack.pop();
        for (const w of (childrenMap.get(cur) || [])) {
          const wk = k(w);
          if (wk && wk !== ak && !set.has(wk)) { set.add(wk); stack.push(wk); }
        }
      }
      let mi = 0, pr = 0;
      for (const w of set) { if (mini.has(w)) mi += 1; if (pro.has(w)) pr += 1; }
      directRows.push({ wallet: d, members: set.size, mini: mi, pro: pr });
    }
    directRows.sort((a, b) => (b.mini + b.pro) - (a.mini + a.pro) || b.members - a.members || a.wallet.localeCompare(b.wallet));
    const excludes = (Array.isArray(excludeList) ? excludeList : [excludeList]).map(x => k(x)).filter(Boolean);
    const excludedSet = new Set(excludes);
    const excludedRows = directRows.filter(r => excludedSet.has(r.wallet));
    const s = (rows, key) => rows.reduce((sum, r) => sum + r[key], 0);
    return {
      address: ak,
      directCount: stats.directCount, indirectCount: stats.indirectCount, teamCount: stats.teamCount,
      teamMini: stats.teamMini, teamPro: stats.teamPro - hiddenPro,
      directMini: stats.directMini, directPro: stats.directPro - hiddenDirectPro,
      rawTeamPro: stats.teamPro, excludedRotationPro: hiddenPro,
      directRows,
      excluded: excludedRows.map(r => r.wallet),
      excludedMini: s(excludedRows, 'mini'), excludedPro: s(excludedRows, 'pro'), excludedMembers: s(excludedRows, 'members'),
      netMini: stats.teamMini - s(excludedRows, 'mini'),
      netPro: stats.teamPro - hiddenPro - s(excludedRows, 'pro'),
      netTeamCount: stats.teamCount - s(excludedRows, 'members'),
    };
  }

  // 父链：钱包(小写) -> 直推上级(小写)
  function parentMapOf(links) {
    const m = new Map();
    for (const item of links) if (item.referrerWallet) m.set(k(item.wallet), k(item.referrerWallet));
    return m;
  }

  // 计算某地址在全部展示覆盖下的叠加量：
  //   ① 本人被设置 → 本人页面各项直接叠加；
  //   ② 后代地址被设置 → 沿真实推荐链向上汇总：其虚拟团队成员/团队矿机/团队业绩计入每个真实上级，
  //      其虚拟直推仅计入它「直推上级」的间推人数。
  function virtualStatsAccrual(address, linksArg = null, context = null) {
    const rows = context?.rows || database.listATokenTeamStatsOverrides?.() || [];
    const acc = {
      dDirect: 0, dIndirect: 0, dTeam: 0,
      dDirectMini: 0, dDirectPro: 0, dTeamMini: 0, dTeamPro: 0,
      directHoldUnits: 0n, teamHoldUnits: 0n,
      directHoldUsers: 0, teamHoldUsers: 0,
      own: false,
    };
    if (!rows.length) return acc;
    const links = linksArg || database.listReferralLinks();
    const parentMap = context?.parentMap || parentMapOf(links);
    const target = k(address);
    for (const o of rows) {
      const ow = k(o.wallet);
      if (ow === target) {
        acc.own = true;
        acc.dDirect += o.dDirect;
        acc.dIndirect += o.dIndirect;
        acc.dTeam += o.dTeam;
        acc.dDirectMini += o.dDirectMini;
        acc.dDirectPro += o.dDirectPro;
        acc.dTeamMini += o.dTeamMini;
        acc.dTeamPro += o.dTeamPro;
        acc.directHoldUnits += VIRTUAL_MINI_HOLD_UNITS * BigInt(o.dDirectMini) + VIRTUAL_PRO_HOLD_UNITS * BigInt(o.dDirectPro);
        // 团队业绩口径含直推（与真实统计一致）：虚拟直推矿机同样计入本人团队业绩
        acc.teamHoldUnits += VIRTUAL_MINI_HOLD_UNITS * BigInt(o.dTeamMini + o.dDirectMini)
          + VIRTUAL_PRO_HOLD_UNITS * BigInt(o.dTeamPro + o.dDirectPro);
        acc.directHoldUsers += o.dDirectMini + o.dDirectPro;
        acc.teamHoldUsers += o.dTeamMini + o.dTeamPro + o.dDirectMini + o.dDirectPro;
        continue;
      }
      // 沿真实父链一直向上找 target（全代际，与团队人数的全量下级遍历口径一致）；
      // depth=1 表示 target 是 ow 的直推上级；seen 防止异常推荐链成环导致死循环
      let cur = parentMap.get(ow);
      let depth = 0;
      const seen = new Set([ow]);
      while (cur) {
        depth += 1;
        if (seen.has(cur)) break;
        seen.add(cur);
        if (cur === target) {
          acc.dTeam += o.dTeam;
          // 下级（无论隔几层）的虚拟直推矿机用户，对上级都是团队矿机用户
          acc.dTeamMini += o.dTeamMini + o.dDirectMini;
          acc.dTeamPro += o.dTeamPro + o.dDirectPro;
          acc.teamHoldUnits += VIRTUAL_MINI_HOLD_UNITS * BigInt(o.dTeamMini + o.dDirectMini)
            + VIRTUAL_PRO_HOLD_UNITS * BigInt(o.dTeamPro + o.dDirectPro);
          acc.teamHoldUsers += o.dTeamMini + o.dTeamPro + o.dDirectMini + o.dDirectPro;
          if (depth === 1) acc.dIndirect += o.dDirect;
          break;
        }
        cur = parentMap.get(cur);
      }
    }
    return acc;
  }

  // 后台/接口共用视图：真实值 + 生效值（真实+叠加）+ 该地址已保存的覆盖行
  function getTeamStatsView(address) {
    const links = activeLinks();
    const r = realTeamStats(address, links);
    const hiddenTeam = reportingTxs && hiddenViewerSet.has(k(address)) ? hiddenRotationSubtreeCounts(r.downlines) : { pro: 0 };
    const hiddenDirect = reportingTxs && hiddenViewerSet.has(k(address)) ? hiddenRotationSubtreeCounts(r.directSet) : { pro: 0 };
    const real = {
      directCount: r.directCount, indirectCount: r.indirectCount, teamCount: r.teamCount,
      directMini: r.directMini, directPro: r.directPro, teamMini: r.teamMini, teamPro: r.teamPro,
    };
    const acc = virtualStatsAccrual(address, links);
    // 本人被设置时，其虚拟直推矿机也属于自己的团队矿机（团队口径含直推）
    const ownDirectMini = acc.own ? acc.dDirectMini : 0;
    const ownDirectPro = acc.own ? acc.dDirectPro : 0;
    // 真实直推业绩：每个直推用户的个人持有（SVX 余额 + 质押本金 + 矿机剩余）之和，不含其下级
    let directRealHoldUnits = 0n;
    for (const w of r.directSet) {
      try { directRealHoldUnits += getPersonalHeld(w); } catch {}
    }
    const effective = {
      directCount: real.directCount + acc.dDirect,
      indirectCount: real.indirectCount + acc.dIndirect,
      teamCount: real.teamCount + acc.dTeam,
      directMini: real.directMini + acc.dDirectMini,
      directPro: Math.max(0, real.directPro + acc.dDirectPro - hiddenDirect.pro),
      teamMini: real.teamMini + acc.dTeamMini + ownDirectMini,
      teamPro: Math.max(0, real.teamPro + acc.dTeamPro + ownDirectPro - hiddenTeam.pro),
      teamHoldA: formatUnits(acc.teamHoldUnits, A_TOKEN_DECIMALS),
      directHoldA: formatUnits(acc.directHoldUnits, A_TOKEN_DECIMALS),           // 虚拟直推矿机业绩
      directRealHoldA: formatUnits(directRealHoldUnits, A_TOKEN_DECIMALS),       // 真实直推业绩
      directTotalHoldA: formatUnits(directRealHoldUnits + acc.directHoldUnits, A_TOKEN_DECIMALS), // 直推总业绩（真实+虚拟）
      statsOverridden: acc.own,
    };
    // 展示等级（仅页面展示，不写快照、不影响真实分润）：真实团队业绩 + 虚拟矿机业绩参与档位计算
    let effectiveLevel = 0;
    try {
      const levelRow = database.getATokenTeamLevel?.(address);
      const realLevel = applyFloor(calcLevel(getPersonalHeld(address), getTeamHeld(address)), levelRow?.manualLevel || 0);
      const virtualLevel = calcLevel(getPersonalHeld(address), getTeamHeld(address) + acc.teamHoldUnits);
      effectiveLevel = Math.max(realLevel, virtualLevel);
    } catch {}
    effective.level = effectiveLevel;
    const stored = database.getATokenTeamStatsOverride?.(address) || null;
    const reportingEnabled = !!reportingTxs && hiddenViewerSet.has(k(address));
    const reporting = { enabled: reportingEnabled,
      excludedTeamPro: hiddenTeam.pro, excludedDirectPro: hiddenDirect.pro,
      realTeamPro: Math.max(0, real.teamPro - hiddenTeam.pro),
      realDirectPro: Math.max(0, real.directPro - hiddenDirect.pro),
      excludedDirectWallets: reportingEnabled ? [...r.directSet].filter(wallet => hiddenActivationsByWallet().has(k(wallet))) : [],
    };
    return { real, effective, stored, reporting };
  }

  // ── 团队持有：记忆化递归（每钱包质押本金查一次、子树和算一次，整体 O(n)，防环）──
  // 团队业绩 = 下级钱包 SVX 余额 + 下级 active 质押本金 + 下级 active 矿机剩余
  // 注意：active 质押本金未退回钱包，所以不会与钱包余额重复；到期后质押变 completed 不算，本金已退回钱包
  function teamHeldOf(address, childrenMap, stakedCache, walletCache, teamCache, visiting) {
    const key = k(address);
    if (teamCache.has(key)) return teamCache.get(key);
    // 2026-10-29：改迭代式后序遍历——团伙造出数千层深的推荐链，旧递归在深链上爆栈
    //（栈上缓存全部作废），快照每个入口重走整链又永远缓存不上 → O(N²) 自旋、事件循环卡死。
    // 迭代版不爆栈、每节点恰好缓存一次；环上子节点按旧 visiting 语义只计自身持有、不计子树。
    const stack = [[key, 0]];
    const onStack = new Set([key]);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const [ck, idx] = frame;
      const children = childrenMap.get(ck) || [];
      if (idx < children.length) {
        frame[1] += 1;
        const childKey = k(children[idx]);
        if (!teamCache.has(childKey) && !onStack.has(childKey)) {
          onStack.add(childKey);
          stack.push([childKey, 0]);
        }
        continue;
      }
      stack.pop();
      onStack.delete(ck);
      let total = 0n;
      for (const child of children) {
        const childKey = k(child);
        if (!stakedCache.has(childKey)) stakedCache.set(childKey, getStakedPrincipal(child));
        if (!walletCache.has(childKey)) {
          try { walletCache.set(childKey, walletService.balanceUnits(child, 'A')); } catch { walletCache.set(childKey, 0n); }
        }
        total += walletCache.get(childKey);       // 下级钱包里持有的 SVX
        total += stakedCache.get(childKey);       // 下级质押中的本金 + 矿机剩余
        total += teamCache.get(childKey) || 0n;    // 环上子节点的子树不计（与旧递归语义一致）
      }
      teamCache.set(ck, total);
    }
    return teamCache.get(key) || 0n;
  }

  // ── 团队持有：递归累加所有下级的 A 余额 + 质押本金 + 矿机剩余 ──
  function getTeamHeld(address) {
    const childrenMap = buildReferralTree(activeLinks());
    return teamHeldOf(address, childrenMap, new Map(), new Map(), new Map(), new Set());
  }

  // ── 升级仓金额（P3）：仅 active 仓位计入；退出/赎回（redeeming）立即掉级 ──
  function getUpgradeUnits(address) {
    try { return BigInt(database.sumATokenUpgradeUnits?.(address) || '0'); } catch { return 0n; }
  }

  // ── 团队业绩（P3）：按币计、全团队累计、可冲销（反向事件净额）──
  function getTeamPerfUnits(address) {
    try { return BigInt(database.sumATokenTeamPerfUnits?.(address) || '0'); } catch { return 0n; }
  }

  // ── 计算等级：个人升级仓金额 + 团队业绩 必须同时达标 ──
  function calcLevel(upgradeUnits, teamPerfUnits) {
    let level = 0;
    for (let i = TEAM_LEVELS.length - 1; i >= 0; i--) {
      const t = TEAM_LEVELS[i];
      if (upgradeUnits >= t.warehouseUnits && teamPerfUnits >= t.teamPerfUnits) {
        level = t.level;
        break;
      }
    }
    return level;
  }

  // ── 快照：算等级 + 写入数据库 ──
  // manualLevel 语义=保底等级（只升不降）：实际等级取 max(自动等级, 保底等级)；
  // 持仓达标更高等级时自动升级，跌破保底时维持保底；manualLevel=0 表示完全按持仓自动计算
  function applyFloor(autoLevel, manualLevel) {
    return autoLevel; // 新规则只认升级舱与团队业绩双条件，旧手动保底不再生效。
  }
  function snapshot(address) {
    const upgradeUnits = getUpgradeUnits(address);
    const teamPerfUnits = getTeamPerfUnits(address);
    const existing = database.getATokenTeamLevel?.(address);
    const manualLevel = existing?.manualLevel || 0;
    const level = applyFloor(calcLevel(upgradeUnits, teamPerfUnits), manualLevel);
    const links = activeLinks();
    const directValid = links.filter(
      (item) => k(item.referrerWallet) === k(address) && getPersonalHeld(item.wallet) > 0n
    ).length;
    const now = Date.now();
    database.upsertATokenTeamLevelRow({
      wallet: address,
      level,
      // 复用旧列存 P3 双条件指标：personal_held_units = 升级仓金额，team_held_units = 团队业绩
      personalHeldUnits: upgradeUnits.toString(),
      teamHeldUnits: teamPerfUnits.toString(),
      directValidCount: directValid,
      updatedAt: now,
      manualLevel: manualLevel > 0 ? manualLevel : undefined,
    });
    // 同步 wallet_users 里的 level 字段，避免其他地方读旧值
    try { walletService?.setUserLevel?.(address, level); } catch {}
    return {
      wallet: address, level,
      upgradeA: Number(formatUnits(upgradeUnits, A_TOKEN_DECIMALS)),
      teamPerfA: Number(formatUnits(teamPerfUnits, A_TOKEN_DECIMALS)),
    };
  }

  // ── 全量快照：一次建树 + 记忆化递归 + 事务批量写（O(n)，不随人数平方增长）──
  // 2026-10-05 修复：加节流，防止 settleParityRewards/settleA10Pool/启动 等多处叠加调用导致 CPU 100%
  let _lastSnapshotAllAt = 0;
  const SNAPSHOT_ALL_MIN_INTERVAL = 30_000; // 全量快照最小间隔 30 秒（ snapshotAll 是 O(N)，N=2146 时约 2-3 秒）
  function snapshotAll() {
    const throttleNow = Date.now();
    if (throttleNow - _lastSnapshotAllAt < SNAPSHOT_ALL_MIN_INTERVAL) {
      return { count: 0, skipped: true, reason: 'throttled' };
    }
    _lastSnapshotAllAt = throttleNow;
    const links = activeLinks();
    const childrenMap = buildReferralTree(links);
    const personalCache = new Map();
    const wallets = new Set();
    for (const item of links) {
      if (item.wallet) wallets.add(item.wallet);
      if (item.referrerWallet) wallets.add(item.referrerWallet);
    }
    // P3：等级双条件指标改为「升级仓金额 + 团队业绩」，批量分组读取避免逐人查库。
    let upgradeTotals = new Map();
    let perfTotals = new Map();
    try { upgradeTotals = database.sumAllATokenUpgradeUnits?.() || new Map(); } catch {}
    try { perfTotals = database.sumAllATokenTeamPerfUnits?.() || new Map(); } catch {}
    for (const w of upgradeTotals.keys()) wallets.add(w);
    for (const w of perfTotals.keys()) wallets.add(w);
    const now = Date.now();
    const rows = [];
    for (const w of wallets) {
      try {
        const key = k(w);
        const upgradeUnits = upgradeTotals.get(key) || 0n;
        const teamPerfUnits = perfTotals.get(key) || 0n;
        const existing = database.getATokenTeamLevel?.(w);
        const manualLevel = existing?.manualLevel || 0;
        const level = applyFloor(calcLevel(upgradeUnits, teamPerfUnits), manualLevel);
        let directValid = 0;
        for (const cw of childrenMap.get(key) || []) {
          const ck = k(cw);
          if (!personalCache.has(ck)) personalCache.set(ck, getPersonalHeld(cw));
          if (personalCache.get(ck) > 0n) directValid += 1;
        }
        rows.push({
          wallet: w, level,
          personalHeldUnits: upgradeUnits.toString(),
          teamHeldUnits: teamPerfUnits.toString(),
          directValidCount: directValid, updatedAt: now,
          manualLevel: manualLevel > 0 ? manualLevel : undefined,
        });
      } catch {}
    }
    const write = () => {
      for (const row of rows) {
        database.upsertATokenTeamLevelRow(row);
        // 同步 wallet_users.level：快照表为等级唯一权威，后台用户列表等读此字段，全量重算（含降级）后须一并更新
        // 处于原子事务中时 setUserLevel 仅标记 dirty，由 transaction() 统一一次性提交，不会逐行落库
        try { walletService?.setUserLevel?.(row.wallet, row.level); } catch {}
      }
    };
    if (database.db.isTransaction) write(); else transaction(write);
    return { count: rows.length, results: rows.slice(0, 100) };
  }

  // ── 获取等级（从快照表读）──
  function getLevel(address) {
    return calcLevel(getUpgradeUnits(address), getTeamPerfUnits(address));
  }

  // ── 后台手动指定等级：manualLevel 作为「保底等级」，实际等级=max(自动等级, 保底)，只升不降 ──
  // level 1-10 = 设置/更新保底；0 = 取消保底，恢复完全按持仓自动计算
  // 等级取值统一交给 snapshot()（applyFloor），这里只负责写入/删除保底标记
  function setManualLevel() { throw new Error('等级按升级舱与团队业绩自动计算，不支持手动保底'); }

  // ── 团队业绩记账（P3）：按币计、全团队都算（整条推荐链），可冲销 ──
  // 一笔业务只记一次；id 由 bizType+bizId+链位置确定，重复调用幂等。
  function recordTeamPerformance(sourceWallet, { bizType, bizId, amountUnits, occurredAt = Date.now(), payload = {} } = {}) {
    // 2026-11-12：能量/质押本金、盲盒产出均不记团队业绩（业绩只认矿池 node 与升级舱 upgrade）
    if (bizType === 'energy' || bizType === 'stake' || bizType === 'blindbox') return { recorded: 0, depth: 0 };
    const units = BigInt(amountUnits || '0');
    const source = k(sourceWallet);
    if (units <= 0n || !source || !bizType || !bizId) return { recorded: 0, depth: 0 };
    if (isBanned(source)) return { recorded: 0, depth: 0 };
    const chain = getReferralChain(source, TEAM_PERF_MAX_DEPTH);
    let recorded = 0;
    for (let i = 0; i < chain.length; i += 1) {
      const owner = chain[i];
      if (isBanned(owner)) continue;
      const ok = database.insertATokenTeamPerfEventRow({
        id: `atpe_${bizType}_${bizId}_${i + 1}`,
        ownerWallet: owner,
        sourceWallet: source,
        bizType,
        bizId,
        amountUnits: units.toString(),
        asset: 'A',
        depth: i + 1,
        occurredAt: Number(occurredAt) || Date.now(),
        createdAt: Date.now(),
        payload,
      });
      if (ok) recorded += 1;
    }
    return { recorded, depth: chain.length };
  }

  // 冲销：把某笔业务写入的团队业绩逐条反向，等级在下一次 snapshot 时回落。
  function reverseTeamPerformance(sourceWallet, bizType, bizId) {
    const rows = database.listATokenTeamPerfEventsByBiz?.(sourceWallet, bizType, bizId) || [];
    let reversed = 0;
    for (const row of rows) {
      const done = database.reverseATokenTeamPerfEvent?.(row.id, {
        createdAt: Date.now(),
        payload: { reason: 'reverse', bizType, bizId },
      });
      if (done) reversed += 1;
    }
    return { reversed };
  }

  // ── 团队分润（矿机产出/质押收益通用）：直推 10%（仅质押）+ 级差/平级 ──
  // 动态收益仅发给当前仍持有有效矿池的用户。
  const eligibleStmt = database.db.prepare("SELECT 1 FROM a_token_nodes WHERE wallet=? AND status='active' AND expires_at>? LIMIT 1");
  function isEligibleRecipient(wallet) { return !!eligibleStmt.get(k(wallet), clock()); }

  // 幂等判重：id 结构 = prefix_kind_sourceId_slotAt_idx。
  // 走 source_wallet 索引 + LIKE 边界匹配，命中即停（LIMIT 1），
  // 不再把该来源的全部奖励行拉进 JS 内存（2026-10-12 0 点卡死优化）。
  const dupStmt = database.db.prepare(
    "SELECT 1 AS hit FROM a_token_team_rewards WHERE source_wallet=? AND id LIKE ? ESCAPE '\\' LIMIT 1"
  );
  const escapeLike = (s) => String(s).replace(/[\\%_]/g, '\\$&');
  // prefix: 'miner' → kind=miner_direct/...；'stake' → kind=stake_direct/...
  function distributeReward(userAddress, rewardUnits, { prefix, sourceId, slotAt = Date.now(), receivedAt = slotAt }) {
    const dupPattern = `${escapeLike(prefix)}\\_%\\_${escapeLike(sourceId)}\\_${escapeLike(slotAt)}\\_%`;
    if (dupStmt.get(userAddress, dupPattern)) return { distributed:false, reason:'already distributed' };
    const chain = getReferralChain(userAddress);
    if (chain.length === 0) return { distributed: false, reason: 'no referrer' };
    // 等级直接读快照表（5 分钟定时器维护）：snapshot() 单用户也要全表扫推荐关系+递归子树持仓（O(N)），
    // 00:00 日结全部矿机集中发放时逐个 snapshot 会 O(矿机数×链长×N) 冻结事件循环（2026-10-05 全站卡死事故）
    const userLevel = getLevel(userAddress);
    const totalReward = BigInt(rewardUnits);
    if (totalReward <= 0n) return { distributed: false, reason: 'zero reward' };
    const results = [];

    const credit = (recipient, kind, amount, levelInfo = {}, options = {}) => {
      if (amount <= 0n) return;
      // 封禁账号不发放任何团队分润（直推/间推/团队/级差/平级）
      if (isBanned(recipient)) {
        results.push({ recipient, kind, amount: amount.toString(), credited: false, skipped: 'banned' });
        return;
      }
      // 所有动态奖励统一受有效矿池门槛约束。
      if (!isEligibleRecipient(recipient)) {
        results.push({ recipient, kind, amount: amount.toString(), credited: false, skipped: 'ineligible' });
        return;
      }
      const rewardId = `${prefix}_${kind}_${sourceId}_${slotAt}_${results.length}`;
      const recorded = database.insertATokenTeamRewardRow({
        id: rewardId,
        recipientWallet: recipient,
        sourceWallet: userAddress,
        kind: `${prefix}_${kind}`,
        level: levelInfo.level ?? null,
        rateBps: levelInfo.rateBps ?? null,
        amountUnits: amount.toString(),
        createdAt: receivedAt,
        periodEndAt: slotAt,
      });
      if (recorded.inserted) {
        // P3：级差收益统一进入待领取（pending），由用户主动领取后入主钱包；
        // 没有 pendingService 的旧调用路径保持直接入账，避免破坏历史测试/工具脚本。
        if (pendingService) {
          pendingService.createReward({
            wallet: recipient,
            bizType: 'team',
            bizId: rewardId,
            periodKey: 'v1',
            amountUnits: amount.toString(),
            quotaUnits: amount.toString(),
            availableAt: nextSettlementAt(slotAt - 1),
            payload: {
              rewardId, sourceWallet: userAddress, kind: `${prefix}_${kind}`,
              level: levelInfo.level ?? null, rateBps: levelInfo.rateBps ?? null, slotAt,
            },
          });
        } else {
          walletService.creditBalance(recipient, 'A', amount);
        }
      }
      results.push({ recipient, kind, amount: amount.toString(), credited:recorded.inserted });
    };

    // ① 直推 10%（2026-11-09 新规）：只按下级「质押收益」计算，不再按投资额；
    //    矿机产出发放不再产生直推奖励。
    if ((prefix === 'stake' || prefix === 'node') && chain[0]) {
      const amt = (totalReward * DIRECT_STAKE_RATE_BPS) / 10000n;
      credit(chain[0], 'direct', amt, { level: 1, rateBps: Number(DIRECT_STAKE_RATE_BPS) });
    }
    // ② 间推：新规归零并彻底移除（旧 10% 逻辑不再保留任何开关）

    // ③ 级差（2026-11-12 口径）：V1~V10 每级 5%，按「矿池每日利息」计提；
    //    奖励 = 自己比例 − 直接下级比例；平级为 0、下级更高为 0。
    const rateBpsOf = (lvl) => (lvl > 0 ? BigInt(TEAM_LEVELS[lvl - 1].rateBps) : 0n);
    if (prefix === 'node') {
      for (let i = 0; i < chain.length && i < LEVEL_DIFF_MAX_DEPTH; i++) {
        const uplineLevel = getLevel(chain[i]);
        if (uplineLevel <= 0) continue;
        const downlineLevel = i === 0 ? userLevel : getLevel(chain[i - 1]);
        if (uplineLevel === downlineLevel && uplineLevel > 0) break;
        const takeBps = rateBpsOf(uplineLevel) - rateBpsOf(downlineLevel);
        if (takeBps <= 0n) continue;
        const amt = (totalReward * takeBps) / 10000n;
        if (amt <= 0n) continue;
        credit(chain[i], 'level_diff', amt, { level: uplineLevel, rateBps: Number(takeBps) }, { viaPending: true, allowByLevel: true });
      }
    }

    return { distributed: true, results, totalDistributed: results.reduce((s, r) => s + BigInt(r.amount), 0n).toString() };
  }

  // ── 矿池利息分润（2026-11-12 起：直推 10% + 级差）──
  function distributeNodeReward(userAddress, rewardUnits, nodeId, slotAt = Date.now(), receivedAt = slotAt) {
    return transaction(() => distributeReward(userAddress, rewardUnits, { prefix: 'node', sourceId: nodeId, slotAt, receivedAt }));
  }

  // ── 质押收益分润（仅直推 10%）──
  function distributeStakeReward(userAddress, rewardUnits, stakeId, slotAt = Date.now(), receivedAt = slotAt) {
    return transaction(() => distributeReward(userAddress, rewardUnits, { prefix: 'stake', sourceId: stakeId, slotAt, receivedAt }));
  }

  // 新方案取消平级奖；保留方法以兼容调度入口，不再生成或补发任何平级奖励。
  function settleParityRewards() { return { settled: false, reason: 'disabled_by_model' }; }

  // ── A10 池：交易/互转手续费的分红份额全额进池（调用方已按 50% 预分），日结均分给所有 A10 用户 ──
  function distributeToA10Pool(feeAUnits, executionId, createdAt = Date.now()) {
    const poolReward = BigInt(feeAUnits);
    if (poolReward <= 0n) return 0n;
    let pool = database.getA10Pool('current');
    if (!pool) {
      pool = { id: 'current', accumUnits: '0', settled: 0, createdAt, updatedAt: createdAt };
    }
    pool.accumUnits = (BigInt(pool.accumUnits || '0') + poolReward).toString();
    pool.updatedAt = createdAt;
    database.upsertA10Pool(pool);
    return poolReward;
  }

  // ── A10 日结：均分池子给所有 A10 用户（发 SVX）──
  function settleA10Pool(now = Date.now()) {
    const settleDate = new Date(beijingDayStart(now) + 28800000).toISOString().slice(0, 10);
    if (database.getA10Pool(`settled_${settleDate}`)) return { settled:false, reason:'already settled' };
    const pool = database.getA10Pool('current');
    if (!pool) return null;
    const total = BigInt(pool.accumUnits || '0');
    if (total <= 0n) return { settled: false, reason: 'pool empty' };
    snapshotAll();
    const a10Users = database.listATokenTeamLevelsByLevel(10).filter(u => !isBanned(u.wallet)).sort((a,b) => k(a.wallet).localeCompare(k(b.wallet)));
    const count = a10Users.length;
    if (count === 0) return { settled: false, reason: 'no A10 users', accumUnits: total.toString() };

    const perShare = total / BigInt(count);
    const remainder = total % BigInt(count);

    let i = 0;
    for (const user of a10Users) {
      let share = perShare;
      if (remainder > 0n && i === 0) share += remainder;
      if (share > 0n && user.wallet) {
        // 幂等：先写记录（ON CONFLICT DO NOTHING），changes=0 表示当日已发过，跳过发币避免重复
        const rec = database.insertATokenTeamRewardRow({
          id: `a10pool_${settleDate}_${k(user.wallet)}`,
          recipientWallet: user.wallet,
          sourceWallet: 'A10_POOL',
          kind: 'a10_pool_share',
          level: 10,
          rateBps: null,
          amountUnits: share.toString(),
          createdAt: now,
        });
        if (rec.inserted) walletService.creditBalance(user.wallet, 'A', share);
      }
      i++;
    }

    // 归档当前池为历史记录
    database.upsertA10Pool({
      ...pool,
      id: `settled_${settleDate}`,
      settled: 1,
      settleDate,
      participantCount: count,
      perShareUnits: perShare.toString(),
      updatedAt: now,
    });
    // 重置当前池
    database.upsertA10Pool({ id: 'current', accumUnits: '0', settled: 0, createdAt: now, updatedAt: now });

    return { settled: true, settleDate, participantCount: count, perShare: perShare.toString(), total: total.toString() };
  }

  // 人数首屏不需要读取收益流水、持仓或重算等级。
  function summary(address) {
    const links = activeLinks();
    const childrenMap = buildReferralTree(links);
    const own = k(address);
    const direct = new Set((childrenMap.get(own) || []).map(k).filter(w => w && w !== own));
    const downlines = new Set(direct);
    const stack = [...direct];
    while (stack.length) {
      for (const child of childrenMap.get(stack.pop()) || []) {
        const key = k(child);
        if (key && key !== own && !downlines.has(key)) { downlines.add(key); stack.push(key); }
      }
    }
    const acc = virtualStatsAccrual(address, links);
    const parent = links.find(item => k(item.wallet) === own)?.referrerWallet;
    const referrer = parent && k(parent) !== own ? links.find(item => k(item.wallet) === k(parent))?.wallet : null;
    return {
      directReferrer: referrer || null,
      directCount: direct.size + acc.dDirect,
      teamCount: downlines.size + acc.dTeam,
    };
  }

  // ── 团队 profile：等级 + 收益 + 下级 ──
  function profile(address) {
    snapshot(address);
    const level = getLevel(address);
    const upgradeUnits = getUpgradeUnits(address);
    const teamPerfUnits = getTeamPerfUnits(address);
    const chain = getReferralChain(address);
    // 团队页的累计收益不能只取最近 200 笔，否则历史流水多时会被截断。
    const rewards = readAixIncome(database, address, 'team');
    const directCountRewards = readAixIncome(database, address, 'direct');
    const allRewards = [
      ...rewards,
      ...directCountRewards.map(r => ({ ...r, kind: 'direct_count', amountUnits: r.amountUnits || '0' })),
    ];
    const totalEarned = allRewards.reduce((sum, r) => sum + BigInt(r.amountUnits || '0'), 0n);
    const pool = database.getA10Pool('current');

    // 下级列表（个人持有/等级读快照表，无实时余额递归；无快照行时回退实时）
    const links = activeLinks();
    const minerWallets = database.listATokenMinerWallets?.() || new Set();
    const miniMinerWallets = database.listATokenMinerWalletsByPlan?.('mini120') || new Set();
    const proMinerWallets = database.listATokenMinerWalletsByPlan?.('pro1500') || new Set();
    // 后台手动设置的团队展示数据叠加量（本人设置 + 后代节点沿真实推荐链向上汇总，仅影响展示）
    const overrideContext = { rows: database.listATokenTeamStatsOverrides?.() || [], parentMap: parentMapOf(links) };
    const statsAcc = virtualStatsAccrual(address, links, overrideContext);
    const childrenMap2 = buildReferralTree(links);
    // 一次请求共用树与持仓缓存，直推明细不再逐人扫描整张推荐关系表。
    const stakedCache = new Map(), walletCache = new Map(), teamCache = new Map();
    const teamHeldFor = wallet => teamHeldOf(wallet, childrenMap2, stakedCache, walletCache, teamCache, new Set());
    let directHoldUnits = 0n;
    let directHoldUsers = 0;
    const directs = links.filter((item) => k(item.referrerWallet) === k(address)).map((item) => {
      const row = database.getATokenTeamLevel?.(item.wallet);
      const bal = getPersonalHeld(item.wallet);
      const teamHeld = teamHeldFor(item.wallet);
      const dUpgradeUnits = getUpgradeUnits(item.wallet);
      const dTeamPerfUnits = getTeamPerfUnits(item.wallet);
      // 该直推用户的虚拟团队业绩叠加（后台设置的虚拟矿机业绩沿推荐链传播到此直推用户）
      const dAcc = virtualStatsAccrual(item.wallet, links, overrideContext);
      const effTeamHeld = teamHeld + dAcc.teamHoldUnits;
      // 保底等级只升不降：max(自动等级, 保底等级)；自动等级按 P3 双条件（升级仓 + 团队业绩）
      const lvl = applyFloor(calcLevel(dUpgradeUnits, dTeamPerfUnits), row?.manualLevel || 0);
      const hisDirectCount = (childrenMap2.get(k(item.wallet)) || []).length;
      directHoldUnits += bal;
      if (bal > 0n) directHoldUsers += 1;
      return {
        wallet: item.wallet,
        shortAddress: `${String(item.wallet).slice(0, 6)}...${String(item.wallet).slice(-4)}`,
        personalA: Number(formatUnits(bal, A_TOKEN_DECIMALS)),
        teamA: Number(formatUnits(effTeamHeld, A_TOKEN_DECIMALS)),
        upgradeA: Number(formatUnits(dUpgradeUnits, A_TOKEN_DECIMALS)),
        teamPerfA: Number(formatUnits(dTeamPerfUnits, A_TOKEN_DECIMALS)),
        level: lvl,
        joinedAt: item.createdAt,
        // 按查看者的展示统计规则扣除指定激活，不修改矿机记录。
        minerCount: Math.max(0, (database.countATokenMinersByWallet?.(item.wallet) || 0) - hiddenMinerCountFor(item.wallet, address)),
        directCount: hisDirectCount + dAcc.dDirect,
      };
    });
    const directMinerUsers = directs.filter((d) => d.minerCount > 0).length;
    // 真实间推（直推的直推，去重）与直推分档矿机人数
    const directWalletSet = new Set(directs.map(d => k(d.wallet)));
    const indirectWalletSet = new Set();
    for (const dw of directWalletSet) {
      for (const gw of (childrenMap2.get(dw) || [])) {
        const gwk = k(gw);
        if (gwk && gwk !== k(address) && !directWalletSet.has(gwk)) indirectWalletSet.add(gwk);
      }
    }
    let realDirectMini = 0, realDirectPro = 0;
    for (const w of directWalletSet) {
      if (miniMinerWallets.has(w)) realDirectMini += 1;
      if (proMinerWallets.has(w)) realDirectPro += 1;
    }

    // 整个团队网络（迭代遍历全部下级）中激活过矿机的人数
    const childrenMap = childrenMap2;
    const downlines = new Set();
    const stack = [k(address)];
    while (stack.length) {
      for (const w of childrenMap.get(stack.pop()) || []) {
        const ck = k(w);
        if (!downlines.has(ck)) { downlines.add(ck); stack.push(ck); }
      }
    }
    downlines.delete(k(address));
    let teamMinerUsers = 0;
    for (const w of downlines) { if (minerWallets.has(w)) teamMinerUsers += 1; }
    let realTeamMini = 0, realTeamPro = 0;
    for (const w of downlines) {
      if (miniMinerWallets.has(w)) realTeamMini += 1;
      if (proMinerWallets.has(w)) realTeamPro += 1;
    }
    // 指定查看者本人查看时：其整棵下级里经轮换收款地址激活的矿机不计入「团队激活矿机」
    const hiddenTeam = hiddenViewerSet.has(k(address)) ? hiddenRotationSubtreeCounts(downlines) : { mini: 0, pro: 0, users: 0 };
    const hiddenDirect = reportingTxs && hiddenViewerSet.has(k(address)) ? hiddenRotationSubtreeCounts(directWalletSet) : { pro: 0 };

    // 团队持币统计：下级钱包 SVX 余额 + active 质押本金 + active 矿机剩余（与级别判定口径一致）
    let teamHoldUnits = 0n;
    let teamHoldUsers = 0;
    for (const w of downlines) {
      let v = 0n;
      if (!walletCache.has(w)) {
        try { walletCache.set(w, walletService.balanceUnits(w, 'A')); } catch { walletCache.set(w, 0n); }
      }
      if (!stakedCache.has(w)) stakedCache.set(w, getStakedPrincipal(w));
      v += walletCache.get(w) + stakedCache.get(w);
      if (v > 0n) { teamHoldUnits += v; teamHoldUsers += 1; }
    }
    // 虚拟会员业绩叠加（仅展示）：Mini 100 SVX / Pro 1500 SVX
    teamHoldUnits += statsAcc.teamHoldUnits;
    teamHoldUsers += statsAcc.teamHoldUsers;
    directHoldUnits += statsAcc.directHoldUnits;
    directHoldUsers += statsAcc.directHoldUsers;

    // 团队质押业绩：在押（active）质押本金，按钱包汇总后统计直推/整个团队
    const stakeByWallet = new Map();
    for (const s of database.listActiveATokenStakes?.() || []) {
      const sw = k(s.wallet);
      stakeByWallet.set(sw, (stakeByWallet.get(sw) || 0n) + splitStakePayment(s, s.totalEarnedUnits).outstanding);
    }
    let teamStakeUnits = 0n;
    let teamStakeUsers = 0;
    for (const w of downlines) {
      const v = stakeByWallet.get(w);
      if (v && v > 0n) { teamStakeUnits += v; teamStakeUsers += 1; }
    }
    let directStakeUnits = 0n;
    let directStakeUsers = 0;
    for (const d of directs) {
      const v = stakeByWallet.get(k(d.wallet));
      if (v && v > 0n) { directStakeUnits += v; directStakeUsers += 1; }
    }

    // 按 kind 汇总收益
    const byKind = {};
    for (const r of allRewards) {
      const k2 = r.kind || 'other';
      byKind[k2] = (byKind[k2] || 0n) + BigInt(r.amountUnits || '0');
    }

    // 展示等级：P3 严格按「升级仓金额 + 团队业绩」双条件，不再叠加虚拟持仓。
    const displayLevel = level;
    // 本人被设置时，虚拟直推矿机同时计入本人团队矿机（团队口径含直推）
    const ownDirectMini = statsAcc.own ? statsAcc.dDirectMini : 0;
    const ownDirectPro = statsAcc.own ? statsAcc.dDirectPro : 0;

    return {
      level: displayLevel,
      realLevel: level,
      levelLabel: displayLevel > 0 ? TEAM_LEVELS[displayLevel - 1].label : '未达标',
      nextLevel: displayLevel < 10 && displayLevel >= 0 ? TEAM_LEVELS_VIEW[displayLevel] : null,
      upgradeA: formatUnits(upgradeUnits, A_TOKEN_DECIMALS),
      teamPerfA: formatUnits(teamPerfUnits, A_TOKEN_DECIMALS),
      directReferrer: chain[0] || null,
      indirectReferrer: chain[1] || null,
      directCount: directs.length + statsAcc.dDirect,
      indirectCount: indirectWalletSet.size + statsAcc.dIndirect,
      directMini: realDirectMini + statsAcc.dDirectMini,
      directPro: Math.max(0, realDirectPro + statsAcc.dDirectPro - hiddenDirect.pro),
      directMinerUsers: directMinerUsers + statsAcc.dDirectMini + statsAcc.dDirectPro,
      teamMini: Math.max(0, realTeamMini + statsAcc.dTeamMini + ownDirectMini - hiddenTeam.mini),
      teamPro: Math.max(0, realTeamPro + statsAcc.dTeamPro + ownDirectPro - hiddenTeam.pro),
      teamMinerUsers: Math.max(0, teamMinerUsers + statsAcc.dTeamMini + statsAcc.dTeamPro + ownDirectMini + ownDirectPro - hiddenTeam.users),
      teamCount: downlines.size + statsAcc.dTeam,
      statsOverridden: statsAcc.own,
      teamHoldA: formatUnits(teamHoldUnits, A_TOKEN_DECIMALS),
      teamHoldUsers,
      directHoldA: formatUnits(directHoldUnits, A_TOKEN_DECIMALS),
      directHoldUsers,
      teamStakeA: formatUnits(teamStakeUnits, A_TOKEN_DECIMALS),
      teamStakeUsers,
      directStakeA: formatUnits(directStakeUnits, A_TOKEN_DECIMALS),
      directStakeUsers,
      directs: directs.slice(0, 50),
      totalEarnedA: totalEarned > 0n ? formatUnits(totalEarned, A_TOKEN_DECIMALS) : '0',
      byKind: Object.fromEntries(Object.entries(byKind).map(([k2, v]) => [k2, formatUnits(v, A_TOKEN_DECIMALS)])),
      a10PoolAccum: pool ? formatUnits(BigInt(pool.accumUnits || '0'), A_TOKEN_DECIMALS) : '0',
      a10ParticipantCount: database.listATokenTeamLevelsByLevel(10).length,
      TEAM_LEVELS: TEAM_LEVELS_VIEW,
    };
  }

  // Admin display totals use the union of the selected teams; nested teams are counted once.
  function reportingMinerSummary() {
    const raw = database.adminMinerSummary();
    if (!reportingTxs) return raw;
    const links = activeLinks();
    const eligible = new Set();
    for (const viewer of hiddenViewerSet) for (const w of realTeamStats(viewer, links).downlines) eligible.add(w);
    const rows = raw.rows.map(row => ({ ...row }));
    let excludedPro = 0;
    for (const w of hiddenActivationsByWallet().keys()) {
      if (!eligible.has(w)) continue;
      const miner = database.listATokenMiners(w).filter(row => row.plan === 'pro1500' && !String(row.activationId || '').startsWith('ata_aix_'))
        .sort((a, b) => Number(a.startedAt) - Number(b.startedAt) || String(a.id).localeCompare(String(b.id)))[0];
      if (!miner) continue;
      const group = rows.find(row => row.plan === 'pro1500' && row.status === miner.status);
      if (group && group.c > 0) { group.c -= 1; excludedPro += 1; }
    }
    const by = Object.fromEntries(rows.map(row => [`${row.status || 'unknown'}:${row.plan || 'all'}`, Number(row.c)]));
    return { ...raw, rows, by, total: raw.total - excludedPro, excludedPro, rawTotal: raw.total, rawBy: raw.by };
  }

  return { reportingMinerSummary, snapshot, snapshotAll, getLevel, setManualLevel, calcLevel, distributeNodeReward, distributeStakeReward, distributeToA10Pool, getReferralChain,
    recordTeamPerformance, reverseTeamPerformance, getUpgradeUnits, getTeamPerfUnits,
    settleParityRewards:(...args) => transaction(() => settleParityRewards(...args)),
    settleA10Pool:(...args) => transaction(() => settleA10Pool(...args)), profile, summary, getTeamStatsView, teamActivationBreakdown, TEAM_LEVELS };
}
