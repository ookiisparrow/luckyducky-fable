# Lucky Ducky（小棉鸭）— 生产源仓

> ## 本仓身份：生产迭代源（v0.9.1 起）
>
> 本仓 = Lucky Ducky 的**生产源**。经「**高纬度自动化完全重构**」（四主张 T1–T4 + 元模式治理 + round-2 体检）后，2026-06-14 用户拍板 **v0.9.1 转正**：云环境 `cloudbase-d4gcssqbv06865479` 从此从本仓迭代，云函数（`packages/cloud`）+ 前端（`packages/miniapp`/`packages/admin`）生产版均出自本仓。
>
> - **旧生产仓退役**：`/Users/sparrow/luckyducky-miniprogram`（GitHub `ookiisparrow/luckyducky-miniprogram`）= 切换前 v0.9 基线，**仅作回滚用、不再迭代**（回滚预案见 `docs/archive/切换runbook.md` §五）。
> - **接管 tcb·部署闸**：本仓直管 tcb 部署。`scripts/guard-deploy.mjs`（生产仓模型，用户拍板 A）对**敏感函数**（钱/权限/状态）的 tcb 写部署 + 批量 `DEPLOY_ALLOWED=1 deploy-fns` 二次确认（`ask`），读类 tcb（invoke/log/list）与单个非敏感函数部署放行；只认真正的 tcb 命令、提交信息里的字样不拦。人在自己终端不经本 hook。本地验证靠 vitest 内存桩 + H5 回退 + 双端 build，部署前 `npm run check` 全绿 + `node scripts/preflight.mjs`。
> - **8 件控制台正册资产**（git 外，勿动）：微信支付连接器 `wxpay_33nb7su`、支付工作流 `sywxzfapifqzf_nncvqss2`、退款工作流 `kbgzl_n8gojr3a`、paynotify/refundnotify 及其 script1 转发节点——副本正册在本仓 `console-assets/`。
> - **治理脊柱**：`docs/元模式.md`（治理框架 canonical：痛→守卫→反向自检循环，§A 可移植 / §B 本仓绑定）+ `docs/根因账本.md`（13 类病根：病史→本质→根治→绝迹证明）+ `docs/现状与路线.md`（第二次重构 live 地图）+ `docs/archive/切换runbook.md`（切换/回滚）。执行纪律：每批一个 squash 提交上 main、`npm run check` 全绿才推进、commit 报净化指标并标注根治病根；批次结论记 `docs/重构日志.md`。
>
> 以下为工程约定，随批次演进。

Lucky Ducky（小棉鸭）：钩织材料包电商 App，uni-app 一份代码发微信小程序 / H5 / App。后端微信云开发（环境 `cloudbase-d4gcssqbv06865479`、AppID `wxcbd2fb68b81bcfb1`）。

**本文件 = 全部工程约定（代码怎么写、git 怎么走、质量怎么把），按元模式组织：每条约束尽量配机器守卫。当前完成度与下一步只看 `docs/现状与路线.md`，本文件不放进度。**

## 1. 文档地图

约定只在本文件；`docs/` 其余是记录与参考：

- **记录**：`现状与路线.md`（事实与下一步）· `重构日志.md`（批次账本，里程碑记这）· `调试日志.md`（bug 账本）· `待办与债.md`（欠债）· `关键决策记录.md`（为什么这么定）· `待办与债.md`（占位决策追踪）· `运营与增长规划.md`（运营/增长/营销/生态战略·上线前钩子纲领）。（生产线史 `工作日志` 已冻结归 `archive/`。）
- **参考**：`系统事实.md`（客观事实总源：接口/集合/数据/守卫，机器维护）· `业务逻辑架构.md`（业务链心智地图）· `云开发参考.md`（云开发要点）· `微信客服配置手册.md`（微信客服智能客服配置流程 + 排障 runbook）· `验收手册.md`（验收方法论 + 黄金路径）。需求见 `需求清单.md`；设计规格×2 目标设计长文归 archive。
- **工程**：`admin/`（管理控制台，独立 Vue3+Vite，共用云环境，见其 README）· `design/`（Pencil 设计稿）· `docs/archive/`（历史归档，含原《代码标准》《Git协作约定》全文——git 名词扫盲在后者）。

记录约定（任务收尾照做）：里程碑记 `重构日志.md` + `现状与路线.md`（`工作日志`=生产线史、已冻结归 archive）；bug → 调试日志；技术债 → 技术债文档；需求变更先改 `需求清单` 再动代码；里程碑收尾附非技术验收单（模板见验收手册）。本文件只在约定 / 技术栈 / 目录变化时才改。

