# 自由交易闸门改为运维手动开关（2026-11-10）

## 1. 背景与决策

用户确认：平台币先做内盘交易，链上池子建好后由运营把代币挂上来即可交易，**不做「链上加池金额回写 `a_token_lp_pool_entries`」**。

因此把「LP 账本累计 ≥ 500,000 USDT 自动开闸」改成「`service_settings` 手动开关」：

- 开关 key：`free_trading_enabled`，默认关闭（缺失 / 非法值都视为关闭）。
- 关闭时：`assertFreeTrading()` 继续拦截 `market` 区自由交易（`a-token-zone-trade-service.js` L64、L101）与撮合（`a-token-order-service.js` L298 已读 `liquidityStatus().enabled`，无需改动）。
- 打开时：放行。
- `a_token_lp_pool_entries` 继续作为手续费记账保留，但**不再是开闸依据**，前端不再展示累计金额与进度条。
- 乙区额度维持现状：乙区买入只记乙区余额，不额外发放涡轮额度；只有进涡轮才产生卖出额度。**本次不改**。

## 2. 后端契约

### 2.1 `src/a-token-service.js`

模块常量区（`POOL_META_KEY` 附近）新增：

```js
const FREE_TRADING_SETTING_KEY = 'free_trading_enabled';
```

工厂内新增两个函数（放在 `liquidityStatus()` 之前）：

```js
function isFreeTradingEnabled() {
  try {
    const raw = db.getSetting(FREE_TRADING_SETTING_KEY);
    if (raw == null) return false;
    const parsed = JSON.parse(raw);
    return parsed === true || parsed === 'true' || parsed === 1 || parsed === '1';
  } catch { return false; }
}
function setFreeTradingEnabled(enabled) {
  const value = enabled === true || enabled === 'true' || enabled === 1 || enabled === '1';
  db.saveSetting(FREE_TRADING_SETTING_KEY, JSON.stringify(value));
  return value;
}
```

替换 L90-L100：

```js
function liquidityStatus() {
  const enabled = isFreeTradingEnabled();
  return {
    enabled,
    status: enabled ? 'open' : 'pending',
    // 仅作手续费记账展示/对账，不再参与开闸判定
    balanceUsdt: formatUnits(BigInt(db.getATokenLpPoolBalance().usdtUnits || '0'), USDT_DECIMALS),
  };
}
function assertFreeTrading() {
  if (isFreeTradingEnabled()) return;
  throw Object.assign(
    new Error('自由交易暂未开放：待链上流动性就绪后由运营手动开启'),
    { code: 'LP_TRADING_LOCKED' }, // 错误码保留，避免未知调用方按码判断失效
  );
}
```

导出（L519）追加 `isFreeTradingEnabled, setFreeTradingEnabled`，保留 `liquidityStatus, assertFreeTrading`。

### 2.2 `src/a-token-admin-api.js`

- `handle()` 的 `const { url, allowRequest } = ctx;` 改为同时取 `operatorSession`。
- 在合伙人配置端点（L364）之后新增：

```js
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
```

审计沿用 `funds-admin-api.js` 的直接 INSERT 惯例（`audit_log.address` 允许 NULL）。

## 3. 后台入口 `public/admin.html`

在 `data-admin-panel="a-token-balance"` 面板内、L231 `</section>` 之前新增：

```html
<section class="admin-content-block">
  <header><div><h2>自由交易开关</h2><p>链上流动性就绪后由运营手动开启；关闭时自由交易与撮合全部拦截，仅保留甲区/乙区一键买入。</p></div></header>
  <div style="display:flex;gap:12px;align-items:center;padding:18px;flex-wrap:wrap">
    <span id="admin-free-trading-state" class="admin-inline-status">读取中…</span>
    <button class="admin-primary-button" type="button" id="admin-free-trading-toggle" disabled>开启自由交易</button>
  </div>
</section>
```

## 4. 后台交互 `public/js/operator-admin.js`

- 状态变量：`let freeTradingEnabled = false;`（与 `blindboxSnapshot` 同区）。
- `loadAll()` L537 后新增分支：`else if (page === 'a-token-balance') await loadFreeTrading();`
- 新增函数（放在 `loadBlindbox` 附近）：

