# SVX 平台币合约与部署说明（SolvexToken）

> 本文只讲「SVX 代币本体」：源码、参数、部署顺序、上线前测试清单、链下需要同步的硬编码位置。
> 加 LP 合约见 [README-AUTO-LP.md](./README-AUTO-LP.md)。

## 新部署流程（2026-11-12）

使用 `node scripts/build-svx-wallet-deploy.mjs` 构建钱包页面，再运行
`node scripts/serve-svx-wallet-deploy.mjs`，浏览器打开 `http://127.0.0.1:8787`。
页面用浏览器钱包分别签名部署代币和自动 LP；需要先预测 LP 地址，将其在代币构造时作为不可变开盘控制器绑定。
页面不读取、存储或输出钱包私钥。分红地址由部署者输入。

代币固定发行 10 亿枚，买入税 0%、卖出税 5%；交易税功能不能关闭，税率只能保持 0/500 bps。
税款仍按构造/配置的比例销毁并转到分红钱包，LP 合约拥有固定的交易对、USDT 与 Router 地址。
LP 合约登记为 pair 并豁免手续费之后，用 `depositSvx` 注入 SVX 库存。
只有真实交易对的 USDT 储备达到 500,000 USDT，且已有配对储备和 LP supply，LP 控制器才能开放交易。

`openTrading` 只能由绑定的 LP 控制器在流动性达标后执行；owner 不能直接打开或关闭交易。
关闭反机器人检查同样受 500,000 USDT 真实储备限制。部署前必须正确预测控制器地址，因为它是 immutable。
任何 owner 可调用的 LP 提取函数不等于锁池；owner 可以将 LP 凭证取走并撤流动性。

## 1. 与既有合约的关系

| 文件 | 用途 | 状态 |
| --- | --- | --- |
| `contracts/A.sol` | 旧版 SVX：固定 10 亿、无税、无 mint、`emergencyWithdraw` | **未修改**。并行会话仍在改动，避免覆盖 |
| `contracts/SolvexToken.sol` | SVX 固定发行 10 亿，买入 0%、卖出 5%；固定绑定自动 LP 合约作为开盘控制器 | 本文件说明对象 |
| `contracts/SolvexAutoLp.sol` | 盲盒款及每日提现手续费组 LP，真实池内 USDT 储备达到 50 万后开盘 | 见 README-AUTO-LP.md |

两版代币的 `name / symbol / decimals / 总量` 完全一致（`Solvex / SVX / 18 / 1,000,000,000`），区别只在于新版带交易税与限额开关。因此链下代码无需为「换新版」改任何代币元数据；只需把新合约地址回填到 `A_TOKEN_CONTRACT_ADDRESS` 与 `AUTO_LP_SVX_CONTRACT`。

> 说明：链下的「甲区 / 乙区」是**账本分区**，不是链上概念。`乙区买的币留在乙区` 由交易服务与账本处理，代币合约只认地址与数量，不参与分区。本次没有改这条链路。

## 2. 代币参数

| 项目 | 值 | 备注 |
| --- | --- | --- |
| 名称 / 符号 | `Solvex` / `SVX` | 与链下展示一致 |
| 精度 | 18 | 与 `A_TOKEN_DECIMALS = 18` 对齐 |
| 总量 | `1_000_000_000 * 10 ** 18` | `MAX_SUPPLY` 为 constant，**无 mint 函数，不可增发** |
| 初始分配 | 部署时一次性 `_mint(initialOwner, MAX_SUPPLY)` | 全部给 `initialOwner`，无预留、无锁仓逻辑 |
| 销毁 | `ERC20Burnable`：任何人可 `burn` / `burnFrom` 自己的币 | 与交易税里的销毁是两条独立路径 |
| Permit | EIP-2612 `ERC20Permit("Solvex")` | 支持链下签名授权 |
| 重入防护 | `ReentrancyGuard` | 用于 `rescueToken` / `rescueNative` |

### 2.1 买入 0 / 卖出 5% 手续费

