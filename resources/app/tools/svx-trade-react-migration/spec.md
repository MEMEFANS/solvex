# SVX 交易页（a-token-trade）迁移到 React — 规格说明

## 1. 背景与目标
legacy 页面脚本 `public/js/a-token-trade.js`（约 60KB）承担 SVX/USDT 平台内交易：顶部行情条、K 线、一键买卖、订单簿与账户面板。本次将其迁移为 React 页面，接入现有懒加载 + portal 路由体系，保留原有功能与视觉，并沿用已有数据接口。

页面展示名统一为 **SVX交易**；内部资产代码仍为 `A`，不得改经济模型、费率、分区规则与文案含义。

## 2. 范围
### 2.1 本次包含
1. 新增 React 页面 `frontend/src/pages/a-token-trade.tsx`。
2. 顶部行情条：现价（4 位小数）、24h 涨跌幅/最高/最低、今日交易量（SVX/USDT）、今日销毁、累计销毁、LP 加池进度与门槛、游客连接钱包 CTA。
3. K 线：6 个周期（1m/5m/15m/1h/4h/1d），lightweight-charts，精度 4 位、最小变动 0.0001，10 秒增量刷新（整批 setData 即可），窗口尺寸随容器同步。
4. 一键交易面板：买/卖切换、买方分区（甲区/乙区）、自由交易入口（LP 达标才可用）、可用余额（点击 100% 填充）、数量输入、0/25/50/75/100% 滑块、买卖两套报价卡、提交按钮、订单价值/手续费摘要与规则说明。
5. 报价：`GET /api/a-token/zone/quote?side&zone&amount`，输入 300ms 防抖；金额非法不发请求并清空摘要。
6. 下单：先取报价 → 组装确认文案 → 钱包 `personal_sign` → `POST /api/a-token/zone/buy|sell`（带 `Idempotency-Key`）。成功/失败均以 toast 提示并刷新数据。
7. 折叠区「历史委托与订单簿」：订单簿（卖盘最多 12 档倒序、买盘 12 档、中间标记价，点击价格切买卖方向）、挂单明细（卖盘/买盘分段，含限价/市价标签）。
8. 底部账户面板 5 个 tab：资产、持仓、当前委托、历史委托、成交历史。
9. 游客态：可见行情、K 线、订单簿与交易面板（按钮为「连接钱包开始交易」），账户区域显示连接钱包引导。
10. 路由接线：`app.tsx` 懒加载 + portal；`runtime.ts` 清理 `#tab-a-token-trade`；`page-loader.js` 跳过该页 legacy 脚本。
11. 预览门禁：`scripts/preview-solvex-react.mjs` 增加该页等待断言；fixture 补该页接口响应。

### 2.2 本次不包含
- 不接 wagmi/viem 链上下单，不新增链上交易路径；仍然只做平台账本交易 + 钱包签名。
- 不修改费率、分区、涡轮/额度/销毁等经济规则与后端服务。
- 不删除 legacy 脚本文件，仅停止在本页加载。
- 不改 `loadLegacyStyles` 的 `['earn','referrals','leaderboard']` 跳过名单。
- 不做交易终端（trade）迁移。

## 3. 数据契约（接口字段以 legacy 实现为准）
### 3.1 行情 `GET /api/a-token/pool`
`priceUsdt`、`todayVolumeA`、`todayHigh`、`todayLow`、`totalBurned`、`todayBurned`、`dividendPool`、`changePct24h`（可空）、`recentTrades[]`（`side`、`priceUsdt`、`size`、`createdAt`）。

### 3.2 账户 `GET /api/a-token/profile`（需登录）
`balances.{USDT,A}`、`locked.{usdt,a}`、`zones.{alpha,beta}`、`sellQuota.available`、`turbo.betaBalance`、`sellFee.feePct`、`liquidity.{enabled,balanceUsdt,targetUsdt}`、`trades[]`（`side`、`priceUsdt`、`size`、`amountUsdt`、`burn`、`dividend`、`createdAt`）。

### 3.3 盘口 `GET /api/a-token/orderbook?limit=50&tick=0.0001`
`bids[]`/`asks[]`（`price`、`size`、`usdt`、`count`、`top[]`）、`markPrice`。

### 3.4 挂单明细 `GET /api/a-token/open-orders?limit=2000`
`buys[]`/`sells[]`：`priceUsdt`、`sizeA`、`netA`、`amountUsdt`、`orderType`、`createdAt`。

### 3.5 我的委托 `GET /api/a-token/orders?limit=200`
`orders[]`：`orderId`、`side`、`orderType`、`orderStatus`、`orderPriceUsdt`、`inputUsdt`、`inputA`、`filledUsdt`、`filledA`、`fillPriceUsdt`、`createdAt`。