```js
function renderFreeTrading() {
  const state = byId('admin-free-trading-state'), btn = byId('admin-free-trading-toggle');
  if (!state || !btn) return;
  state.textContent = freeTradingEnabled ? '当前状态：已开放自由交易' : '当前状态：待开放（自由交易已拦截）';
  state.style.color = freeTradingEnabled ? 'var(--admin-green)' : 'var(--admin-red)';
  btn.textContent = freeTradingEnabled ? '关闭自由交易' : '开启自由交易';
  btn.disabled = false;
}
async function loadFreeTrading() {
  const result = await aApi('/free-trading/config');
  freeTradingEnabled = result.enabled === true;
  renderFreeTrading();
}
async function toggleFreeTrading() {
  const next = !freeTradingEnabled, btn = byId('admin-free-trading-toggle');
  btn.disabled = true;
  try {
    const result = await aApi('/free-trading/config', { method:'POST', body:JSON.stringify({ enabled:next }) });
    freeTradingEnabled = result.enabled === true;
    renderFreeTrading();
    toast(`自由交易已${freeTradingEnabled ? '开放' : '关闭'}`);
  } catch (error) { toast(error.message); btn.disabled = false; }
}
```

- 事件绑定（`admin-aix-query-btn` 附近）：`byId('admin-free-trading-toggle')?.addEventListener('click', toggleFreeTrading);`

## 5. 前端文案

### 5.1 `public/js/a-token-trade.js`

- L141：`if (liquidity) liquidity.textContent = profile.liquidity?.enabled ? '已开放' : '待开放';`
- L223-L224 两行合并为一行：
  ```html
  <div class="meta-kv"><span>自由交易状态</span><b id="atrade-liquidity-total">${p ? (p.liquidity?.enabled ? '已开放' : '待开放') : '—'}</b></div>
  ```
- L254 按钮：`自由交易 · ${enabled ? '已开放' : '待开放'}`，仍按 `enabled` 决定 `disabled`。
- L255 说明：`自由交易由运营手动开关控制：链上流动性就绪后开启；未开放时仅支持甲区/乙区一键买入。`

### 5.2 `frontend/src/pages/assets.tsx`

- L120-L123 改为：`const lpOpen = Boolean(platform?.liquidity?.enabled);`（删除 `lpBalance`、`lpTarget`；`percent` 从 import 中移除）。
- L196 徽章文案：`{lpOpen ? '已开放自由交易' : '待开放自由交易'}`。
- L198-L203 删除进度条，改为：
  ```tsx
  <div className="assets-allocation">
    <div className="assets-allocation-item">
      <div className="assets-allocation-name"><span>自由交易状态</span><b>{lpOpen ? '已开放' : '待开放'}</b></div>
    </div>
  </div>
  ```
- L204：`{lpOpen ? '自由交易已开放，SVX 可按大盘价在平台内自由买卖。' : '链上流动性就绪后由运营手动开启，当前仅在平台内按大盘价交易。'}`

### 5.3 `frontend/src/types.ts`

`liquidity?: { enabled?: boolean; status?: 'open' | 'pending'; balanceUsdt?: string }`。移除 `targetUsdt`。

## 6. 七语言文案

`public/js/i18n-zh-en.js` 末尾追加 `Object.assign(window.I18nDict, {...})`；`public/js/i18n-extra.js` 末尾追加 5 个 IIFE（zh-TW / ja / ko / ru / es），key 集合完全一致：

