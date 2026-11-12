# 任务清单：矿池页投入入口改造

对应 spec：`resources/app/tools/pool-invest-20261111/spec.md`
执行前：确认 `git status` 中 `frontend/src/pages/pool.tsx`、`ui-refinement.css` 未被并行会话正在修改。

## 1. 删除旧入口

- [ ] `pages/pool.tsx`：移除 `ResponsiveAmountForm` import 与 `openPool()`。
- [ ] 删除右栏 `<Card className="rx-open-pool">…</Card>` 整块。
- [ ] `.rx-pool-empty` 删除「开通矿池」按钮，改为引导文案 + 保留「买入 SVX」。
- [ ] `.rx-getting-started` 第 03 步改为「投入矿池 / 在矿池卡片中选择数量」。
- [ ] 三份 CSS 清理 `.rx-open-pool*` 死样式；`.rx-pool-workspace` 全部断点改为单列。

## 2. 卡片按钮

- [ ] `pool.tsx` 增加 `invest` state 与 `investTier()`（未登录 → `connectWallet()`）。
- [ ] 每张 `.rx-tier` 底部加「投入矿池」按钮，标记 `className="rx-tier-invest"`。
- [ ] CSS：桌面 100% 宽 / 40px；手机 `grid-area:action`、42px、整行。

## 3. 数量弹窗

- [ ] 新建 `components/pool-invest-dialog.tsx`：档位信息、余额、输入、全部、区间、预估、校验、取消/确认。
- [ ] 整数校验与档位区间（上限不含）按 spec 第 3 节实现。
- [ ] 实时预估用 BigInt 计算，quote 命中时优先显示后端 payout。
- [ ] 提交：重新 quote → `postOnce('a-token/nodes/open', { coins }, 'pool')` → toast 成功 → invalidate（除 plans）+ `Portal.invalidate()` → 关闭；失败原文入弹窗。
- [ ] `pool.tsx` 挂载 `<PoolInvestDialog />`。
- [ ] CSS：桌面居中、`max-height:calc(100dvh - 48px)`、内部纵向滚动、`overflow-x:hidden`；手机 375/390 全宽留 12px、按钮 44px。
- [ ] `frontend/index.html` viewport 加 `interactive-widget=resizes-content`。

## 4. 构建与验证

- [ ] `npm run typecheck`。
- [ ] `npm run build:frontend`，确认 `public/index.html` 新 hash。
- [ ] Puppeteer（临时脚本，不入库；拦截 `/api/a-token/*`，禁止真实下单）：
  - [ ] 375×667 / 390×844：首屏第一张卡完整、弹窗无横向溢出、按钮可点。
  - [ ] 边界值：空 / `abc` / `0` / 999 / 铜矿卡输入 2000 / 超余额 / 1500，逐项断言提示与 disabled。
  - [ ] 「全部」填充、预估数值随输入变化。
  - [ ] 375×420 模拟键盘：弹窗内部可滚到确认按钮。
  - [ ] 访客态：点击只触发钱包连接，不出现弹窗。
  - [ ] mock 400：弹窗显示后端原文；mock 200：toast + 关闭。
  - [ ] 1440×900：弹窗居中、三列卡片布局正常。
- [ ] 确认验证过程未调用真实 `nodes/open`，无新增订单记录。

## 5. 汇报

- [ ] 按「删了什么 / 按钮加在哪 / 调的是哪个接口 / 校验规则 / 实测结果」输出，附修改文件链接。
