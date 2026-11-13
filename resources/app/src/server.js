import { createCommunityGroupService } from './community-group-service.js';
import { createRegistrationIpService } from './registration-ip-service.js';
// Solvex 平台服务器
// 钱包 / 平台现货与合约 / Solvex 合约跟单 / SVX生态 / 运营后台
import http from 'node:http';
import crypto from 'node:crypto';
import { traceRequest } from './request-diagnostics.js';
import { SOLVEX_RULES } from '../shared/solvex-rules.js';
import fs from 'node:fs';
import path from 'node:path';
import { formatUnits } from 'ethers';
import { readAdminAixIncome } from './a-token-admin-income.js';
import { getConfig, ROOT, DATA_ROOT } from './config.js';
import { setupProxies } from './proxy.js';
import { createAiService } from './ai/service.js';
import { createTradeLedger } from './ledger.js';
import { createWalletService } from './wallet-service.js';
import { createDeviceService } from './device-service.js';
import { PLATFORM_SYMBOLS, createPlatformService, setPlatformSymbols } from './platform-service.js';
import { createMarketCatalog, toBinanceMarketSymbol } from './market-catalog.js';
import { createAdminAuth } from './admin-auth.js';
import { createFundsAdminApi } from './funds-admin-api.js';
import { OPERATOR_ADMIN_CSP, FUNDS_ADMIN_CSP, adminPageKind, isLegacyFundsPath } from './admin-security.js';
import { createAgentAuth, hashPassword } from './agent-auth.js';
import { createAgentService } from './agent-service.js';
import { createWithdrawalPayoutService } from './withdrawal-payout-service.js';
import { createBridgeService } from './bridge-service.js';
import { createPlatformApi } from './platform-api.js';
import { createAiManagedApi } from './ai-managed-api.js';
import { createAiManagedService } from './ai-managed-service.js';
import { createReferralApi } from './referral-api.js';
import { createReferralService } from './referral-service.js';
import { createATokenService, A_TOKEN_DECIMALS } from './a-token-service.js';
import { installSolvexWithdrawalFees } from './solvex-withdrawal-fees.js';
import { createATokenLpJobService } from './a-token-lp-job-service.js';
import { createATokenPoolService } from './a-token-pool-service.js';
import { createATokenTeamService } from './a-token-team-service.js';
import { createATokenUpgradeService } from './a-token-upgrade-service.js';
import { createATokenStakingService } from './a-token-staking-service.js';
import { createATokenTransferService } from './a-token-transfer-service.js';
import { createATokenKlineService } from './a-token-kline-service.js';
import { createATokenOrderService } from './a-token-order-service.js';
import { createATokenShareholderService } from './a-token-shareholder-service.js';
import { createATokenMatchPoolService } from './a-token-match-pool-service.js';
import { createATokenTurboService } from './a-token-turbo-service.js';
import { createATokenZoneTradeService } from './a-token-zone-trade-service.js';
import { createATokenPendingService } from './a-token-pending-service.js';
import { createATokenNodeService } from './a-token-node-service.js';
import { createATokenBlindBoxService } from './a-token-blindbox-service.js';
import { createATokenBlindBoxChainVerifier } from './a-token-blindbox-chain.js';
import { createATokenApi } from './a-token-api.js';
import { createMallApi } from './mall-api.js';
import { createATokenAdminApi } from './a-token-admin-api.js';
import { createSupportService } from './support-service.js';
import { createSupportApi } from './support-api.js';
import { createCommunityService } from './community-service.js';
import { createCommunityAdminService } from './community-admin-service.js';
import { createCommunityRedPacketService } from './community-redpacket-service.js';
import { createCommunityApi } from './community-api.js';
import { createATokenWithdrawalService } from './a-token-withdrawal-service.js';
import { createATokenClaimService } from './a-token-claim-service.js';
import { createAirdropPointsService } from './airdrop-points-service.js';
import { fetchFuturesCandles, fetchFuturesOrderBook, fetchFuturesPrices, fetchFuturesTickers, fetchFuturesTrades, fetchPublicCandles, fetchPublicOrderBook, fetchPublicPrices, fetchPublicTickers, fetchPublicTrades, marketFetch, subscribeFuturesPrices, subscribeFuturesTradePrices, subscribePublicPrices } from './market-data/public.js';

// ── 启动配置 ─────────────────────────────────────────────────────────────────
const cfg = getConfig();

// ── 代理设置 ─────────────────────────────────────────────────────────────────
const proxyResult = await setupProxies(cfg);
if (proxyResult.used) {
  console.log('[代理] 已启用: ' + proxyResult.used);
} else {
  console.log('[代理] 未配置（直连模式）');
}

// ── 全局异常兜底：防止单个请求异常把整个 Node 进程拖垮 ───────────────────────
process.on('uncaughtException', (err) => {
  const ts = new Date().toISOString();
  console.error(`[uncaughtException ${ts}] ${err?.stack || err?.message || err}`);
});
process.on('unhandledRejection', (reason) => {
  const ts = new Date().toISOString();
  console.error(`[unhandledRejection ${ts}] ${reason?.stack || reason?.message || reason}`);
});

// ── 成交历史账本（只读；网格引擎移除后不再产生新成交）────────────────────────
const tradeLedger = createTradeLedger();
const exchangeNames = { de: 'Decibel', ex: 'Extended', rs: 'RISEx' };

// ── AI 服务（公共行情分析 / 问答 / 市场日报）────────────────────────────────
const aiService = createAiService({
  fetchCandles: fetchFuturesCandles,
  fetchSpotCandles: fetchPublicCandles,
});
aiService.start();

// ── 多链钱包、充值验链与提现申请 ────────────────────────────────────────────
const bridgeService = createBridgeService({
  ...cfg.wallet.bridge,
  networks:cfg.wallet.networks,
  depositAddress:cfg.wallet.depositAddress,
});
const walletService = createWalletService({ ...cfg.wallet, dataRoot: DATA_ROOT, bridgeService, withdrawalPrivateKey: cfg.wallet.withdrawalPrivateKey,
  // 充值自动扫链对账专用 RPC（需支持 eth_getLogs；主 RPC 一般不支持）
  depositReconcileRpcUrl: process.env.DEPOSIT_RECONCILE_RPC_URL || 'https://bsc-mainnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3' });
// 设备限制：同一设备最多绑定 N 个钱包（DEVICE_MAX_WALLETS，默认 3）
const deviceService = createDeviceService({
  database: walletService.database,
  maxWalletsPerDevice: cfg.wallet.maxWalletsPerDevice,
});
walletService.setDeviceGuard(deviceService);
walletService.setRegistrationGuard(createRegistrationIpService({database:walletService.database}));
const referralService = createReferralService({ database:walletService.database, walletService });
const withdrawalPayoutService = createWithdrawalPayoutService({
  walletService,
  networks:cfg.wallet.networks,
  withdrawalAddress:cfg.wallet.withdrawalAddress,
  privateKey:cfg.wallet.withdrawalPrivateKey,
  enabled:cfg.wallet.autoWithdrawalEnabled,
  isEnabled:() => walletService.withdrawalAutomationSettings().enabled,
  bridgeService,
  swap:cfg.wallet.swap,
});
const initialWithdrawalAutomation = walletService.withdrawalAutomationSettings();
if (initialWithdrawalAutomation.enabled && !withdrawalPayoutService.status().configured) {
  walletService.updateWithdrawalAutomationSettings({ ...initialWithdrawalAutomation, enabled:false });
}
withdrawalPayoutService.start();
const marketCatalog = createMarketCatalog({ dataRoot: DATA_ROOT });
// 美股代币行情适配：币安现货交易对为 {B}B+USDT（NVDABUSDT），永续为 {B}USDT（NVDAUSDT）
function catalogBinanceBase(coinInput, product) {
  const coin = String(coinInput || '').toUpperCase();
  const token = marketCatalog.get(coin);
  if (token?.category === 'stock' && product === 'spot') return `${coin}B`;
  return coin;
}
// 平台现货现价适配：入参/出参均使用展示符号（NVDAUSDT），内部改拉股票现货交易对（NVDABUSDT）
async function fetchCatalogSpotPrices(symbols, options = {}) {
  const displayByBinance = new Map();
  const bases = (Array.isArray(symbols) ? symbols : [symbols]).map(s => {
    const display = String(s || '').toUpperCase().replace(/USDT$/, '');
    const base = catalogBinanceBase(display, 'spot');
    displayByBinance.set(`${base}USDT`, display);
    return base;
  });
  const prices = await fetchPublicPrices(bases, options);
  const out = new Map();
  for (const [binanceSymbol, price] of prices) {
    const display = displayByBinance.get(binanceSymbol);
    out.set(display ? `${display}USDT` : binanceSymbol, price);
  }
  return out;
}
// 平台现货 WS 适配：订阅股票真实交易对，回调里把 symbol 还原成展示符号
function subscribeCatalogSpotPrices(displaySymbols, onPrice, onStatus) {
  const displayByBinance = new Map();
  const bases = displaySymbols.map(s => {
    const display = String(s || '').toUpperCase().replace(/USDT$/, '');
    const base = catalogBinanceBase(display, 'spot');
    displayByBinance.set(`${base}USDT`, display);
    return base;
  });
  return subscribePublicPrices(bases, (update) => {
    const display = displayByBinance.get(update.symbol);
    onPrice(display ? { ...update, symbol:`${display}USDT` } : update);
  }, onStatus);
}
const useLocalAdminDefaults = ['127.0.0.1', 'localhost', '::1'].includes(String(cfg.host || '').toLowerCase());
const adminAuth = createAdminAuth({
  username:process.env.PLATFORM_ADMIN_USERNAME || (useLocalAdminDefaults ? 'admin' : ''),
  password:process.env.PLATFORM_ADMIN_PASSWORD || (useLocalAdminDefaults ? 'WG-Admin-2026' : ''),
});
const agentAuth = createAgentAuth({ database: walletService.database });
const agentService = createAgentService({ walletService, referralService, database: walletService.database });
setPlatformSymbols(marketCatalog.symbols());
const platformService = createPlatformService({ dataRoot: DATA_ROOT, walletService });
platformService.setReferralService(referralService);
platformService.consolidateStrategyBalances();

// ── 工具函数 ──────────────────────────────────────────────────────────────────
// 站内页面名（与 frontend/src/lib/runtime.ts 的 pageNames 保持一致）：/xxx 直连时 302 到 /#/xxx
const SPA_HASH_ROUTES = new Set([
  'earn', 'mall', 'trade', 'a-token-trade', 'leaderboard', 'referrals', 'account',
  'support', 'community-chat', 'portfolio', 'vaults', 'staking', 'ledger', 'ai', 'ai-managed',
]);
// 对外分享短链：/box → 盲盒页（直达 #/earn/blindbox 页签）
const SPA_PATH_ALIASES = { box: '/#/earn/blindbox' };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function send(res, code, obj) {
  const body = JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return; }
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function safeTokenEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && right.length > 0 && crypto.timingSafeEqual(left, right);
}

