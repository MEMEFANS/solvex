# Tasks — 老技术栈清理与 Solvex 品牌收口

状态：已执行（2026-11-11 00:33 完成首批；跳过项见文末）。用户决定：海报不重绘，直接删除；tools/ 与 output/ 按盘点结论处理。

## 执行结果（2026-11-11 00:33）
- 改名：15 张海报 → Solvex-*（随后按用户指令删除）；3 份课件 → Solvex*；contracts 4 件 → SolvexPool.* / README-SOLVEX-POOL-DEPLOY.md；scripts/deploy-aix-pool.js → deploy-solvex-pool.js；引用同步（gen-ppt/debug-split/shoot-guide/compile-contracts）。
- 协议头：X-AxiX-Action → X-Solvex-Action（server.js:338 + account-action-guard.js:26），全仓 0 残留。
- 缓存：SW_VERSION → solvex-static-v33-brand；`?v=20261110-*` → `20261111-*`（35 个 public 文件 + runtime.ts + legacy/index.html + frontend/index.html + 3 个 tsx），已重新 build。
- 碎片清理：根 .tmp-* 4 个、_tmp_src.cjs、gen-h-wallet.cjs、flagged-wallets csv、mall-*.png 13 张、3 个 *-stats-20261024.js、A.sol/AToken.*/README-DEPLOY.md/deploy-a-token.js、空目录 .screenshots 与 src/exchange。
- 死资产：根 tools/ 仅保留 aix-chart-20261011（测试 baseline fixture），755.7MB → 1.11MB；output/ 仅保留提现出款链路说明.md，141MB → 0.03MB；清单见 `C:\Users\Administrator\Desktop\AXIX-legacy-backup\2026-11-11T00-29-46-legacy-artifacts\TOOLS-AND-OUTPUT-INVENTORY.txt`。
- 校验：3 份合约 solc 编译通过；改动 JS `node --check` 通过；8080（PID 61812）首页/后台/商城/商户后台 200，6 个页面浏览器控制台无报错、无旧品牌文本。

## 跳过（并行会话正在改，mtime 00:27–00:28）
- `public/js/a-token-claim.js`、`earn.js`、`operator-admin.js`、`i18n-extra.js`、`i18n-zh-en.js`：仍含 `AIXPool` 文案（"平台未部署 AIXPool 合约"）与 `paymentAsset === 'AIX'` 枚举
- `public/mall.html`、`mall-merchant.html`、`games/mall/wallet-sign.js`、`src/funds-admin-api.js`：`paymentAsset === 'AIX'` 内部枚举
- `AIX_POOL_CONTRACT_ADDRESS` / `AIX_POOL_SIGNER_PRIVATE_KEY` 配置键：改名需同步部署环境，列入"需先迁移"
- 域名 `solvexdex.com` / `solvexdex.com`：按要求只列不改
- `resources/app/tools/` 154 个运维脚本（ssh-*/_deploy-*.ps1、plink/pscp、审计导出）：未删，待确认是否仍作为部署路径


## T1 前置安全检查
- [ ] T1.1 记录 `src/server.js`、`src/a-token-lp-job-service.js`、`src/database.js`、`src/a-token-admin-api.js`、`src/config.js`、`src/solvex-withdrawal-fees.js` 当前 mtime
- [ ] T1.2 判定是否与并行会话冲突（10 分钟内有写入即视为冲突）

## T2 图片重绘（15 张）
- [ ] T2.1 建 `resources/app/tools/brand-posters-20261111/render-posters.mjs`，读原图尺寸
- [ ] T2.2 实现统一模板：同心环 + 轨道星点 + 暖金点缀，`#0b7264` 主色
- [ ] T2.3 渲染 `Solvex-<同后缀>.png` 到仓库根，覆盖 15 个主题
- [ ] T2.4 删除旧 `AxiX-*.png`，确认 0 残留

## T3 文件改名 + 引用同步
- [ ] T3.1 课件三件套改名（md/pptx/md）
- [ ] T3.2 更新 `gen-ppt.mjs`、`debug-split.mjs`、`test-ppt.mjs` 路径
- [ ] T3.3 `contracts/AIXPool.*` → `SolvexPool.*`，文内 AIXPool→SolvexPool、AIX→SVX
- [ ] T3.4 `README-AIXPool-DEPLOY.md` → `README-SOLVEX-POOL-DEPLOY.md`
- [ ] T3.5 `scripts/deploy-aix-pool.js` → `deploy-solvex-pool.js`，内部路径与 env 引用同步
- [ ] T3.6 全仓 grep 旧文件名，确认无断链

## T4 协议头改名（前后端同一批）
- [ ] T4.1 `src/server.js:338` → `X-Solvex-Action`
- [ ] T4.2 `public/js/account-action-guard.js:26` 同步
- [ ] T4.3 grep `X-AxiX-Action` 应为 0

## T5 缓存版本刷新
- [ ] T5.1 `public/sw.js` SW_VERSION → `solvex-static-v33-brand`
- [ ] T5.2 `?v=20261110-*` → `20261111-brand-1`（runtime.ts / page-loader.js / legacy/index.html）
- [ ] T5.3 `npm run build:frontend` 重新产出 `public/index.html` + `public/app/*`
- [ ] T5.4 确认新入口 HTML 引用的是新 hash 且带新版本号

## T6 死资产清理（仅"可删"清单，逐项确认后执行）
- [ ] T6.1 根 `tools/`（755.7MB）
- [ ] T6.2 `resources/app/tools/` 旧脚本（保留 2 个 spec 目录）
- [ ] T6.3 `output/`（141MB）
- [ ] T6.4 根 `mall-*.png`、`.tmp-*`、`_tmp_src.cjs`、`gen-h-wallet.cjs`、`flagged-wallets-20261014.csv`、`.screenshots/`
- [ ] T6.5 `resources/app/*-stats-20261024.js`
- [ ] T6.6 `contracts/A.sol`、旧 ABI/bytecode、`scripts/deploy-a-token.js`、`scripts/erc20-bytecode.json`
- [ ] T6.7 `src/exchange/` 空目录

## T7 校验
- [ ] T7.1 `node --check` 所有改动 JS
- [ ] T7.2 `npx tsc --noEmit`
- [ ] T7.3 全仓残留扫描，逐条归类（域名 / 配置键 / 真残留）
- [ ] T7.4 启动本地服务，`/`、`/admin.html`、`/mall.html`、`/mall-merchant.html` 200
- [ ] T7.5 puppeteer 打开首页/后台/赚钱/交易/群聊/商城，控制台无报错、无旧品牌展示
- [ ] T7.6 报告：盘点清单 + 实际改动 + 校验结果 + 跳过项

## 明确不做
- 不改 `.env` 中的 `AIX_POOL_*` 键名（需与部署配置同步，列入"需先迁移"）
- 不替换 `solvexdex.com` / `solvexdex.com`
- 不改 `public/js/earn.js` 的 localStorage 键
- 不部署、不连服务器、不 `git commit`
