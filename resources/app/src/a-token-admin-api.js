import { isLegacyFundsPath } from './admin-security.js';
import { SHAREHOLDER_TIERS, SHAREHOLDER_TIER_1000_SETTING_KEY } from './a-token-shareholder-service.js';

// SVX后台路由 /api/admin/a-token/*（需后台 operator session,由 server.js 在 admin 块内调用）
export function createATokenAdminApi({
  aTokenService, poolService, stakingService, klineService, orderService, walletService,
  aTokenTeamService, blindBoxService, aTokenLpJobService,
  send, readBody,
}) {
  async function handle(request, res, pathname, ctx = {}) {
    if (!pathname.startsWith('/api/admin/a-token/')) return false;
    // Also enforce this inside the router so a future caller cannot bypass the
    // server's operator guard. Funds credentials only work on the funds API.
    if (isLegacyFundsPath(pathname)) {
      send(res, 403, { error:'此操作需要独立资金后台权限', code:'FUNDS_ADMIN_REQUIRED' });
      return true;
    }
    // 矿机功能已于 2026-11-12 彻底下线，历史接口统一返回 410
    if (/\/miners?(\/|$)|\/activations?(\/|$)|\/activation\/|\/team-activations$/.test(pathname)) {
      send(res, 410, { error:'矿机功能已下线', code:'MINER_DISABLED' });
      return true;
    }
    const { url, allowRequest, operatorSession } = ctx;
    const searchParams = url?.searchParams;

    try {
      if (pathname === '/api/admin/a-token/stats' && request.method === 'GET') {
        return send(res, 200, {
          pool: aTokenService.poolStats(),
          orders: orderService?.stats?.() || null,
        });
      }
      // 挂单查询（所有钱包）?status=OPEN|FILLED|CANCELLED&wallet=...&limit=500
      if (pathname === '/api/admin/a-token/orders' && request.method === 'GET') {
        const status = String(searchParams?.get('status') || '').trim();
        const wallet = String(searchParams?.get('wallet') || '').trim();
        const limit = Math.max(1, Math.min(1000, Number(searchParams?.get('limit') || 500)));
        const source = wallet
          ? walletService.database?.listATokenOrdersByWallet?.(wallet, limit) || []
          : (status
              ? (walletService.database?.listATokenOpenOrders?.() || []).filter(r => r.status === status)
              : (walletService.database?.listATokenOpenOrders?.() || []));
        return send(res, 200, {
          items: source,
          stats: orderService?.stats?.() || null,
        });
      }
      // 后台一键驳回全部卖单（2026-11-01）：逐单解冻并置为 CANCELLED
      if (request.method === 'POST' && pathname === '/api/admin/a-token/orders/cancel-sells') {
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 5, 60_000)) return true;
        const body = await readBody(request).catch(() => ({}));
        const reason = String(body.reason || 'admin_sell_orders_rejected').slice(0, 120);
        const open = walletService.database?.listATokenOpenOrders?.() || [];
        const sells = open.filter(r => String(r.status) === 'OPEN' && String(r.side) === 'sell');
        let cancelled = 0;
        const failed = [];
        const now = Date.now();
        // 后台强制解冻必须给已封禁账户入账，否则封禁用户被驳回的资金会丢失
        const refundOpt = { ignoreBlock: true };
        for (const order of sells) {
          try {
            const wallet = String(order.wallet || '').toLowerCase();
            if (BigInt(order.input_usdt_units || '0') > 0n) aTokenService.creditUsdt(wallet, BigInt(order.input_usdt_units), refundOpt);
            if (BigInt(order.input_a_units || '0') > 0n) {
              aTokenService.creditA(wallet, BigInt(order.input_a_units), refundOpt);
              try { walletService.database?.refundATokenUsableQuota?.(wallet, BigInt(order.input_a_units)); } catch {}
            }
            const info = walletService.database?.markATokenOrderCancelled?.(order.id, { cancelledAt: now, updatedAt: now, reason });
            if (info?.changes) cancelled += 1; else failed.push(order.id);
          } catch (error) {
            failed.push(`${order.id}:${error?.message || 'unknown'}`);
          }
        }
        return send(res, 200, { ok: true, total: sells.length, cancelled, failed });
      }

      // 后台强制撤单（按 orderId，可指定 reason）
      if (request.method === 'POST' && pathname === '/api/admin/a-token/orders/cancel') {
        const body = await readBody(request);
        const orderId = String(body.orderId || '').trim();
        const reason = String(body.reason || 'admin_cancelled').slice(0, 120);
        const order = walletService.database?.getATokenOrder?.(orderId);
        if (!order) return send(res, 404, { error: '订单不存在' });
        if (order.status !== 'OPEN') return send(res, 400, { error: '仅 OPEN 状态订单可撤单' });
        // 解冻（ignoreBlock：封禁账户也要返还冻结资金）
        const refundOpt = { ignoreBlock: true };
        const wallet = String(order.wallet || '').toLowerCase();
        if (BigInt(order.input_usdt_units || '0') > 0n) aTokenService.creditUsdt(wallet, BigInt(order.input_usdt_units), refundOpt);
        if (BigInt(order.input_a_units || '0') > 0n) {
          aTokenService.creditA(wallet, BigInt(order.input_a_units), refundOpt);
          // 2026-10-31：后台撤卖单时返还已占用的流通额度（匹配池产出）
          try { walletService.database?.refundATokenUsableQuota?.(wallet, BigInt(order.input_a_units)); } catch {}
        }
        const now = Date.now();
        const info = walletService.database?.markATokenOrderCancelled?.(orderId, { cancelledAt: now, updatedAt: now, reason });
        return send(res, 200, { ok: true, changes: info?.changes || 0 });
      }

      // ── 平台公告（公开接口 /api/announcement 只读；此处可写，最多 2 条）──
      if (request.method === 'POST' && pathname === '/api/admin/a-token/announcement') {
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 30, 60_000)) return true;
        const body = await readBody(request);
        let prev = null;
        try { prev = JSON.parse(walletService.database.getSetting('platform_announcement') || 'null'); } catch { prev = null; }
        const prevList = Array.isArray(prev) ? prev : (prev && typeof prev === 'object' ? [prev] : []);
        const rawItems = Array.isArray(body.items) ? body.items : [body];
        const items = rawItems.slice(0, 2).map((ann, i) => {
          const id = String(ann?.id || `a${i + 1}`);
          const next = {
            id,
            enabled: ann?.enabled === true || ann?.enabled === '1' || ann?.enabled === 1,
            zh: String(ann?.zh ?? '').slice(0, 2000),
            en: String(ann?.en ?? '').slice(0, 2000),
          };
          const old = prevList.find(row => String(row?.id || '') === id);
          const changed = !old || old.enabled !== next.enabled
            || String(old.zh || '') !== next.zh || String(old.en || '') !== next.en;
          // 只有内容真的变了才刷新 updatedAt：否则编辑第二条会把已关闭的第一条重新弹出来
          return { ...next, updatedAt: changed ? Date.now() : (Number(old?.updatedAt) || 0) };
        });
        walletService.database.saveSetting('platform_announcement', JSON.stringify(items));
        const head = items.find(item => item.enabled) || items[0] || { enabled:false, zh:'', en:'', updatedAt:0 };
        return send(res, 200, {
          ok: true, items,
          enabled: head.enabled, zh: head.zh, en: head.en, updatedAt: head.updatedAt,
        });
      }

      // 价格 / 手续费 / 交易数据调控
      if (request.method === 'POST' && pathname === '/api/admin/a-token/price') {
        const body = await readBody(request);
        aTokenService.setPrice(String(body.price ?? ''));
        // 后台改价后立即触发一次限价单撮合
        let matchResult = null;
        try { matchResult = orderService?.matchOpenOrders?.() || null; } catch (e) { matchResult = { error: e?.message || String(e) }; }
        return send(res, 200, { ok:true, pool: aTokenService.poolStats(), orderMatch: matchResult });
      }
      if (request.method === 'POST' && pathname === '/api/admin/a-token/pool-meta') {
        const body = await readBody(request);
        const patch = {};
        if (body.feeRateBps !== undefined) patch.feeRateBps = Math.max(0, Math.min(10000, Number(body.feeRateBps) || 0));
        if (body.burnRateBps !== undefined) patch.burnRateBps = Math.max(0, Math.min(10000, Number(body.burnRateBps) || 0));
        if (body.dividendRateBps !== undefined) patch.dividendRateBps = Math.max(0, Math.min(10000, Number(body.dividendRateBps) || 0));
        if (body.adminOverrides !== undefined) patch.adminOverrides = body.adminOverrides || {};
        if (body.todayVolumeA !== undefined) patch.todayVolumeAUnits = String(body.todayVolumeA); // 后台调控今日交易量
        if (body.todayVolumeUsdt !== undefined) patch.todayVolumeUsdtUnits = String(body.todayVolumeUsdt);
        aTokenService.setPoolMeta(patch);
        return send(res, 200, { ok:true, pool: aTokenService.poolStats() });
      }

      // ── 销毁总开关 ──
      if (request.method === 'POST' && pathname === '/api/admin/a-token/burn/mode') {
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 30, 60_000)) return true;
        const body = await readBody(request);
        const enabled = body.enabled === true || body.enabled === '1' || body.enabled === 1;
        aTokenService.setPoolMeta({ burnEnabled: enabled ? '1' : '0' });
        return send(res, 200, { ok:true, burnEnabled: enabled, pool: aTokenService.poolStats() });
      }

      // ── SVX 提现开关（关闭时用户不可发起 SVX 链上提现）──
      if (request.method === 'POST' && pathname === '/api/admin/a-token/withdraw/mode') {
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 30, 60_000)) return true;
        const body = await readBody(request);
        const enabled = body.enabled === true || body.enabled === '1' || body.enabled === 1;
        aTokenService.setPoolMeta({ withdrawEnabled: enabled ? '1' : '0' });
        return send(res, 200, { ok:true, withdrawEnabled: enabled, pool: aTokenService.poolStats() });
      }

      // ── K 线调控 ──
      if (klineService && pathname === '/api/admin/a-token/kline/status' && request.method === 'GET') {
        return send(res, 200, { ok:true, status: klineService.status(), pool: aTokenService.poolStats() });
      }
      if (klineService && request.method === 'POST' && pathname === '/api/admin/a-token/kline/mode') {
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 30, 60_000)) return true;
        const body = await readBody(request);
        const patch = {};
        if (['sideways','up','down','daily','manual'].includes(body.mode)) patch.mode = body.mode;
        if (body.volatility !== undefined) patch.volatility = Math.max(0.1, Math.min(5, Number(body.volatility) || 1));
        if (body.baseVolumePerDayA !== undefined) patch.baseVolumePerDayA = Math.max(0, Number(body.baseVolumePerDayA) || 0);
        // daily 模式：每日目标涨跌幅（%），正=涨 负=跌
        if (body.dailyChangePct !== undefined) {
          const v = Number(body.dailyChangePct);
          if (!Number.isFinite(v)) throw new Error('每日涨跌幅必须是数字（如 1 表示每日 +1%）');
          patch.dailyChangePct = Math.max(-95, Math.min(95, v));
          // 中途改涨幅必须重锚当日计划（以当前价为起点重新规划），
          // 否则旧锚点 + 新目标会让路径输出与现价差出好几个百分点，
          // tick 被 ±0.3% 硬限幅顶格 → K 线出现匀速直线拉升（2026-10-21 事故）
          patch.daily = null;
        }
        if (body.driftBpsPer1m && typeof body.driftBpsPer1m === 'object') {
          const drift = {};
          for (const k of ['sideways','up','down']) {
            if (body.driftBpsPer1m[k] !== undefined) drift[k] = Number(body.driftBpsPer1m[k]) || 0;
          }
          patch.driftBpsPer1m = drift;
        }
        const settings = klineService.saveSettings(patch);
        return send(res, 200, { ok:true, settings });
      }
      if (klineService && request.method === 'POST' && pathname === '/api/admin/a-token/kline/rebuild') {
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 2, 60_000)) return true;
        const body = await readBody(request);
        const info = klineService.rebuildAll(body.basePrice);
        return send(res, 200, { ok:true, rebuilt: info });
      }
      if (klineService && request.method === 'POST' && pathname === '/api/admin/a-token/kline/append') {
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 30, 60_000)) return true;
        const body = await readBody(request);
        const period = String(body.period || '1m');
        const candle = klineService.appendCandle(period, body.candle || {});
        return send(res, 200, { ok:true, candle, period });
      }
      if (klineService && request.method === 'POST' && pathname === '/api/admin/a-token/kline/tick') {
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 60, 60_000)) return true;
        const body = await readBody(request);
        const n = Math.max(1, Math.min(120, Number(body?.n || 1)));
        const results = [];
        for (let i = 0; i < n; i++) results.push(klineService.tickLiveBar());
        return send(res, 200, { ok:true, ticks: results.length, last: results[results.length - 1] });
      }

      // ── 盲盒概率档位配置（存 service_settings: blindbox_probability）──
      // GET：当前配置 + 实际生效来源（config / uniform 兜底）+ 最近开盒分布
      if (pathname === '/api/admin/a-token/blindbox/config' && request.method === 'GET') {
        if (!blindBoxService) return send(res, 503, { error:'盲盒未启用', code:'BLINDBOX_DISABLED' });
        return send(res, 200, { ok:true, ...blindBoxService.adminSnapshot() });
      }
      // POST：{ tiers: [{ coins, weight }] }，校验失败返回 400 + 逐条原因
      if (request.method === 'POST' && pathname === '/api/admin/a-token/blindbox/config') {
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 30, 60_000)) return true;
        if (!blindBoxService) return send(res, 503, { error:'盲盒未启用', code:'BLINDBOX_DISABLED' });
        const body = await readBody(request).catch(() => ({}));
        try {
          blindBoxService.saveProbabilityConfig(body?.tiers);
          return send(res, 200, { ok:true, ...blindBoxService.adminSnapshot() });
        } catch (error) {
          return send(res, 400, {
            error: error?.message || String(error),
            code: error?.code || 'BLINDBOX_CONFIG_INVALID',
            errors: Array.isArray(error?.errors) ? error.errors : [error?.message || String(error)],
          });
        }
      }

      // 合伙人档位：1000 USDT 档默认关闭，可在此开关；档位定义不删除
      if (pathname === '/api/admin/a-token/shareholder/config' && request.method === 'GET') {
        const db = walletService.database;
        let t1000Enabled = false;
        try { t1000Enabled = JSON.parse(db.getSetting(SHAREHOLDER_TIER_1000_SETTING_KEY) || 'false') === true; } catch { t1000Enabled = false; }
        return send(res, 200, {
          ok: true,
          t1000Enabled,
          tiers: SHAREHOLDER_TIERS.map(tier => ({
            key: tier.key, label: tier.label, priceUsdt: tier.priceUsdt, dividendPct: tier.dividendPct,
            enabled: tier.key === 't500' ? true : t1000Enabled,
          })),
        });
      }
      if (request.method === 'POST' && pathname === '/api/admin/a-token/shareholder/config') {
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 30, 60_000)) return true;
        const body = await readBody(request).catch(() => ({}));
        const enabled = body?.t1000Enabled === true || body?.t1000Enabled === '1' || body?.t1000Enabled === 1;
        walletService.database.saveSetting(SHAREHOLDER_TIER_1000_SETTING_KEY, JSON.stringify(enabled));
        return send(res, 200, { ok: true, t1000Enabled: enabled });
      }

      // ── 自由交易手动开关（service_settings: free_trading_enabled，默认关闭）──
      if (pathname === '/api/admin/a-token/free-trading/config' && request.method === 'GET') {
        return send(res, 200, { ok:true, enabled: aTokenService.isFreeTradingEnabled() });
      }
      if (request.method === 'POST' && pathname === '/api/admin/a-token/free-trading/config') {
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 30, 60_000)) return true;
        const body = await readBody(request).catch(() => ({}));
        const enabled = aTokenService.setFreeTradingEnabled(body?.enabled);
        const record = { actor: operatorSession?.username || 'admin', enabled, at: Date.now() };
        try {
          walletService.database.db.prepare(
            'INSERT INTO audit_log(event_id,address,event_type,created_at,payload_json) VALUES(?,?,?,?,?)',
          ).run(
            `free_trading_${record.at}_${Math.random().toString(36).slice(2, 8)}`,
            null, 'a_token_free_trading_switch', record.at, JSON.stringify(record),
          );
        } catch (error) {
          console.warn('[a-token-admin] free trading audit failed', error?.message || error);
        }
        return send(res, 200, { ok:true, enabled });
      }

      // 用户列表（含 A 余额）
      if (pathname === '/api/admin/a-token/users' && request.method === 'GET') {
        const dashboard = walletService.adminDashboard();
        const users = (dashboard.users || []).map(u => ({
          address: u.address, USDT: u.USDT, A: u.balances?.A ?? u.A ?? '0', updatedAt: u.updatedAt,
        }));
        return send(res, 200, { summary: dashboard.summary, users });
      }

      // ── 提现手续费按日累计与批量加 LP ─────────────────────────────────────
      // GET /api/admin/a-token/lp-pools?status=open|settled&limit=200 → 按日期/币种累计池
      if (pathname === '/api/admin/a-token/lp-pools' && request.method === 'GET') {
        if (!aTokenLpJobService) return send(res, 503, { error:'加 LP 任务服务未启用', code:'LP_JOB_SERVICE_DISABLED' });
        const status = String(searchParams?.get('status') || '').trim();
        const limit = Math.max(1, Math.min(1000, Number(searchParams?.get('limit') || 200)));
        return send(res, 200, {
          ok: true,
          config: aTokenLpJobService.readiness(),
          stats: aTokenLpJobService.stats(),
          pools: aTokenLpJobService.listPools({ status, limit }),
          accruals: aTokenLpJobService.listAccruals({ limit }),
        });
      }
      // POST /api/admin/a-token/lp-pools/settle { date?, asset? } → 手动立即结算（只允许已结束业务日）
      if (pathname === '/api/admin/a-token/lp-pools/settle' && request.method === 'POST') {
        if (!aTokenLpJobService) return send(res, 503, { error:'加 LP 任务服务未启用', code:'LP_JOB_SERVICE_DISABLED' });
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 10, 60_000)) return true;
        const body = await readBody(request).catch(() => ({}));
        try {
          const jobs = aTokenLpJobService.settleAll({
            date: String(body.date || '').trim(),
            asset: String(body.asset || '').trim(),
          });
          return send(res, 200, { ok: true, jobs });
        } catch (error) {
          return send(res, Number(error?.statusCode) || 400, {
            error: error?.message || String(error), code: error?.code || 'LP_SETTLE_FAILED',
          });
        }
      }
      // ── 提现手续费自动加 LP 任务（链下入队 → 上链 → 回写）────────────────
      // ?status=pending|processing|sent|confirmed|failed|cancelled&limit=200
      if (pathname === '/api/admin/a-token/lp-jobs' && request.method === 'GET') {
        if (!aTokenLpJobService) return send(res, 503, { error:'加 LP 任务服务未启用', code:'LP_JOB_SERVICE_DISABLED' });
        const status = String(searchParams?.get('status') || '').trim();
        const limit = Math.max(1, Math.min(1000, Number(searchParams?.get('limit') || 200)));
        return send(res, 200, {
          ok: true,
          config: aTokenLpJobService.readiness(),
          stats: aTokenLpJobService.stats(),
          items: aTokenLpJobService.listJobs({ status, limit }),
        });
      }
      // 生成单条上链指令：?id=lpjob_xxx | withdrawalId=xxx | poolDate=YYYY-MM-DD&asset=USDT
      if (pathname === '/api/admin/a-token/lp-jobs/instruction' && request.method === 'GET') {
        if (!aTokenLpJobService) return send(res, 503, { error:'加 LP 任务服务未启用', code:'LP_JOB_SERVICE_DISABLED' });
        const id = String(searchParams?.get('id') || '').trim();
        const withdrawalId = String(searchParams?.get('withdrawalId') || '').trim();
        const poolDate = String(searchParams?.get('poolDate') || '').trim();
        const asset = String(searchParams?.get('asset') || 'USDT').trim();
        const job = id
          ? aTokenLpJobService.getJob(id)
          : (withdrawalId ? aTokenLpJobService.listJobs({ status:'', limit:5000 }).find(item => item.withdrawalId === withdrawalId)
            : (poolDate ? aTokenLpJobService.listJobs({ status:'', limit:5000 }).find(item => item.poolDate === poolDate && item.asset === asset) : null));
        if (!job) return send(res, 404, { error:'加池任务不存在', code:'LP_JOB_NOT_FOUND' });
        return send(res, 200, { ok: true, job, instruction: aTokenLpJobService.buildInstruction(job) });
      }
      // 回写：{ jobId|withdrawalId|txHash, status, txHash, usdtUsed, svxUsed, lpMinted, priceUsdtPerSvx1e18, error, note }
      if (pathname === '/api/admin/a-token/lp-jobs/writeback' && request.method === 'POST') {
        if (!aTokenLpJobService) return send(res, 503, { error:'加 LP 任务服务未启用', code:'LP_JOB_SERVICE_DISABLED' });
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 20, 60_000)) return true;
        const body = await readBody(request).catch(() => ({}));
        try {
          return send(res, 200, { ok: true, job: aTokenLpJobService.writeback(body) });
        } catch (error) {
          return send(res, 400, { error: error?.message || String(error), code: 'LP_JOB_WRITEBACK_INVALID' });
        }
      }
      // 取消：{ jobId|withdrawalId, reason }
      if (pathname === '/api/admin/a-token/lp-jobs/cancel' && request.method === 'POST') {
        if (!aTokenLpJobService) return send(res, 503, { error:'加 LP 任务服务未启用', code:'LP_JOB_SERVICE_DISABLED' });
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 20, 60_000)) return true;
        const body = await readBody(request).catch(() => ({}));
        const job = body.jobId
          ? aTokenLpJobService.getJob(String(body.jobId))
          : aTokenLpJobService.listJobs({ status:'', limit:5000 }).find(item => item.withdrawalId === String(body.withdrawalId || ''));
        if (!job) return send(res, 404, { error:'加池任务不存在', code:'LP_JOB_NOT_FOUND' });
        try {
          const cancelled = aTokenLpJobService.cancelJob(job.id, String(body.reason || 'admin_cancelled').slice(0, 120));
          return send(res, 200, { ok: true, job: cancelled });
        } catch (error) {
          return send(res, Number(error?.statusCode) || 409, {
            error: error?.message || String(error), code: error?.code || 'LP_JOB_CANCEL_FAILED', job,
          });
        }
      }
      // 手动触发执行（仅在 PLATFORM_AUTO_LP_ENABLE_EXECUTOR=1 时可用）
      if (pathname === '/api/admin/a-token/lp-jobs/execute' && request.method === 'POST') {
        if (!aTokenLpJobService) return send(res, 503, { error:'加 LP 任务服务未启用', code:'LP_JOB_SERVICE_DISABLED' });
        if (!aTokenLpJobService.config.executorEnabled) {
          return send(res, 503, { error:'执行器未开启，请设置 PLATFORM_AUTO_LP_ENABLE_EXECUTOR=1', code:'LP_EXECUTOR_DISABLED' });
        }
        if (allowRequest && !allowRequest(request, res, 'a-token-admin', 10, 60_000)) return true;
        const body = await readBody(request).catch(() => ({}));
        const job = aTokenLpJobService.getJob(String(body.jobId || ''));
        if (!job) return send(res, 404, { error:'加池任务不存在', code:'LP_JOB_NOT_FOUND' });
        const result = await aTokenLpJobService.executeJob(job.id);
        return send(res, 200, { ok: true, ...result });
      }

      send(res, 404, { error:'后台接口不存在', code:'NOT_FOUND' });
      return true;
    } catch (error) {
      return send(res, Number(error?.statusCode) || 400, { error: error?.message || String(error), code: error?.code || 'A_TOKEN_ADMIN_ERROR' });
    }
  }

  return { handle };
}