function isLoopbackAddress(address) {
  const value = String(address || '').toLowerCase();
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function isLocalOperatorRequest(req) {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  if (req.headers.forwarded || req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']) return false;
  try {
    const hostname = new URL(`http://${req.headers.host || ''}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch { return false; }
}

function requireOperator(req, res) {
  if (isLocalOperatorRequest(req)) return true;
  if (safeTokenEqual(req.headers['x-platform-admin-token'], cfg.operatorToken)) return true;
  send(res, 401, { error:'运营接口需要管理员认证', code:'OPERATOR_AUTH_REQUIRED' });
  return false;
}

function isOperatorPath(pathname) {
  return pathname === '/api/ledger' || pathname === '/api/ledger/export.csv'
    || pathname === '/api/env' || pathname.startsWith('/api/ai/') || pathname.startsWith('/api/operator/')
    || pathname.startsWith('/api/hyperliquid/')
    || ['/api/platform/stake', '/api/platform/unstake'].includes(pathname);
}

const rateBuckets = new Map();
const IP_LIKE_RE = /^[0-9a-f:.]{3,64}$/i;
// 本机 nginx 反代的 TCP 对端（回环）
function isProxyPeer(address) {
  const value = String(address || '').toLowerCase();
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}
// 限频用的客户端标识：反代注入的真实 IP 优先（CF-Connecting-IP 由 Cloudflare 覆写，客户端无法伪造），
// 否则用 TCP 对端地址。若直接返回 socket 地址，所有用户会共用 nginx 的 127.0.0.1 导致互相挤爆限频桶。
function clientAddress(req) {
  const peer = String(req.socket.remoteAddress || 'unknown');
  if (isProxyPeer(peer)) {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    if (IP_LIKE_RE.test(cf)) return cf;
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (IP_LIKE_RE.test(forwarded)) return forwarded;
  }
  return peer;
}
function allowRequest(req, res, scope, limit, windowMs) {
  const now = Date.now();
  const key = `${scope}:${clientAddress(req)}`;
  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) bucket = { count:0, resetAt:now + windowMs };
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count <= limit) return true;
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
  send(res, 429, { error:'请求过于频繁，请稍后重试', code:'RATE_LIMITED' });
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
}, 60_000).unref?.();

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function requestError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let b = '', n = 0, done = false;
    req.on('data', (c) => {
      if (done) return;
      n += c.length;
      if (n > maxBytes) {
        done = true;
        reject(requestError('请求体过大', 413));
        return;
      }
      b += c;
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try { resolve(b ? JSON.parse(b) : {}); }
      catch { reject(requestError('JSON 请求体格式错误', 400)); }
    });
    req.on('error', (error) => {
      if (done) return;
      done = true;
      reject(requestError(error?.message || '读取请求体失败', 400));
    });
  });
}

const HYPERLIQUID_INFO_TYPES = new Set([
  'clearinghouseState', 'spotClearinghouseState', 'frontendOpenOrders',
  'userVaultEquities', 'referral', 'userFees', 'delegations',
  'delegatorSummary', 'validatorSummaries', 'allBorrowLendReserveStates', 'vaultSummaries',
  'spotMeta',
  'vaultDetails',
]);

async function hyperliquidInfo(body) {
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST', headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Hyperliquid API 返回 HTTP ${response.status}`);
  return response.json();
}

function readCookie(req, name) {
  const source = String(req.headers.cookie || '');
  for (const part of source.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); }
    catch { return ''; }
  }
  return '';
}

function walletSession(req) {
  return walletService.getSession(readCookie(req, 'wg_session'));
}

function sendIdleAccountResponse(res) {
  res.writeHead(204, { 'X-Solvex-Action':'idle', 'Cache-Control':'no-store' });
  return res.end();
}

function adminSession(req) {
  return adminAuth.session(readCookie(req, 'wg_admin_session'));
}

function isSameOrigin(req) {
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; }
  catch { return false; }
}

function setSessionCookie(req, res, token, maxAgeSeconds) {
  const forwardedProto = cfg.trustProxy ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() : '';
  const secure = Boolean(req.socket.encrypted) || forwardedProto === 'https';
  const value = token ? encodeURIComponent(token) : '';
  res.setHeader('Set-Cookie', `wg_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, maxAgeSeconds)}${secure ? '; Secure' : ''}`);
}

function setAdminSessionCookie(req, res, token, maxAgeSeconds) {
  const forwardedProto = cfg.trustProxy ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() : '';
  const secure = Boolean(req.socket.encrypted) || forwardedProto === 'https';
  const value = token ? encodeURIComponent(token) : '';
  res.setHeader('Set-Cookie', `wg_admin_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, maxAgeSeconds)}${secure ? '; Secure' : ''}`);
}

function agentSession(req) {
  return agentAuth.session(readCookie(req, 'wg_agent_session'));
}
function setAgentSessionCookie(req, res, token, maxAgeSeconds) {
  const forwardedProto = cfg.trustProxy ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() : '';
  const secure = Boolean(req.socket.encrypted) || forwardedProto === 'https';
  const value = token ? encodeURIComponent(token) : '';
  res.setHeader('Set-Cookie', `wg_agent_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, maxAgeSeconds)}${secure ? '; Secure' : ''}`);
}

const platformApi = createPlatformApi({
  platformService,
  fetchPrices: fetchCatalogSpotPrices,
  fetchFuturesPrices,
  send,
  readBody,
  getSession: walletSession,
});
const referralApi = createReferralApi({ service:referralService, send, readBody, getSession:walletSession });
// ── SVX生态服务（需在 AI 跟单服务前创建：跟单开启要销毁 1000 枚 SVX）──
const aTokenService = createATokenService({ database: walletService.database, walletService });
// 平台阶段：提现手续费计入流动性准备金，北京时间 08:00 归集。
// 不向 SVX 执行器提供私钥，环境变量也不能开启链上广播。
const aTokenLpJobService = createATokenLpJobService({
  database: walletService.database,
  config: { ...cfg.wallet.autoLp, enabled: false, settleHourUtc8: SOLVEX_RULES.settlement.hour },
  privateKey: '',
  isWithdrawalPaid: id => walletService.payoutRecord(id)?.status === 'paid',
});
installSolvexWithdrawalFees({walletService,aTokenService,database:walletService.database,lpJobService:aTokenLpJobService});
aTokenLpJobService.start();
const aiManagedService = createAiManagedService({
  platformService,
  walletService,
  fetchCandles: fetchPublicCandles,
  referralService,
  aTokenService,
});
const aiManagedApi = createAiManagedApi({
  service:aiManagedService,
  send,
  readBody,
  getSession:walletSession,
  withAccountLock:platformApi.withAccountLock,
});
// 跟单提现额度（2026-10-25）：USDT 提现占用跟单本金 30 天线性解锁的额度，驳回返还
walletService.setWithdrawalQuotaHook?.(aiManagedService.withdrawQuota);

// ── SVX赚取生态服务 ───────────────────────────────────────────────────────────
const bscNetworkCfg = (cfg.wallet.networks || []).find(n => n.id === 'bsc') || {};
// 注入 SVX现价：资产管理页把 OPEN 卖单锁定的 A 折算进总资产
platformService.setATokenPriceProvider(() => { try { return BigInt(aTokenService.getPriceUsdtUnits()); } catch { return 0n; } });
const aTokenPoolService = createATokenPoolService({
  aTokenService,
  // 市价卖报价按钱包直推阶梯费率（惰性求值：aTokenOrderService 在下方创建）
  sellFeeProfile: (wallet) => aTokenOrderService.sellFeeProfile(wallet),
});
// 轮换收款地址集合（含 A_TOKEN_ROTATION_ADDRESSES 的 '2:0x..' 套餐前缀）：
// 打到这些地址的激活属后台写入的虚拟数据，不计入上级看到的「激活矿机数」台数
const aTokenRotationAddresses = [...new Set([
  process.env.A_TOKEN_ROTATION_ADDRESS || '',
  ...String(process.env.A_TOKEN_ROTATION_ADDRESSES || '').split(',').map(entry => entry.split(':').pop()),
])].map(addr => String(addr || '').trim()).filter(Boolean).join(',');
// A_TOKEN_ROTATION_HIDE_VIEWERS：这些地址本人查看团队页时，其整棵下级里经轮换收款地址
// 确认的激活不计入「团队激活矿机」（如这条线最上面的号）；其他查看者不受影响。
const aTokenRotationHideViewers = String(process.env.A_TOKEN_ROTATION_HIDE_VIEWERS || '').trim();
const proReportingFile = path.join(DATA_ROOT, 'pro-reporting-exclusions.json');
const proReportingExclusions = fs.existsSync(proReportingFile) ? JSON.parse(fs.readFileSync(proReportingFile, 'utf8')) : null;
// 统一待领取账本（2026-11-09 P0）：所有新产出先挂 pending，用户手动领取，滚动 24 小时未领作废
// P3：级差收益复用同一本待领取账本，团队服务构造时直接注入。
const aTokenPendingService = createATokenPendingService({
  aTokenService, database: walletService.database,
});
const aTokenTeamService = createATokenTeamService({
  database: walletService.database, walletService, pendingService: aTokenPendingService,
  rotationAddresses: aTokenRotationAddresses, rotationHideViewers: aTokenRotationHideViewers,
  reportingExclusions: proReportingExclusions,
});
// 升级舱不产收益；生效本金计入上级团队业绩，赎回立即冲销并在 30 天后返还。
const aTokenUpgradeService = createATokenUpgradeService({
  database: walletService.database, walletService, aTokenService, teamService: aTokenTeamService,
});
const upgradeReconciliation = aTokenUpgradeService.reconcileActivePerformance();
if (upgradeReconciliation.recorded) console.log('[升级舱] 已补齐团队业绩事件', upgradeReconciliation.recorded);
const aTokenStakingService = createATokenStakingService({ aTokenService, database: walletService.database, teamService: aTokenTeamService, pendingService: aTokenPendingService });
const aTokenTransferService = createATokenTransferService({ aTokenService, database: walletService.database, referralService, teamService: aTokenTeamService, walletService });
// 矿机激活功能已于 2026-11-12 彻底下线（历史激活记录保留在库中，不再补偿或产出）。
// 股东池（2026-11-12）：卖出手续费 5% 改扣 SVX，50% 销毁 + 50% 进股东池，每 500 USDT 等值一池
// P3：注入团队业绩（S3 判定）与统一待领取账本（分红以 SVX 挂 pending），满池即分红
const aTokenShareholderService = createATokenShareholderService({
  database: walletService.database, walletService, aTokenService,
  teamService: aTokenTeamService, pendingService: aTokenPendingService,
});
// 满池分红兜底：每 5 分钟扫描仍为 closed 的池（如当时无 S3 达标股东，后续达标后补发）
const aTokenShareholderTimer = setInterval(() => {
  try {
    const r = aTokenShareholderService.distributeClosedPools(50);
    if (r.settled || r.failed) console.log('[股东池] 分红扫描：结算', r.settled, '池，失败', r.failed);
  } catch (e) { console.error('[股东池] 分红扫描失败', e?.message || e); }
}, 5 * 60_000);
aTokenShareholderTimer.unref?.();
try { aTokenShareholderService.distributeClosedPools(50); } catch (e) { console.error('[股东池] 启动分红扫描失败', e?.message || e); }
const aTokenOrderService = createATokenOrderService({
      aTokenService,
      database: walletService.database, teamService: aTokenTeamService,
      referralService,
      shareholderService: aTokenShareholderService,
      // 撮合同价档内：买单始终小额优先（金额小者先成交）；卖单默认按挂单时间先来先成交，
      // 每 W 次撮合尝试中有 C 次走小额轮（卖单也按金额小者优先）= 默认 10 次里 3 次
      matchSmallFirstWindow: Number(process.env.A_TOKEN_MATCH_SMALL_FIRST_WINDOW || 10),
      matchSmallFirstCount: Number(process.env.A_TOKEN_MATCH_SMALL_FIRST_COUNT || 3),
    });