**文档体系规则（防职责渗漏，根因#11；`docs-budget` 守卫机器盯本文件行数）**：① 活文档条目 ≤8 行，溢出沉 `重构日志`，不在原地膨胀；② `调试日志` 按季卷档，旧季度移 `docs/archive/`；③ 正册只放「仍会被查」的内容，过期即删，不留考古层；④ 约定（本文件）· 记录（现状/日志/账本）· 参考（架构/规格）三类边界明示，状态只一处权威、不三处漂移；⑤ 本文件只放工程约定，不放进度/bug/欠债；⑥ **客观/主观分治**：客观事实（接口/集合/数据/计数＝能拿代码判真假）只在 `系统事实` 机器维护、别处引用不手抄（防 stale）；主观（需求/决策/计划＝只能问"还认不认"）各归单源（需求→`需求清单`/决策→`关键决策`/计划→`现状与路线`）+ 标 provenance；⑦ **一需求一家**：6 类（治理/意图/客观事实/状态/历史/参考）一需求一份，活文档数有预算（`docs-budget` 守 ≤15、超即合并/卷档）。**新文档开局即守此规则**。

**退役制（文档生命周期·治熵核心）**：活文档只留**核心**（意图/理由/当前事实）；**过程账**（已完成批次/已关闭状态/中间边角料）**退役**到 `docs/archive/`——重要的是意图与理由，过程产物退到可查层、不赖在活文档（治"只增不减"的熵）。退役 = 移 archive + 原处留指针「→ 已退役 `archive/X`」+ 在 `docs/archive/README.md` 索引登记（守卫 `archive-index-synced` 焊死：归档⟷索引⟷活文档指针不悬空·索引自身不 stale）。触发：状态转「已完成/已关账」∨ `docs-budget` 超限 ∨ 季度卷档。**唤起** = 查 `archive/README.md` 索引（关键词/源活文档）→ 定位 → 读 / 需要时引回活文档。揪「该退没退的过程账」走 `/doc-audit`。

## 2. 技术栈与命令

uni-app + Vue 3（`<script setup>`）· JavaScript（页面层不用 TS，cloud/shared 用 TS）· SCSS（token 在 `src/uni.scss`）· Pinia（`src/store/`）· Vite · 路由 `pages.json` · 自绘导航（`navigationStyle: custom`）。**不要擅自更换技术栈，优先沿用现有模式。**

