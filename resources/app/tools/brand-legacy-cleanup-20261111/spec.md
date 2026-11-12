# 老技术栈盘点 + Solvex 品牌残留清理

日期：2026-11-11　范围：`c:\Users\Administrator\Desktop\AXIX-副本-20261109`
约束：不部署、不连服务器、不提交 git；`src/` 有并行会话在改经济模型，动手前核对 mtime，正在改的文件跳过并说明。
域名 `solvexdex.com` / `solvexdex.com` 只列位置，不替换。

---

## 第一步：盘点结论（只读，未删任何文件）

### 1. 两套前端：谁在跑

| 层 | 位置 | 状态 | 依据 |
|---|---|---|---|
| React 生产壳 | `public/index.html`（862B）+ `public/app/assets/index-cQbKRTUj.js`（397KB） | **当前真正在跑的入口** | `scripts/build-frontend.mjs` 先 `vite build`（root=`frontend`、outDir=`public/app`），再把 `public/app/index.html` 复制成 `public/index.html`；`src/server.js:1826-1877` 静态根就是 `public/`，`/` 直接返回该文件 |
| React 源码 | `frontend/src/**`（app.tsx + 7 个 lazy 页面：earn/team/assets/ranking/support/community-chat/ai-managed） | 活 | 构建产物 hash 与源码一致（`index-cQbKRTUj.js` 内含 `tab-earn` 等宿主 id） |
| 兼容层 | `frontend/src/lib/runtime.ts` | 活 | 以 `?raw` 引入 `frontend/legacy/index.html`，把 `.tab-panel` 注入 `#legacy-root`，再动态加载 `/js/*.js` |
| 原生 JS 业务模块 | `public/js/*.js`（57 个） | 活（被 React 兼容层调用） | `public/js/page-loader.js` 维护页面→模块组映射；trade / a-token / 商城 / 群聊仍是原生实现 |
| legacy 模板 | `frontend/legacy/index.html`（52KB） | **模板，不是入口** | 无任何 HTML/JS 以 URL 形式引用它，只被 `runtime.ts` 当字符串读入 |
| 原生独立页 | `admin.html`、`mall.html`、`mall-merchant.html`、`funds-admin.html`、`withdraw-admin.html`、`agent.html` | 活（独立路由） | 各自 `<script src="/js/...">`，`/admin.html` 实测 200 / 30KB |
| 营销静态页 | `promo-*.html`(13)、`tutorial-m.html`、`tutorial-register.html`、`policy-posters.html`、`infographic.html` | 活但游离 | 纯静态，无构建依赖，直接可访问 |

构建产物是否被页面加载：**是**。`public/index.html` 的 `<script type="module" src="/app/assets/index-cQbKRTUj.js">` 就是构建产物；`public/app/index.html` 是其原样副本（构建脚本生成的中间文件）。

### 2. vendor / tools / contracts 死资产

**`public/vendor/`（活的）**
- `lightweight-charts.js` → `page-loader.js:7` 使用
- `three/three.module.js`（1.27MB）→ `mining-tunnel.js`、`mining-cavern.js`
- `wallet/connector.js` → `frontend/wallet-connector.js` 的 esbuild 产物（`scripts/build-wallet.js` 可重建）

**根 `tools/`：755.7MB / 4350 文件，全部死资产**
- `run-aix/` 686MB、`address-investigation-20261011/` 19MB、`hash-aix/` 12.7MB、`page-loading-20261011/` 7.1MB、`i18n-audit/` 4.1MB……
- 内含旧 `public/index.html`（117KB，2026-10-20 版）与旧 `src/server.js`（124KB）的 before/candidate/production 三份快照
- 全仓无任何运行时引用

**`resources/app/tools/`：154 文件，约 1.7MB，绝大多数死资产**
- SSH 运维：`ssh-*.ps1`、`_run-*.ps1`、`_deploy-*.ps1`、`plink.exe`、`pscp.exe`
- AIX 期审计/i18n 导出：`i18n-missing.json`、`local-manifest.txt`、`server-manifest.txt`、`page-loading-20261011/`
- 仅 2 个目录是活的：`free-trading-switch-20261110/`、`svx-trade-react-migration/`（当前会话的 spec/tasks）