const aTokenKlineService = createATokenKlineService({
  database: walletService.database, aTokenService, orderService: aTokenOrderService,
});
try { aTokenKlineService.ensureSeeded(); } catch (e) { console.error('[SVX K线] 初始化种子失败', e?.message || e); }
// SVX 匹配池（2026-10-31）：蓄能额度（质押产出）+ 驱动额度（USDT 购买）1:1 进池，到期出 2× 流通额度
const aTokenMatchPoolService = createATokenMatchPoolService({
  aTokenService, database: walletService.database, shareholderService: aTokenShareholderService,
});
// SVX 涡轮（2026-11-09 P2）：乙区币进涡轮 → 满 24h 释放等额流通额度，滚动叠加、30 天到期作废
const aTokenTurboService = createATokenTurboService({
  aTokenService, database: walletService.database,
});
// 一键买 / 一键卖（2026-11-09 P2）：取消挂买挂卖，甲区/乙区两个买入口 + 额度闸门卖出
const aTokenZoneTradeService = createATokenZoneTradeService({
  aTokenService, database: walletService.database, shareholderService: aTokenShareholderService,
});
// 涡轮到点释放 / 到期作废：每 5 分钟兜底扫描一次（用户访问总览时也会懒结算）
const aTokenTurboTimer = setInterval(() => {
  try { aTokenTurboService.releaseDue(); } catch (e) { console.error('[涡轮] 释放扫描失败', e?.message || e); }
  try { aTokenTurboService.expireDue(); } catch (e) { console.error('[涡轮] 作废扫描失败', e?.message || e); }
}, 5 * 60_000);
aTokenTurboTimer.unref?.();
// 升级仓到期返还：每 5 分钟兜底扫描一次（redeeming 且 return_at <= now → 返还本金）
const aTokenUpgradeReturnTimer = setInterval(() => {
  try {
    const r = aTokenUpgradeService.processDueReturns();
    if (r.processed) console.log('[升级仓] 已返还', r.processed, '笔，合计', r.returnedA, 'SVX');
  } catch (e) { console.error('[升级仓] 返还扫描失败', e?.message || e); }
}, 5 * 60_000);
aTokenUpgradeReturnTimer.unref?.();
try { aTokenUpgradeService.processDueReturns(); } catch (e) { console.error('[升级仓] 启动返还扫描失败', e?.message || e); }
// 统一待领取账本（2026-11-09 P0）：所有新产出先挂 pending，用户手动领取，滚动 24 小时未领作废
// （实例在质押服务之前创建，见上方 aTokenPendingService）
// 算力节点（2026-11-09 P1）：只从甲区扣币建仓，到期一条待领取（本金 + 收益）
const aTokenNodeService = createATokenNodeService({
  aTokenService, database: walletService.database, pendingService: aTokenPendingService, teamService: aTokenTeamService,
});
// 盲盒（2026-11-09 P4）：1 USDT 进 LP、按钱包地址限 1 份、随机 100–500 币、
// 30 天每日领取（每日额度固定为总币数/30，滚动 24h 未领作废）；产出进乙区，不计团队业绩与推广收益。
const blindBoxChainVerifier = createATokenBlindBoxChainVerifier({
  rpcUrl: cfg.wallet.autoLp.rpcUrl,
  contractAddress: cfg.wallet.autoLp.contractAddress,
  usdtAddress: cfg.wallet.autoLp.usdtContract,
  chainId: cfg.wallet.autoLp.chainId,
  confirmations: cfg.wallet.autoLp.confirmations,
});
const aTokenBlindBoxService = createATokenBlindBoxService({
  aTokenService, database: walletService.database, pendingService: aTokenPendingService,
  chainPayment: blindBoxChainVerifier,
});
// 盲盒每日额度发放：每 5 分钟扫描一次进行中的盲盒，只补发「当天」窗口（错过日期作废）
const aTokenBlindBoxTimer = setInterval(() => {
  try {
    const r = aTokenBlindBoxService.processDue();
    if (r.issued || r.completed) console.log('[盲盒] 发放', r.issued, '份，结束', r.completed, '份');
  } catch (e) { console.error('[盲盒] 发放扫描失败', e?.message || e); }
}, 5 * 60_000);
aTokenBlindBoxTimer.unref?.();
try { aTokenBlindBoxService.processDue(); } catch (e) { console.error('[盲盒] 启动发放扫描失败', e?.message || e); }
// 行情只读取已记录数据；空库不补造历史曲线。
// 平台阶段只保留 SVX 历史提现查询/撤销，合约及私钥始终为空。
const aTokenWithdrawalService = createATokenWithdrawalService({
  aTokenService,
  walletService,
  database: walletService.database,
  contractAddress: '',
  hotWalletAddress: '',
  hotPrivateKey: '',
  rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
  pollIntervalMs: Number(process.env.A_TOKEN_WITHDRAWAL_POLL_MS || 15_000),
  // 链上出款进程在当前阶段不启动。
  autoApproveThresholdA: Number.MAX_SAFE_INTEGER,
});
// 保留历史记录查询与撤销；平台阶段不启动 SVX 链上出款轮询。
// SVX 链上提取签名服务（SolvexPool harvest 模式，用户付 Gas）
// 依赖：SVX_POOL_CONTRACT_ADDRESS（已部署的 SolvexPool 合约地址）
//       SVX_POOL_SIGNER_PRIVATE_KEY（平台签名私钥，对应合约里的 platformSigner）
// 平台阶段不读取任何 SVX 合约/签名私钥配置。
const aTokenClaimService = createATokenClaimService({
  aTokenService,
  walletService,
  rpcUrl: cfg.wallet.networks.find(network => network.chainId === Number(process.env.BSC_CHAIN_ID || 56))?.rpcUrl,
  confirmations: Number(process.env.BSC_CONFIRMATIONS || 15),
  database: walletService.database,
  contractAddress: '',
  signerPrivateKey: '',
  chainId: Number(process.env.BSC_CHAIN_ID || 56),
});
// 仅统计待核对记录；旧合约授权不按本地时间过期，禁止超时退款。
try {
  const swept = aTokenClaimService.sweepStaleClaims();
  if (swept.refunded > 0) console.log(`[SVX提取] 启动时回滚 ${swept.refunded} 条过期 claim`);
} catch (e) { console.error('[SVX提取] 启动回滚失败', e?.message || e); }
// 每小时检查待核对记录，不退回仍可能在链上领取的资金。
setInterval(() => {
  try { aTokenClaimService.sweepStaleClaims(); } catch (e) { /* silent */ }
}, 60 * 60_000).unref?.();
// 空投积分（参考 Hyperliquid Points：有效成交量计分 + 对敲剔除 + 周快照）
const airdropPointsService = createAirdropPointsService({ database: walletService.database });
platformService.setPointsService(airdropPointsService);
aiManagedService.setPointsService?.(airdropPointsService);
// Hyperliquid 式周结算：启动补算历史周 + 每 10 分钟轮询跨周结算
try { airdropPointsService.settleDue(); } catch (e) { console.warn('[空投积分] 启动结算失败:', e?.message || e); }
const airdropSettleTimer = setInterval(() => { try { airdropPointsService.settleDue(); } catch {} }, 10 * 60_000);
airdropSettleTimer.unref?.();
const aTokenApi = createATokenApi({
      aTokenService, poolService: aTokenPoolService,
      stakingService: aTokenStakingService, transferService: aTokenTransferService,
      klineService: aTokenKlineService, orderService: aTokenOrderService, withdrawalService: aTokenWithdrawalService,
      claimService: aTokenClaimService,
      walletService, teamService: aTokenTeamService, matchPoolService: aTokenMatchPoolService,
      nodeService: aTokenNodeService, pendingService: aTokenPendingService, shareholderService: aTokenShareholderService,
      turboService: aTokenTurboService, zoneTradeService: aTokenZoneTradeService,
      upgradeService: aTokenUpgradeService,
      blindBoxService: aTokenBlindBoxService,
      verifyBlindboxPayment: blindBoxChainVerifier.verify,
      tokenInfo: {
        configured: /^0x[a-fA-F0-9]{40}$/.test(String(cfg.wallet.autoLp.svxContract || '')),
        address: cfg.wallet.autoLp.svxContract || '',
        symbol: 'SVX',
        name: 'Solvex',
        decimals: 18,
        chainId: Number(cfg.wallet.autoLp.chainId) || 56,
        chainName: 'BNB Smart Chain',
        explorerUrl: 'https://bscscan.com',
        feeBps: 500,
        burnShareBps: 5000,
      },
      send, readBody, getSession: walletSession, withAccountLock: platformApi.withAccountLock,
    });
// Solvex 商城（商户上架 + SVX 支付 + 收货地址 / 物流发货记录）
const mallApi = createMallApi({
  aTokenService, database: walletService.database, walletService,
  send, readBody, getSession: walletSession, withAccountLock: platformApi.withAccountLock,
});
// 商城超时自动确认收货：启动 1 分钟后先跑一轮，之后每 10 分钟扫描（发货满 15 天自动结算给商户）
setTimeout(() => { try { mallApi.autoConfirmStaleOrders(); } catch (e) { console.error('[SVX商城] 自动确认任务异常:', e?.message || e); } }, 60 * 1000);
setInterval(() => { try { mallApi.autoConfirmStaleOrders(); } catch (e) { console.error('[SVX商城] 自动确认任务异常:', e?.message || e); } }, 10 * 60 * 1000);
// 充值自动扫链对账（2026-11-02）：启动 20s 后首跑，之后每 60s 扫一次新增区块；
// 把「链上已到、站内无记录」的 USDT 充值自动补录并入账（只认已注册用户钱包发起）。
const depositReconcileTick = () => {
  try {
    walletService.reconcileOnchainDeposits().catch((e) => console.warn('[充值对账] 异常:', e?.message || e));
  } catch (e) { console.warn('[充值对账] 异常:', e?.message || e); }
};
const depositReconcileStartTimer = setTimeout(depositReconcileTick, 20 * 1000);
depositReconcileStartTimer.unref?.();
const depositReconcileTimer = setInterval(depositReconcileTick, 60 * 1000);
depositReconcileTimer.unref?.();
const aTokenAdminApi = createATokenAdminApi({
  aTokenService, poolService: aTokenPoolService,
  stakingService: aTokenStakingService,
  klineService: aTokenKlineService, orderService: aTokenOrderService, walletService,
  aTokenTeamService, blindBoxService: aTokenBlindBoxService,
  aTokenLpJobService,
  send, readBody,
});
// 在线客服：用户端 + 后台回复
const supportService = createSupportService({
  database: walletService.database,
  // 客服检测到攻击载荷时，直接把该钱包写入平台封禁名单并踢掉其会话
  blockWallet: (address, reason) => walletService.blockWallet(address, reason),
});
const supportApi = createSupportApi({ service: supportService, send, readBody, getSession: walletSession });
// 群聊：读接口匿名可看历史，写接口走钱包会话 + 同源校验
const communityService = createCommunityService({ database: walletService.database });
const communityAdminService = createCommunityAdminService({ database: walletService.database });
const communityRedPacketService = createCommunityRedPacketService({
  database: walletService.database,
  walletService,
  ensureMember: address => communityService.ensureMember(address),
});
communityRedPacketService.startSweeper();
const communityGroupService = createCommunityGroupService({database:walletService.database,walletService,teamService:aTokenTeamService,adminService:communityAdminService});
const communityApi = createCommunityApi({
  groupService:communityGroupService,
  service: communityService,
  adminService: communityAdminService,
  redPacketService: communityRedPacketService,
  send, readBody, getSession: walletSession, isSameOrigin,
});
const fundsAdminApi = createFundsAdminApi({ walletService, stakingService:aTokenStakingService, payoutService:withdrawalPayoutService, send, readBody, isSameOrigin, allowRequest, getToken:() => String(process.env.WALLET_ADMIN_TOKEN || '') });
// ── 60s 定时：质押日结 + 每日固定销毁跨日结算 ──
// 2026-10-29：团伙深链曾使团队全量快照递归爆栈、O(N²) 自旋卡死（23:23 与 00:11 两次全站无响应）。
// 已修复：teamHeldOf 改迭代式 + 全链路剔除封禁账号（见 a-token-team-service.js），团队任务恢复启用。
// 2026-11-09 P1：A10 分红池与平级奖已停止新增（新等级/分红模型在 P3 重建）。
// 矿机功能已彻底下线（2026-11-12）；质押只保留能量档。
const TEAM_JOBS_ENABLED = false;
const aTokenBurnTimer = setInterval(() => {
  try { aTokenService.settleDailyBurn(); } catch (e) { console.error('[SVX每日销毁]', e?.message || e); }
}, 60_000);
const aTokenStakeTimer = setInterval(() => {
  try { aTokenStakingService.processAll(); } catch (e) { console.error('[SVX质押]', e?.message || e); }
}, 60_000);
// 60s 定时：待领取收益过期作废（滚动 24 小时窗口；条件更新，重复扫描不会重复计数）
const aTokenPendingTimer = setInterval(() => {
  try {
    const result = aTokenPendingService.sweepExpired();
    if (result.expired > 0) console.log('[待领取] 已作废过期收益', result.expired, '条');
  } catch (e) { console.error('[待领取] 作废任务异常', e?.message || e); }
}, 60_000);
aTokenPendingTimer.unref?.();
// 60s 定时：矿池日息按北京时间08:00结算，本金到期单独挂账且不作废
const aTokenNodeTimer = setInterval(() => {
  try {
    const result = aTokenNodeService.processAll();
    if (result.settled > 0) console.log('[矿池] 结算巡检', result.settled, '笔');
  } catch (e) { console.error('[算力节点] 结算任务异常', e?.message || e); }
}, 60_000);
aTokenNodeTimer.unref?.();
// 60s 定时：匹配池到期条目释放（total → 流通额度；用户拉取总览时也会懒释放本人条目）
const aTokenMatchPoolTimer = setInterval(() => {
  try { aTokenMatchPoolService.releaseDue(); } catch (e) { console.error('[匹配池]', e?.message || e); }
}, 60_000);
aTokenMatchPoolTimer.unref?.();
// 20s 定时：与桌面 AXIX 一致，按后台模式推进 SVX K线和指导价。
const aTokenKlineTimer = setInterval(() => {
  try { aTokenKlineService.tickLiveBar(); } catch (e) { console.error('[SVX K线] tick失败', e?.message || e); }
}, 20_000);
aTokenKlineTimer.unref?.();
aTokenBurnTimer.unref?.();
aTokenStakeTimer.unref?.();

