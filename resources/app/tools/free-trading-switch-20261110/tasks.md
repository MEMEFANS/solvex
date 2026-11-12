# 任务清单：自由交易闸门改为运维手动开关

- [x] T1 后端：`src/a-token-service.js` 新增 `free_trading_enabled` 读写函数，`liquidityStatus()` 读开关并返回 `{enabled,status,balanceUsdt}`，`assertFreeTrading()` 改为「待链上流动性就绪后由运营手动开启」；导出 `isFreeTradingEnabled/setFreeTradingEnabled`
  - 验证：`node --check src/a-token-service.js`；`node test/solvex-model.test.js`
- [x] T2 后台接口：`src/a-token-admin-api.js` 新增 `GET/POST /api/admin/a-token/free-trading/config`，POST 走 `allowRequest`，写 `audit_log`（event_type `a_token_free_trading_switch`，含 actor/enabled/at）
  - 验证：`node --check src/a-token-admin-api.js`
- [x] T3 后台页面：`public/admin.html` 在 `a-token-balance` 面板加「自由交易开关」区块（状态 + 切换按钮）
- [x] T4 后台交互：`public/js/operator-admin.js` 加 `freeTradingEnabled` 状态、`loadAll` 分支、`loadFreeTrading/renderFreeTrading/toggleFreeTrading` 与点击绑定
  - 验证：`node --check public/js/operator-admin.js`
- [x] T5 交易页文案：`public/js/a-token-trade.js` 去掉 LP 进度/门槛数字，改「自由交易状态：待开放/已开放」；说明改为「由运营手动开关控制」；按钮文案同步
- [x] T6 资产页：`frontend/src/pages/assets.tsx` 去掉 LP 进度条与累计数字，改状态徽章/说明；移除无用 `percent` 导入
- [x] T7 类型：`frontend/src/types.ts` 的 `liquidity` 改为 `{enabled?,status?,balanceUsdt?}`，移除 `targetUsdt`
- [x] T8 七语言：`public/js/i18n-zh-en.js` + `public/js/i18n-extra.js` 追加 spec 第 6 节 14 个 key 的 6 语翻译
- [x] T9 测试对齐：`solvex-model`、`solvex-finance`、`a-token-match-priority`、`a-token-market-price-follow`、`a-token-recharge-lock` 改用 `setFreeTradingEnabled(true)`；`solvex-ui` mock 与等待文案改为 `status:'pending'` / `待开放`
- [x] T10 预览夹具：`test/fixtures/solvex-preview.mjs`、`scripts/preview-solvex-design.mjs` 的 liquidity 改为 `{enabled:false,status:'pending'}`
- [x] T11 缓存版本：`admin.html`、`page-loader.js`、`runtime.ts`、`i18n.js` 版本号升 `20261110-free-1`
- [x] T12 构建与回归：`npm run build:frontend`；跑 `a-token-*`、`solvex-*`、`i18n`、`mobile-static-cache` 全部通过

不部署、不连服务器、不提交 git。