**`contracts/`**
- 旧：`AIXPool.sol`、`AIXPool.abi.json`、`AIXPool.bytecode`、`README-AIXPool-DEPLOY.md`、`A.sol`
- 新：`SolvexToken.*`、`SolvexAutoLp.*`、`README-SVX-TOKEN.md`、`README-AUTO-LP.md`、`README-DEPLOY.md`
- `scripts/`：`deploy-aix-pool.js`、`deploy-a-token.js`、`erc20-bytecode.json` 旧；`deploy-solvex-token.js`、`deploy-auto-lp.js`、`compile-contracts.js` 新
- 后端**仍读取** `AIX_POOL_CONTRACT_ADDRESS` / `AIX_POOL_SIGNER_PRIVATE_KEY`（`src/server.js:570-582`）→ 属"需先迁移"

### 3. 其它旧栈残留

- 根目录 15 张 `AxiX-*.png`（不是 16 张；`AxiX-生态思维导图.png` 仅出现在 `tools/shot-mindmap.mjs` 的默认输出路径里，实际不存在）
- `AxiX讲师课件.md`、`AxiX讲师课件.pptx`、`AxiX平台介绍课件.md`；引用方 `gen-ppt.mjs`、`debug-split.mjs`、`test-ppt.mjs`
- 根目录 `mall-*.png` 13 张（2026-10-31 旧截图）、`.tmp-*.py/.sh` 4 个、`_tmp_src.cjs`、`gen-h-wallet.cjs`（0 字节）、`flagged-wallets-20261014.csv`、`玩法介绍.md`、空目录 `.screenshots/`
- `output/` 141MB / 8554 文件（`aix-activation-local/` 75MB、`imagegen/` 46MB、`solvex-*` 19MB）
- `resources/app/` 根：`miner-stats-20261024.js`、`reward-stats-20261024.js`、`stake-stats-20261024.js`（一次性统计脚本）
- `src/exchange/` 空目录；`src/ai/`、`src/market-data/` 活
- 重复 `index.html`：`public/index.html` 与 `public/app/index.html` 同哈希（构建脚本复制的，属预期）；`frontend/index.html` 是 Vite 开发壳（活）；`tools/**` 里的旧副本随 `tools/` 一起死

### 4. 三类清单

**可删（无运行时引用）**
1. 根 `tools/` 整目录（755.7MB）
2. `resources/app/tools/` 除 `free-trading-switch-20261110/`、`svx-trade-react-migration/` 外的全部内容
3. `output/` 全部（141MB 截图/报告/生成物）
4. 根目录 15 张 `AxiX-*.png`（第 2 步重绘替换）
5. 根目录 `mall-*.png` 13 张、`.tmp-*`、`_tmp_src.cjs`、`gen-h-wallet.cjs`、`flagged-wallets-20261014.csv`、`.screenshots/`
6. `resources/app/miner-stats-20261024.js`、`reward-stats-20261024.js`、`stake-stats-20261024.js`
7. `contracts/A.sol`、`contracts/AIXPool.abi.json`、`contracts/AIXPool.bytecode`、`scripts/deploy-a-token.js`、`scripts/erc20-bytecode.json`
8. `src/exchange/`（空目录）

**需保留**
1. `public/**` 全部活资源（含 `app/` 构建产物、`js/`、`styles/`、`assets/`、`vendor/`、`games/mall/`）
2. `frontend/**`（React 源码 + `legacy/index.html` 模板 + `wallet-connector.js`）
3. `src/**`（除空 `exchange/`）
4. `contracts/Solvex*`、`contracts/README-SVX-TOKEN.md`、`README-AUTO-LP.md`、`README-DEPLOY.md`
5. `scripts/` 的构建/本地运行/测试入口
6. `test/`、`data/`、`backups/`（数据不入库，但是当前账本与备份）

**需先迁移**
1. `AIX_POOL_CONTRACT_ADDRESS` / `AIX_POOL_SIGNER_PRIVATE_KEY`（`src/server.js:570-582`）：改名需同步 `.env` 与部署配置，本轮只列不改
2. `contracts/AIXPool.sol` + `README-AIXPool-DEPLOY.md` + `scripts/deploy-aix-pool.js`：先改名/改内部引用，再与 env 键一起统一
3. `src/a-token-claim-service.js` 注释中的 "AIXPool harvest 模式"、`a-token-withdrawal-service.js` 注释中的 `contracts/A.sol`
4. `public/js/earn.js:1803,1838` 的 localStorage 键 `axix_activation_retry_v1` / `axix_activation_aix_request_v1`：内部键不展示，改名会丢失进行中的重试状态 → 保留