### 3.6 报价 `GET /api/a-token/zone/quote`
买：`aOut`、`priceUsdt`、`usdtIn`（或 `amountUsdt`）、`feeUsdt`、`totalUsdt`；
卖：`aIn`、`usdtOut`、`netUsdt`、`feeUsdt`、`feePct`、`amountUsdt`。

### 3.7 K 线 `GET /api/a-token/kline?period=&limit=500`
`candles[]`：`time`（秒）、`open`、`high`、`low`、`close`。

### 3.8 下单 `POST /api/a-token/zone/buy|sell`（需登录）
Buy body：`{ zone, amount, timestamp, signature }`；Sell body：`{ amount, timestamp, signature }`。返回买：`usdtCost`、`aOut`、`feeUsdt`、`zoneLabel`；卖：`aIn`、`netUsdt`、`feeUsdt`。

## 4. 精确改动清单
### 4.1 `frontend/src/types.ts`（新增 export）
- `SvxPoolTrade { side?: string; priceUsdt?: number | string; size?: number | string; createdAt?: number | string }`
- `SvxPoolStats { priceUsdt?; todayVolumeA?; todayHigh?; todayLow?; totalBurned?; todayBurned?; dividendPool?; changePct24h?: number | string | null; recentTrades?: SvxPoolTrade[] }`（数值字段 `number | string`）
- `SvxTrade { side?; priceUsdt?; size?; amountUsdt?; burn?; dividend?; createdAt?: number }`
- `SvxOrder { orderId: string; side?; orderType?; orderStatus?; orderPriceUsdt?; inputUsdt?; inputA?; filledUsdt?; filledA?; fillPriceUsdt?; createdAt?: number }`（金额字段 `number | string`）
- `SvxBookLevel { price?; size?; usdt?: number | string; count?: number; top?: { size?; usdt?: number | string }[] }`
- `SvxBook { bids?: SvxBookLevel[]; asks?: SvxBookLevel[]; markPrice?: number | string | null }`
- `SvxOpenOrders { buys?: SvxOrder[]; sells?: SvxOrder[]; count?: number }`
- `SvxZoneQuote { aOut?; aIn?; priceUsdt?: number | string; usdtIn?: number | string; amountUsdt?: number | string; feeUsdt?: number | string; totalUsdt?: number | string; usdtOut?: number | string; netUsdt?: number | string; feePct?: string }`
- `SvxKlineCandle { time: number; open: number; high: number; low: number; close: number }`
- `SvxKline { candles?: SvxKlineCandle[] }`
- `SvxTradeProfile extends PlatformProfile { locked?: { usdt?: string; a?: string }; turbo?: { betaBalance?: string }; sellFee?: { feePct?: string }; trades?: SvxTrade[] }`
- `SvxOpenOrderRow { priceUsdt?; sizeA?; netA?; amountUsdt?: number | string; orderType?; createdAt?: number }`

### 4.2 `frontend/src/env.d.ts`
在 `Window` 增加：
- `loadPageCharts?: () => Promise<void>;`
- `LightweightCharts?: { createChart(el: HTMLElement, options: Record<string, unknown>): SvxChart; CandlestickSeries: unknown; CrosshairMode: { Normal: number } };`
并在文件内定义最小接口 `SvxChart { addSeries(type: unknown, options: Record<string, unknown>): SvxChartSeries; timeScale(): { applyOptions(options: Record<string, unknown>): void; scrollToPosition(position: number, animated: boolean): void }; applyOptions(options: Record<string, unknown>): void; remove(): void }`、`SvxChartSeries { setData(data: unknown[]): void; update(bar: unknown): void; priceScale(): { applyOptions(options: Record<string, unknown>): void }; applyOptions(options: Record<string, unknown>): void }`（仅覆盖本页用到的 API，不用 any）。

### 4.3 新增 `frontend/src/pages/a-token-trade.tsx`
结构：
- 默认导出 `SvxTradePage`。
- 常量：`PERIODS`（1m/5m/15m/1h/4h/1d）、`BAR_SPACING`、`ZONE_LABEL = { alpha:'甲区', beta:'乙区', market:'自由交易（乙区）' }`、`ACCOUNT_TABS`。
- 金额工具（仅字符串/bigint）：
  - `decimal6(value)` / `decimal18(value)`：正则校验后右补零到固定精度并 `BigInt`。
  - `formatAmount(units, decimals)`：用 `units()` 还原十进制字符串。
  - `buyMax(usdt)`：`usdt6 * 100n / 105n` 后向下取整到 2 位（`/ 10000n * 10000n`）。
  - `sellMax(balA, quota)`：`min(decimal18(balA), decimal18(quota))`。
  - 百分比填充：`max * pct / 100n` 向下取整（买 4 位、卖 8 位小数）。