| 中文 key | en | zh-TW | ja | ko | ru | es |
|---|---|---|---|---|---|---|
| 自由交易状态 | Free Trading Status | 自由交易狀態 | 自由取引ステータス | 자유 거래 상태 | Статус свободной торговли | Estado de trading libre |
| 待开放 | Pending | 待開放 | 未開放 | 미개방 | Ожидает открытия | Pendiente |
| 已开放 | Open | 已開放 | 開放中 | 개방됨 | Открыто | Abierto |
| 待开放自由交易 | Free trading pending | 待開放自由交易 | 自由取引は未開放 | 자유 거래 미개방 | Свободная торговля ожидает открытия | Trading libre pendiente |
| 已开放自由交易 | Free trading open | 已開放自由交易 | 自由取引は開放済み | 자유 거래 개방됨 | Свободная торговля открыта | Trading libre abierto |
| 待链上流动性就绪后由运营手动开启 | Enabled manually by operations once on-chain liquidity is ready | 待鏈上流動性就緒後由營運手動開啟 | オンチェーン流動性の準備後、運営が手動で開啟 | 온체인 유동성 준비 후 운영자가 수동으로 개방 | Включается оператором вручную после готовности ончейн-ликвидности | Se activa manualmente por operaciones cuando la liquidez on-chain esté lista |
| 自由交易由运营手动开关控制：链上流动性就绪后开启；未开放时仅支持甲区/乙区一键买入。 | Free trading is controlled by a manual operations switch: it opens once on-chain liquidity is ready; until then only Alpha/Beta one-click buys are available. | 自由交易由營運手動開關控制：鏈上流動性就緒後開啟；未開放時僅支援甲區/乙區一鍵買入。 | 自由取引は運営の手動スイッチで制御：オンチェーン流動性の準備後に開放。未開放時は甲区/乙区のワンクリック買いのみ。 | 자유 거래는 운영자 수동 스위치로 제어됩니다. 온체인 유동성 준비 후 개방되며, 미개방 시 갑구/을구 원클릭 매수만 가능합니다. | Свободная торговля управляется ручным переключателем оператора: открывается после готовности ончейн-ликвидности; до этого доступны только покупки в зонах Alpha/Beta. | El trading libre se controla con un interruptor manual de operaciones: se abre cuando la liquidez on-chain esté lista; hasta entonces solo hay compras en un clic en Alpha/Beta. |
| 自由交易开关 | Free Trading Switch | 自由交易開關 | 自由取引スイッチ | 자유 거래 스위치 | Переключатель свободной торговли | Interruptor de trading libre |
| 链上流动性就绪后由运营手动开启；关闭时自由交易与撮合全部拦截，仅保留甲区/乙区一键买入。 | Enabled manually by operations once on-chain liquidity is ready; when off, free trading and order matching are blocked, leaving only Alpha/Beta one-click buys. | 鏈上流動性就緒後由營運手動開啟；關閉時自由交易與撮合全部攔截，僅保留甲區/乙區一鍵買入。 | オンチェーン流動性の準備後、運営が手動で開啟。オフ時は自由取引とマッチングを全停止し、甲区/乙区のワンクリック買いのみ。 | 온체인 유동성 준비 후 운영자가 수동으로 개방합니다. 끄면 자유 거래와 매칭이 모두 차단되고 갑구/을구 원클릭 매수만 유지됩니다. | Включается оператором после готовности ончейн-ликвидности; при выключении свободная торговля и матчинг блокируются, остаются только покупки в зонах Alpha/Beta. | Se activa manualmente por operaciones cuando la liquidez on-chain esté lista; al desactivarlo se bloquean el trading libre y el emparejamiento, dejando solo compras en un clic en Alpha/Beta. |
| 当前状态：已开放自由交易 | Current status: free trading open | 當前狀態：已開放自由交易 | 現在の状態：自由取引は開放済み | 현재 상태: 자유 거래 개방됨 | Текущий статус: свободная торговля открыта | Estado actual: trading libre abierto |
| 当前状态：待开放（自由交易已拦截） | Current status: pending (free trading blocked) | 當前狀態：待開放（自由交易已攔截） | 現在の状態：未開放（自由取引は停止中） | 현재 상태: 미개방(자유 거래 차단됨) | Текущий статус: ожидает открытия (свободная торговля заблокирована) | Estado actual: pendiente (trading libre bloqueado) |
| 开启自由交易 | Enable free trading | 開啟自由交易 | 自由取引を開放 | 자유 거래 개방 | Включить свободную торговлю | Activar trading libre |
| 关闭自由交易 | Disable free trading | 關閉自由交易 | 自由取引を停止 | 자유 거래 중지 | Отключить свободную торговлю | Desactivar trading libre |
| 自由交易已开放 | Free trading enabled | 自由交易已開放 | 自由取引を開放しました | 자유 거래가 개방되었습니다 | Свободная торговля включена | Trading libre activado |
| 自由交易已关闭 | Free trading disabled | 自由交易已關閉 | 自由取引を停止しました | 자유 거래가 중지되었습니다 | Свободная торговля отключена | Trading libre desactivado |
| 自由交易已开放，SVX 可按大盘价在平台内自由买卖。 | Free trading is open; SVX can be traded in-platform at the market price. | 自由交易已開放，SVX 可按大盤價在平台內自由買賣。 | 自由取引は開放済み。SVX は大盘価格でプラットフォーム内で売買できます。 | 자유 거래가 개방되어 SVX를 시장가로 플랫폼 내에서 거래할 수 있습니다. | Свободная торговля открыта; SVX можно торговать внутри платформы по рыночной цене. | El trading libre está abierto; SVX se puede comprar y vender en la plataforma al precio de mercado. |
| 链上流动性就绪后由运营手动开启，当前仅在平台内按大盘价交易。 | Enabled manually by operations once on-chain liquidity is ready; currently trading only in-platform at the market price. | 鏈上流動性就緒後由營運手動開啟，目前僅在平台內按大盤價交易。 | オンチェーン流動性の準備後、運営が手動で開啟。現在はプラットフォーム内のみ大盘価格で取引。 | 온체인 유동성 준비 후 운영자가 수동으로 개방하며, 현재는 플랫폼 내에서만 시장가로 거래됩니다. | Включается оператором после готовности ончейн-ликвидности; сейчас торговля идёт только внутри платформы по рыночной цене. | Se activa manualmente por operaciones cuando la liquidez on-chain esté lista; actualmente solo se opera en la plataforma al precio de mercado. |