---

## 第二步：品牌清理执行方案

### A. 图片（15 张 PNG 重绘）
- 新建 `resources/app/tools/brand-posters-20261111/render-posters.mjs`（puppeteer，`resources/app` 已有依赖）
- 统一矢量模板：同心环 + 轨道星点 + 暖金点缀，主色 `#0b7264`，辅色 `#c9a227`/`#f6f7fc`；标题用原图同名主题（平台介绍/经济模型/质押收益……）
- 按原图实际像素尺寸逐张渲染，输出 `Solvex-<同后缀>.png` 到仓库根，删除旧 `AxiX-*.png`
- 若某张原图缺失（`AxiX-生态思维导图.png`），不新造

### B. 文件名 / 目录改名并同步引用
| 原 | 新 | 需同步 |
|---|---|---|
| `AxiX讲师课件.md` | `Solvex讲师课件.md` | `gen-ppt.mjs:5,227`、`debug-split.mjs:2` |
| `AxiX讲师课件.pptx` | `Solvex讲师课件.pptx` | `gen-ppt.mjs:227` |
| `AxiX平台介绍课件.md` | `Solvex平台介绍课件.md` | 无引用，仅改名 |
| `contracts/README-AIXPool-DEPLOY.md` | `contracts/README-SOLVEX-POOL-DEPLOY.md` | 文内 `AIXPool`→`SolvexPool`，`AIX`→`SVX` |
| `contracts/AIXPool.sol` | `contracts/SolvexPool.sol` | 合约名/字符串/注释同步 |
| `contracts/AIXPool.abi.json`、`.bytecode` | `SolvexPool.abi.json`、`.bytecode` | `scripts/deploy-solvex-pool.js` |
| `scripts/deploy-aix-pool.js` | `scripts/deploy-solvex-pool.js` | 内部 `contracts/AIXPool.*` → `SolvexPool.*`、README 互引 |

### C. 协议头（前后端同一次改完）
- `src/server.js:338` `X-AxiX-Action` → `X-Solvex-Action`
- `public/js/account-action-guard.js:26` 同步
- 全仓再 grep 确认无第三处

### D. 缓存版本
- `public/sw.js:9` `SW_VERSION = 'solvex-static-v32-session'` → `'solvex-static-v33-brand'`
- `?v=20261110-*` 统一升到 `20261111-brand-1`：`frontend/src/lib/runtime.ts`、`public/js/page-loader.js`、`frontend/legacy/index.html`
- 重新 `npm run build:frontend` 生成新 hash 的 `public/index.html` + `public/app/*`

### E. 域名（不改）
位置清单：`policy-posters.html:130,167`、`promo-guide.html:239`、`promo-live.html:71`、`tutorial-register.html:313,355,397,439,481,523,565,701,886`、`tutorial-m.html:305,345,385,425,465,505,545,765`、`i18n-zh-en.js:2694`、`i18n-extra.js:6,569,1186,1804,2689`

### F. 安全约束
- 动手前再次 `Get-Item` 核对 mtime，> 10 分钟未变才改
- 已知热文件：`src/server.js`(00:03)、`src/a-token-lp-job-service.js`(00:03)、`src/database.js`(23:59)、`src/a-token-admin-api.js`(23:56)、`src/config.js`(23:56)、`src/solvex-withdrawal-fees.js`(23:56)、`scripts/lp-auto-ops.js`(23:58)
- 若 `server.js` 仍在被写：跳过协议头改名，其余照做并在报告标注

### G. 校验
1. `node --check` 所有改动过的 `.js`；`npx tsc --noEmit` 前端类型
2. `npm run build:frontend` 成功，`public/index.html` 引用新 hash
3. 全仓 grep `AxiX|AXIX|AIX`（排除 `node_modules`、已删目录）应只剩：域名、`AIX_POOL_*` 配置键、历史 ABI/合约存档
4. 启动本地服务（优先 8080，占用则 5174），验证 `/`、`/admin.html`、`/mall.html`、`/mall-merchant.html` 200，puppeteer 抓控制台无报错
5. 未登录访问 `/api/a-token/profile` 返回文案含 Solvex/SVX