- 数据查询（`useQuery`）：
  - `['svx-trade-pool']` → `api<SvxPoolStats>('a-token/pool', {}, false)`，`refetchInterval: 5000`。
  - `['svx-trade-profile', identity]` → `api<SvxTradeProfile>('a-token/profile')`，`enabled: wallet.authenticated`，`refetchInterval: 5000`。
  - `['svx-trade-book']` → `api<SvxBook>('a-token/orderbook?limit=50&tick=0.0001', {}, false)`，`refetchInterval: 4000`。
  - `['svx-trade-open-orders', identity]` → `api<SvxOpenOrders>('a-token/open-orders?limit=2000')`，`enabled: authenticated && bookOpen`，`refetchInterval: 4000`。
  - `['svx-trade-orders', identity]` → `api<{ orders?: SvxOrder[] }>('a-token/orders?limit=200')`，`enabled: authenticated && (tab==='orders' || tab==='history')`，`refetchInterval: 5000`。
  - `['svx-trade-quote', identity, side, zone, debounced]` → `api<SvxZoneQuote>('a-token/zone/quote?...')`，`enabled: authenticated && 合法正数`，`retry: false`。
- 状态：`side`、`zone`、`amount`、`period`、`accountTab`、`bookOpen`、`debounced`、`submitting`。
- 交互函数：`changeSide`、`changeZone`、`fill(pct)`、`submit()`。
  - `submit`：未登录 → toast「请先连接并确认钱包」；空/非法金额 → 对应错误；买超 `buyMax`、卖超 `sellMax`、卖 < 1 SVX → 对应错误；取最新报价 → 生成 `requestId='azt_'+crypto.randomUUID()`、`timestamp=Date.now()` → `personal_sign`（通过 `window.solvexWalletBridge?.provider()`，地址用 `walletAddress()`）→ `api('a-token/zone/buy|sell', { method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':requestId}, body })` → 成功 toast（文案同 legacy）→ 清空输入/滑块 → `queryClient.invalidateQueries({ predicate: q => ['svx-trade-pool','svx-trade-profile','svx-trade-book','svx-trade-orders','svx-trade-open-orders'].includes(String(q.queryKey[0])) })`。异常走 `friendlyError`（4001/rejected → 「已取消」）。
  - `submit` 用 `useAction().run` 包裹确认弹窗与 busy 态。
- 渲染：
  - 页头：`PageHeading title="SVX交易" subtitle="连接 SVX 生态 · 甲区与超速驱动 · 平台内买卖各收 5% 交易费"`。
  - `pool.isPending` → `Loading`；`pool.error` → `ErrorState`。
  - 行情条 `atrade-spot-price-strip`：成对图标/名称/生态资产标签、`price-big`（涨跌 class）、24h 高低、`atrade-spot-meta` 6 项（含 `atrade-burn-today`/`atrade-burn-total`/`atrade-liquidity-total`）、游客 `balance-cta`。
  - 主体 `atrade-terminal > atrade-terminal-grid`：`.atrade-cell-chart` 放 K 线卡（toolbar 周期按钮 + `.atrade-chart-host`），`.atrade-cell-entry` 放 `aentry` 面板。
  - 折叠 `<details className="svx-legacy-book">`（`onToggle` 控制 `bookOpen`）：`book-card` + 订单簿 + 挂单明细。
  - 账户区 `portal-section atrade-account`：`terminal-tabs` 5 tab + `terminal-account-content`；未登录渲染 `Gate`。
  - 数值展示：价格 4 位（`formatDecimal(v,4)`）、SVX 4 位、USDT 2 位、涨跌 2 位；只用 `formatDecimal/mulDecimal/sumDecimal/percent`，金额不参与 `Number` 计算（`Number` 仅用于展示判断，例如涨跌方向）。
- 子组件 `CandleChart({ period })`：
  - `useEffect([])`：`await window.loadPageCharts?.()`；无 `window.LightweightCharts` 时显示「图表加载失败，请刷新重试」并返回；`createChart(host,{ width:clientWidth||600, height:clientHeight||360, layout/grid/crosshair/rightPriceScale/timeScale/localization })`；`addSeries(LightweightCharts.CandlestickSeries,{ upColor:'#4fd1b5', downColor:'#f06f75', borderVisible:false, wickUpColor:'#4fd1b5', wickDownColor:'#f06f75' })`；`priceScale().applyOptions({ autoScale:true })`；`applyOptions({ priceFormat:{ type:'price', precision:4, minMove:0.0001 } })`。
  - `ResizeObserver` 同步 `applyOptions({ width, height })`。
  - `useQuery(['svx-kline', period])` → `api<SvxKline>('a-token/kline?period=..&limit=500', {}, false)`，`refetchInterval: 10000`；数据到达后 `setData(candles)` → `timeScale().applyOptions(timeScaleOptions(period))` → `scrollToPosition(4,false)`。
  - 卸载：断开 observer、`chart.remove()`。

