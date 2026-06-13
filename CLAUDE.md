# Lucky Ducky 重构样板房（平行仓）

> ## ⚠️ 本仓身份：重构样板房，不是生产仓
>
> 本仓 = 「**高纬度自动化完全重构**」（用程序哲学与美学重构整个项目）的平行工作仓，从生产仓克隆而来。
>
> - **生产仓**：`/Users/sparrow/luckyducky-miniprogram`（GitHub `ookiisparrow/luckyducky-miniprogram`）——生产事务只在那边做，本仓任何内容不自动进入生产。
> - **云环境共用、本仓禁部署**：两仓共用云环境 `cloudbase-d4gcssqbv06865479`。本仓 `scripts/guard-deploy.mjs` 已改为**拦截一切 tcb 部署/发布命令**（deny），永不解除；deploy-fns 类脚本须 `DEPLOY_ALLOWED=1`，本仓永不设置。验证全靠 vitest 内存桩 + H5 回退 + 双端 build。
> - **8 件控制台正册资产**（git 外，勿动）：微信支付连接器 `wxpay_33nb7su`、支付工作流 `sywxzfapifqzf_nncvqss2`、退款工作流 `kbgzl_n8gojr3a`、paynotify/refundnotify 及其 script1 转发节点——记录见生产仓 `docs/工作日志.md` 2026-06-12 与 `docs/调试日志.md` J；B6 批次把副本正册化进本仓 `console-assets/`。
> - **总计划与脊柱**：`docs/元模式.md`（治理框架 canonical 定义：痛→守卫→反向自检循环 + 三件套怎么咬合，§A 可移植 / §B 本仓绑定）+ `docs/重构总计划.md`（v4 权威版，批次表挂病根编号）+ `docs/根因账本.md`（十二类病根：病史→本质→根治→绝迹证明——账本未覆盖的不做、覆盖的不漏）。执行纪律：每批一个 squash 提交上本仓 main、`npm run check` 全绿才推进、commit 报净化指标并标注根治病根；批次结论与证据记 `docs/重构日志.md`；生产仓事务随时插队优先。
>
> 以下为克隆自生产仓的工程约定，重构过程中随批次演进。

Lucky Ducky（幸运小鸭）：钩织材料包电商 App，uni-app 一份代码发微信小程序 / H5 / App。后端微信云开发（环境 `cloudbase-d4gcssqbv06865479`、AppID `wxcbd2fb68b81bcfb1`）。

**本文件 = 全部工程约定（代码怎么写、git 怎么走、质量怎么把），按元模式组织：每条约束尽量配机器守卫。当前完成度与下一步只看 `docs/项目现状.md`，本文件不放进度。**

## 1. 文档地图

约定只在本文件；`docs/` 其余是记录与参考：

- **记录**：`项目现状.md`（事实与下一步）· `工作日志.md`（按日）· `调试日志.md`（bug 账本）· `技术债与重构.md`（欠债）· `关键决策记录.md`（为什么这么定）· `上线前占位清单.md`（占位决策追踪）。
- **参考**：`业务逻辑架构.md`（三层架构 + 集合地图 + 业务链 + 状态机，建全局心智先读）· `设计规格-课程电商系统.md` / `设计规格-管理控制台.md`（目标设计）· `微信云开发文档梳理.md`（云开发要点）· `验收手册.md`（非技术验收机制与验收单）。
- **工程**：`admin/`（管理控制台，独立 Vue3+Vite，共用云环境，见其 README）· `design/`（Pencil 设计稿）· `docs/archive/`（历史归档，含原《代码标准》《Git协作约定》全文——git 名词扫盲在后者）。

记录约定（任务收尾照做）：里程碑只更新 `工作日志.md` + `项目现状.md`；bug → 调试日志；技术债 → 技术债文档；设计变更先改设计规格再动代码；里程碑收尾附非技术验收单（模板见验收手册）。本文件只在约定 / 技术栈 / 目录变化时才改。

**文档体系规则（防职责渗漏，根因#11；`docs-budget` 守卫机器盯本文件行数）**：① 活文档条目 ≤8 行，溢出沉 `工作日志`/`重构日志`，不在原地膨胀；② `调试日志` 按季卷档，旧季度移 `docs/archive/`；③ 正册只放「仍会被查」的内容，过期即删，不留考古层；④ 约定（本文件）· 记录（现状/日志/账本）· 参考（架构/规格）三类边界明示，状态只一处权威、不三处漂移；⑤ 本文件只放工程约定，不放进度/bug/欠债。**新文档开局即守此规则**（重构日志/根因账本/总计划已遵）。

