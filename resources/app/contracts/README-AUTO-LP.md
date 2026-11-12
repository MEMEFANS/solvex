# 提现手续费自动加 LP（SolvexAutoLp）接入说明

## 2026-11-12 链上方案

SVX 和 USDT 地址、Pair 和 Router 在部署后固定；LP 合约只允许 owner 设置操作员、滑点、LP 去向及暂停状态。SVX 库存可由钱包直接转入（或用 `depositSvx` 记账注入）。盲盒采用 1 U/盒的唯一批次凭证，提现手续费只在北京时间业务日结束后按日录入一次，均作为 USDT 留在 LP 合约。

自动 LP **必须由 keeper/操作员显式调用**。ERC-20 裸转账没有执行回调，智能合约也不能自行在每日零点发送交易；页面当前是人工钱包签名流程，平台定时执行仍需另接账本和服务。提取时实际 2% 手续费数由平台确认并转入，合约不会自行读取提现订单。

LP 执行要求 Pair 正确登记、LP 合约在代币中豁免手续费，并使用当次广播前读取的储备报价。报价保护不能代替独立预言机或全面的 MEV 保护。LP 不足配对时剩余 U 保留在合约，由后续任务继续处理。真实 Pair 的 USDT 储备达到 500,000 U 且另一侧储备/LP supply 已存在，SVX 合约才接受自动 LP 控制器开放交易的调用。50 万按 USDT 的实际代币小数精度换算。

LP 凭证默认为合约地址持有，owner 仍可用 `emergencyWithdrawLp` 转出，之后可撤出流动性。**本合约不锁仓，不得对外称 LP 已锁定。**

提现手续费 2% 过去只记在 `a_token_lp_pool_entries` 账本里。本方案把它落成真实资金动作：
**用户提现成功后，把该笔提现 2% 对应的 USDT 从提现出款钱包转入加 LP 合约，合约按 SVX/USDT 池当前储备比例自动配比并调用 DEX Router 加流动性。**

> 整体上线顺序：**先部署 SVX 代币 → 建 SVX/USDT 池 → 部署本加 LP 合约并注资 → 回填地址 → 开启交易**。
> 代币合约参数、建池与 `setPair`/`setTradingEnabled` 步骤见 [README-SVX-TOKEN.md](./README-SVX-TOKEN.md)。

## 1. 文件与职责

| 文件 | 作用 |
| --- | --- |
| `contracts/SolvexToken.sol` | SVX 平台币（10 亿固定总量、买入 0 / 卖出 5%、50% 销毁 / 50% 分红），见 [README-SVX-TOKEN.md](./README-SVX-TOKEN.md) |
| `contracts/SolvexAutoLp.sol` | 加 LP 合约：SVX 库存、USDT 入口、按储备配比、滑点/最小额保护、暂停、紧急提取、链上幂等 |
| `scripts/compile-contracts.js` | 已加入 `SolvexAutoLp` 编译目标，产出 `contracts/SolvexAutoLp.{bytecode,abi.json}` |
| `scripts/deploy-auto-lp.js` | 部署脚本（全部地址参数化，支持 `--dry-run`，本次未执行） |
| `test/auto-lp-contract.test.js` | 合约最小验证：solc 编译 + ABI/事件检查 + 禁止写死地址 |
| `src/a-token-lp-job-service.js` | 链下服务：按日累计、每日批量结算出任务、指令生成、回写、重试执行器 |
| `src/solvex-withdrawal-fees.js` | 提现创建时扣 2% 手续费；**放款成功后**才写入 LP 流水并累计到当日池，退款/冲销对应扣减 |
| `src/database.js` | 新增 `a_token_lp_fee_accruals`（累计事实）、`a_token_lp_daily_pools`（日/币种聚合池）、`a_token_lp_jobs.pool_date` |
| `src/a-token-admin-api.js` | 后台查询累计池 / 手动立即结算 / 指令 / 回写 / 取消 / 手动执行接口 |
| `scripts/lp-auto-ops.js` | 运维脚本：手动结算、列出指令、单笔/批量执行、外部广播后回写 |

