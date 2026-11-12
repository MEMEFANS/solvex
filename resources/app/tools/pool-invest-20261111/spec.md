# 矿池页投入入口改造：卡片内「投入矿池」+ 数量弹窗

日期：2026-11-11　范围：`resources/app/frontend/src`（React 前端）+ 前端构建产物
约束：不改后端；不提交 git、不部署；验证不得产生真实矿池订单。

---

## 1. 现状（已核实）

| 项 | 事实 | 位置 |
|---|---|---|
| 现入口 | 右栏 Card「开通矿池」内嵌 `ResponsiveAmountForm`（桌面内联表单，手机底部 Sheet） | [pool.tsx](file:///c:/Users/Administrator/Desktop/AXIX-副本-20261109/resources/app/frontend/src/pages/pool.tsx#L89) |
| 空态入口 | 「我的矿池」空态里还有一颗「开通矿池」按钮 | pool.tsx `openPool()` / `.rx-pool-empty` |
| 访客引导 | `.rx-getting-started` 第 03 步文案为「开通矿池」 | pool.tsx |
| 投入接口 | `POST /api/a-token/nodes/open`，body `{ coins }`，前端经 `postOnce('a-token/nodes/open', { coins }, 'pool')` 调用（带幂等键） | [amount-form.tsx](file:///c:/Users/Administrator/Desktop/AXIX-副本-20261109/resources/app/frontend/src/components/amount-form.tsx#L43-L45) |
| 报价接口 | `GET /api/a-token/nodes/quote?coins=` → `{ coins, interest, payout, ratePct, days, minCoins }` | amount-form.tsx:22 |
| 档位来源 | `profile.nodeTerm || plans.nodes` → `days / minCoins / midCoins / highCoins / lowRatePct / midRatePct / highRatePct` | pool.tsx:12-18 |
| 规则 | 30 天；1000–1999：25%，2000–9999：45%，10000+：55%；从甲区扣币 | `shared/solvex-rules.js`、`src/a-token-node-service.js` |
| 余额 | `profile.zones.alpha`（最小单位字符串） | amount-form.tsx:20 |
| 刷新 | 成功后 invalidate 除 `plans` 外的全部 query + `window.Portal?.invalidate()` | common.tsx:39-40 |
| 其它页面 | `ResponsiveAmountForm` 仍被 energy（earn.tsx）与 team 页使用，不能删组件 | earn.tsx:24、team.tsx:50 |

后端校验：`coins <= 0` →「矿池币数必须大于 0」；`coins < 1000` →「矿池最少 1000 币」；余额不足由甲区扣款抛错。接口接受小数，但产品本次要求整数交互。

---

## 2. 目标交互

1. 删除右栏「开通矿池」Card 及其说明，不留空位；矿池区改为整行单列。
2. 三张 `.rx-tier` 卡片底部各加一颗「投入矿池」按钮：
   - 桌面：卡片内容底部，宽度 100%，高 40px；银矿（当前高亮档）用主按钮，其余描边按钮。
   - 手机：整行铺满，最小高度 42px。
3. 点击：
   - 未登录/未连钱包 → 直接 `connectWallet()`（与 Hero 一致），不打开弹窗、不报错。
   - 已登录 → 打开数量弹窗，并把被点击的档位传进去。
4. 弹窗内容（桌面居中，手机内边距收紧）：
   - 标题「投入铜矿 / 银矿 / 金矿」，副标题说明从甲区扣币、周期到期。
   - 档位信息：矿种、周期天数、收益率。
   - 甲区可用余额。
   - 数量输入框 +「全部」按钮；`inputMode="numeric"`。
   - 档位区间：`1000 – 1999 SVX`（上限不含）或金矿 `10000 SVX 起`。
   - 实时预估：本金、预计利息、到期可领取总额（本金+收益）。
   - 校验提示（按钮置灰 + 明确原因）。
   - 取消 / 确认投入；提交中显示「提交中…」。
   - 提交失败在弹窗内红字显示后端 `error` 原文；成功后 toast + 关闭 + 刷新余额/持仓。

---

## 3. 校验规则（整数口径）

输入统一 `trim()` 后判断，按顺序命中第一条：

| 条件 | 提示文案 | 确认按钮 |
|---|---|---|
| 空 | 请输入投入数量 | 置灰 |
| 非纯数字（含小数、负号、字母、科学计数） | 请输入整数数量，不支持小数 | 置灰 |
| `< minCoins`（含 0、`999`） | 低于起投数量，最少 1,000 SVX | 置灰 |
| 余额未同步完成 | 正在同步甲区余额，请稍候 | 置灰 |
| 余额同步失败 | 余额同步失败，请稍后重试 | 置灰 |
| 数量 > 甲区余额 | 超过甲区可用余额 1,234.5678 SVX | 置灰 |
| 通过 | 绿色提示「数量已通过起投与余额校验」 | 可用 |

说明：
- 「整数」是本次产品要求（后端虽支持 18 位小数）；0 归入「低于起投」，不单独造规则。
- **不设前端档位上限**：后端对高档无上限，前端只在卡片上展示接口给出的档位区间，输入超过当前卡片区间时按接口边界自动切换实际档位与收益率，不拦截、不编造最大值。
- 校验只提示最靠前的一条；未连钱包在点击入口时即转为连接引导，不进入弹窗。
- 「全部」填充 `Math.floor(甲区余额)`，余额不足 1 时填 `0` 并由起投校验提示原因。

预估算法（不依赖接口，输入合法即实时刷新）：
`coinsUnits = toUnits(raw)`；按接口返回的 `midCoins/highCoins` 边界选出 `lowRatePct/midRatePct/highRatePct`；`interestUnits = coinsUnits * BigInt(Math.round(ratePct*100)) / 10000n`；总额 = 本金 + 利息，用 `formatUnits` 展示；若 quote 已返回且数量一致，则优先显示后端 `payout` 与 `ratePct`。

---

## 4. 文件级改动

### 4.1 新增 `frontend/src/components/pool-invest-dialog.tsx`

```tsx
type Tier = { title: string; min: string; max?: string; rate: number };
type Props = { tier: Tier | null; days: number; open: boolean; onOpenChange: (open: boolean) => void };
export function PoolInvestDialog({ tier, days, open, onOpenChange }: Props)
```

- 内部使用 `useProfile()`、`useWallet()`、`useQueryClient()`。
- state：`amount`、`debounced`（300ms）、`busy`、`submitError`；`useEffect` 在 `open` / `tier.title` 变化时重置。
- quote query：`['quote', address, revision, debounced]`，`enabled: open && 整数 && >0`，`retry:false`。
- `submit()`：
  1. `preparingRef` 防重入；
  2. 重新 `api('a-token/nodes/quote?coins='+raw)`（沿用现有逻辑，提交前校验档位）；
  3. `walletIdentity()` 前后比对，变化则中止；
  4. `postOnce('a-token/nodes/open', { coins: raw }, 'pool')`；
  5. `toast.success('已投入 ' + raw + ' SVX 到' + tier.title)`；
  6. `invalidateQueries({ predicate: q => q.queryKey[0] !== 'plans' })` + `window.Portal?.invalidate()`；
  7. 关闭弹窗；catch 把 `error.message` 写入 `submitError` 并在弹窗内展示。
- 使用现有 `Dialog / DialogContent / DialogTitle / DialogDescription`、`Input`、`Button`。
- 根节点 class：`rx-invest-dialog`；内部类：`rx-invest-facts / rx-invest-balance / rx-invest-range / rx-invest-estimate / rx-invest-hint / rx-invest-error / rx-invest-actions`。

### 4.2 修改 `frontend/src/pages/pool.tsx`

- 删除 `import { ResponsiveAmountForm }`。
- 删除 `openPool()`。
- 删除整块 `<Card className="rx-open-pool">…</Card>`。
- 新增 `const [invest, setInvest] = useState<Tier | null>(null);`
- `.rx-tier` 内 `<small>` 后追加：

```tsx
<Button className="rx-tier-invest" variant={i === 1 ? 'default' : 'outline'} onClick={() => investTier(t)}>
  投入矿池 <ArrowUpRight />
</Button>
```

- `investTier(t)`：未登录 `connectWallet()`；已登录 `setInvest(t)`。
- 页面末尾渲染 `<PoolInvestDialog tier={invest} days={term?.days || 0} open={Boolean(invest)} onOpenChange={o => !o && setInvest(null)} />`。
- 空态 `.rx-pool-empty`：删除「开通矿池」按钮，文案改为「买入 SVX 到甲区后，在下方选择矿池卡片投入。」，保留「买入 SVX」按钮。
- `.rx-getting-started` 第 03 步文案改为 `投入矿池 / 在矿池卡片中选择数量`。
- 其余持仓、指标、Hero 不动。

### 4.3 修改 CSS（`ui-refinement.css` 为主，`styles.css`、`brand-theme.css` 同步清理）

- `.rx-pool-workspace` 全部断点改为单列：`grid-template-columns:minmax(0,1fr)`；删除 1600/1200/1600px 下 `340px/350px/310px` 的第二列定义。
- 删除 `.rx-open-pool`、`.rx-open-connect`、`.rx-open-pool .rx-amount-form`、`.rx-open-pool .rx-form-balance`、`.rx-open-pool .rx-form-trust`、`.rx-open-pool .rx-quote` 等死样式（三份 CSS 中均清理）。
- 新增 `.rx-tier-invest { width:100%; margin-top:16px; min-height:40px; }`。
- 弹窗桌面：`.rx-invest-dialog { max-height:calc(100dvh - 48px); overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; }`，内部 `overflow-wrap:anywhere`。
- 弹窗手机 `@media(max-width:600px)`：
  - `.rx-invest-dialog { width:calc(100% - 24px); max-height:calc(100dvh - 24px); padding:20px 16px; border-radius:20px; }`
  - 信息区纵向排列（`grid-template-columns:1fr` 或 flex column），字号 12–13px，行高 1.5。
  - 操作按钮各 46px，整行等宽。
  - 预估区三段纵向对齐，数值右对齐，不出现横向滚动。
  - `.rx-tier-invest { min-height:42px; margin-top:7px; }`，移动端 `.rx-tier` 的 grid 改为 `"icon title period" / "rate rate label" / "min min min" / "action action action"`：收益率与「周期总利息」同排，起投与档位说明同一行左右分列，按钮独占一行；首张卡内容（含按钮）保持在 375×667 首屏、底栏之上。

### 4.4 `frontend/index.html`

viewport 增加 `interactive-widget=resizes-content`，保证移动端键盘弹出时 `dvh` 随内容区收缩，弹窗内可滚动、不被顶出屏幕。构建会把该文件复制为 `public/index.html`。

### 4.5 不改

- 后端 `src/a-token-api.js` / `a-token-node-service.js`。
- `amount-form.tsx`、`responsive-amount-form.tsx`（energy / team 仍在用）。
- 矿池 Hero、指标、持仓列表。

---

## 5. 验证

1. `npm run typecheck`（前端 TS）。
2. `npm run build:frontend`，确认 `public/index.html` 引用新 hash。
3. 本地 8080 已在跑则直接用；否则 `npm run preview:ui`。
4. Puppeteer 脚本（临时目录，不入库）：
   - `evaluateOnNewDocument` 注入假钱包 `window.currentWalletConnection.authenticated/profile`，并拦截所有 `/api/a-token/*`：
     - `profile` 返回甲区余额 `12345.6789 SVX`、空 nodes；
     - `plans`/`nodeTerm` 返回 30 天、1000/2000/10000、25/45/55；
     - `quote` 按输入返回对应档位；
     - `nodes/open` 用 **request interception fulfill** 模拟 200/400，绝不落到真实后端。
   - 375×667、390×844：
     - 首屏可见「选择你的矿池」+ 第一张卡完整内容 + 按钮；
     - 点「投入矿池」弹窗完整可见，`document.documentElement.scrollWidth === clientWidth`，弹窗 `scrollWidth <= clientWidth`；
     - 依次输入空、`abc`、`0`、`999`、`2000`（铜矿卡）、`999999`、`1500`，断言提示文案与按钮 disabled 状态；
     - 点「全部」断言填充值；
     - 弹窗内滚动容器 `scrollHeight > clientHeight` 时仍可滚到底部按钮；
     - 再把视口压到 375×420 模拟键盘，断言弹窗底部按钮可通过内部滚动到达。
   - 1440×900：弹窗居中（左右留白近似相等），卡片按钮不破坏三列布局。
   - 访客态（不注入登录）：点「投入矿池」断言打开钱包连接入口、未出现 `.rx-invest-dialog`、无错误 toast。
   - 成功/失败路径：mock 200 → toast 成功 + 弹窗关闭；mock 400 `{error:'甲区余额不足'}` → 弹窗内出现该原文。
5. 不调用真实 `/api/a-token/nodes/open`，不产生订单；验证后确认后端无新增 node 记录。

---

## 6. 验收清单

- [ ] 「开通矿池」入口、说明、右栏空位全部消失，页面单列无空洞。
- [ ] 每张矿卡都有「投入矿池」，手机整行、≥42px；桌面底部对齐。
- [ ] 弹窗含矿种/周期/收益率、余额、区间、输入+全部、实时预估、校验原因、取消/确认。
- [ ] 提交走 `a-token/nodes/open`，成功刷新余额与持仓，失败显示后端原因。
- [ ] 未登录点击只给连接引导。
- [ ] 375/390/1440 无横向溢出、无裁切、弹窗完整可达。

## 7. 待批准

以上方案需用户确认后再实施；批准后按 `tasks.md` 顺序执行，并在完成后按「删了什么 / 按钮加在哪 / 调哪个接口 / 校验规则 / 实测结果」汇报。