## 2. 技术栈与命令

uni-app + Vue 3（`<script setup>`）· JavaScript（页面层不用 TS，cloud/shared 用 TS）· SCSS（token 在 `src/uni.scss`）· Pinia（`src/store/`）· Vite · 路由 `pages.json` · 自绘导航（`navigationStyle: custom`）。**不要擅自更换技术栈，优先沿用现有模式。**

```bash
npm install            # prepare 会自动注册 git hooks
npm run dev:h5         # H5 预览优先用这个
npm run dev:mp-weixin  # 构建后导入 dist/dev/mp-weixin
npm run check          # 提交前全套：conventions+structure+typecheck+lint+test（pre-commit 也会自动跑）
npm run build:h5 / build:mp-weixin / build:cloud
```

## 3. 元模式与质量闸（约束怎么变守卫）

本项目治理遵 **元模式**（canonical 定义见 `docs/元模式.md`）：每条痛 / 主张 → 一条不变量 → 一个永久守卫；**靠人记的迟早漂移、靠机器守的不会**。§4 每条规则都标来源——`[机器守: <守卫id>]`（有机器守卫，机制在守卫里、本文不复述）或 `[靠人:#N …]`（机器守不了的病根，写清为什么靠人）。覆盖率由 `guard-coverage` 机器核：每条病根都得有守卫或靠人豁免，缺一即红。

**五道网**（被拦先修代码、不绕闸）：① 编辑 hook（改文件即跑 conventions+structure 违例当场反馈 + prettier 就地格式化）→ ② pre-commit（`npm run check` 红灯拦提交）→ ③ CI（push/PR 同样跑）→ ④ 反向自检（每批篡改守卫必红→还原）→ ⑤ 类型系统（TS 非法状态名 / 浮点金额编译期挡）。三道闸单一定义 = `npm run check`，自身由 `gate-single-source` 守。刻意例外：行内注释加 `convention-ok` / `structure-ok`（先确认是刻意决策）。ESLint 禁 `src/` 裸 console——日志走 `utils/logger.js`（云函数 / admin 不限）。

## 4. 痛 → 不变量 → 守卫（每条标来源）

**架构主张（T1–T4）**
- **T1 微信原生单源**：H5/App 不连核心交易流程；api 层只对接云、不引样例数据回退。`[机器守: api-cloud-only]`
- **T2 云函数域分组**：函数在 `functions/<域>/` 下；业务码禁裸 `cloud.init`/`getWXContext`，身份/初始化经 kit。`[机器守: cloud-domain-grouped]` `[机器守: kit-only-cloud-primitives]`
- **T3 云为唯一真相**：商品/课程种子单源在 `packages/shared/seed`，`data/` 仅派生视图。`[机器守: seed-single-source]`
- **T4 按链内聚**：依赖方向 pages→store/api→utils/data（叶），不反转、无环。`[机器守: dep-direction]`

**钱 / 权限 / 状态 / 幂等（病根 1–4）**
- **信任边界 fail-closed**：写库必过 kit 闸（withOpenId/withAdminGate/isServerCall/defineNotifyCallback）；回调防伪（见 OPENID 即拒）；越权先验本人。**价格/数量/openid/订单状态一律云函数校验，不信前端。** `[机器守: writes-need-gate]` `[机器守: gate-fail-closed]` `[机器守: notify-forge-proof]`
- **并发幂等 + 状态机**：一次性副作用绑首次状态转移；确定性 `_id`（撞 id 即并发方已写，天然幂等）；流转走 `transition()` 携合法流转表，钱相关自动留痕。`[机器守: deterministic-id-concurrency]` `[机器守: transition-atomic-idempotent]` `[机器守: order-status-union]`
- **金额分整数**：全链「分」整数（Fen 品牌类型），元只在展示层；边界收元转分一次。`[机器守: fen-branded-type]` `[机器守: fen-money-chain]`

**规模 / 资产 / 平台 / 文档（病根 7,9,11,12）**
- **分页协议**：列表走 cursor/limit 契约，杜绝固定 limit 静默挤出旧数据。`[机器守: paging-contract]`
- **平台接缝单点**：支付/退款与微信的接缝（`cloudbase_module`）收口 kit `callFlow` 一处；参数 flowId/refundFlowId/notify_url 正册在 `console-assets/`，平台规则单方变化只改这点。`[机器守: flow-seam-single]` `[机器守: flow-seam-via-kit]`
- **git 外资产正册**：控制台 8 件资产 + 库权限期望表副本在 `console-assets/`，变更先 repo 后控制台。`[机器守: console-assets-present]`
- **文档防膨胀**：本文件 ≤180 行、活文档条目 ≤8 行，溢出沉记录类。`[机器守: docs-budget]`