- 只在 `isAMMPair[from]`（买入）或 `isAMMPair[to]`（卖出）时收税，税率分别由 `buyTaxBps`、`sellTaxBps` 控制：**买入默认 `0`（不收税）、卖出默认 `500`（5%）**，与内盘「买入 0 / 卖出 5%」口径一致。
- 钱包 ↔ 钱包普通转账、合约发放、Owner 调仓**不收税**。
- 手续费拆分：`burnShareBps`（默认 `5000` = 50%）销毁，剩余进 `dividendWallet`。两个比例、两个接收地址都可改。
- 销毁方式二选一：
  - `burnToDead = true`（默认）：把销毁份额转到 `burnWallet`（默认 `0x…dEaD`），链上可见、不可恢复；
  - `burnToDead = false`：合约内 `_burn`，直接减少 `totalSupply`。
- 代币在收费时先转到合约自身，再立即分发，**转账过程中没有任何外部合约调用、没有循环**；`FeeApplied` 事件记录净额、税额、销毁额、分红额。

### 2.2 豁免与限额

- 默认豁免：`address(this)`、构造时传入的 `router`、`initialOwner`。
- 交易对**不能整体豁免**，否则买卖税失效。因此建池/撤池免税的做法是：**用 Owner 地址操作**（`initialOwner` 已豁免），而不是豁免 Pair。Pair 只作为「买入/卖出」方向的识别标志，通过 `setPair(pair, true)` 登记。
- `maxTxAmount` / `maxWalletAmount` 默认 `0` = 不限制。开启方式：`setLimits(maxTx, maxWallet)`，参数是**代币最小单位**（人类可读数量 × `10^18`）。建议 `maxTx <= maxWallet`，且钱包上限在买入方向生效。
- 防机器人：`antiBotEnabled = true` + `tradingEnabled = false`（默认）。此时只有豁免地址可转账，用来防止开盘前被脚本抢先。建池、加 LP 完成后调用 `setTradingEnabled(true)` 开放交易；不想用可 `setAntiBotEnabled(false)` 关闭这层拦截。

## 3. 部署顺序（必须按顺序）

```
① 部署 SolvexToken（先拿币地址）
      ↓
② 用 Owner 地址在 PancakeSwap V2 建 SVX/USDT 池并加初始流动性（Owner 免手续费）
      ↓
③ 部署 SolvexAutoLp（传入第 ① 步的 SVX 地址与 USDT），depositSvx 注入 SVX 库存
      ↓
④ 回填地址：SVX 地址 → setPair(pair,true) / .env；加 LP 合约地址 → .env
      ↓
⑤ setTradingEnabled(true) 开放交易（确认池子与加 LP 都就绪后再开）
```

> 顺序不能反：先建池后 `setPair`，否则买卖税无法识别；先注资后开盘，否则前几笔加池会按 `bootstrapSvxPerUsdt` 兜底价成交。

### 3.1 第 ① 步：编译与部署代币

```bash
cd resources/app
node scripts/compile-contracts.js          # 产出 contracts/SolvexToken.{bytecode,abi.json}
node scripts/deploy-solvex-token.js --dry-run   # 只打印构造参数与后续步骤，不广播
node scripts/deploy-solvex-token.js             # 正式部署（需 DEPLOYER_PRIVATE_KEY + BNB gas）
```

部署脚本必需参数（也可用命令行参数）：