## 2. 上线前必须填写的地址

| 配置项 | 说明 | 当前状态 |
| --- | --- | --- |
| `AUTO_LP_SVX_CONTRACT` | SVX 代币地址 | **缺失，等 SVX 上链部署后必填** |
| `AUTO_LP_USDT_CONTRACT` | USDT 地址 | 默认 BSC 主网 `0x55d398326f99059fF775485246999027B3197955` |
| `AUTO_LP_ROUTER` | DEX Router | 默认 PancakeSwap V2 `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| `AUTO_LP_PAIR_ADDRESS` | SVX/USDT 交易对地址 | **缺失**；部署时留空会向 `Router.factory().getPair()` 查询，仍查不到就需人工 `setPair` |
| `AUTO_LP_CONTRACT_ADDRESS` | 本合约部署地址 | 部署后回填，未填时任务照常入队但 `ready=false` |
| `AUTO_LP_OPERATOR` | 允许调用加池的地址（建议提现出款钱包） | 部署脚本默认取 `PLATFORM_WITHDRAWAL_ADDRESS` |
| `AUTO_LP_CONFIRMATIONS` | 执行等待确认数 | 默认 3 |
| `PLATFORM_AUTO_LP_ENABLE_EXECUTOR` | 是否让 server 内执行器自动广播 | 默认关闭，建议保持关闭，用 `scripts/lp-auto-ops.js` 执行 |

地址一律不写死、不编造：合约构造函数传入 SVX / USDT / Router / Pair，且 `setTokens` / `setRouter` / `setPair` 可替换。

## 3. 触发条件与调用顺序（按日累计 + 每日批量）

1. 用户发起提现：`wallet-service.requestWithdrawal` 只扣减用户余额（含 2% 手续费），**不再写 LP 流水、不产生加池任务**。
2. 提现被驳回 / 出款失败退款：退回余额；若该笔已被累计（仅可能发生在放款成功后），对应 accrual 置为 `reversed` 并扣减当日池，不出现负累计。
3. 提现确认成功放款（`status=paid`，自动出款或人工审核确认）后，才写入：
   - LP 流水 `a_token_lp_pool_entries`（仅记账用途）；
   - 累计事实 `a_token_lp_fee_accruals`（`withdrawal_id` 唯一，天然幂等）；
   - 当日聚合池 `a_token_lp_daily_pools (pool_date, asset)` 的 `units` 累加。
   写入失败只告警，绝不回滚或阻塞提现；之后可用同一提现单幂等补记（无需单独的补录按钮）。
4. 每日 **00:00（UTC+8）** 由 `a-token-lp-job-service` 扫描已关闭业务日（`pool_date < 今日`）且 `units > 0` 的池，
   合并成**一条**任务写入 `a_token_lp_jobs`：`idempotency_key = lp_daily:<date>:<asset>`，
   `withdrawal_id = daily:<date>:<asset>`，`pool_date/asset` 唯一；池置 `settled`，`units` 清零、`settledUnits` 记录已合并金额。
   - 配置：`AUTO_LP_SETTLE_ENABLED`（默认开）、`AUTO_LP_SETTLE_HOUR_UTC8`（默认 0）。
   - 平台其他每日结算窗口同样是 UTC+8 00:00，默认值一致，无时区冲突。
5. 运营方先调用 `depositSvx(amount)` 注入 SVX 库存（需先 `approve` 合约）。
6. 出款侧/运维脚本执行：
   - 给合约 `approve` 该笔 USDT；
   - 调用 `addLiquidity(usdtAmount, jobKey)`，`jobKey = keccak256(idempotencyKey)`；
   - 回写 `confirmed` + txHash + 事件里的 usdt/svx/LP/价格。
7. 对账：同一业务日 + 币种最多一条任务，`settledUnits` 合计应与当日 accrual 合计一致；每条 confirmed 任务都能在 BscScan 上按 txHash 找到对应 `LiquidityAdded`。

> SVX 提现当前不计 2% 手续费（`feeUnits=0`），因此 `asset=A` 的池通常为空；一旦手续费策略扩展到 SVX，会自动按币种独立累计、独立出任务，无需改代码。

## 4. 合约入口取舍

同时提供两个 USDT 入口：

- `addLiquidity(uint256 usdtAmount, bytes32 jobKey)`：**推荐**。用 `transferFrom` 从授权调用方拉取固定金额，金额明确、可审计，并由 `jobKey` 做链上幂等。
- `deposit(uint256 usdtAmount, bytes32 jobKey)`：兼容「USDT 已先转到合约」的场景，使用合约当前余额并退回多余部分。

**为什么没有让裸转账自动触发加池**：BSC 上的 USDT 是 BEP20，`transfer` 不会调用接收合约的 `receive()`/`fallback`，所以「U 一进来就自动加」在代币层面无法实现。若强行依赖 `receive()`，只会得到一个永远不会触发的死逻辑。因此：
- 合约保留 `receive()` 仅接收误转 BNB，不 revert，避免裸转账失败；
- 真正的自动加池由链下遵守「转 USDT + 调 addLiquidity」原子顺序完成；只转不调的 U 会留在合约，可用 `deposit()` 补加。

## 5. 参数与保护

| 参数 | 默认 | 作用 |
| --- | --- | --- |
| `slippageBps` | 100（1%） | 传给 Router 的最小成交额，以及 LP 数量的最小偏差校验 |
| `minAddUsdt` | `10^usdtDecimals`（1 USDT） | 单笔最少加池金额，挡粉尘 |
| `minLiquidity` | 1000 | 单笔最少 LP，挡粉尘/空池操纵 |
| `bootstrapSvxPerUsdt` | `10e18`（0.1 USDT/SVX） | 仅在池子储备为 0 的首次建池使用 |
| `deadlineSeconds` | 300 | Router deadline 窗口 |
| `paused` | false | 暂停所有加池入口，不影响提取 |

其他安全点：
- `ReentrancyGuard` 防重入；
- `SafeERC20` + `forceApprove` 兼容非标准 ERC20，Router 授权用完即清零；
- 余额与内部记账分离：`svxDeposited / totalSvxAdded / availableSvx()`，`rescueToken` 不能动未使用的 SVX 库存；
- 储备为 0 时只按 `bootstrapSvxPerUsdt` 兜底，一旦有储备就完全按实时储备比例；
- SVX 库存不足时按库存反算 USDT 用量并退回差额，不会强行制造失衡比例。

**紧急提取的边界**：`emergencyWithdrawLp` 只能转移本合约持有的 LP 凭证，`rescueToken` 只能提取误转代币；二者都不会调用 Router 的 `removeLiquidity`，因此不会把用户已入池的流动性抽走。

## 6. 失败重试与对账

任务状态：`pending → processing → sent → confirmed`，异常为 `failed`，取消为 `cancelled`。

- 链下重试：`failed` 任务在 `attempts < 5` 时下一轮会被重新领取；每次领取 `attempts + 1`。任务金额保留在任务上（不回池、不清账），重试使用同一 `jobKey`。
- 不重复加池：`(pool_date, asset)` 唯一 + `idempotency_key` 唯一，保证同一天同币种只会有一条任务；合约 `usedJobs[jobKey]` 再做链上兜底。即使上次交易已成功但回写丢失，重试会命中 `usedJobs=true` 并直接对账为 `confirmed`。
- 取消未上链任务：金额退回当日池（`units += job.units`，池重新 `open`），下次结算复用**同一任务行与同一 jobKey** 重新入队，金额不丢、不会重复加池。
- 已 `sent/confirmed` 的任务遇到手续费冲销：不改链上金额，记录 `payload.reversalOwedUnits` 并告警，进入人工核对。
- 对账 SQL 示例：
  ```sql
  -- 任务维度
  SELECT pool_date, asset, status, usdt_units FROM a_token_lp_jobs ORDER BY pool_date, asset;
  -- 日池维度：待加池 vs 已合并
  SELECT pool_date, asset, units, settled_units, status FROM a_token_lp_daily_pools ORDER BY pool_date DESC;
  -- 累计事实：正常 + 冲销
  SELECT pool_date, asset, status, SUM(CAST(units AS INTEGER)) FROM a_token_lp_fee_accruals GROUP BY 1,2,3;
  ```
  `settled_units` 应等于该日该币种 `accrued` 的 accrual 合计；链上侧按 `LiquidityAdded(jobKey, ...)` 事件逐笔核对 txHash、USDT/SVX 用量与 LP。
- 后台接口（需后台 operator session）：
  - `GET /api/admin/a-token/lp-pools?status=open|settled&limit=` → 待加池累计（按日期/币种）+ 任务统计 + accruals
  - `POST /api/admin/a-token/lp-pools/settle` → 手动立即结算 `{ date?, asset? }`（只允许已结束业务日）
  - `GET /api/admin/a-token/lp-jobs?status=&limit=`
  - `GET /api/admin/a-token/lp-jobs/instruction?id=lpjob_xxx | poolDate=YYYY-MM-DD&asset=USDT`
  - `POST /api/admin/a-token/lp-jobs/writeback`
  - `POST /api/admin/a-token/lp-jobs/cancel`
  - `POST /api/admin/a-token/lp-jobs/execute`（仅执行器开启时可用）

## 7. 上线前测试网清单（必须逐项验证）

1. 部署 SVX 测试代币与 USDT 测试代币，创建 PancakeSwap V2 测试交易对（或 fork 主网）。
2. `node scripts/compile-contracts.js` → 确认 `SolvexAutoLp.bytecode` 生成。
3. `node scripts/deploy-auto-lp.js --dry-run ...` 核对参数 → 正式部署到测试网。
4. `setOperator(出款钱包, true)`；非授权地址调用 `addLiquidity` 必须 revert。
5. `depositSvx` 注入库存；`previewAddLiquidity` 与真实成交的 USDT/SVX/LP 偏差在滑点内。
6. 首次建池（储备为 0）走 `bootstrapSvxPerUsdt`，价格符合预期（0.1 USDT/SVX）。
7. 库存不足场景：USDT 差额正确退回，池子比例不被破坏。
8. 低于 `minAddUsdt` / `minLiquidity` 必须 revert；`slippageBps` 被价格移动击穿必须 revert。
9. 同一 `jobKey` 重复调用第二次必须 revert，且只产生一笔 LP。
10. 暂停后 `addLiquidity`/`deposit` 必须失败；`rescueToken` 不能提取未使用 SVX 库存；`emergencyWithdrawLp` 后池内流动性不变。
11. 链下：提现成功 → 当日池累计增加（无单笔任务）；次日 00:00 结算出 1 条日任务；驳回/退款 → 累计扣减或冲销；执行 → `confirmed` 且 txHash 可在浏览器查到。
12. 断网/超时重试：模拟广播成功但回写失败，确认重试不会重复加池；同日重复结算只出一次任务。
13. 小额真实资金演练（如 10 USDT 提现 → 0.2 USDT 累计 → 次日批量 1 笔加池），核对事件与账本。

## 8. 当前测试现状

仓库没有 Hardhat / Foundry / Ganache，`package.json` 只内置 `solc`。因此：

- `test/auto-lp-contract.test.js` 用真实 solc 编译 + ABI/事件断言 + 源码地址检查，作为**最小可运行验证**；
- `test/a-token-lp-job.test.js` 覆盖按日累计：多笔汇总成一次、同日重复结算幂等、跨日不串账、失败重试不丢金额、冲销扣减、取消回池复用同一 jobKey、SVX/USDT 分开累计、重启恢复；
- `test/solvex-withdrawal.test.js` 覆盖提现手续费扣除、放款成功才累计、累计失败不影响提现、退款不产生 LP 记录；
- 合约运行时行为（加池、滑点、重入、暂停）需要在测试网按第 7 节清单人工验证。若后续引入 Hardhat，可直接复用本合约与部署脚本参数。