**多端样式（标 ⚙ 的由 conventions 机器拦）**
- ⚙ 单位 px 不用 rpx `[机器守: rpx]`；⚙ 不写死主题色（与色票同值 hex 被拦）`[机器守: theme-hex]`；⚙ 不内联 `<svg>`、图标用 `<image>` 引 static/icons `[机器守: inline-svg]`；⚙ 交互用 `<view>`+`@tap` 不用 `<button>`（微信能力按钮 open-type 例外）`[机器守: button]`；⚙ 避 `backdrop-filter`/`color-mix()` `[机器守: css-compat]`；⚙ 本地图不走 `background-image:url()` 用 `<image>`、占位用 `MediaSlot` `[机器守: bg-image-local]`。
- 无独立守卫（靠 review / 条件编译纪律）：只用 `uni.xxx` 跨端 API、端私有能力 `// #ifdef MP-WEIXIN` 隔离；安全区/胶囊避让用 `utils/systemBar.js` 动态算、不硬编码 `env()`；scoped 拿不到 JS 值时经 `:style` 注入 CSS 变量、样式里 `var()` 取。

**靠人（机器守不了的病根，写清为什么）**
- `[靠人:#8 验证样本失真]`：E2E/验收必用**真实尺寸样本**（图走真实大小、列表真实条数、金额真实分）；凭证/签名走**完整请求形状**到最后一步（「拿到」≠「用通」）；兜底覆盖主路径全部失败点并被测试逼出。——样本与真实的距离只有真机/真尺寸证得了，机器证不出「过了 ≠ 真能用」。
- `[靠人:#10 工具实例状态不可信]`：开发者工具是有状态共享实例，build/自动化/真机互踩后表象不可信——跑 build 前先停自动化；遇怪象（`component not found`/白屏/RPC 不回包）先 `cli quit`+重启再排查，别在僵实例查业务码。visual-check RPC 探活守卫兜第一道。——工具僵态是运行时现象，静态守卫测不了。

## 5. 目录与命名

```text
src/
  pages/          页面，每页一目录（页内自用组件放 pages/<page>/components/）
  components/     跨页复用组件（媒体大块在 components/media/）
  data/           静态样例数据，逐步换 api
  api/            请求层与业务接口
  store/          Pinia 状态（cart 购物车+结算草稿 / address / user / products / courses / progress / reviews）
  styles/         跨页公共样式（co.scss）
  utils/          工具（cloud / logger / validate / systemBar / track / format）
  static/icons/   svg 图标
  uni.scss        设计 token 单一来源
```

命名：组件 PascalCase（`ProductCard.vue`）· 页面路径小写 · JS camelCase · 常量 UPPER_SNAKE · class kebab-case（首页/通用 `ld-` 前缀，结算/订单/地址/售后/评价系列沿用 `co-` 体系）· 图标文件 kebab-case，激活态 `-on` 后缀，颜色写进 svg，组件里 `<Icon name="house" :size="20" />`（name 不带 .svg）。

## 6. 数据 / 状态 / 样式细则（守卫够不到的判断项）

- **商品身份单源 `src/data/catalog.js`**：首页/购物车/详情按 id 从 catalog 派生（catalog 本身派生自 shared 种子，见 T3）；订单/售后里是历史快照，不回读 catalog，样例价保持一致。
- **云数据走 `utils/cloud.js` 的 `callCloud` + 业务云函数**，不走 HTTP request；样板 `api/shop.js` + `store/products.js`（store 收口、页面从 store 取）。新模块照此三件套。
- **持久化经 `store/persist.js`**（uni storage）：明确哪些字段持久化；临时态（结算草稿）不持久化；回灌必过 `sanitize` 防脏数据；新增持久化补 `tests/`。
- **样式**：颜色/圆角/间距/字号引 `uni.scss` 变量，改主题只改它；标题用 `ld-h1`/`ld-h2` mixin；`co-` 公共样式在 `styles/co.scss`，页面差异写页面 scoped。**scoped 边界铁律**：组件 / 父页面 / co.scss 三者互相够不到，插槽内容属父级作用域；抽组件别为去重破坏边界，同名 class 不要全局 + scoped 双写。

## 7. 代码质量尺子（自查与审核；深度审核走 `/deep-audit`）