### 4.4 `frontend/src/app.tsx`
- `const SvxTradePage = lazy(() => import('@/pages/a-token-trade'));`
- `{ready && page === 'a-token-trade' && createPortal(<PageBoundary><Suspense fallback={<Loading />}><SvxTradePage /></Suspense></PageBoundary>, document.getElementById('tab-a-token-trade')!)}`

### 4.5 `frontend/src/lib/runtime.ts`
- `installLegacyDOM` 的 `.tab-panel` 循环条件追加 `|| panel.id === 'tab-a-token-trade'`。
- 不改 `switchTab` 中 `loadLegacyStyles` 的跳过名单。

### 4.6 `public/js/page-loader.js`
- `loadPageModule` 与 `isPageModuleReady` 的 `WG_REACT_APP` 跳过名单追加 `'a-token-trade'`（同步更新注释）。

### 4.7 `scripts/preview-solvex-react.mjs`
- `visit` 内新增：`if(name==='a-token-trade')await waitText('#tab-a-token-trade','一键交易');`

### 4.8 `test/fixtures/solvex-preview.mjs`
- `/api/a-token/pool` 补 `changePct24h:2.4`、`dividendPool:'3200'`、`recentTrades:[{side:'buy',priceUsdt:.1012,size:'120',createdAt:now-60000},{side:'sell',priceUsdt:.1008,size:'80',createdAt:now-30000}]`。
- `/api/a-token/profile` 补 `locked:{usdt:'120',a:'300'}`, `turbo:{betaBalance:'400'}`, `sellFee:{feePct:'5%'}`, `trades:[{side:'buy',priceUsdt:.1,size:'100',amountUsdt:'10',burn:'0.5',dividend:'0.5',createdAt:now-3600000}]`。
- 新增 `/api/a-token/open-orders` → `{ count:2, sells:[{priceUsdt:.1015,sizeA:'90',netA:'90',amountUsdt:'9.14',orderType:'limit',createdAt:now-120000}], buys:[{priceUsdt:.0995,sizeA:'60',netA:'60',amountUsdt:'5.97',orderType:'market',createdAt:now-60000}] }`。
- 新增 `/api/a-token/zone/quote`：读 `side`/`amount`，买返回 `{ amountUsdt, usdtIn:amount, aOut:(amount/0.1), priceUsdt:.1, feeUsdt:amount*0.05, totalUsdt:amount*1.05 }`；卖返回 `{ aIn:amount, usdtOut:amount*0.1, netUsdt:amount*0.095, feeUsdt:amount*0.005, feePct:'5%', priceUsdt:.1, amountUsdt:amount*0.1 }`（fixture 内部允许浮点，仅用于展示）。

## 5. 约束
- 金额计算只用 bigint/字符串；禁止 `Number` 参与金额计算。
- 展示层代币名 `SVX`；内部代码仍为 `A`。
- 不新增链上路径、不部署、不连远程、不 git 提交、不写私钥。
- 新代码注释用中文；TypeScript `verbatimModuleSyntax`，类型导入用 `import type`。
- 页面数据获取一律走 `useQuery + api/post`，钱包状态走 `useWallet()`。

## 6. 验证步骤（cwd=`resources/app`，PowerShell 逐条执行）
1. `npm run typecheck`
2. `npm run build:frontend`
3. `node scripts/preview-solvex-react.mjs`（15 路由、0 错误、0 缺失资源，含 `svx` 桌面/移动截图）
4. `npm run test:solvex-ui`
5. `node test/a-token-withdrawal-security.test.js`
6. `node test/a-token-asset-reporting.test.js`
7. `node --check public/js/page-loader.js`

## 7. 验收标准
- 上述 7 条命令全部通过。
- `/svx`（hash `#/a-token-trade`）在桌面与移动端无横向溢出；页面出现「一键交易」「历史委托与订单簿」「资产/持仓/当前委托/历史委托/成交历史」。
- 游客态不出现余额数字；已登录态显示 USDT/SVX 余额、额度与报价。
- 未下单/未签名前不产生资金类请求；预览拦截下无未捕获错误。
