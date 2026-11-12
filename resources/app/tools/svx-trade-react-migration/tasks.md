# SVX 交易页迁移 — 任务清单

> 规格见 `spec.md`。按顺序执行；每步完成后自检，最后统一跑回归。

## T1 类型与环境声明
- 文件：`frontend/src/types.ts`、`frontend/src/env.d.ts`
- 内容：按 spec 4.1 新增 `SvxPoolTrade`/`SvxPoolStats`/`SvxTrade`/`SvxOrder`/`SvxBookLevel`/`SvxBook`/`SvxOpenOrders`/`SvxZoneQuote`/`SvxKlineCandle`/`SvxKline`/`SvxTradeProfile`/`SvxOpenOrderRow`；spec 4.2 增加 `loadPageCharts`、`LightweightCharts` 与最小图表接口。
- 验收：`npm run typecheck` 不因新增类型报错（页面未接入前也无未使用告警）。

## T2 新增页面 `frontend/src/pages/a-token-trade.tsx`
- 文件：同左（新建）
- 内容：按 spec 4.3 实现行情条、一键交易面板、K 线子组件、折叠订单簿/挂单明细、5 tab 账户面板、游客态、报价与签名下单。
- 关键点：
  - 金额派生只用 bigint/字符串（`buyMax`/`sellMax`/百分比填充）。
  - K 线经 `window.loadPageCharts()` 加载 `LightweightCharts`，失败降级为文案，不抛异常。
  - 下单走 `useAction().run` + `personal_sign` + `Idempotency-Key`，成功后精准失效本页查询键。
- 验收：`npm run typecheck` 通过；无 `any`。

## T3 路由接线
- 文件：`frontend/src/app.tsx`、`frontend/src/lib/runtime.ts`、`public/js/page-loader.js`
- 内容：
  - `app.tsx` 懒加载 `SvxTradePage`，`page==='a-token-trade'` 时 portal 到 `#tab-a-token-trade`。
  - `runtime.ts` `replaceChildren()` 名单追加 `tab-a-token-trade`。
  - `page-loader.js` 两个跳过名单追加 `a-token-trade`，更新注释。
- 验收：`node --check public/js/page-loader.js` 通过；`npm run build:frontend` 通过。

## T4 预览门禁与 fixture
- 文件：`scripts/preview-solvex-react.mjs`、`test/fixtures/solvex-preview.mjs`
- 内容：按 spec 4.7/4.8 增加 `waitText('#tab-a-token-trade','一键交易')`；补 `open-orders`、`zone/quote`、pool/profile 字段。
- 验收：`node scripts/preview-solvex-react.mjs` 输出 passed，`svx-desktop.png`/`svx-mobile.png` 生成，errors/missing 为空。

## T5 完整回归
- 命令（cwd=`resources/app`，逐条执行）：
  1. `npm run typecheck`
  2. `npm run build:frontend`
  3. `node scripts/preview-solvex-react.mjs`
  4. `npm run test:solvex-ui`
  5. `node test/a-token-withdrawal-security.test.js`
  6. `node test/a-token-asset-reporting.test.js`
  7. `node --check public/js/page-loader.js`
- 验收：全部 PASS；如页面截图发现溢出/空白，回到 T2 修复后重跑。

## T6（后续，不在本次批准范围）
- 交易终端三步迁移：只读行情/图表 → 下单/持仓/委托 → 移动端 → 切 portal。
