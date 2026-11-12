import crypto from 'node:crypto';
import { formatUnits } from 'ethers';
import { createATokenRevenueService } from './a-token-revenue-service.js';
import { SOLVEX_RULES } from '../shared/solvex-rules.js';

const A_TOKEN_DECIMALS = 18;
function formatATokenDisplay(units) {
  try { return formatUnits(BigInt(units || '0'), A_TOKEN_DECIMALS); } catch { return '0'; }
}

// SVX前端路由 /api/a-token/*（需钱包 session）
function apiError(message, code = 'A_TOKEN_ERROR', statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
function errorCode(error) {
  if (error?.code) return error.code;
  const m = String(error?.message || '');
  if (m.includes('余额不足')) return 'INSUFFICIENT_BALANCE';
  if (m.includes('不存在') || m.includes('未找到')) return 'NOT_FOUND';
  if (m.includes('格式') || m.includes('必须') || m.includes('无效') || m.includes('过小')) return 'VALIDATION_ERROR';
  return 'A_TOKEN_ERROR';
}

export function createATokenApi({
  aTokenService, poolService, stakingService, transferService, klineService, orderService, withdrawalService, claimService, walletService, teamService, matchPoolService, nodeService, pendingService, shareholderService, turboService, zoneTradeService, upgradeService, blindBoxService,
  verifyBlindboxPayment = null,
  tokenInfo = null,
  send, readBody, getSession, withAccountLock = (addr, op) => op(),
}) {
  const RATE_LIMIT_KEY = 'a-token-mutation';
  const revenueService = createATokenRevenueService({ database: walletService.database });

  function sendError(res, error) {
    send(res, Number(error?.statusCode) || 400, { error: error?.message || String(error), code: errorCode(error) });
  }
  function requireSession(request) {
    const session = getSession(request);
    if (!session) throw apiError('请连接钱包', 'SESSION_REQUIRED', 401);
    return session;
  }
  function idempotencyKey(request) {
    return String(request.headers['idempotency-key'] || `srv_${crypto.randomBytes(12).toString('hex')}`).trim();
  }

  async function handle(request, res, pathname) {
    if (!pathname.startsWith('/api/a-token/')) return false;
    if (request.method === 'POST' && /\/activate|\/activation\//.test(pathname)) return send(res,403,{error:'旧矿机激活已关闭，请使用矿池',code:'LEGACY_ACTIVATION_DISABLED'});
    const isGet = request.method === 'GET';
    if (isGet && pathname === '/api/a-token/rules') return send(res, 200, SOLVEX_RULES);
    if (/^\/api\/a-token\/(withdraw(?:\/quote)?|claim(?:-sign|-signature|-confirm|-refund|\/status)?)$/.test(pathname)) {
      if (isGet && pathname.endsWith('/claim/status')) return send(res, 200, { enabled: false, configured: false, mode: 'platform' });
      return send(res, 409, { error: 'SVX 当前为平台内资产，暂未开放链上提现或合约领取', code: 'SVX_PLATFORM_ONLY' });
    }

    // 公开：SVX 链上代币元数据（合约地址/精度/链/税率），供前端「添加到钱包」与链上余额展示
    if (isGet && pathname === '/api/a-token/token-info') {
      return send(res, 200, { configured: false, mode: 'platform', name: SOLVEX_RULES.asset.name, symbol: 'SVX', decimals: SOLVEX_RULES.asset.decimals, address: '', chainId: null });
    }
    // 公开（仅需 session）
    if (isGet && pathname === '/api/a-token/pool') {
      try {
        const s = poolService.stats();
        return send(res, 200, { ...s, depth: orderService?.depth?.() || null });
      } catch (e) { return sendError(res, e); }
    }
    // 真实 P2P 盘口（公开）：逐笔列出 OPEN 委托（不归并、不含地址）?limit=20
    if (isGet && pathname === '/api/a-token/orderbook') {
      try {
        const sp = new URLSearchParams(request.url?.split('?')[1] || '');
        const limit = Math.min(Math.max(Number(sp.get('limit')) || 20, 1), 50);
        return send(res, 200, orderService.orderbook({ limit }));
      } catch (e) { return sendError(res, e); }
    }
    // 挂单明细（公开）：逐笔 OPEN 委托（数量 + 金额 + 市价/限价），无挂单时返回空数组
    if (isGet && pathname === '/api/a-token/open-orders') {
      try {
        const sp = new URLSearchParams(request.url?.split('?')[1] || '');
        const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 2000);
        return send(res, 200, orderService.openOrders({ limit }));
      } catch (e) { return sendError(res, e); }
    }
    if (isGet && pathname === '/api/a-token/plans') {
      return send(res, 200, {
        withdrawEnabled: false,
        rules: SOLVEX_RULES,
        assetMode: 'platform',
        staking: Object.values(stakingService.STAKE_PLANS).map(p => ({
          ...p, minUnits: undefined, maxUnits: undefined,
          minCoins: p.minUnits ? formatATokenDisplay(p.minUnits) : '',
          maxCoins: p.maxUnits ? formatATokenDisplay(p.maxUnits) : '',
        })),
        nodes: nodeService?.describe?.() || null,
        liquidity: aTokenService.liquidityStatus(),
      });
    }
    // 股东池（公开只读）：卖出手续费归集进度 + 500U 分池状态（买入 0 手续费）
    if (isGet && pathname === '/api/a-token/shareholder-pool') {
      try {
        if (!shareholderService) return send(res, 200, { enabled: false });
        return send(res, 200, { enabled: true, ...shareholderService.overview() });
      } catch (e) { return sendError(res, e); }
    }
    // K 线（公开）：?period=1m|5m|15m|1h|4h|1d&limit=500
    if (isGet && pathname === '/api/a-token/kline') {
      try {
        const sp = new URLSearchParams(request.url?.split('?')[1] || '');
        const period = String(sp.get('period') || '15m');
        const limit = Number(sp.get('limit') || 500);
        const candles = klineService
          ? klineService.listKlines(period, limit)
          : [];
        return send(res, 200, { period, candles, status: klineService?.status ? klineService.status() : null });
      } catch (e) { return sendError(res, e); }
    }
    // 报价（公开，GET 查询参数）；已登录 → 卖方手续费按直推阶梯费率
    if (isGet && pathname === '/api/a-token/quote') {
      try {
        const sp = new URLSearchParams(request.url?.split('?')[1] || '');
        const side = sp.get('side') === 'sell' ? 'sell' : 'buy';
        const amount = sp.get('amount') || '';
        let quoteWallet = '';
        try { quoteWallet = requireSession(request).address; } catch {}
        return send(res, 200, poolService.quote(side, amount, quoteWallet));
      } catch (e) { return sendError(res, e); }
    }
    // 限价挂单报价（GET 查询参数：side=buy|sell&priceUsdt=0.098&amount=100）
    // 已登录 → 按直推阶梯算卖方手续费；未登录 → 按默认 50% 报价
    if (isGet && pathname === '/api/a-token/orders/quote') {
      try {
        const sp = new URLSearchParams(request.url?.split('?')[1] || '');
        const side = sp.get('side') === 'sell' ? 'sell' : 'buy';
        const priceUsdt = sp.get('priceUsdt') || '';
        const amount = sp.get('amount') || '';
        let quoteWallet = '';
        try { quoteWallet = requireSession(request).address; } catch {}
        return send(res, 200, orderService.quoteLimitOrder({ side, priceUsdt, amount, wallet: quoteWallet }));
      } catch (e) { return sendError(res, e); }
    }

    // 一键买/一键卖报价（公开只读）：side=buy|sell&zone=alpha|beta&amount=...
    if (isGet && pathname === '/api/a-token/zone/quote') {
      try {
        if (!zoneTradeService) return send(res, 503, { error: '一键交易未启用', code: 'ZONE_TRADE_DISABLED' });
        const sp = new URLSearchParams(request.url?.split('?')[1] || '');
        const side = sp.get('side') === 'sell' ? 'sell' : 'buy';
        const zone = ['beta','market'].includes(sp.get('zone')) ? sp.get('zone') : 'alpha';
        return send(res, 200, zoneTradeService.quote({ side, zone, amount: sp.get('amount') || '' }));
      } catch (e) { return sendError(res, e); }
    }

    let session;
    try { session = requireSession(request); }
    catch (e) { return sendError(res, e); }

    try {
      if (isGet && pathname === '/api/a-token/profile') {
        const prof = await aTokenService.profile(session.address);
        // 用 service.present() 的完整字段覆盖（含 remaining/progressPct/label/flexible 等）
        // 矿机功能已下线，不再下发矿机数据
        prof.miners = [];
        prof.stakes = stakingService.present(session.address);
        prof.liquidity = aTokenService.liquidityStatus();
        // 算力节点 / 甲区乙区余额 / 待领取总览（P1 新链路）
        try { prof.nodes = nodeService?.present?.(session.address) || []; } catch { prof.nodes = []; }
        try { prof.nodeTerm = nodeService?.describe?.() || null; } catch { prof.nodeTerm = null; }
        try { prof.zones = walletService.database.listATokenZoneBalances(session.address); } catch { prof.zones = { alpha:'0', beta:'0' }; }
        try {
          prof.pending = pendingService?.list?.(session.address, 'pending', 200) || [];
          prof.pendingSummary = pendingService?.summary?.(session.address) || null;
        } catch { prof.pending = []; prof.pendingSummary = null; }
        // 等级以团队快照为准，不要用 wallet_users 里旧的 level 字段
        prof.level = prof.teamLevel?.level ?? 0;
        // 冻结中资金：OPEN 委托占用的 USDT / A（资产条展示「可用 + 冻结中」）
        try { prof.locked = orderService?.myLocks?.(session.address) || { usdt: '0', a: '0' }; } catch { prof.locked = { usdt: '0', a: '0' }; }
        // 卖出阶梯费率档案（前端下单面板直接展示当前费率）
        try { prof.sellFee = orderService?.sellFeeProfile?.(session.address) || null; } catch { prof.sellFee = null; }
        // 可卖额度（2026-10-31 起 = 流通额度）：只有匹配池产出的流通额度可卖，前端卖出面板展示
        try { prof.sellQuota = orderService?.sellQuota?.(session.address) || null; } catch { prof.sellQuota = null; }
        // 匹配池总览（蓄能额度/驱动额度/流通额度 + 锁定条目），矿机页「匹配池」tab 使用
        try { prof.matchPool = matchPoolService?.overview?.(session.address) || null; } catch { prof.matchPool = null; }
        // 乙区涡轮总览（2026-11-09 P2）：锁定中 / 已释放额度 / 24h 释放 / 30 天到期
        try { prof.turbo = turboService?.overview?.(session.address) || null; } catch { prof.turbo = null; }
        // 升级仓总览（2026-11-09 P3）：active / 赎回中 / 已返还 + 30 天返还期
        try { prof.upgrade = upgradeService?.overview?.(session.address) || null; } catch { prof.upgrade = null; }
        // 股东总览（2026-11-09 P3）：本金 / S3 资格 / 待领取分红 / 500U 分池进度
        try { prof.shareholder = shareholderService?.overview?.(session.address) || null; } catch { prof.shareholder = null; }
        return send(res, 200, prof);
      }
      if (isGet && pathname === '/api/a-token/team/summary') {
        return send(res, 200, teamService.summary(session.address));
      }
      if (isGet && pathname === '/api/a-token/team/profile') {
        try {
          const tp = teamService?.profile(session.address);
          return send(res, 200, tp || { level: 0, levelLabel: '未达标' });
        } catch (e) {
          return send(res, 200, { level: 0, levelLabel: '未达标', error: e?.message || String(e) });
        }
      }
      // SVX 收益流水：汇总矿机产出、质押收益、团队分润、A10 分红、跟单/交易推荐奖励
      if (isGet && pathname === '/api/a-token/revenue') {
        const sp = new URLSearchParams(request.url?.split('?')[1] || '');
        const limit = Number(sp.get('limit') || 100);
        const kind = String(sp.get('kind') || '');
        try {
          const result = revenueService.listRevenue(session.address, { limit, kind });
          return send(res, 200, result);
        } catch (e) { return sendError(res, e); }
      }
      if (isGet && pathname === '/api/a-token/stakes') {
        return send(res, 200, { stakes: stakingService.present(session.address) });
      }
      // 算力节点总览：档位口径 + 甲乙区余额 + 本人节点仓位
      if (isGet && pathname === '/api/a-token/nodes') {
        if (!nodeService) return send(res, 501, { error: '算力节点未启用' });
        return send(res, 200, nodeService.overview(session.address));
      }
      // 算力节点报价：?coins=1000（只从甲区扣币建仓，输入为币数）
      if (isGet && pathname === '/api/a-token/nodes/quote') {
        if (!nodeService) return send(res, 501, { error: '算力节点未启用' });
        try {
          const sp = new URLSearchParams(request.url?.split('?')[1] || '');
          return send(res, 200, nodeService.quote(sp.get('coins') || '0'));
        } catch (e) { return sendError(res, e); }
      }
      // 待领取收益列表（默认 pending）：?status=pending|claimed|expired|reversed
      if (isGet && pathname === '/api/a-token/pending') {
        if (!pendingService) return send(res, 501, { error: '待领取未启用' });
        const sp = new URLSearchParams(request.url?.split('?')[1] || '');
        const status = String(sp.get('status') || 'pending');
        const limit = Math.min(Math.max(Number(sp.get('limit')) || 200, 1), 1000);
        return send(res, 200, {
          pending: pendingService.list(session.address, status, limit),
          summary: pendingService.summary(session.address),
        });
      }
      if (isGet && pathname === '/api/a-token/my-transfers') {
        return send(res, 200, { transfers: transferService.myTransfers(session.address) });
      }
      // 互转报价预览：GET /api/a-token/transfer-quote?amount=123
      // 2026-11-01 起互转功能关闭（保留历史记录查询 my-transfers）
      if (isGet && pathname === '/api/a-token/transfer-quote') {
        return send(res, 403, { error: 'SVX 互转功能已关闭', code: 'TRANSFER_DISABLED' });
      }
      // ===== 匹配池（2026-10-31）=====
      // GET /api/a-token/match-pool：总览（蓄能额度/驱动额度/流通额度 + 条目 + 购买记录）
      if (isGet && pathname === '/api/a-token/match-pool') {
        if (!matchPoolService) return send(res, 503, { error: '匹配池未启用', code: 'MATCH_POOL_DISABLED' });
        return send(res, 200, matchPoolService.overview(session.address));
      }
      // GET /api/a-token/match-pool/quote?aix=2000：SVX 数量 → 应付 USDT 报价（按 SVX 实时价）
      if (isGet && pathname === '/api/a-token/match-pool/quote') {
        if (!matchPoolService) return send(res, 503, { error: '匹配池未启用', code: 'MATCH_POOL_DISABLED' });
        const sp = new URLSearchParams(request.url?.split('?')[1] || '');
        try {
          if (sp.get('aix')) return send(res, 200, matchPoolService.quoteTurboByA(String(sp.get('aix'))));
          return send(res, 200, matchPoolService.quoteTurbo(String(sp.get('usdt') || '')));
        }
        catch (e) { return sendError(res, e); }
      }
      // GET /api/a-token/turbo：乙区涡轮总览（锁定中 / 已释放额度 / 到期时间）
      if (isGet && pathname === '/api/a-token/turbo') {
        if (!turboService) return send(res, 503, { error: '涡轮未启用', code: 'TURBO_DISABLED' });
        try { return send(res, 200, turboService.overview(session.address)); }
        catch (e) { return sendError(res, e); }
      }
      // GET /api/a-token/blindbox：盲盒总览（规则 / 我的盲盒 / 今日待领取）
      // 访问时顺带补发「当天」额度（只补当天，错过日期作废），不影响只读语义
      if (isGet && pathname === '/api/a-token/blindbox') {
        if (!blindBoxService) return send(res, 503, { error: '盲盒未启用', code: 'BLINDBOX_DISABLED' });
        try {
          blindBoxService.processDue(Date.now(), 200, session.address);
          return send(res, 200, blindBoxService.overview(session.address));
        } catch (e) { return sendError(res, e); }
      }
      // GET /api/a-token/turbo/history：一键买/一键卖流水
      if (isGet && pathname === '/api/a-token/zone/history') {
        if (!zoneTradeService) return send(res, 503, { error: '一键交易未启用', code: 'ZONE_TRADE_DISABLED' });
        try {
          const sp = new URLSearchParams(request.url?.split('?')[1] || '');
          return send(res, 200, { orders: zoneTradeService.history(session.address, Number(sp.get('limit') || 50)) });
        } catch (e) { return sendError(res, e); }
      }
      // 我的委托（含 OPEN / FILLED / CANCELLED）
      if (isGet && pathname === '/api/a-token/orders') {
        const sp = new URLSearchParams(request.url?.split('?')[1] || '');
        const limit = Number(sp.get('limit') || 100);
        return send(res, 200, { orders: orderService.myOrders({ wallet: session.address, limit }) });
      }
      // 撤单 DELETE /api/a-token/orders/:orderId
      if (request.method === 'DELETE' && pathname.startsWith('/api/a-token/orders/')) {
        const orderId = decodeURIComponent(pathname.slice('/api/a-token/orders/'.length));
        const result = await withAccountLock(session.address, () => orderService.cancelOrder({ wallet: session.address, orderId, reason: 'user_cancelled' }));
        return send(res, 200, result);
      }
      // SVX链上提现：预估报价 ?amount=100
      if (isGet && pathname === '/api/a-token/withdraw/quote') {
        const sp = new URLSearchParams(request.url?.split('?')[1] || '');
        const amount = Number(sp.get('amount') || 0);
        const balanceA = aTokenService.balanceA(session.address);
        try {
          const q = withdrawalService.quote({ amount });
          return send(res, 200, { ...q, balanceA: formatATokenDisplay(BigInt(balanceA)) });
        } catch (e) { return sendError(res, e); }
      }
      // SVX链上提现：我的提现记录 ?limit=50
      if (isGet && pathname === '/api/a-token/withdrawals') {
        const sp = new URLSearchParams(request.url?.split('?')[1] || '');
        const limit = Number(sp.get('limit') || 50);
        const list = withdrawalService.listWithdrawals(session.address, limit);
        return send(res, 200, {
          withdrawals: list.map(r => ({
            id: r.id, status: r.status, amountA: formatATokenDisplay(BigInt(r.amountUnits || '0')),
            feeA: formatATokenDisplay(BigInt(r.feeUnits || '0')),
            toAddress: r.toAddress || '', txHash: r.txHash || null,
            chainId: r.chainId || 56, confirmations: r.confirmations || 0,
            createdAt: r.createdAt, processedAt: r.processedAt, failReason: r.failReason || null,
          })),
          status: withdrawalService.status(),
        });
      }
      // SVX链上提现：用户撤销 DELETE /api/a-token/withdraw/:id（仅 manual_review/pending 状态可撤销）
      if (request.method === 'DELETE' && pathname.startsWith('/api/a-token/withdraw/')) {
        const withdrawalId = decodeURIComponent(pathname.slice('/api/a-token/withdraw/'.length));
        try {
          const result = await withAccountLock(session.address, () =>
            withdrawalService.cancelWithdrawal({ wallet: session.address, id: withdrawalId }));
          return send(res, 200, result);
        } catch (e) { return sendError(res, e); }
      }

      // ===== SVX 链上提取（SolvexPool harvest 模式，用户付 Gas）=====
      // GET /api/a-token/claim/status：返回合约地址、储备量、签名公钥、限额配置
      if (isGet && pathname === '/api/a-token/claim/status') {
        if (!claimService) return send(res, 200, { enabled: false });
        try {
          const balanceUnits = BigInt(aTokenService.balanceA(session.address) || '0');
          return send(res, 200, { ...claimService.status(), balanceA: formatATokenDisplay(balanceUnits), balanceUnits:balanceUnits.toString() });
        } catch (e) { return sendError(res, e); }
      }
      // GET /api/a-token/claims：用户提取记录 ?limit=50
      if (isGet && pathname === '/api/a-token/claims') {
        if (!claimService) return send(res, 200, { claims: [], status: { enabled: false } });
        const sp = new URLSearchParams(request.url?.split('?')[1] || '');
        const limit = Number(sp.get('limit') || 50);
        try {
          const list = claimService.listClaims(session.address, limit);
          return send(res, 200, {
            claims: list.map(r => ({
              id: r.id, status: r.status,
              amountA: formatATokenDisplay(BigInt(r.amountUnits || '0')),
              feeA: formatATokenDisplay(BigInt(r.feeUnits || '0')),
              nonce: r.nonce,
              contractAddress: r.contractAddress,
              txHash: r.txHash || null,
              createdAt: r.createdAt,
              confirmedAt: r.confirmedAt,
              expiresAt: r.expiresAt,
              failReason: r.failReason || null,
            })),
            status: claimService.status(),
          });
        } catch (e) { return sendError(res, e); }
      }

      if (isGet && pathname === '/api/a-token/shareholder') {
        if (!shareholderService) return send(res,503,{error:'股东未启用',code:'SHAREHOLDER_DISABLED'});
        return send(res,200,{ok:true,...shareholderService.overview(session.address)});
      }
      if (isGet && pathname === '/api/a-token/upgrade/overview') {
        if (!upgradeService) return send(res,503,{error:'升级舱未启用',code:'UPGRADE_DISABLED'});
        return send(res,200,{ok:true,...upgradeService.overview(session.address)});
      }

      // 写操作
      if (request.method !== 'POST' && request.method !== 'DELETE') { send(res, 404, { error:'接口不存在', code:'NOT_FOUND' }); return true; }
      if (request.method === 'DELETE') { send(res, 404, { error:'接口不存在', code:'NOT_FOUND' }); return true; }
      // An account freeze covers on-chain exits and transfers to another account.
      if (['/api/a-token/withdraw', '/api/a-token/claim-signature', '/api/a-token/transfer', '/api/a-token/orders', '/api/a-token/zone/sell'].includes(pathname)
          && walletService.adminGetWithdrawalFreeze?.(session.address)?.frozen) {
        throw apiError('该账户提现与资产转出已冻结，请联系平台客服', 'WITHDRAWAL_FROZEN', 403);
      }
      const body = await readBody(request);

      // ===== 匹配池（2026-10-31）=====
      // POST /api/a-token/match-pool/buy-turbo：按 SVX 数量购买驱动额度（USDT 按实时价折算）
      //   body: { aix: '2000', timestamp: 1730000000000, signature: '0x...' }
      //   签名金额由服务端按实时价计算（与报价一致），幂等键：header 'idempotency-key'
      if (pathname === '/api/a-token/match-pool/buy-turbo') {
        if (!matchPoolService) return send(res, 503, { error: '匹配池未启用', code: 'MATCH_POOL_DISABLED' });
        const requestId = idempotencyKey(request);
        let cost;
        try { cost = matchPoolService.costForA(String(body.aix ?? '')); }
        catch (e) { return sendError(res, e); }
        try {
          // 签名消息只绑定「购买数量 + 编号 + 时间」，不绑定按实时价折算的金额：
          // 旧版消息含金额，价格 tick 后前后端折算值不同，验签恢复出另一个地址，
          // 表现为「钱包签名与当前账户不一致」。保留旧消息兼容仍缓存旧 JS 的客户端。
          const timestamp = String(body.timestamp ?? '');
          const signature = String(body.signature ?? '');
          const messages = [
            `Solvex 驱动额度购买确认：购买 ${String(body.aix ?? '')} SVX，编号 ${requestId}，时间：${timestamp}`,
            `Solvex 驱动额度购买确认：支付 ${cost.totalStr} USDT，编号 ${requestId}，时间：${timestamp}`,
          ];
          let lastError;
          for (const message of messages) {
            try { walletService.verifyOperationSignature({ address: session.address, message, signature }); lastError = null; break; }
            catch (e) { lastError = e; }
          }
          if (lastError) throw lastError;
        } catch (e) { return sendError(res, e); }
        try {
          const result = await withAccountLock(session.address, () => matchPoolService.buyTurboByA({
            wallet: session.address, aixAmount: String(body.aix ?? ''), usdtUnits: cost.total.toString(), requestId,
          }));
          return send(res, 200, { ok: true, ...result });
        } catch (e) { return sendError(res, e); }
      }
      // POST /api/a-token/match-pool/enter：蓄能额度 + 驱动额度 1:1 放入匹配池
      //   body: { amount: '100' }（放入的蓄能额度 SVX 数量，驱动额度自动同量配比）
      if (pathname === '/api/a-token/match-pool/enter') {
        if (!matchPoolService) return send(res, 503, { error: '匹配池未启用', code: 'MATCH_POOL_DISABLED' });
        try {
          const result = await withAccountLock(session.address, () => matchPoolService.enterPool({
            wallet: session.address, amount: String(body.amount ?? ''),
            requestId: idempotencyKey(request),
          }));
          return send(res, 200, { ok: true, entry: result });
        } catch (e) { return sendError(res, e); }
      }
      // ===== 涡轮（2026-11-09 P2）=====
      // POST /api/a-token/turbo/enter：乙区币进涡轮，满 24 小时释放等额卖出额度
      //   body: { amount: '100' }，幂等键：header 'idempotency-key'
      if (pathname === '/api/a-token/turbo/enter') {
        if (!turboService) return send(res, 503, { error: '涡轮未启用', code: 'TURBO_DISABLED' });
        const requestId = idempotencyKey(request);
        try {
          const lock = await withAccountLock(session.address, () => turboService.enter({
            wallet: session.address, units: String(body.amount ?? body.units ?? ''), refId: requestId,
          }));
          return send(res, 200, { ok: true, lock, overview: turboService.overview(session.address) });
        } catch (e) { return sendError(res, e); }
      }
      // ===== 盲盒（2026-11-09 P4）=====
      // POST /api/a-token/blindbox/join：确认用户钱包已链上支付并原子加 LP 后，记入盲盒账本。
      if (pathname === '/api/a-token/blindbox/join') {
        if (!blindBoxService) return send(res, 503, { error: '盲盒未启用', code: 'BLINDBOX_DISABLED' });
        if (typeof verifyBlindboxPayment !== 'function') return send(res, 503, { error: '链上盲盒支付尚未配置', code: 'BLINDBOX_CHAIN_DISABLED' });
        const requestId = idempotencyKey(request);
        if (String(body.receiptKey || '').toLowerCase() !== requestId.toLowerCase()) {
          return send(res, 400, { error: '盲盒支付编号不匹配', code: 'BLINDBOX_RECEIPT_MISMATCH' });
        }
        try {
          const transactionHash = String(body.transactionHash || '');
          await verifyBlindboxPayment({
            transactionHash, wallet: session.address, receiptKey: requestId,
          });
          const result = await withAccountLock(session.address, () => blindBoxService.join({
            wallet: session.address, refId: requestId, paymentTx: transactionHash,
          }));
          return send(res, 200, { ok: true, transactionHash, ...result, overview: blindBoxService.overview(session.address) });
        } catch (e) { return sendError(res, e); }
      }
      // ===== 一键买 / 一键卖（2026-11-09 P2，取消挂买挂卖）=====
      // POST /api/a-token/zone/buy：{ zone:'alpha'|'beta', amount:'100'(USDT), timestamp, signature }
      if (pathname === '/api/a-token/zone/buy') {
        if (!zoneTradeService) return send(res, 503, { error: '一键交易未启用', code: 'ZONE_TRADE_DISABLED' });
        const requestId = idempotencyKey(request);
        const zone = ['beta','market'].includes(body.zone) ? body.zone : 'alpha';
        const amount = String(body.amount ?? '');
        let q;
        try { q = zoneTradeService.quote({ side: 'buy', zone, amount }); }
        catch (e) { return sendError(res, e); }
        try {
          // 同上：签名消息绑定用户输入的金额（不随价格 tick 变化），旧消息保留兼容
          const timestamp = String(body.timestamp ?? '');
          const signature = String(body.signature ?? '');
          const messages = [
            `Solvex ${q.zoneLabel}买币确认：支付 ${amount} USDT（买入手续费 0），编号 ${requestId}，时间：${timestamp}`,
            `Solvex ${q.zoneLabel}买币确认：支付 ${q.usdtIn} USDT（买入手续费 0），编号 ${requestId}，时间：${timestamp}`,
          ];
          let lastError;
          for (const message of messages) {
            try { walletService.verifyOperationSignature({ address: session.address, message, signature }); lastError = null; break; }
            catch (e) { lastError = e; }
          }
          if (lastError) throw lastError;
        } catch (e) { return sendError(res, e); }
        try {
          const result = await withAccountLock(session.address, () => zoneTradeService.buy({
            wallet: session.address, zone, usdtAmount: amount, requestId,
          }));
          return send(res, 200, { ok: true, ...result });
        } catch (e) { return sendError(res, e); }
      }
      // POST /api/a-token/zone/sell：{ amount:'100'(SVX), timestamp, signature }
      if (pathname === '/api/a-token/zone/sell') {
        if (!zoneTradeService) return send(res, 503, { error: '一键交易未启用', code: 'ZONE_TRADE_DISABLED' });
        const requestId = idempotencyKey(request);
        const amount = String(body.amount ?? '');
        let q;
        try { q = zoneTradeService.quote({ side: 'sell', amount }); }
        catch (e) { return sendError(res, e); }
        try {
          const timestamp = String(body.timestamp ?? '');
          const signature = String(body.signature ?? '');
          const messages = [
            `Solvex 一键卖出确认：卖出 ${amount} SVX，编号 ${requestId}，时间：${timestamp}`,
            `Solvex 一键卖出确认：卖出 ${q.aIn} SVX，编号 ${requestId}，时间：${timestamp}`,
          ];
          let lastError;
          for (const message of messages) {
            try { walletService.verifyOperationSignature({ address: session.address, message, signature }); lastError = null; break; }
            catch (e) { lastError = e; }
          }
          if (lastError) throw lastError;
        } catch (e) { return sendError(res, e); }
        try {
          const result = await withAccountLock(session.address, () => zoneTradeService.sell({
            wallet: session.address, aixAmount: amount, requestId,
          }));
          return send(res, 200, { ok: true, ...result });
        } catch (e) { return sendError(res, e); }
      }
      if (pathname === '/api/a-token/quote') {
        const side = body.side === 'sell' ? 'sell' : 'buy';
        return send(res, 200, poolService.quote(side, String(body.amount ?? '')));
      }
      // 挂买挂卖已下线（2026-11-09 P2）：统一走 /api/a-token/zone/buy 与 /api/a-token/zone/sell
      if (pathname === '/api/a-token/orders') {
        return send(res, 403, {
          error: '挂买挂卖已关闭，请使用「甲区 / 乙区」一键买入或一键卖出',
          code: 'ORDER_BOOK_DISABLED',
        });
      }
      // SVX链上提现：POST /api/a-token/withdraw
      //   body: { amount: '100' }   // toAddress 已废弃：强制只提现到当前连接钱包地址（防钓鱼/防误转）
      //   幂等键：header 'idempotency-key'
      if (pathname === '/api/a-token/withdraw') {
        if (aTokenService.isWithdrawEnabled && !aTokenService.isWithdrawEnabled()) {
          return send(res, 503, { error: 'SVX 提现暂未开放，请留意平台公告', code: 'WITHDRAW_DISABLED' });
        }
        const requestId = idempotencyKey(request);
        // 钱包签名确认：SVX 提现必须由用户本人钱包 personal_sign 授权（签名绑定幂等编号防重放）
        walletService.verifyOperationSignature({
          address: session.address,
          message: `Solvex SVX提现确认：数量 ${String(body.amount ?? '')} SVX，编号 ${requestId}，时间：${String(body.timestamp ?? '')}`,
          signature: String(body.signature ?? ''),
        });
        try {
          const result = await withAccountLock(session.address, () => withdrawalService.requestWithdrawal({
            wallet: session.address,
            amount: String(body.amount ?? ''),
            toAddress: session.address, // 强制等于连接钱包
            requestId,
          }));
          return send(res, 200, {
            ok: true,
            withdrawal: {
              id: result.id, status: result.status,
              amountA: formatATokenDisplay(BigInt(result.amountUnits || '0')),
              feeA: formatATokenDisplay(BigInt(result.feeUnits || '0')),
              toAddress: result.toAddress, txHash: result.txHash,
              createdAt: result.createdAt,
              autoApproved: result.status === 'processing',
              needManualReview: result.status === 'manual_review',
            },
          });
        } catch (e) { return sendError(res, e); }
      }
      // SVX 链上提取签名：POST /api/a-token/claim-signature
      //   body: { amount: '100' }
      //   返回 { claimId, amount, amountUnits, nonce, signature, contractAddress, chainId, expiresAt }
      //   前端拿到 signature + nonce 后调用 SolvexPool.harvest(amountUnits, nonceBigInt, signature)
      if (pathname === '/api/a-token/claim-signature') {
        if (!claimService) return sendError(res, apiError('SVX 链上提取未启用', 'CLAIM_NOT_ENABLED', 503));
        try {
          const result = await withAccountLock(session.address, () => claimService.signClaim({
            wallet: session.address,
            amount: String(body.amount ?? ''),
          }));
          return send(res, 200, { ok: true, claim: {
            claimId: result.claimId,
            amount: result.amount,
            amountUnits: result.amountUnits,
            feeUnits: result.feeUnits,
            needUnits: result.needUnits,
            nonce: result.nonce,
            nonceBigInt: '0x' + result.nonce,
            signature: result.signature,
            contractAddress: result.contractAddress,
            chainId: result.chainId,
            expiresAt: result.expiresAt,
          }});
        } catch (e) { return sendError(res, e); }
      }
      // SVX 链上提取确认：POST /api/a-token/claim-confirm
      //   body: { claimId, txHash }
      if (pathname === '/api/a-token/claim-confirm') {
        if (!claimService) return sendError(res, apiError('SVX 链上提取未启用', 'CLAIM_NOT_ENABLED', 503));
        try {
          const result = await claimService.confirmClaim({
            wallet: session.address,
            claimId: String(body.claimId || ''),
            txHash: String(body.txHash || ''),
          });
          return send(res, 200, { ok: true, claim: {
            id: result.id, status: result.status,
            txHash: result.txHash,
            confirmedAt: result.confirmedAt,
          }});
        } catch (e) { return sendError(res, e); }
      }
      // SVX 链上提取退款（用户取消签名或链上失败）：POST /api/a-token/claim-refund
      //   body: { claimId, reason? }
      if (pathname === '/api/a-token/claim-refund') {
        if (!claimService) return sendError(res, apiError('SVX 链上提取未启用', 'CLAIM_NOT_ENABLED', 503));
        try {
          const result = await withAccountLock(session.address, () => claimService.refundClaim(
            String(body.claimId || ''),
            String(body.reason || 'user_cancelled'),
          ));
          return send(res, 200, { ok: true, claim: {
            id: result.id, status: result.status, failReason: result.failReason,
          }});
        } catch (e) { return sendError(res, e); }
      }
      if (pathname === '/api/a-token/transfer') {
        // 2026-11-01 起互转功能关闭（保留历史记录查询 my-transfers）
        return send(res, 403, { error: 'SVX 互转功能已关闭', code: 'TRANSFER_DISABLED' });
      }
      // POST /api/a-token/upgrade/enter：{ amount:'1000' }，header Idempotency-Key 幂等
      if (pathname === '/api/a-token/upgrade/enter') {
        if (!upgradeService) return send(res, 503, { error: '升级仓未启用', code: 'UPGRADE_DISABLED' });
        const requestId = idempotencyKey(request);
        try {
          const result = await withAccountLock(session.address, () => upgradeService.enter({
            wallet: session.address, amount: String(body.amount ?? ''), refId: requestId,
          }));
          return send(res, 200, { ok: true, ...result });
        } catch (e) { return sendError(res, e); }
      }
      // POST /api/a-token/upgrade/redeem：{ positionId }，整笔赎回；赎回期 30 天，不支持部分赎回
      if (pathname === '/api/a-token/upgrade/redeem') {
        if (!upgradeService) return send(res, 503, { error: '升级仓未启用', code: 'UPGRADE_DISABLED' });
        try {
          const result = await withAccountLock(session.address, () => upgradeService.redeem({
            wallet: session.address, positionId: String(body.positionId ?? ''), amount: body.amount,
          }));
          return send(res, 200, { ok: true, ...result });
        } catch (e) { return sendError(res, e); }
      }
      // POST /api/a-token/shareholder/join：{ tier:'t500'|'t1000', timestamp, signature }，header Idempotency-Key 幂等
      if (pathname === '/api/a-token/shareholder/join') {
        if (!shareholderService) return send(res, 503, { error: '股东未启用', code: 'SHAREHOLDER_DISABLED' });
        if (!walletService.verifyOperationSignature) return send(res, 503, { error: '签名校验未启用', code: 'SIGNATURE_DISABLED' });
        const requestId = idempotencyKey(request);
        const tier = String(body.tier ?? 't500');
        const tierInfo = (shareholderService.SHAREHOLDER_TIERS || []).find(t => t.key === tier);
        if (!tierInfo) return send(res, 400, { error: '未知的股东档位', code: 'BAD_TIER' });
        const amount = tierInfo.priceUsdt;
        try {
          walletService.verifyOperationSignature({
            address: session.address,
            message: `Solvex 股东加入确认：${tierInfo.label}，支付 ${amount} USDT，编号 ${requestId}，时间：${String(body.timestamp ?? '')}`,
            signature: String(body.signature ?? ''),
          });
        } catch (e) { return sendError(res, e); }
        try {
          const result = await withAccountLock(session.address, () => shareholderService.join({
            wallet: session.address, tier, refId: requestId,
          }));
          return send(res, 200, { ok: true, ...result, overview: shareholderService.overview(session.address) });
        } catch (e) { return sendError(res, e); }
      }
      // POST /api/a-token/shareholder/upgrade：500 → 1000 档，补 500 USDT 差价
      if (pathname === '/api/a-token/shareholder/upgrade') {
        if (!shareholderService) return send(res, 503, { error: '股东未启用', code: 'SHAREHOLDER_DISABLED' });
        if (!walletService.verifyOperationSignature) return send(res, 503, { error: '签名校验未启用', code: 'SIGNATURE_DISABLED' });
        const requestId = idempotencyKey(request);
        try {
          walletService.verifyOperationSignature({
            address: session.address,
            message: `Solvex 股东升档确认：补差价 500 USDT，编号 ${requestId}，时间：${String(body.timestamp ?? '')}`,
            signature: String(body.signature ?? ''),
          });
        } catch (e) { return sendError(res, e); }
        try {
          const result = await withAccountLock(session.address, () => shareholderService.upgrade({
            wallet: session.address, refId: requestId,
          }));
          return send(res, 200, { ok: true, ...result, overview: shareholderService.overview(session.address) });
        } catch (e) { return sendError(res, e); }
      }
      // POST /api/a-token/shareholder/withdraw：撤回股东身份，退款 = 本金 − 已分红
      if (pathname === '/api/a-token/shareholder/withdraw') {
        if (!shareholderService) return send(res, 503, { error: '股东未启用', code: 'SHAREHOLDER_DISABLED' });
        try {
          const result = await withAccountLock(session.address, () => shareholderService.withdraw({
            wallet: session.address, reason: 'user_withdraw',
          }));
          return send(res, 200, { ok: true, ...result, overview: shareholderService.overview(session.address) });
        } catch (e) { return sendError(res, e); }
      }
      if (pathname === '/api/a-token/stake') {
        const result = await withAccountLock(session.address, () => stakingService.stake(session.address, String(body.planId ?? ''), String(body.principal ?? ''), { requestId: idempotencyKey(request) }));
        return send(res, 200, { ok:true, stake:result });
      }
      // 建算力节点：只从甲区扣币（不再卖套餐、不按 U 定价）
      if (pathname === '/api/a-token/nodes/open') {
        if (!nodeService) return send(res, 501, { error: '算力节点未启用' });
        const result = await withAccountLock(session.address, () => nodeService.open(session.address, String(body.coins ?? ''), { requestId: idempotencyKey(request) }));
        return send(res, 200, { ok: true, node: result });
      }
      // 领取一条待领取收益（滚动 24 小时窗口内有效；过期自动作废）
      if (pathname === '/api/a-token/pending/claim') {
        if (!pendingService) return send(res, 501, { error: '待领取未启用' });
        const result = await withAccountLock(session.address, () => pendingService.claim(session.address, String(body.id ?? '')));
        return send(res, 200, { ok: true, claim: result });
      }
      // 一键领取当前可领的全部待领取收益
      if (pathname === '/api/a-token/pending/claim-all') {
        if (!pendingService) return send(res, 501, { error: '待领取未启用' });
        const claimed = await withAccountLock(session.address, () => {
          const rows = pendingService.list(session.address, 'pending', 1000);
          const results = [];
          for (const row of rows) {
            try { results.push(pendingService.claim(session.address, row.id)); }
            catch (e) { results.push({ id: row.id, error: e?.message || String(e) }); }
          }
          return results;
        });
        return send(res, 200, { ok: true, claimed });
      }
      if (pathname === '/api/a-token/activate') {
        // 2026-11-09 P1：旧矿机激活入口关闭（含历史 BNB 补录），只保留存量矿机到期结算。
        // 新模型不再按套餐/BNB 卖矿机，用户先在交易页买币进甲区，再用甲区币建「算力节点」。
        return send(res, 403, { error: '矿机激活已关闭，请使用甲区币开通算力节点', code: 'ACTIVATION_DISABLED' });
      }

      send(res, 404, { error:'接口不存在', code:'NOT_FOUND' });
      return true;
    } catch (error) {
      sendError(res, error);
      return true;
    }
  }

  return { handle };
}