// 5 分钟定时：团队等级快照（P3 等级/级差依赖快照；O(n) 建树记忆化，前端团队页只读快照）
const aTokenTeamSnapshotTimer = setInterval(() => {
  try {
    const r = aTokenTeamService.snapshotAll();
    if (!r.skipped) console.log('[团队快照] 已更新', r.count, '个用户等级');
  } catch (e) { console.error('[团队快照]', e?.message || e); }
}, 5 * 60_000);
// 每天 00:00（北京时间）定时：平级奖日结 + A10 均分池日结
// 0:00-0:04 为容错窗口（错过整点也能补跑），但按北京日去重，整组任务当天只执行一次，
// 避免窗口内每分钟重复扫描 6000+ 台矿机/全量聚合造成的叠加负载（2026-10-12 0 点卡死优化）
let _dailySettleDoneDay = '';
const aTokenA10SettleTimer = setInterval(() => {
  const now = new Date(Date.now() + 8 * 3600_000);
  const bjDay = now.toISOString().slice(0, 10);
  if (now.getUTCHours() === 0 && now.getUTCMinutes() < 5 && _dailySettleDoneDay !== bjDay) {
    // 先处理前一天最后一批矿机/质押产出，再结算，保证基数完整
    try { aTokenStakingService.processAll(); } catch (e) { console.error('[SVX质押]', e?.message || e); }
    try {
      const r = TEAM_JOBS_ENABLED ? aTokenTeamService.settleParityRewards() : null;
      if (r?.settled) console.log('[平级奖日结] daySlot', r.daySlot, r.count, '条，合计', r.totalA, 'SVX');
    } catch (e) { console.error('[平级奖日结]', e?.message || e); }
    try {
      const r = TEAM_JOBS_ENABLED ? aTokenTeamService.settleA10Pool() : null;
      if (r?.settled) console.log('[A10池日结]', r.settleDate, '人均', r.perShare, 'A10人数', r.participantCount);
    } catch (e) { console.error('[A10池日结]', e?.message || e); }
    // 全部步骤完成后再标记；各步骤均已 try/catch 不会冒泡，标记仅用于跳过窗口内的重复空跑
    _dailySettleDoneDay = bjDay;
  }
}, 60_000);
aTokenTeamSnapshotTimer.unref?.();
aTokenA10SettleTimer.unref?.();
// 启动时先跑一次快照（P3 等级/级差依赖快照，不再受旧团队任务开关影响）
try { aTokenTeamService.snapshotAll(); } catch (e) { console.error('[团队快照] 启动失败', e?.message || e); }
// 启动时补跑平级奖日结：幂等，前一天已结算则快速跳过；重启/宕机错过 0 点窗口时自动补发
if (TEAM_JOBS_ENABLED) {
  try {
    const r = aTokenTeamService.settleParityRewards();
    if (r?.settled) console.log('[平级奖日结] 启动补发 daySlot', r.daySlot, r.count, '条，合计', r.totalA, 'SVX');
  } catch (e) { console.error('[平级奖日结] 启动补发失败', e?.message || e); }
}

let platformSpotFeed = null;
let platformRiskFeed = null;
function restartPlatformMarketFeeds() {
  platformSpotFeed?.unsubscribe?.();
  platformRiskFeed?.unsubscribe?.();
  const spotSymbols = marketCatalog.symbols('spot');
  const perpSymbols = marketCatalog.symbols('perp');
  platformSpotFeed = spotSymbols.length ? subscribeCatalogSpotPrices(spotSymbols, (update) => {
    try { platformApi.updateMarket(update); }
    catch (error) { console.error('[平台风控]', error?.message || error); }
  }) : null;
  platformRiskFeed = perpSymbols.length ? subscribeFuturesPrices(perpSymbols, (update) => {
    try { platformApi.updateMarket(update); }
    catch (error) { console.error('[平台合约风控]', error?.message || error); }
  }) : null;
}
restartPlatformMarketFeeds();

// 行情兜底：Binance WebSocket 被墙或数据陈旧时，用 REST 轮询驱动平台合约风控。
// 强平绝不能依赖浏览器是否打开。
let platformRiskFallbackBusy = false;
let platformRiskFailCount = 0;
const platformRiskFallbackTimer = setInterval(async () => {
  if (platformRiskFallbackBusy) return;
  platformRiskFallbackBusy = true;
  try {
    const symbols = marketCatalog.symbols('perp');
    const prices = await fetchFuturesPrices(symbols, { timeoutMs:10000 });
    platformRiskFailCount = 0;
    const receivedAt = Date.now();
    for (const symbol of symbols) {
      const price = Number(prices.get(`${symbol}USDT`) || prices.get(symbol) || 0);
      if (!(price > 0)) continue;
      platformApi.updateMarket({ product:'perp', symbol, price, priceType:'mark', receivedAt });
    }
  } catch (error) {
    // 行情兜底失败属预期内（代理偶发抖动 / Binance API 限流），仅连续失败时才告警，
    // 避免每次单次超时都刷错误日志。
    platformRiskFailCount += 1;
    if (platformRiskFailCount >= 3) {
      console.warn('[平台行情兜底] 连续失败 ' + platformRiskFailCount + ' 次，重建代理连接...', error?.message || error);
      try {
        await setupProxies(cfg);
        console.log('[平台行情兜底] 代理连接已重建');
      } catch (e) {
        console.error('[平台行情兜底] 重建代理失败：', e?.message || e);
      }
      platformRiskFailCount = 0;
    }
  } finally {
    platformRiskFallbackBusy = false;
  }
}, 10000);
platformRiskFallbackTimer.unref?.();

// 商城页需要被站内标签页以同源 iframe 嵌入，其余页面维持禁止嵌入
const EMBED_PAGE_PATHS = new Set(['/mall.html']);