> 说明：`自由交易` 已存在于词表则复用；新增 key 只覆盖上述状态/说明文案。

## 7. 缓存版本

静态 JS 改动后统一把版本号升到 `20261110-free-1`：

- `public/admin.html` L383：`/js/operator-admin.js?v=20261110-free-1`
- `public/js/page-loader.js`：`a-token-trade` 版本
- `frontend/src/lib/runtime.ts`：脚本 `?v=`
- `public/js/i18n.js`：字典 `?v=`

React 改动后执行 `npm run build:frontend` 重新生成 `public/app/assets/*`。

## 8. 测试调整（改为开关开闸，不再插 LP 流水）

| 文件 | 改动 |
|---|---|
| `test/solvex-model.test.js` L33-35 | 默认关闭断言 `/待链上流动性就绪/`；改 `at.setFreeTradingEnabled(true)` 后断言 `enabled === true`、`status === 'open'`；再关回断言 false |
| `test/solvex-finance.test.js` L57 | 正则 `/500,000/` → `/待链上流动性就绪/`；L72 用 `at.setFreeTradingEnabled(true)` 替代 LP 插入 |
| `test/a-token-match-priority.test.js` L37-41 | `at.setFreeTradingEnabled(true)` |
| `test/a-token-market-price-follow.test.js` L44-48 | `at.setFreeTradingEnabled(true)` |
| `test/a-token-recharge-lock.test.js` L45-46 | `at.setFreeTradingEnabled(true)` |
| `test/solvex-ui.test.js` L12 | mock `liquidity:{enabled:false,status:'pending'}`；L58 等待文案 `加池未达标` → `待开放` |
| `test/fixtures/solvex-preview.mjs` L8 | `liquidity:{enabled:false,status:'pending'}` |
| `scripts/preview-solvex-design.mjs` L16 | 同上 |

其余 `a-token-*` / `solvex-*` 测试不改实现。

## 9. 验证

在 `resources/app` 下执行：

```powershell
node --check src/a-token-service.js
node --check src/a-token-admin-api.js
node --check public/js/operator-admin.js
node --check public/js/a-token-trade.js
node test/solvex-model.test.js
node test/solvex-finance.test.js
node test/solvex-ui.test.js
node test/a-token-match-priority.test.js
node test/a-token-market-price-follow.test.js
node test/a-token-recharge-lock.test.js
node test/a-token-turbo-zone.test.js
node test/i18n.test.js
Get-ChildItem test/a-token-*.test.js, test/solvex-*.test.js | ForEach-Object { node $_.FullName }
node test/mobile-static-cache.test.js   # 若构建产物有变化
npm run build:frontend                  # assets.tsx 改动后
```

期望：全部 PASS；`assertFreeTrading` 默认抛「待链上流动性就绪」；开关置 true 后 market 区买入与撮合放行；乙区行为不变。

## 10. 边界

- 不做链上加池金额回写，不新增链上监听。
- 不改乙区额度规则。
- 不改旧质押档、能量团队奖励。
- 不部署、不连服务器、不提交 git。
