# Solvex 前端

当前生产入口为 React + TypeScript + Vite，组件采用 Tailwind CSS 和 shadcn/ui 的 Radix/CVA 结构。React Query 按钱包地址及登录状态版本隔离请求。

## 开发与构建

- npm run dev:local：真实本地业务后端，默认 http://127.0.0.1:5174 ，直接提供已构建的前端。使用 data/local-dev 下的独立账本，首次启动没有示例账户、余额或订单；可用 SOLVEX_LOCAL_PORT 改端口。
- npm run dev:frontend：Vite 开发服务，默认 http://127.0.0.1:5173 。API 默认代理到上述本地后端 http://127.0.0.1:5174 ；可用 SOLVEX_API_TARGET 指定其他地址。
- npm run build:frontend：构建到 public/app，然后更新 public/index.html。不会清理 public 下的其他文件。
- npm run typecheck：TypeScript 检查。
- npm run test:frontend：构建并在 Chrome 中执行隔离浏览器测试，所有 API 请求均由测试截获，不启动业务后端、不读取资金数据库。
- npm run preview:ui：只读界面预览，默认 http://127.0.0.1:5175 ，使用内存示例数据，拦截资金和消息提交。可用 SOLVEX_PREVIEW_PORT 改端口。

本地体验使用 `npm run build:frontend` 后运行 `npm run dev:local`。修改前端时，可在另一个终端运行 `npm run dev:frontend` 获得热更新。5174 使用真实钱包签名与服务端会话，各页面共享登录状态；5175 只用于查看设计中的示例状态。

本地后端不会加载原数据目录或资金环境配置，自动出款、跨链与闪兑均关闭。真实业务 API 不等于真实资金链路已上线：充值收款地址、出款钱包和线上部署仍需单独配置。SVX 图表只读取已有 K 线，不再自动补出历史曲线或模拟价格波动；新库没有已接入的成交行情时图表为空。

npm start 的前置脚本会构建钱包连接器和新前端，然后启动同一个独立本地后端。仓库根目录的 npm start、npm test 也可直接使用，不需要切换目录。

## 本地回归

- npm test / npm run test:local：业务模型、构建与界面、真实本地后端、缓存和语言切换的当前回归入口。
- npm run test:model：当前模型、升级舱和交易品种目录；数据位于系统临时目录。
- npm run test:runtime：启动临时数据目录中的独立后端，使用临时钱包完成真实登录签名，检查桌面和手机页面、刷新恢复、商城会话及空账本；结束时停止该测试进程并移除临时数据。需要先完成前端构建。

复制来的原数据库与旧账本已移到 backups/copied-project-records-*，保留经过完整性校验的快照和清单，运行目录不再包含这些旧记录。已有历史测试文件不代表全部适用于当前模型；默认回归使用上面的当前入口。

## 本次迁移范围

- React：主导航、手机菜单、钱包状态展示、矿池首页、持仓、开通表单、能量、待领取、团队概览、成员、团队收益、邀请、升级舱。
- 矿池场景：一张连通洞穴插画 + 铜／银／金三套原创潮玩机器人矿工图集（每套 8 帧，1.1 秒挥镐循环），服装采用 LOGO 紫蓝青色，头盔区分金属档位。矿工侧身面向岩壁，接触帧敲击矿石中部，脚底对齐岩壁旁地面。按有效未到期持仓及 18 位精确数量分配矿区，同档位只出现一名矿工。整张矿场在手机与桌面均按 16:9 缩放，三个矿区同时可见，不裁切或横向滚动。支持矿区选择、暂停、离屏暂停、减少动态效果偏好；无持仓时明确标注动画预览，加载／失败时不显示运行矿工。背景为 public/assets/mining/toy-cavern-v2.webp，矿工为 toy-miner-{copper,silver,gold}-v3.webp；原图、提示词及处理脚本位于项目根目录 output/imagegen/solvex-toy-mine-20261111。
- 兼容模块：交易终端与 Lightweight Charts、原钱包签名、资产与充提、Ai量化、SVX交易、商城、风云榜、客服、群聊、股东、盲盒、超速驱动协议、交易返佣。

兼容模块通过 src/lib/runtime.ts 挂载到 React 不管理子节点的宿主中。legacy/index.html 是保留 DOM ID 和兼容性回归的模板，不是生产入口。不要把 public/js/core.js 等依赖全局词法变量的脚本直接改为 ESM。

## 状态与资金操作

- GET 请求按钱包身份和版本分组，钱包变化会取消并清除旧查询。修改中的表单不会被后台数据刷新重置。
- 金额以十进制字符串提交，以 BigInt 校验 18 位精度；Number 仅用于展示和进度。
- 资金操作需要确认，禁止自动重试，提交期间阻止重复点击。升级舱沿用后端的幂等请求编号，结果不确定时重试同一编号。
- 新组件不计算或改变业务收益，规则和实际结算仍由现有服务端负责。
- 登录后首页优先呈现余额、待领取和持仓；游客首页呈现矿井与参与引导。手机金额表单使用 Radix 底部抽屉；Input、Skeleton 和抽屉样式统一在 `src/ui-refinement.css`，该文件最后加载。
- 路由使用 #/页面名，兼容原来的 ?page=ai-managed 和 ?ref=。浏览器前进/后退可用，无需修改后端路由。
- 旧 CSS 放在 legacy 层，非首页样式按需下载，避免覆盖 Tailwind 间距和组件状态。

视觉系统采用原 LOGO 的紫、蓝、青渐变色，搭配冷白背景和深靛蓝重点区域。主组件使用 Tailwind + shadcn/ui；商城和兼容模块也统一配色。矿场使用本地 WebP 插画与透明帧图集，不需要建模、WebGL 或运行时图片 API；购物袋、量化网络、股东徽章与盲盒沿用代码绘制图形。

矿场专项检查：`node scripts/verify-toy-mine.mjs`（全部 API 采用隔离测试数据，不读取业务账本）。实际本地页面截图：`node scripts/capture-toy-mine.mjs`。结果位于项目根目录 output/solvex-mine-wall-20261111。

浏览器预览与检查结果输出到仓库根目录 output/solvex-react-20261110/。