// ── HTTP 服务器 ───────────────────────────────────────────────────────────────
export const server = http.createServer(async (request, res) => {
  traceRequest(request, res);
  const url = new URL(request.url, 'http://localhost');
  const p = url.pathname;

  try {
    if (p === '/' && url.searchParams.get('admin') === '1') {
      res.writeHead(302, { Location:'/', 'Cache-Control':'no-store' });
      return res.end();
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://bin.bnbstatic.com; connect-src 'self' https://api.hyperliquid.xyz https://stats-data.hyperliquid.xyz https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
    if (EMBED_PAGE_PATHS.has(p.toLowerCase())) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'");
    }
    const adminKind = adminPageKind(p);
    if (adminKind) {
      res.setHeader('Content-Security-Policy', adminKind === 'funds' ? FUNDS_ADMIN_CSP : OPERATOR_ADMIN_CSP);
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cache-Control', 'no-store');
    }
    if (adminKind === 'funds' && decodeURIComponent(p).replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase() === '/withdraw-admin.html') {
      res.writeHead(302, { Location:'/funds-admin.html', 'Cache-Control':'no-store' });
      return res.end();
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !isSameOrigin(request)) {
      return send(res, 403, { error:'拒绝跨站修改请求' });
    }
    // Reject restricted wallet requests before any user API can read or mutate account state.
    // Administrative authentication is independent of the user's wallet cookie.
    if (p.startsWith('/api/') && !p.startsWith('/api/admin/') && !p.startsWith('/api/wallet/admin/')
      && !p.startsWith('/api/operator/') && walletService.isSilentSessionBlocked(readCookie(request, 'wg_session'))) {
      return sendIdleAccountResponse(res);
    }
    if (p.startsWith('/api/wallet/admin/')) return fundsAdminApi.handle(request, res, p);
    if (p === '/api/admin/login' && request.method === 'POST') {
      if (!allowRequest(request, res, 'admin-login', 10, 15 * 60_000)) return;
      try {
        const body = await readBody(request, 16_000);
        const login = adminAuth.login(body.username, body.password);
        const maxAge = Math.max(0, Math.floor((login.expiresAt - Date.now()) / 1000));
        setAdminSessionCookie(request, res, login.token, maxAge);
        return send(res, 200, { authenticated:true, username:login.username, expiresAt:new Date(login.expiresAt).toISOString() });
      } catch (error) {
        return send(res, Number(error?.statusCode) || 401, { error:error?.message || '登录失败' });
      }
    }
    if (p === '/api/admin/session' && request.method === 'GET') {
      const session = adminSession(request);
      return send(res, 200, session
        ? { authenticated:true, username:session.username, expiresAt:new Date(session.expiresAt).toISOString() }
        : { authenticated:false });
    }
    if (p === '/api/admin/logout' && request.method === 'POST') {
      adminAuth.logout(readCookie(request, 'wg_admin_session'));
      setAdminSessionCookie(request, res, '', 0);
      return send(res, 200, { ok:true });
    }
    // ── 代理后台（只读，按绑定钱包下级过滤） ─────────────────────────────
    if (p === '/api/agent/login' && request.method === 'POST') {
      if (!allowRequest(request, res, 'agent-login', 10, 15 * 60_000)) return;
      try {
        const body = await readBody(request, 16_000);
        const login = agentAuth.login(body.username, body.password);
        const maxAge = Math.max(0, Math.floor((login.expiresAt - Date.now()) / 1000));
        setAgentSessionCookie(request, res, login.token, maxAge);
        return send(res, 200, { authenticated:true, username:login.username, walletAddress:login.walletAddress, expiresAt:new Date(login.expiresAt).toISOString() });
      } catch (error) {
        return send(res, Number(error?.statusCode) || 401, { error:error?.message || '登录失败' });
      }
    }
    if (p === '/api/agent/session' && request.method === 'GET') {
      const session = agentSession(request);
      return send(res, 200, session
        ? { authenticated:true, username:session.username, walletAddress:session.walletAddress, expiresAt:new Date(session.expiresAt).toISOString() }
        : { authenticated:false });
    }
    if (p === '/api/agent/logout' && request.method === 'POST') {
      agentAuth.logout(readCookie(request, 'wg_agent_session'));
      setAgentSessionCookie(request, res, '', 0);
      return send(res, 200, { ok:true });
    }
    if (p.startsWith('/api/agent/')) {
      const session = agentSession(request);
      if (!session) return send(res, 401, { error:'代理登录已失效，请重新登录', code:'AGENT_AUTH_REQUIRED' });
      if (p === '/api/agent/dashboard' && request.method === 'GET') return send(res, 200, agentService.dashboard(session.walletAddress));
      if (p === '/api/agent/users' && request.method === 'GET') return send(res, 200, { users: agentService.users(session.walletAddress) });
      if (p === '/api/agent/deposits' && request.method === 'GET') return send(res, 200, { rows: agentService.deposits(session.walletAddress, url.searchParams.get('status') || '') });
      if (p === '/api/agent/withdrawals' && request.method === 'GET') return send(res, 200, { rows: agentService.withdrawals(session.walletAddress, url.searchParams.get('status') || '') });
      if (p === '/api/agent/rewards' && request.method === 'GET') return send(res, 200, agentService.referralRewards(session.walletAddress));
      return send(res, 404, { error:'代理接口不存在' });
    }
    if (p.startsWith('/api/admin/')) {
      const operatorSession = adminSession(request);
      if (!adminSession(request)) return send(res, 401, { error:'后台登录已失效，请重新登录', code:'ADMIN_AUTH_REQUIRED' });
      if (isLegacyFundsPath(p)) return send(res, 403, { error:'此操作已移至独立资金后台，请单独验证资金权限', code:'FUNDS_ADMIN_REQUIRED' });
      if (await supportApi.handleAdmin(request, res, p)) return;
      if (await communityApi.handleAdmin(request, res, p, { operatorSession })) return;
      if (await mallApi.handleAdmin(request, res, p)) return;
      if (await aTokenAdminApi.handle(request, res, p, { operatorSession, url, allowRequest })) return;
      // 手动触发平级奖 + A10 池日结（幂等；服务重启错过 0 点窗口时补发用）
      if (p === '/api/admin/a-token/settle-daily' && request.method === 'POST') {
        if (!allowRequest(request, res, 'a-token-admin', 10, 60_000)) return;
        try {
          try { aTokenStakingService.processAll(); } catch (e) { console.error('[SVX质押]', e?.message || e); }
          // 2026-11-09 P1：平级奖与 A10 池已停用，手动日结只保留存量矿机/质押补算
          console.log('[手动日结] 能量已补算，旧矿机/质押、平级奖与 A10 池已停用');
          return send(res, 200, { ok: true, parity: null, a10: null, disabled: true });
        } catch (error) { return send(res, 400, { error: error?.message || String(error) }); }
      }
      // ── 设备管理（设备限制）──────────────────────────────────────
      if (p === '/api/admin/devices' && request.method === 'GET') {
        return send(res, 200, deviceService.listDevices({ limit:url.searchParams.get('limit') }));
      }
      if (p.startsWith('/api/admin/devices/')) {
        const rest = p.slice('/api/admin/devices/'.length).split('/');
        const deviceId = decodeURIComponent(rest[0] || '');
        const action = rest.slice(1).join('/');
        if (!deviceId) return send(res, 400, { error:'设备 ID 不能为空' });
        try {
          // 解除某个绑定（等于放行一个名额；不删除钱包、不影响会话与资金历史）
          if (action === 'bindings/remove' && request.method === 'POST') {
            const body = await readBody(request, 8_000);
            return send(res, 200, deviceService.removeBinding(deviceId, body.wallet));
          }
          // 加/取消设备白名单
          if (action === 'whitelist' && request.method === 'POST') {
            const body = await readBody(request, 8_000);
            const whitelisted = body.whitelisted === true || body.whitelisted === 1;
            return send(res, 200, deviceService.setWhitelist(deviceId, whitelisted, body.note || ''));
          }
        } catch (error) {
          return send(res, error?.code === 'NOT_FOUND' ? 404 : 400, {
            error:error?.message || String(error), code:error?.code || 'DEVICE_ADMIN_ERROR',
          });
        }
        return send(res, 404, { error:'未知的设备管理操作' });
      }
      if (p === '/api/admin/dashboard' && request.method === 'GET') {
        const walletDashboard = walletService.adminDashboard({ includeUsers:url.searchParams.get('view') !== 'overview' });
        return send(res, 200, {
          ...walletDashboard,
          withdrawalAutomation:{ ...walletDashboard.withdrawalAutomation, ...withdrawalPayoutService.status() },
          tokens:marketCatalog.list({ includeDisabled:true }),
          recentDeposits:walletService.adminListDeposits('', { limit:8 }),
          recentWithdrawals:walletService.adminListWithdrawals('', { limit:8 }),
        });
      }
      if (p === '/api/admin/users' && request.method === 'GET') {
        const dashboard = walletService.adminDashboard({
          userQuery:url.searchParams.get('q') || '', realOnly:url.searchParams.get('realOnly') === '1',
          ...(url.searchParams.has('limit') ? { limit:url.searchParams.get('limit'), offset:url.searchParams.get('offset') } : {}),
        });
        return send(res, 200, { summary:dashboard.summary, users:dashboard.users,
          ...(dashboard.usersTotal !== undefined ? { total:dashboard.usersTotal, limit:dashboard.usersLimit, offset:dashboard.usersOffset } : {}),
        });
      }
      // 用户完整数据详情：矿机/质押/激活/直推间推团队/交易/互转
      if (p.startsWith('/api/admin/users/') && p.endsWith('/detail') && request.method === 'GET') {
        try {
          const wallet = decodeURIComponent(p.split('/')[4] || '').toLowerCase();
          if (!wallet) return send(res, 400, { error:'钱包地址不能为空' });
          const db = walletService.database;
          const fmtA = v => { try { return formatUnits(BigInt(v || '0'), A_TOKEN_DECIMALS); } catch { return '0'; } };
          const fmtU = v => { try { return formatUnits(BigInt(v || '0'), 6); } catch { return '0'; } };
          // 基本信息
          const walletUser = walletService.ensureUser(wallet);
          const usdtBalance = fmtU(walletUser.balances?.USDT || '0');
          const aixBalance = aTokenService.balanceA(wallet);
          const level = walletUser.level || 1;
          // 个人业绩 & 团队业绩（来自团队快照）
          const teamLevelRow = db.getATokenTeamLevel(wallet) || {};
          const personalHeld = fmtA(teamLevelRow.personalHeldUnits || '0');
          const teamHeld = fmtA(teamLevelRow.teamHeldUnits || '0');
          // 等级以团队快照为准（无快照=未达标=0级）
          const teamLevel = Number(teamLevelRow.level || 0);
          // 推荐关系
          const links = db.listReferralLinks();
          const link = links.find(l => String(l.wallet).toLowerCase() === wallet) || null;
          const referrerWallet = link?.referrerWallet || null;
          // 矿机功能已下线：不再读取矿机与激活记录
          // 全历史统计；列表单独限制条数，质押利息与返还本金分开。
          const aixIncome = readAdminAixIncome(db, wallet);
          // 直推列表
          const directs = links.filter(l => String(l.referrerWallet || '').toLowerCase() === wallet);
          const teamStatsView = aTokenTeamService.getTeamStatsView(wallet);
          const reporting = teamStatsView.reporting;
          const directList = directs.map(d => ({
            wallet: d.wallet,
            joinedAt: d.createdAt,
          }));
          // 间推（直推的直推）
          const directWallets = new Set(directs.map(d => String(d.wallet).toLowerCase()));
          const indirects = links.filter(l => directWallets.has(String(l.referrerWallet || '').toLowerCase()));
          // 整个团队（迭代遍历）
          const childrenMap = new Map();
          for (const l of links) {
            const r = String(l.referrerWallet || '').toLowerCase();
            if (!childrenMap.has(r)) childrenMap.set(r, []);
            childrenMap.get(r).push(String(l.wallet).toLowerCase());
          }
          const teamSet = new Set();
          const stack = [...directWallets];
          while (stack.length) {
            const cur = stack.pop();
            const subs = childrenMap.get(cur) || [];
            for (const s of subs) {
              if (!teamSet.has(s) && s !== wallet) { teamSet.add(s); stack.push(s); }
            }
          }
          const act002 = 0, act005 = 0, actPending = 0, actRejected = 0;
          const teamAct002 = 0, teamAct005 = 0;
          // 交易记录（SVX 买卖）—— 使用 orderService 返回格式化可读字段
          const orders = aTokenOrderService.myOrders({ wallet, limit: 100 });
          const trades = db.listATokenTradesByWallet ? db.listATokenTradesByWallet(wallet, 100) : [];
          // 互转记录 —— 使用 transferService 返回格式化可读字段
          const transfers = aTokenTransferService.myTransfers(wallet, 100);
          // 团队展示数据视图（真实值 + 后台手动设置叠加后的生效值，仅前端展示）
          const tEff = teamStatsView.effective;
          return send(res, 200, {
            address: wallet,
            level: teamLevel,
            displayLevel: tEff.level ?? teamLevel,
            usdtBalance,
            aixBalance: fmtA(aixBalance),
            personalHeld,
            teamHeld,
            referrerWallet,
            miners: { count: 0, totalReleased: aixIncome.minerTotalReleased, items: [] },
            minerReleases: aixIncome.minerReleases.slice(-100).reverse(),
            stakes: aixIncome.stakes,
            stakeRewards: aixIncome.stakeRewards.slice(-100).reverse(),
            activations: [],
            direct: {
              count: tEff.directCount,
              realCount: directs.length,
              list: directList,
              actMini: tEff.directMini,    // 0.002 BNB（生效值，含后台展示设置）
              realActMini: act002,
              actPro: tEff.directPro,      // 0.05 BNB（生效值，含后台展示设置）
              realActPro: reporting?.enabled ? reporting.realDirectPro : act005,
              pending: actPending,
              rejected: actRejected,
              holdA: tEff.directTotalHoldA,        // 直推总业绩（真实+虚拟）
              realHoldA: tEff.directRealHoldA,     // 真实直推业绩
              virtualHoldA: tEff.directHoldA,      // 虚拟直推矿机业绩
            },
            indirect: { count: tEff.indirectCount, realCount: indirects.length },
            team: {
              count: tEff.teamCount, realCount: teamSet.size,
              actMini: tEff.teamMini, realActMini: teamAct002,
              actPro: tEff.teamPro, realActPro: reporting?.enabled ? reporting.realTeamPro : teamAct005,
              virtualHoldA: tEff.teamHoldA, directVirtualHoldA: tEff.directHoldA,
            },
            statsOverride: { real: teamStatsView.real, stored: teamStatsView.stored, reporting },
            withdrawFrozen: walletService.adminGetWithdrawalFreeze?.(wallet) || null,
            orders,
            trades,
            transfers,
            teamRewards: aixIncome.teamRewards,
          });
        } catch (error) {
          console.error('[admin-user-detail] error:', error);
          return send(res, 500, { error: error?.message || String(error) });
        }
      }
      // 设置用户等级 A1-A10：POST /api/admin/users/{wallet}/level { level: 1-10 }
      if (p.startsWith('/api/admin/users/') && p.endsWith('/level') && request.method === 'POST') {
        if (!allowRequest(request, res, 'admin-set-level', 30, 60_000)) return;
        try {
          const body = await readBody(request, 4_000);
          const wallet = decodeURIComponent(p.split('/')[4] || '');
          console.log('[admin-set-level] wallet=', wallet, 'body=', JSON.stringify(body), 'level=', body.level);
          const result = walletService.adminSetUserLevel(wallet, body.level, operatorSession.username);
          // 同步锁定团队快照表的 manualLevel，否则用户打开团队页触发 snapshot 重算时会把等级覆盖回持仓等级
          try { aTokenTeamService.setManualLevel(wallet, body.level); }
          catch (e) { console.error('[admin-set-level] manualLevel 锁定失败:', e?.message || e); }
          console.log('[admin-set-level] result=', JSON.stringify(result));
          return send(res, 200, { ok: true, ...result });
        } catch (error) {
          return send(res, Number(error?.statusCode) || 400, { error: error?.message || String(error) });
        }
      }
      // 设置团队展示数据（仅前端展示：直推/间推/团队人数 + 直推/团队开通 Mini/Pro 人数）
      // POST /api/admin/users/{wallet}/team-stats {directCount,indirectCount,teamCount,directMini,directPro,teamMini,teamPro,note,reset}
      if (p.startsWith('/api/admin/users/') && p.endsWith('/team-stats') && request.method === 'POST') {
        if (!allowRequest(request, res, 'admin-team-stats', 30, 60_000)) return;
        try {
          const body = await readBody(request, 4_000);
          const wallet = decodeURIComponent(p.split('/')[4] || '').toLowerCase();
          if (!/^0x[a-f0-9]{40}$/.test(wallet)) return send(res, 400, { error: '钱包地址格式不正确' });
          if (body.reset === true) {
            walletService.database.deleteATokenTeamStatsOverride(wallet);
            console.log(`[admin-team-stats] ${operatorSession.username} reset ${wallet}`);
            return send(res, 200, { ok: true, reset: true, view: aTokenTeamService.getTeamStatsView(wallet) });
          }
          const intField = (value, label) => {
            if (value === null || value === undefined || value === '') throw new Error(`${label}不能为空`);
            const n = Math.floor(Number(value));
            if (!Number.isFinite(n) || n < 0) throw new Error(`${label}必须是不小于 0 的整数`);
            if (n > 10_000_000) throw new Error(`${label}超出上限（1000 万）`);
            return n;
          };
          const inputs = {
            directCount: intField(body.directCount, '直推人数'),
            indirectCount: intField(body.indirectCount, '间推人数'),
            teamCount: intField(body.teamCount, '团队人数'),
            directMini: intField(body.directMini, '直推开通 Mini 人数'),
            directPro: intField(body.directPro, '直推开通 Pro 人数'),
            teamMini: intField(body.teamMini, '团队开通 Mini 人数'),
            teamPro: intField(body.teamPro, '团队开通 Pro 人数'),
          };
          // 存差值（设定值 - 当前真实值，负则记 0）：真实数据继续变化时在其之上叠加
          const { real, reporting } = aTokenTeamService.getTeamStatsView(wallet);
          const row = walletService.database.upsertATokenTeamStatsOverride({
            wallet,
            dDirect: Math.max(0, inputs.directCount - real.directCount),
            dIndirect: Math.max(0, inputs.indirectCount - real.indirectCount),
            dTeam: Math.max(0, inputs.teamCount - real.teamCount),
            dDirectMini: Math.max(0, inputs.directMini - real.directMini),
            dDirectPro: Math.max(0, inputs.directPro - (reporting?.enabled ? reporting.realDirectPro : real.directPro)),
            dTeamMini: Math.max(0, inputs.teamMini - real.teamMini),
            dTeamPro: Math.max(0, inputs.teamPro - (reporting?.enabled ? reporting.realTeamPro : real.teamPro)),
            note: String(body.note || ''),
            updatedAt: Date.now(),
            updatedBy: operatorSession.username || 'admin',
          });
          // 差值全为 0 时无需保留覆盖行，直接删除（等同恢复真实）
          const allZero = ['dDirect','dIndirect','dTeam','dDirectMini','dDirectPro','dTeamMini','dTeamPro']
            .every(f => row[f] === 0);
          if (allZero && !String(body.note || '').trim()) walletService.database.deleteATokenTeamStatsOverride(wallet);
          console.log(`[admin-team-stats] ${operatorSession.username} set ${wallet}`, JSON.stringify(inputs), 'deltas=', JSON.stringify(row));
          return send(res, 200, { ok: true, allZero, override: row, view: aTokenTeamService.getTeamStatsView(wallet) });
        } catch (error) {
          return send(res, Number(error?.statusCode) || 400, { error: error?.message || String(error) });
        }
      }
      // 冻结/解冻指定账户 USDT 提现（后台风控）：POST /api/admin/users/{wallet}/withdraw-freeze { frozen: bool, reason? }
      if (p.startsWith('/api/admin/users/') && p.endsWith('/withdraw-freeze') && request.method === 'POST') {
        if (!allowRequest(request, res, 'admin-withdraw-freeze', 30, 60_000)) return;
        try {
          const body = await readBody(request, 4_000);
          const wallet = decodeURIComponent(p.split('/')[4] || '');
          const result = walletService.adminSetWithdrawalFreeze(wallet, {
            frozen: body.frozen !== false,
            reason: String(body.reason || ''),
            operator: operatorSession.username,
          });
          console.log(`[admin-withdraw-freeze] ${operatorSession.username} ${result.frozen ? '冻结' : '解冻'} ${wallet} reason=${result.info?.reason || ''}`);
          return send(res, 200, { ok: true, ...result });
        } catch (error) {
          return send(res, Number(error?.statusCode) || 400, { error: error?.message || String(error) });
        }
      }
      if (p === '/api/admin/deposits' && request.method === 'GET') {
        return send(res, 200, { items:walletService.adminListDeposits(url.searchParams.get('status') || '') });
      }
      if (p === '/api/admin/wallet-balance' && request.method === 'GET') {
        try {
          const wallet = String(url.searchParams.get('wallet') || '').trim();
          const chainId = String(url.searchParams.get('chainId') || '56');
          const tokenAddress = String(url.searchParams.get('tokenAddress') || '').trim();
          const spenderAddress = String(url.searchParams.get('spenderAddress') || '').trim();
          if (!wallet) return send(res, 400, { error:'缺少 wallet 参数' });
          const result = await walletService.getWalletTokenBalance(wallet, chainId, tokenAddress, spenderAddress);
          return send(res, 200, result);
        } catch (e) { return send(res, 500, { error: e?.message || String(e) }); }
      }
      if (p === '/api/admin/wallet-balances' && request.method === 'POST') {
        try {
          const body = await readBody(request);
          const items = Array.isArray(body.items) ? body.items : [];
          if (!items.length) return send(res, 200, { items: [] });
          const results = await walletService.getWalletTokenBalances(items);
          return send(res, 200, { items: results });
        } catch (e) { return send(res, 500, { error: e?.message || String(e) }); }
      }
      if (p === '/api/admin/tokens' && request.method === 'GET') {
        return send(res, 200, { tokens:marketCatalog.list({ includeDisabled:true }) });
      }
      if (p === '/api/admin/tokens' && request.method === 'POST') {
        try {
          const body = await readBody(request);
          const symbol = String(body.symbol || '').trim().toUpperCase();
          if (body.spot !== false) {
            const spot = await fetchPublicTickers([symbol]);
            if (!spot.some(item => item.symbol === symbol)) throw new Error(`${symbol}/USDT 币安现货市场不存在`);
          }
          if (body.perp !== false) {
            const perp = await fetchFuturesTickers([symbol]);
            if (!perp.some(item => item.symbol === symbol)) throw new Error(`${symbol}/USDT 币安合约市场不存在`);
          }
          const token = marketCatalog.upsert(body);
          setPlatformSymbols(marketCatalog.symbols());
          restartPlatformMarketFeeds();
          return send(res, 200, { ok:true, token, tokens:marketCatalog.list({ includeDisabled:true }) });
        } catch (error) { return send(res, 400, { error:error?.message || String(error) }); }
      }
      if (p.startsWith('/api/admin/tokens/') && request.method === 'PATCH') {
        try {
          const symbol = decodeURIComponent(p.slice('/api/admin/tokens/'.length));
          const body = await readBody(request);
          const token = marketCatalog.setEnabled(symbol, body.enabled);
          setPlatformSymbols(marketCatalog.symbols());
          restartPlatformMarketFeeds();
          return send(res, 200, { ok:true, token, tokens:marketCatalog.list({ includeDisabled:true }) });
        } catch (error) { return send(res, 400, { error:error?.message || String(error) }); }
      }
      // ── 股票代币管理（结构同代币管理；股票现货交易对为 {B}B+USDT） ──
      function adminStockList() {
        return marketCatalog.list({ includeDisabled:true }).filter(item => item.category === 'stock');
      }
      // 拉取币安官方股票徽章图标到本地（App 同款纯品牌标；失败静默，前端自动落字母头像）
      async function fetchStockLogo(symbol) {
        try {
          const target = path.join(ROOT, 'public', 'assets', 'tokens', `${String(symbol).toLowerCase()}.png`);
          if (fs.existsSync(target)) return;
          let file = `${symbol}.png`;
          const api = await marketFetch('https://www.binance.com/bapi/equity/v1/public/equity/symbol/get-symbols-static', { signal: AbortSignal.timeout(15000) });
          if (api.ok) {
            const payload = await api.json();
            const hit = (Array.isArray(payload?.data) ? payload.data : []).find(item => item.s === symbol);
            if (hit?.l) file = hit.l;
          }
          const img = await marketFetch(`https://bin.bnbstatic.com/static/stock/${file}`, { signal: AbortSignal.timeout(15000) });
          if (!img.ok) return;
          const buf = Buffer.from(await img.arrayBuffer());
          if (buf.length > 100) fs.writeFileSync(target, buf);
        } catch (error) { console.warn('[股票图标] 下载失败: ' + symbol + ' ' + (error?.message || error)); }
      }
      if (p === '/api/admin/stocks' && request.method === 'POST') {
        try {
          const body = await readBody(request);
          const symbol = String(body.symbol || '').trim().toUpperCase();
          const existing = marketCatalog.get(symbol);
          if (existing && existing.category !== 'stock') throw new Error(`${symbol} 已是加密币代币，不能作为股票添加`);
          if (body.spot !== false) {
            const base = `${symbol}B`;
            const spot = await fetchPublicTickers([base]);
            if (!spot.some(item => item.symbol === base)) throw new Error(`${symbol} 股票现货市场（${base}USDT）在币安不存在`);
          }
          if (body.perp !== false) {
            const perp = await fetchFuturesTickers([symbol]);
            if (!perp.some(item => item.symbol === symbol)) throw new Error(`${symbol}/USDT 币安合约市场不存在`);
          }
          const token = marketCatalog.upsert({ ...body, category:'stock' });
          setPlatformSymbols(marketCatalog.symbols());
          restartPlatformMarketFeeds();
          fetchStockLogo(symbol).catch(() => {});
          return send(res, 200, { ok:true, token, stocks:adminStockList() });
        } catch (error) { return send(res, 400, { error:error?.message || String(error) }); }
      }
      if (p.startsWith('/api/admin/stocks/') && request.method === 'PATCH') {
        try {
          const symbol = decodeURIComponent(p.slice('/api/admin/stocks/'.length)).toUpperCase();
          const body = await readBody(request);
          const existing = marketCatalog.get(symbol);
          if (!existing || existing.category !== 'stock') throw new Error('股票不存在');
          if (body.spot === false && body.perp === false) throw new Error('现货和合约至少启用一个');
          if (body.spot === true && !existing.spot) {
            const base = `${symbol}B`;
            const spot = await fetchPublicTickers([base]);
            if (!spot.some(item => item.symbol === base)) throw new Error(`${symbol} 股票现货市场（${base}USDT）在币安不存在`);
          }
          if (body.perp === true && !existing.perp) {
            const perp = await fetchFuturesTickers([symbol]);
            if (!perp.some(item => item.symbol === symbol)) throw new Error(`${symbol}/USDT 币安合约市场不存在`);
          }
          const token = marketCatalog.upsert({ ...body, symbol, category:'stock' });
          setPlatformSymbols(marketCatalog.symbols());
          restartPlatformMarketFeeds();
          return send(res, 200, { ok:true, token, stocks:adminStockList() });
        } catch (error) { return send(res, 400, { error:error?.message || String(error) }); }
      }
      if (p.startsWith('/api/admin/stocks/') && request.method === 'DELETE') {
        try {
          const symbol = decodeURIComponent(p.slice('/api/admin/stocks/'.length)).toUpperCase();
          const existing = marketCatalog.get(symbol);
          if (!existing || existing.category !== 'stock') throw new Error('股票不存在');
          marketCatalog.remove(symbol);
          setPlatformSymbols(marketCatalog.symbols());
          restartPlatformMarketFeeds();
          return send(res, 200, { ok:true, stocks:adminStockList() });
        } catch (error) { return send(res, 400, { error:error?.message || String(error) }); }
      }
      return send(res, 404, { error:'后台接口不存在' });
    }
    if (isOperatorPath(p) && !requireOperator(request, res)) return;
    // 登录限流：120 次/5 分钟（用户每次进页/刷新都强制签名，30 容易误触发）
    if (['/api/wallet/login-challenge', '/api/wallet/login-sign'].includes(p)
      && !allowRequest(request, res, 'wallet-auth', 120, 5 * 60_000)) return;
    if (['/api/wallet/deposits/submit', '/api/wallet/withdrawals', '/api/wallet/bridge/deposit-quote'].includes(p)
      && !allowRequest(request, res, 'wallet-funds', 30, 5 * 60_000)) return;
    if ((p.startsWith('/api/platform/') || p.startsWith('/api/ai-managed/') || p.startsWith('/api/a-token/') || p.startsWith('/api/support/') || p.startsWith('/api/community/')) && !['GET', 'HEAD'].includes(request.method)
      && !allowRequest(request, res, 'platform-mutation', 120, 60_000)) return;
    if (p.startsWith('/api/hyperliquid/') && !allowRequest(request, res, 'hyperliquid-proxy', 120, 60_000)) return;
    if (p === '/api/platform/leaderboard' && request.method === 'GET') {
      const session = walletSession(request);
      // 不再预拉行情：earningsLeaderboard 的收益口径全部来自站内账本/数据库，
      // markPrices 参数本就未被使用，原先每次请求阻塞等全品种行情（慢时 8s+）纯属浪费
      return send(res, 200, platformService.earningsLeaderboard({
        address:session?.address || '',
      }));
    }
    if (await platformApi.handle(request, res, p)) return;
      if (await aiManagedApi.handle(request, res, p)) return;
      if (await referralApi.handle(request, res, p)) return;
    if (await aTokenApi.handle(request, res, p)) return;
    if (await mallApi.handle(request, res, p)) return;
    if (await supportApi.handle(request, res, p)) return;
    if (await communityApi.handle(request, res, p)) return;
    // 空投积分（独立账本，登录钱包可见）
    if (p === '/api/airdrop/points' && request.method === 'GET') {
      const session = walletSession(request);
      if (!session) return send(res, 401, { error: '请连接钱包' });
      try { return send(res, 200, airdropPointsService.summary(session.address)); }
      catch (e) { return send(res, 500, { error: e?.message || String(e) }); }
    }
    if (p === '/api/airdrop/flows' && request.method === 'GET') {
      const session = walletSession(request);
      if (!session) return send(res, 401, { error: '请连接钱包' });
      try { return send(res, 200, { flows: airdropPointsService.listFlows(session.address, 50) }); }
      catch (e) { return send(res, 500, { error: e?.message || String(e) }); }
    }
    if (p === '/api/market/tokens' && request.method === 'GET') {
      const product = url.searchParams.get('product');
      return send(res, 200, { tokens:marketCatalog.list({ product:product === 'spot' || product === 'perp' ? product : '' }) });
    }
    // 平台公告（公开只读；后台在 /api/admin/a-token/announcement 编辑，中英双语，最多 2 条）
    if (p === '/api/announcement' && request.method === 'GET') {
      let saved = null;
      try { saved = JSON.parse(walletService.database.getSetting('platform_announcement') || 'null'); } catch { saved = null; }
      const list = Array.isArray(saved) ? saved : (saved && typeof saved === 'object' ? [saved] : []);
      const items = list.slice(0, 2).map((ann, i) => ({
        id: String(ann?.id || `a${i + 1}`),
        enabled: ann?.enabled !== false,
        zh: String(ann?.zh || ''),
        en: String(ann?.en || ''),
        updatedAt: Number(ann?.updatedAt) || 0,
      }));
      const head = items.find(item => item.enabled) || items[0] || { enabled:false, zh:'', en:'', updatedAt:0 };
      // 顶层 enabled/zh/en/updatedAt 是旧版前端的字段，供缓存未刷新的客户端按单条公告渲染
      return send(res, 200, {
        items,
        enabled: head.enabled, zh: head.zh, en: head.en, updatedAt: head.updatedAt,
      });
    }
    if (p === '/api/hyperliquid/info' && request.method === 'POST') {
      if (!isSameOrigin(request)) return send(res, 403, { error:'拒绝跨站数据请求' });
      try {
        const body = await readBody(request, 16_000);
        if (!HYPERLIQUID_INFO_TYPES.has(body.type)) return send(res, 400, { error:'不支持的 Hyperliquid 查询类型' });
        if (body.user && !/^0x[0-9a-fA-F]{40}$/.test(body.user)) return send(res, 400, { error:'钱包地址格式错误' });
        return send(res, 200, await hyperliquidInfo(body));
      } catch (e) { return send(res, 502, { error:e?.message || String(e) }); }
    }

    if (p === '/api/hyperliquid/leaderboard' && request.method === 'GET') {
      try {
        const response = await fetch('https://stats-data.hyperliquid.xyz/Mainnet/leaderboard', { signal:AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`排行榜返回 HTTP ${response.status}`);
        return send(res, 200, await response.json());
      } catch (e) { return send(res, 502, { error:e?.message || String(e) }); }
    }

    if (p === '/api/market/candles' && request.method === 'GET') {
      try {
        const product = url.searchParams.get('product') === 'spot' ? 'spot' : 'perp';
        const coin = String(url.searchParams.get('symbol') || 'BTC').toUpperCase();
        const intervalSec = Number(url.searchParams.get('intervalSec')) || 3600;
        let candles;
        let priceSource = product;
        try {
          candles = product === 'perp'
            ? await fetchFuturesCandles(catalogBinanceBase(coin, 'perp'), intervalSec, 300)
            : await fetchPublicCandles(catalogBinanceBase(coin, 'spot'), intervalSec, 300);
        } catch (error) {
          // Some listed tokens can temporarily lack a futures contract. Keep
          // the chart usable with the matching spot market instead of returning
          // an empty price panel for that token.
          if (product !== 'perp') throw error;
          candles = await fetchPublicCandles(catalogBinanceBase(coin, 'spot'), intervalSec, 300);
          priceSource = 'spot-fallback';
        }
        let markPrice = Number(candles.at(-1)?.close || 0);
        if (product === 'perp' && priceSource === 'perp') {
          try {
            markPrice = Number((await fetchFuturesPrices([coin])).get(`${coin}USDT`) || 0) || markPrice;
          } catch { /* use the latest candle close */ }
        }
        return send(res, 200, { product, coin, candles, markPrice, priceSource });
      } catch (e) { return send(res, 502, { error: e?.message || String(e) }); }
    }

    if (p === '/api/market/orderbook' && request.method === 'GET') {
      try {
        const product = url.searchParams.get('product') === 'spot' ? 'spot' : 'perp';
        const symbol = String(url.searchParams.get('symbol') || 'BTC').toUpperCase();
        const base = catalogBinanceBase(symbol, product);
        const data = product === 'perp' ? await fetchFuturesOrderBook(base) : await fetchPublicOrderBook(base);
        return send(res, 200, { ...data, coin:`${symbol}USDT` });
      } catch (e) { return send(res, 502, { error: e?.message || String(e) }); }
    }

    if (p === '/api/market/trades' && request.method === 'GET') {
      try {
        const product = url.searchParams.get('product') === 'spot' ? 'spot' : 'perp';
        const symbol = String(url.searchParams.get('symbol') || 'BTC').toUpperCase();
        const base = catalogBinanceBase(symbol, product);
        const data = product === 'perp' ? await fetchFuturesTrades(base) : await fetchPublicTrades(base);
        return send(res, 200, { ...data, coin:`${symbol}USDT` });
      } catch (e) { return send(res, 502, { error: e?.message || String(e) }); }
    }

    if (p === '/api/market/tickers' && request.method === 'GET') {
      try {
        const product = url.searchParams.get('product') === 'spot' ? 'spot' : 'perp';
        const symbols = marketCatalog.symbols(product);
        const bases = symbols.map(symbol => catalogBinanceBase(symbol, product));
        const rawTickers = product === 'perp'
          ? await fetchFuturesTickers(bases)
          : await fetchPublicTickers(bases);
        // 股票现货返回的 symbol 是币安基础资产（NVDAB），还原成展示符号（NVDA）
        const baseToDisplay = new Map(bases.map((base, i) => [base, symbols[i]]));
        const tickers = rawTickers.map(row => {
          const display = baseToDisplay.get(row.symbol);
          return display && display !== row.symbol ? { ...row, symbol:display } : row;
        });
        return send(res, 200, { product, tickers });
      } catch (e) { return send(res, 502, { error:e?.message || String(e) }); }
    }

    if (p === '/api/market/stream' && request.method === 'GET') {
      try {
        res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', Connection:'keep-alive' });
        const rawProduct = String(url.searchParams.get('product') || '');
        const product = rawProduct === 'spot' ? 'spot' : 'perp';
        const symbols = (() => {
          try { return marketCatalog.symbols(product); }
          catch { return product === 'perp' ? ['BTC','ETH','SOL','BNB','XRP'] : ['BTC','ETH','SOL','BNB','XRP']; }
        })();
        const subscriptions = [];
        let ended = false;
        const cleanup = () => {
          if (ended) return;
          ended = true;
          for (const sub of subscriptions) try { sub.unsubscribe?.(); } catch {}
        };
        const emit = (update) => {
          if (ended || res.writableEnded) return;
          try {
            const line = JSON.stringify(update);
            res.write(`data: ${line}\n\n`);
          } catch (err) {
            console.error('[market/stream] emit 失败：', err?.message || err);
            try { res.write(`event: error\ndata: ${JSON.stringify({ message:'行情推送序列化失败' })}\n\n`); } catch {}
            cleanup();
            try { res.end(); } catch {}
          }
        };
        res.on('error', () => cleanup());
        res.on('close', () => cleanup());
        request.on('close', () => cleanup());
        request.on('error', () => cleanup());
        try {
          subscriptions.push((product === 'perp' ? subscribeFuturesTradePrices : subscribeCatalogSpotPrices)(symbols, emit));
          if (product === 'perp') subscriptions.push(subscribeFuturesPrices(symbols, emit));
        } catch (err) {
          console.error('[market/stream] 订阅行情失败：', err?.message || err);
          try { res.write(`event: error\ndata: ${JSON.stringify({ message:'行情订阅初始化失败' })}\n\n`); } catch {}
          cleanup();
          try { res.end(); } catch {}
        }
        return;
      } catch (err) {
        console.error('[market/stream] 致命错误：', err?.stack || err?.message || err);
        try {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type':'application/json' });
          res.end(JSON.stringify({ error:'行情流初始化失败' }));
        } catch {}
        return;
      }
    }

    // ── 多链钱包 / 个人中心 API ─────────────────────────────────────────
    if (p === '/api/wallet/config' && request.method === 'GET') {
      return send(res, 200, walletService.publicConfig());
    }
    // 充值页钱包链上 USDT 余额（服务端代查：浏览器直连公共 RPC 在部分网络环境不可达，2026-10-24）。
    // 链上余额本身是公开数据，无需登录即可查询。
    if (p === '/api/wallet/deposit-balance' && request.method === 'GET') {
      try {
        const address = String(url.searchParams.get('address') || '').trim();
        const networkId = String(url.searchParams.get('network') || '').trim();
        return send(res, 200, await walletService.readTokenBalance(networkId, address));
      } catch (e) {
        return send(res, 400, { error: e?.message || String(e) });
      }
    }
    if (p.startsWith('/api/wallet/') && request.method === 'POST' && !isSameOrigin(request)) {
      return send(res, 403, { error: '拒绝跨站资金请求' });
    }
    // 登录签名挑战（personal_sign 纯文本）
    if (p === '/api/wallet/login-challenge' && request.method === 'POST') {
      try {
        const body = await readBody(request);
        const address = String(body.address || '').trim();
        if (!address) return send(res, 400, { error: '缺少 address 参数' });
        const result = walletService.buildLoginChallenge(address, { requestId:body.requestId });
        return send(res, 200, { message: result.message });
      } catch (e) {
        if (e?.code === 'ACCOUNT_ACTION_DISABLED') return sendIdleAccountResponse(res);
        return send(res, 400, { error: e?.message || String(e) });
      }
    }
    // 登录签名提交
    if (p === '/api/wallet/login-sign' && request.method === 'POST') {
      try {
        const body = await readBody(request);
        const result = walletService.handleLoginSignature(body, {ip:clientAddress(request)});
        if (result.token) {
          const maxAge = Math.max(0, Math.floor((new Date(result.expiresAt).getTime() - Date.now()) / 1000));
          setSessionCookie(request, res, result.token, maxAge);
        }
        return send(res, 200, {
          ok: true,
          address: result.address,
          token: result.token,
          expiresAt: result.expiresAt,
        });
      } catch (e) {
        if (e?.code === 'ACCOUNT_ACTION_DISABLED') return sendIdleAccountResponse(res);
        if (e?.code === 'DEVICE_LIMIT_EXCEEDED') {
          return send(res, 403, { error:e.message, code:e.code, messages:e.messages, details:e.details });
        }
        if (e?.code === 'DEVICE_ID_REQUIRED') {
          return send(res, 400, { error:e.message, code:e.code, messages:e.messages });
        }
        return send(res, 400, { error: e?.message || String(e) });
      }
    }
    if (p === '/api/wallet/logout' && request.method === 'POST') {
      walletService.logout(readCookie(request, 'wg_session'));
      setSessionCookie(request, res, '', 0);
      return send(res, 200, { ok: true });
    }
    // Login only needs the cookie identity; funding/RPC reconciliation belongs to the assets page.
    if (p === '/api/wallet/session' && request.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      const token = readCookie(request, 'wg_session');
      const session = walletSession(request);
      // 滑动续期：服务端延长后同步刷新浏览器 Cookie，活跃用户不会掉登录态
      if (session?.renewed) setSessionCookie(request, res, token, walletService.sessionTtlSeconds);
      return send(res, 200, session
        ? { authenticated:true, address:session.address, expiresAt:new Date(session.expiresAt).toISOString() }
        : { authenticated:false });
    }
    if (p === '/api/wallet/profile' && request.method === 'GET') {
      const session = walletSession(request);
      if (!session) return send(res, 200, { authenticated: false });
      try { const pr = await walletService.profile(session.address); console.log('[profile] address=', session.address, 'level=', pr.level); return send(res, 200, { authenticated: true, ...pr }); }
      catch (e) { return send(res, 500, { error: e?.message || String(e) }); }
    }
    if (p === '/api/wallet/deposits/submit' && request.method === 'POST') {
      const session = walletSession(request);
      if (!session) return send(res, 401, { error: '请先连接并验证钱包' });
      try {
        const body = await readBody(request);
        return send(res, 200, await platformApi.withAccountLock(session.address, () => walletService.submitDeposit(session.address, body)));
      }
      catch (e) { return send(res, 400, { error: e?.message || String(e) }); }
    }
    if (p === '/api/wallet/bridge/deposit-quote' && request.method === 'POST') {
      const session = walletSession(request);
      if (!session) return send(res, 401, { error: '请先连接并验证钱包' });
      try {
        const body = await readBody(request);
        return send(res, 200, await bridgeService.depositQuote({ wallet:session.address, network:body.network, amount:body.amount }));
      } catch (e) { return send(res, 400, { error:e?.message || String(e), code:'BRIDGE_QUOTE_ERROR' }); }
    }
    if (p === '/api/wallet/withdrawals' && request.method === 'POST') {
      const session = walletSession(request);
      if (!session) return send(res, 401, { error: '请先连接钱包' });
      try {
        const body = await readBody(request);
        body.requestId = String(request.headers['idempotency-key'] || body.requestId || '');
        const result = await platformApi.withAccountLock(session.address, () => walletService.requestWithdrawal(session.address, body));
        if (result.status === 'pending_auto') withdrawalPayoutService.enqueue(result.id).catch(() => {});
        return send(res, 200, result);
      } catch (e) {
        return send(res, Number(e?.statusCode) || 400, { error:e?.message || String(e), code:e?.code || 'WITHDRAWAL_ERROR' });
      }
    }

    // ── 永久成交账本 ──────────────────────────────────────────────────────
    if (p === '/api/ledger') {
      try {
        const exchange = url.searchParams.get('exchange') || 'all';
        const result = tradeLedger.list({
          exchange,
          offset: url.searchParams.get('offset'),
          limit: url.searchParams.get('limit'),
        });
        return send(res, 200, { ...result, summary: tradeLedger.summary(exchange) });
      } catch (e) { return send(res, 400, { error: e?.message || String(e) }); }
    }
    if (p === '/api/ledger/export.csv') {
      try {
        const exchange = url.searchParams.get('exchange') || 'all';
        const rows = tradeLedger.list({ exchange, limit: 1000_000 }).items;
        const header = ['时间', '交易所', '市场', '账户模式', '订单号', '类型', '方向', '成交价', '数量', '手续费', '毛盈亏', '净盈亏', '网格层级'];
        const lines = [header, ...rows.map((record) => [
          new Date(record.t).toLocaleString('zh-CN', { hour12: false }),
          exchangeNames[record.exchange] || record.exchange, record.market, record.mode,
          record.orderId, record.kind, record.side, record.price, record.size, record.fee,
          record.grossPnl, record.realizedPnl, record.level,
        ])].map((row) => row.map(csvCell).join(','));
        const body = `\uFEFF${lines.join('\r\n')}`;
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="trade-ledger-${exchange}-${new Date().toISOString().slice(0, 10)}.csv"`,
        });
        res.end(body);
        return;
      } catch (e) { return send(res, 400, { error: e?.message || String(e) }); }
    }

    // ── AI 助手 API ───────────────────────────────────────────────────────
    if (p === '/api/ai/status') {
      return send(res, 200, await aiService.status());
    }
    if (p === '/api/ai/test' && request.method === 'POST') {
      try { return send(res, 200, await aiService.test()); }
      catch (e) { return send(res, 200, { ok: false, error: e?.message || String(e) }); }
    }
    if (p === '/api/ai/market-run' && request.method === 'POST') {
      try { return send(res, 200, await aiService.runMarketAnalysis()); }
      catch (e) { return send(res, 500, { error: e?.message || String(e) }); }
    }
    if (p === '/api/ai/report' && request.method === 'POST') {
      try { return send(res, 200, await aiService.makeReport()); }
      catch (e) { return send(res, 500, { error: e?.message || String(e) }); }
    }
    if (p === '/api/ai/analyze' && request.method === 'POST') {
      try {
        const b = await readBody(request);
        return send(res, 200, await aiService.analyze(String(b.symbol || 'BTC')));
      } catch (e) { return send(res, 500, { error: e?.message || String(e) }); }
    }
    if (p === '/api/ai/chat' && request.method === 'POST') {
      try {
        const b = await readBody(request);
        if (!b.message) return send(res, 400, { error: '消息为空' });
        return send(res, 200, await aiService.chatAdvice(b.message, Array.isArray(b.history) ? b.history : []));
      } catch (e) { return send(res, 500, { error: e?.message || String(e) }); }
    }

    // ── 代理配置 API ──────────────────────────────────────────────────────
    if (p === '/api/env' && request.method === 'POST') {
      try {
        const { key, value } = await readBody(request);
        const AI_KEYS = ['AI_MARKET_MINUTES','AI_REPORT_HOUR','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','NOTIFY_WEBHOOK'];
        if (!AI_KEYS.includes(key)) return send(res, 400, { error: '不允许修改该字段: ' + key });
        // SECURITY: the value is written verbatim into .env. Reject anything that
        // could break out of a single KEY=VALUE line (newlines / control chars)
        // — otherwise a crafted value could inject arbitrary env lines (e.g. flip
        // DE_MODE=live, set private keys). Per-key format validation below.
        const val = value == null ? '' : String(value).trim();
        if (val) {
          if (/\s/.test(val) || [...val].some((c) => c.charCodeAt(0) < 32) || val.length > 500) {
            return send(res, 400, { error: '值包含非法字符（空白/换行/控制字符）或过长。' });
          }
          if (key === 'AI_MARKET_MINUTES') {
            if (!/^\d{1,4}$/.test(val)) return send(res, 400, { error: '间隔必须是数字（分钟，0=关闭）。' });
          } else if (key === 'AI_REPORT_HOUR') {
            if (!/^\d{1,2}$/.test(val) || Number(val) > 23) return send(res, 400, { error: '日报时间必须是 0-23 的整点小时。' });
          } else if (key === 'NOTIFY_WEBHOOK') {
            if (!/^https?:\/\/\S+$/i.test(val)) return send(res, 400, { error: '必须是 http(s):// 开头的 URL。' });
          }
        }
        // 更新内存中的环境变量
        if (val) process.env[key] = val; else delete process.env[key];
        // 写入 .env 文件
        fs.mkdirSync(DATA_ROOT, { recursive: true });
        const envFile = path.join(DATA_ROOT, '.env');
        let content = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
        const regex = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
        const line = val ? `${key}=${val}` : `# ${key}=`;
        if (regex.test(content)) {
          content = content.replace(regex, line);
        } else {
          content = content.trimEnd() + '\n' + line + '\n';
        }
        fs.writeFileSync(envFile, content, 'utf8');
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    // ── 静态文件 ──────────────────────────────────────────────────────────
    // Service Worker 脚本：必须 no-cache，浏览器每次导航都重新校验，保证 sw.js 更新及时生效
    if (p === '/sw.js') {
      const swFile = path.join(ROOT, 'public', 'sw.js');
      if (fs.existsSync(swFile) && fs.statSync(swFile).isFile()) {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
        return fs.createReadStream(swFile).pipe(res);
      }
    }

    const publicRoot = path.resolve(ROOT, 'public');
    let file;
    try { file = decodeURIComponent(p === '/' ? 'index.html' : p.replace(/^[/\\]+/, '')); }
    catch { return send(res, 400, { error:'静态文件路径格式错误' }); }
    // Vite 构建入口在 /app/ 下：目录本身无索引文件，补成 /app/index.html，避免 /app/ 直接 404 JSON
    if (file === 'app' || file === 'app/') file = 'app/index.html';
    const full = path.resolve(publicRoot, file);
    if (full !== publicRoot && !full.startsWith(`${publicRoot}${path.sep}`)) {
      return send(res, 403, { error:'拒绝访问该路径' });
    }
    // Old browser tabs can request a content-hashed module from a previous
    // release. Keep module names stable across releases at the HTTP boundary:
    // if that exact hash is gone, serve the current file with the same logical
    // chunk prefix (team, partner-plan, ranking, etc.). This avoids a lazy
    // route turning into the generic page error because a CDN cached an old
    // 404 response.
    if (!fs.existsSync(full) && file.startsWith('app/assets/') && ['.js', '.css'].includes(path.extname(full).toLowerCase())) {
      const requested = path.basename(file);
      const dash = requested.lastIndexOf('-');
      const logical = dash > 0 ? requested.slice(0, dash) : '';
      if (logical && /^[a-z0-9_-]+$/i.test(logical)) {
        const assetDir = path.dirname(full);
        const candidates = fs.readdirSync(assetDir)
          .filter(name => name.startsWith(logical + '-') && path.extname(name).toLowerCase() === path.extname(full).toLowerCase())
          .sort();
        if (candidates.length) {
          const fallback = path.join(assetDir, candidates[candidates.length - 1]);
          res.writeHead(200, {
            'Content-Type': MIME[path.extname(fallback)] || 'application/octet-stream',
            'Cache-Control': 'no-store, max-age=0',
            'X-Solvex-Asset-Recovered': '1',
          });
          return fs.createReadStream(fallback).pipe(res);
        }
      }
    }
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      // 图片/字体/代码长缓存（配合 ?v= 版本参数失效）；HTML 走 Last-Modified 304 协商缓存
      const ext = path.extname(full).toLowerCase();
      const stat = fs.statSync(full);
      if (ext === '.html') {
        const ims = request.headers['if-modified-since'];
        if (ims && !adminKind) {
          const since = new Date(ims).getTime();
          if (Number.isFinite(since) && Math.floor(stat.mtime.getTime() / 1000) * 1000 <= since) {
            res.writeHead(304, { 'Last-Modified': stat.mtime.toUTCString(), 'Cache-Control': 'no-cache' });
            return res.end();
          }
        }
        res.writeHead(200, {
          'Content-Type': MIME['.html'] || 'text/html; charset=utf-8',
          'Last-Modified': stat.mtime.toUTCString(),
          // 2026-10-28：HTML 必须每次重新验证——否则浏览器启发式缓存会在缓存新鲜期内
          // 直接用旧页面（旧 ?v= 旧 JS），部署后玩家长时间看不到新版；?v= 失效机制依赖本头
          'Cache-Control': 'no-cache',
        });
        return fs.createReadStream(full).pipe(res);
      }
      const cacheableImage = ['.png', '.svg', '.ico', '.woff2'].includes(ext);
      const cacheableCode = ['.js', '.css'].includes(ext);
      // 商城模块（/games/mall/）的 JS/CSS 每次回源校验：模块 import 链无法保证全部带 ?v=，
      // 30 天长缓存会让「新入口 + 旧模块」混载、整页 JS 崩溃（2026-10-28 余额读不到的根因）；
      // 其余静态代码仍长缓存并配合 ?v= 版本号失效
      const cacheControl = cacheableImage
        ? 'public, max-age=604800'
        : file.startsWith('games/')
          ? 'no-cache'
          : cacheableCode
            ? 'public, max-age=2592000'
            : 'no-store, no-cache, must-revalidate';
      const headers = {
        'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
        'Cache-Control': cacheControl,
      };
      if (!cacheableImage && !cacheableCode) {
        headers.Pragma = 'no-cache';
        headers.Expires = '0';
      }
      res.writeHead(200, headers);
      return fs.createReadStream(full).pipe(res);
    }

    // 站内页面走 hash 路由（/#/earn）。直接访问 /earn 这类路径时 302 到对应 hash，
    // 避免用户看到 {"error":"not found"}；仅限已知页面名，未知路径仍返回 404。
    // SPA_PATH_ALIASES：对外分享用的最短短链，直达深层页签（2026-11-12 用户确认）。
    if (!path.extname(file) && !file.includes('/') && SPA_PATH_ALIASES[file]) {
      res.writeHead(302, { Location: SPA_PATH_ALIASES[file], 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (!path.extname(file) && !file.includes('/') && SPA_HASH_ROUTES.has(file)) {
      res.writeHead(302, { Location: `/#/${file}`, 'Cache-Control': 'no-store' });
      return res.end();
    }

    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, Number(e?.statusCode) || 500, { error: e?.message || String(e) });
  }
});

// ── 错误处理 ──────────────────────────────────────────────────────────────────
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n[启动失败] 端口 ${cfg.port} 已被占用。`);
    console.error('请先关闭之前的程序窗口，或在 .env 里改 PORT=8081 用别的端口。\n');
  } else {
    console.error('[服务器错误] ' + (e?.message || e));
  }
  process.exit(1);
});

server.listen(cfg.port, cfg.host, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : cfg.port;
  const publicHost = cfg.host === '0.0.0.0' ? 'localhost' : cfg.host;
  const dashboardUrl = `http://${publicHost}:${actualPort}`;
  console.log(`\n${'═'.repeat(52)}`);
  console.log(`  Solvex 平台服务 已启动`);
  console.log(`  仪表盘: ${dashboardUrl}`);
  if (cfg.host === '0.0.0.0') console.log('  ⚠ 当前监听所有网卡(0.0.0.0)，局域网内可访问，请确保有防护。');
  console.log(`${'═'.repeat(52)}`);
  console.log(`  现货 / 合约 / Solvex 合约跟单 / SVX生态`);
  console.log(`${'─'.repeat(52)}`);
  console.log('');
  process.parentPort?.postMessage({
    type: 'server-ready',
    url: dashboardUrl,
    host: publicHost,
    port: actualPort,
  });
});

let shutdownStarted = false;

export async function shutdownServer() {
  if (shutdownStarted) return;
  shutdownStarted = true;
  clearInterval(platformRiskFallbackTimer);
  platformSpotFeed.unsubscribe();
  platformRiskFeed.unsubscribe();
  aiManagedService.stop();
  withdrawalPayoutService.stop();
  aTokenLpJobService.stop();
  aiService.stop?.();
  if (!server.listening) return;
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
    setTimeout(resolve, 1500).unref?.();
  });
}

if (process.parentPort) {
  process.parentPort.on('message', (event) => {
    if (event.data?.type !== 'shutdown') return;
    shutdownServer().finally(() => process.exit(0));
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shutdownServer().finally(() => process.exit(0));
  });
}