```bash
npm install            # prepare 会自动注册 git hooks
npm run dev:h5         # H5 预览优先用这个
npm run dev:mp-weixin  # 构建后导入 packages/miniapp/dist/dev/mp-weixin（workspaces 后产物在 packages/miniapp/dist·非仓根 dist；导错空目录会被微信工具填「云开发 quickstart」示例）
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
- **认证端点防爆破（病根13）**：公网口令端点（adminApi）口令校验前先过频控闸（`throttleLocked`/失败 `throttleFail`/成功 `throttleReset`），失败累计达阈即锁定——杜绝无限重试爆破；用户端高频/造数写函数（trackEvent/createOrder/login/updateProfile）经 `withRateLimit` 按 openid 限频。`[机器守: admin-login-throttled]` `[机器守: user-writes-throttled]`
- **并发幂等 + 状态机**：一次性副作用绑首次状态转移；确定性 `_id`（撞 id 即并发方已写，天然幂等）；流转走 `transition()` 携合法流转表，钱相关自动留痕。`[机器守: deterministic-id-concurrency]` `[机器守: transition-atomic-idempotent]` `[机器守: order-status-union]`
- **金额分整数**：全链「分」整数（Fen 品牌类型），元只在展示层；边界收元转分一次。`[机器守: fen-branded-type]` `[机器守: fen-money-chain]`

**规模 / 资产 / 平台 / 文档（病根 7,9,11,12）**
- **分页协议**：列表走 cursor/limit 契约，杜绝固定 limit 静默挤出旧数据。`[机器守: paging-contract]`
- **平台接缝单点**：支付/退款与微信的接缝（`cloudbase_module`）收口 kit `callFlow` 一处；参数 flowId/refundFlowId/notify_url 正册在 `console-assets/`，平台规则单方变化只改这点。`[机器守: flow-seam-single]` `[机器守: flow-seam-via-kit]`
- **git 外资产正册**：控制台 8 件资产 + 库权限期望表副本在 `console-assets/`，变更先 repo 后控制台。`[机器守: console-assets-present]`
- **文档防膨胀**：本文件 ≤180 行、活文档条目 ≤8 行，溢出沉记录类。`[机器守: docs-budget]`

**多端样式（标 ⚙ 的由 conventions 机器拦）**
- ⚙ 单位 px 不用 rpx `[机器守: rpx]`；⚙ 不写死主题色（与色票同值 hex 被拦）`[机器守: theme-hex]`；⚙ 不内联 `<svg>`、图标用 `<image>` 引 static/icons `[机器守: inline-svg]`；⚙ 交互用 `<view>`+`@tap` 不用 `<button>`（微信能力按钮 open-type 例外）`[机器守: button]`；⚙ 避 `backdrop-filter`/`color-mix()` `[机器守: css-compat]`；⚙ 本地图不走 `background-image:url()` 用 `<image>`、占位用 `MediaSlot` `[机器守: bg-image-local]`；⚙ `<scroll-view>` 内不写 sticky 吸顶（mp-weixin 不生效·H5 假绿·改随内容流参 home/me）`[机器守: sticky-in-scroll-view]`；⚙ 全屏遮罩（`*-mask`/`*-backdrop`）根 `<view>` 须 `@touchmove.stop.prevent` 锁背景滚动（mp 不锁则 touchmove 透传滚背景·H5 假绿）`[机器守: overlay-scroll-lock]`。
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
- **抽象简约（防过度工程）**：内联具体优先；先写最笨能跑通主路径的版本，跑通再单独问「重复到值得提取了吗」（Rule of Three·第三次才抽）；新增接口/层/泛型/配置项旁注一句为什么，理由含「万一以后/方便将来」即删；合并相似两段先问「本质相同还是碰巧长得像」、宁可先重复。判例 S11 不引 xCounts、cs 域不立空册——别为不存在的需求建机制（呼应元模式「别摆设守卫」）。`[靠人：「过度抽象」是判断题、机器证不出，同 #8/#10——别为这条硬上守卫，那本身就是过度工程]`
- **业务预留分流**：「以后/预留/将来」不是自动删除信号。先查需求/ADR/现状路线/用户明确意图：对得上＝业务预留，保留并标清；对不上且只为「方便将来」＝投机抽象，删或延后；不确定先问，不直接改。
- **审核分级**：P0 崩溃/数据错乱/交易错误/安全 ｜ P1 主流程错/状态不一致 ｜ P2 维护成本/重复/错位 ｜ P3 风格/命名/注释。
- **red flags**：展示组件 import data ｜ 页面专属组件躺全局 ｜ store import 页面 data ｜ 同名样式双写 ｜ storage 字面量散落 ｜ 函数又校验又改态又跳转 ｜ 金额数量未校验入库 ｜ 新增接口/层/泛型却无 why 注释、或 why＝「方便将来」。

## 8. Git 协作

云端 GitHub 唯一权威（私有库 `ookiisparrow/luckyducky-next`），main 唯一长期分支。**每批一个 squash 提交直接上 main**（生产源仓快速迭代，不走异步 PR）；`npm run check` 全绿才提交（pre-commit 也拦）。部署是独立的人工动作（见身份段），与 git 提交解耦。

1. squash 合并，main 历史一事一行；阶段节点打 tag（如 `v0.9.1`）。
2. 提交信息 `type：中文说明`（全角冒号，type ∈ feat / fix / docs / refactor / chore / test）；需要时开短命分支 `feature|fix|docs|chore/xxx`。

不入库：`dist/`、`node_modules/`、`*.log`、`.DS_Store`、微信工具的 `project*.config.json`。git 名词扫盲与完整教学见 `docs/archive/Git协作约定.md`。

## 9. 工作流 = skills（每个是元模式的一个环，详见 `docs/元模式.md` A5）

反复出现的多步工作流已固化成可直调 skill；调试/审核/验收别从头来，走对应 skill：

- **改一批（genesis）** `/refactor-batch`：根因 → 先守卫(红) → 改到绿 → `npm run check` → 反向自检 → squash + 记账。本仓任何改动都走它。
- **防过度工程（guardrail）** `/anti-overengineering-check`：喂规模/寿命/用途 → 先具体跑主路径 → 真实脏样本/characterization test 钉行为 → 抽象前查「当前痛点/第三次重复/业务预留来源」→ 小批次改 → `npm run check`。
- **调 bug（intake）** `/systematic-debugging`：复现 → 根因 → 修复带守卫 → 归因病根（不命中现有病根则立新病根 + 配守卫）。
- **体检（health）** `/deep-audit`：P0→P3 逐层验、核每病根有守卫（跑 `guard-coverage`）、分级标状态。
- **前端体检（health·前端）** `/frontend-check`：机器层过后专攻真机/多端/交互坑（page-container/scroll/返回/SVG image…），「构建过≠真机能用」（根因#8）。
- **容量体检（health·规模）** `/capacity-check`：量上来扛不扛得住——峰值 QPS 换算、热路径扫规模杀手（聚合封顶/无界查询/缺索引）、基建维度（DB 套餐/视频带宽，代码看不到去控制台）、分清并发正确性 vs 容量、没压测就说推断（根因#8）。
- **文档体检（health·文档）** `/doc-audit`：活文档清晰/准确/精准/简洁四维体检，「准确」对 git/代码交叉核——揪 stale 进度/过期状态/失真描述（看现象不看声称·A7）；机器层复用 `npm run check`，findings 交 refactor-batch 修。
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

新会话先看三样：本文件 → `docs/现状与路线.md` → `git status` + `git log --oneline -5`。其余文档按任务类型查（需求 → `需求清单`；系统现状 → `系统事实`；云开发 → 文档梳理；修 bug → 调试日志；重构 → 重构日志）。