| 环境变量 | 必填 | 说明 |
| --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY` | 是 | 部署钱包私钥，只从环境读取，脚本不落盘、不打印 |
| `BSC_RPC_URL` | 否 | 默认 `https://bsc-dataseed.binance.org` |
| `SVX_DIVIDEND_WALLET` | **是** | 手续费 50% 分红收款地址 |
| `SVX_OWNER` | 否 | Owner + 10 亿代币接收地址，默认部署钱包 |
| `SVX_BURN_WALLET` | 否 | 销毁份额接收地址，默认 `0x…dEaD` |
| `SVX_ROUTER` | 否 | 默认 PancakeSwap V2 `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| `SVX_PAIR` | 否 | 未建池时留空，部署后 `setPair` |

可选参数：`--dividend`、`--owner`、`--router`、`--pair`、`--burn-wallet`、`--buy-tax-bps`、`--sell-tax-bps`、`--burn-share-bps`、`--trading-enabled`、`--burn-by-burn`、`--max-tx`、`--max-wallet`。

`--dry-run` 会输出构造参数 `(owner, dividend, burnWallet, router, pair)` 与部署后需要额外调用的 setter，不广播任何交易。

### 3.2 第 ② 步：建池

- 网络：BNB Smart Chain 主网（Chain ID 56）。
- 用 **Owner 地址**（构造时的 `initialOwner`）在 PancakeSwap V2 建 `SVX / USDT` 交易对并注入初始流动性。
- 初始价格按经济模型：**0.1 USDT / SVX**。例如注入 `1,000,000 SVX + 100,000 USDT`。
- 建池后从 Router/Factory 或 Pancake 页面拿到 Pair 地址，记为 `PAIR`。

### 3.3 第 ③ 步：部署加 LP 合约

按 [README-AUTO-LP.md](./README-AUTO-LP.md) 执行，注意 `AUTO_LP_SVX_CONTRACT` 填第 ① 步地址，`AUTO_LP_PAIR_ADDRESS` 填第 ② 步 Pair。

### 3.4 第 ④ 步：回填地址

```env
# SVX 代币（链上提现 / 加 LP 都读它）
A_TOKEN_CONTRACT_ADDRESS=0x第①步的SVX地址
AUTO_LP_SVX_CONTRACT=0x第①步的SVX地址
# 加 LP 合约
AUTO_LP_CONTRACT_ADDRESS=0x第③步的加LP合约地址
# 交易对（用于加 LP 合约）
AUTO_LP_PAIR_ADDRESS=0x第②步的Pair地址
```

链上还需要调用：

```solidity
// Owner 调用，登记交易对，买卖税才会生效
token.setPair(PAIR, true);
// 确认池子与加 LP 都就绪后，开放交易
token.setTradingEnabled(true);
```

### 3.5 第 ⑤ 步：Bscscan 开源

Solidity 单文件、`0.8.20`、optimization `200 runs`，构造函数参数为 `(owner, dividendWallet, burnWallet, router, pair)`。

## 4. 参数与开启方式速查

| 参数 | 默认 | 修改函数 | 说明 |
| --- | --- | --- | --- |
| `buyTaxBps` | **0** | `setTaxRates` | 买入税（默认 0），上限 2000（20%） |
| `sellTaxBps` | 500 | `setTaxRates` | 卖出税，上限 2000（20%） |
| `burnShareBps` | 5000 | `setTaxRates` | 手续费销毁占比，其余进分红 |
| `dividendWallet` | 构造参数 | `setDividendWallet` | 分红收款地址 |
| `burnWallet` | 构造参数 | `setBurnWallet` | `burnToDead=true` 时的销毁接收地址 |
| `burnToDead` | true | `setBurnToDead` | false = 合约内 `_burn` |
| `feeEnabled` | true | `setFeeEnabled` | 总开关，false 时全免税 |
| `tradingEnabled` | **false** | `setTradingEnabled` | 防机器人闸门，上线后置 true |
| `antiBotEnabled` | true | `setAntiBotEnabled` | false 时不再按 tradingEnabled 拦截 |
| `maxTxAmount` | 0（关闭） | `setLimits` | 单笔上限，代币最小单位 |
| `maxWalletAmount` | 0（关闭） | `setLimits` | 钱包上限，代币最小单位 |
| `isExempt` | 合约/Router/Owner | `setExempt` | 手续费与限额豁免 |
| `isAMMPair` | 构造 Pair 或空 | `setPair` | 买卖方向识别 |

## 5. 安全取舍说明（与需求默认值不同或需要解释的地方）

1. **不预留增发接口**：`MAX_SUPPLY` 为 constant，合约没有 `mint`。总量恒定，销毁只会减少流通量。这是最安全、最容易审计的选择，也省掉「增发开关被滥用」的解释成本。
2. **`tradingEnabled` 默认关闭**：这是防机器人开盘的常用做法。代价是部署后到 `setTradingEnabled(true)` 之前的普通转账会被拦。若不想有这段时间，可在部署脚本加 `--trading-enabled true`，但更建议建池后手动开。
3. **交易对不豁免、Owner 豁免**：让「Pair 参与买卖识别」与「建池/撤池免税」同时成立。撤池务必用 Owner 地址，否则会被当卖出收 5%。
4. **销毁默认走死地址**：链上留痕、可在 BscScan 看到，便于对账与对外说明；想减少 `totalSupply` 再切 `setBurnToDead(false)`。
5. **手续费在合约内即时分发**：没有「累积到阈值再 swap」的复杂逻辑，避免转账里做外部调用与滑点风险。代价是分红钱包收到的是 SVX 而不是 USDT，如需自动换 U 应在链下或独立合约处理。
6. **上限默认关闭**：10 亿总量、卖出 5% 税率下，过早开钱包上限容易误伤正常用户；需要时再 `setLimits`。
7. **`rescueToken` 禁止提取 SVX**：防止 Owner 借救援名义拿走误转到合约的代币税；只允许救援其他 ERC20 / BNB。

## 6. 上线前测试清单（BSC 测试网或主网小额）

1. `node scripts/compile-contracts.js` 无警告，生成 `SolvexToken.{bytecode,abi.json}`。
2. `node scripts/deploy-solvex-token.js --dry-run` 输出的 5 个构造参数与预期一致。
3. 部署后校验：`name()` = `Solvex`、`symbol()` = `SVX`、`decimals()` = `18`、`totalSupply()` = `1000000000e18`、`owner()` = 预期地址。
4. 用 Owner 建 `SVX/USDT` 池（0.1 USDT/SVX），确认 Owner 建池未被收税。
5. `setPair(PAIR, true)` 后：
   - 从 Pair 买入 1000 SVX，实际到账 **1000 SVX**，不触发 `FeeApplied`（买入税 0）；
   - 卖出 1000 SVX，`approve` 后成交，扣 5%（fee=50）：25 进销毁地址、25 进分红地址。
6. 钱包 ↔ 钱包普通转账不扣税、不触发 `FeeApplied`。
7. `feeEnabled=false` 后卖出也不再扣税；重新开启恢复（买入始终为 0）。
8. `setLimits` 设一个较小值，超过的单笔/钱包余额必须 revert；清零后恢复。
9. 未 `setTradingEnabled(true)` 时，非豁免地址转账必须 revert；开启后正常。
10. `burn(amount)` 后 `totalSupply` 减少，其余账本不受影响。
11. 同一笔交易重复调用 `setTaxRates`/`setLimits` 只有 Owner 能成功，非 Owner 必须 revert。
12. 全链路：部署 → 建池 → 加 LP 合约注资 → 提现触发 2% 加 LP，确认 `LiquidityAdded` 的 SVX 来自加 LP 合约库存，且代币税未对 Owner 加池动作收费。

## 7. 当前测试现状

仓库没有 Hardhat / Foundry，只有内置 `solc`。因此：

- `test/solvex-token-contract.test.js`：真实 solc 编译 + ABI/事件断言 + 固定总量/税率常量 + 源码地址检查，作为最小可运行验证；
- 运行时行为（买卖税、拆分、限额、暂停、豁免）需按第 6 节在测试网人工验证；
- 若后续引入 Hardhat，可直接复用本合约与部署脚本参数。

```bash
cd resources/app
node test/solvex-token-contract.test.js
```

## 8. 链下硬编码清单（只列位置，本次未改）

> 以下为「代币名称 / 符号 / 精度 / 初始价 / 合约地址」相关的硬编码或映射位置。换新版合约**不需要**改这些，因为元数据保持一致；只有在改名、改精度、改初始价时才需要同步。

### 8.1 精度（decimals）

| 位置 | 内容 | 需同步时机 |
| --- | --- | --- |
| `src/a-token-service.js:7` | `export const A_TOKEN_DECIMALS = 18;` | 改精度时（与合约 `decimals()` 必须一致） |
| `src/a-token-service.js:8` | `export const USDT_DECIMALS = 6;` | USDT 换链/换币时 |
| `src/a-token-api.js:5` | `const A_TOKEN_DECIMALS = 18;` | 改精度时 |
| `src/a-token-team-service.js:7` | `const USDT_DECIMALS = 6;` | USDT 精度变化时 |
| `src/ai-managed-service.js:19` | `const USDT_DECIMALS = 6;` | 同上 |
| `src/agent-service.js:3` | `const USDT_DECIMALS = 6;` | 同上 |
| `src/referral-service.js:4` | `const USDT_DECIMALS = 6;` | 同上 |
| `scripts/verify-realtime-sync.mjs:10-16` | 引用 `A_TOKEN_DECIMALS` 做单位换算 | 改精度时 |

### 8.2 总量 / 初始价 / 销毁参数

| 位置 | 内容 | 说明 |
| --- | --- | --- |
| `src/a-token-service.js:10` | `TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n` | 与合约总量一致 |
| `src/a-token-service.js:11` | `BURN_CAP = 100_000_000n * 10n ** 18n` | 链下销毁上限，合约不强制 |
| `src/a-token-service.js:18` | `DEFAULT_PRICE_USDT = '0.1'` | 初始价 0.1 USDT/SVX |
| `src/a-token-kline-service.js:254` | 兜底 `aTokenService.setPrice('0.1')` | K 线回填价格 |
| `src/a-token-kline-service.js:345` | 回退设价 `'0.1'` | 同上 |
| `src/a-token-blindbox-service.js:30` | `BLINDBOX_COIN_PRICE_USDT = '0.1'` | 盲盒按 0.1 计价 |

### 8.3 符号 / 名称 / 内部代号映射

| 位置 | 内容 | 说明 |
| --- | --- | --- |
| `public/js/assets.js:2-8` | 内部代号 `'A'` → 显示 `'SVX'`，名称 `Solvex 平台原生代币` | 资产页显示映射 |
| `public/js/funds-admin.js:86,114,153` | `item.asset === 'A' ? 'SVX' : item.asset` | 资金后台显示映射 |
| `public/funds-admin.html:39` | `<option value="A">SVX</option>` | 后台资产下拉 |
| `src/platform-service.js:808` | 资金流水中 `symbol: 'SVX'` | 交易流水展示 |
| `public/js/a-token-trade.js` | `SVX / USDT`、`SVX交易`、4 位小数价格显示 | 交易页文案与价格精度 |
| `public/js/i18n-zh-en.js:1648` | 文案说明「前端 UI 统一以 SVX 显示」 | 多语言说明 |
| `public/infographic.html` / `public/admin.html` / `public/mall*.html` | 品牌与 SVX 文案 | 纯展示，不影响链上 |

### 8.4 合约地址与热钱包环境变量

| 位置 | 变量 | 说明 |
| --- | --- | --- |
| `.env.example:151` | `A_TOKEN_CONTRACT_ADDRESS=` | SVX 合约地址，部署后回填 |
| `.env.example:153-155` | `A_TOKEN_HOT_WALLET` / `A_TOKEN_HOT_PRIVATE_KEY` | 链上提现热钱包 |
| `src/a-token-withdrawal-service.js:38-41` | 注释与校验提示 | 依赖上述三个变量 |
| `src/config.js:119` | `svxContract: AUTO_LP_SVX_CONTRACT || A_TOKEN_CONTRACT_ADDRESS` | 加 LP 合约读取 SVX 地址的兜底顺序 |
| `src/config.js:106` | BSC 网络 `tokenContract` 默认 USDT `0x55d5…7955`、`tokenDecimals:18` | 链上 USDT 配置 |

> 说明：上述 `src/a-token-*.js` 等经济模型相关文件正由并行会话修改，本次**只列清单、不做修改**。