- **边界与依赖**：页面只编排；纯展示组件只 props/emits、不直接 import `data/*`；依赖方向见 T4，无循环；store 不依赖页面数据，utils 不依赖 store。
- **状态归属**：跨页进 store、页面临时态留页、组件交互态留组件。**副作用**：跳转/toast/storage/timer/请求不散进深层展示组件；timer 必清理；storage key 用常量收敛、不散字面量。
- **函数粒度**：一函数一意图，复杂流程拆 validate → mutate → side effect。**错误处理**：请求失败统一处理；storage 解析失败不崩；空数据有空态；用户动作失败有反馈。**注释**：解释为什么而非做什么、mock/demo 必标注。**安全**：不信 storage/query/API 输入；禁 `eval`/`v-html`；敏感信息不进日志。
- **审核分级**：P0 崩溃/数据错乱/交易错误/安全 ｜ P1 主流程错/状态不一致 ｜ P2 维护成本/重复/错位 ｜ P3 风格/命名/注释。
- **red flags**：展示组件 import data ｜ 页面专属组件躺全局 ｜ store import 页面 data ｜ 同名样式双写 ｜ storage 字面量散落 ｜ 函数又校验又改态又跳转 ｜ 金额数量未校验入库。

## 8. Git 协作

云端 GitHub 是唯一权威（私有库 `ookiisparrow/luckyducky-miniprogram`），main 是唯一长期分支。**样板房例外**：本仓不走异步 PR，每批一个 squash 提交直接上本仓 main（见脊柱执行纪律）。生产仓仍守下列：

1. **任何改动**（哪怕一行文档）都开短命分支，绝不直接改 main。
2. 一律走 PR；用户在 GitHub 异步合并——**每批独立 PR，确认合并后再开下一批**（不堆叠）。
3. squash 合并，main 历史一事一行；阶段节点打 tag（如 `v0.1`）。
4. 分支名 `feature|fix|docs|chore/xxx`；提交信息 `type：中文说明`（全角冒号，type ∈ feat / fix / docs / refactor / chore / test）。

不入库：`dist/`、`node_modules/`、`*.log`、`.DS_Store`、微信工具的 `project*.config.json`。git 名词扫盲与完整教学见 `docs/archive/Git协作约定.md`。

## 9. 工作流 = skills（每个是元模式的一个环，详见 `docs/元模式.md` A5）

反复出现的多步工作流已固化成可直调 skill；调试/审核/验收别从头来，走对应 skill：

- **改一批（genesis）** `/refactor-batch`：根因 → 先守卫(红) → 改到绿 → `npm run check` → 反向自检 → squash + 记账。样板房任何改动都走它。
- **调 bug（intake）** `/systematic-debugging`：复现 → 根因 → 修复带守卫 → 归因病根（不命中现有病根则立新病根 + 配守卫）。
- **体检（health）** `/deep-audit`：P0→P3 逐层验、核每病根有守卫（跑 `guard-coverage`）、分级标状态。
- **挖 hook（discovery）** `/hook-audit`：扫执行轨迹找该机器化的重复动作（只建议不装）。
- **验收（acceptance）** `/acceptance-check`：非技术看现象、真机验支付退款、验收单 X/Y/Z。
- **写 skill（meta）** `/writing-skills`：把反复用的工作流固化成 skill。

## 10. 关键决策摘要（详见 docs/关键决策记录.md，勿轻易推翻）

- uni-app 多端一份代码；px 不用 rpx；自绘浮动 TabBar（原生还原不了设计）。
- `MediaSlot` 管图位，将来换真素材只改数据或入参。
- 主题色幸运紫，变量在 `uni.scss`；Sass `@import` → `@use` 暂缓。
- 安全区用 `systemBar.js` 动态算；敏感业务全走云函数，不信前端。
- 代码按技术分层组织，不按业务链重组（决策 §17）；逻辑链整体视图看 `业务逻辑架构.md`。
- 平台接缝单点（根因#12）见 §4「平台接缝单点」；接缝参数正册在 `console-assets/`。

## 11. 扩展套路与新会话

- 加页面：`src/pages/<name>/index.vue` + `pages.json` 注册（必要时接 TabBar / CoNavBar）。
- 加接口：`src/api/<module>.js`，返回结构贴近现有 data；页面或 store 调用。
- 加状态：`src/store/<name>.js`，按需接 persist + sanitize + 测试。
- 改主题：只改 `src/uni.scss`。

新会话先看三样：本文件 → `docs/项目现状.md` → `git status` + `git log --oneline -5`。其余文档按任务类型查（云开发 → 文档梳理 + 设计规格；修 bug → 调试日志；重构 → 技术债 / 重构日志）。
