# Lucky Ducky（小棉鸭）— 生产源仓（fable）

> ## 本仓身份：生产源（2026-07-09 切换转正·前身重构线自 2026-07-03）
>
> 本仓 = Lucky Ducky 的**生产源**。2026-07-03 从 `luckyducky-next`（GitHub `ookiisparrow/luckyducky-next`，HEAD `ff02afb`）完整复制为重构线；**2026-07-09 M5 切换执行完毕、本仓转正**（无真实用户前提下用户拍板压缩 runbook 前置闸·经过见 `docs/重构日志.md` 同日切换条）。云环境 `cloudbase-d4gcssqbv06865479` 唯一版本＝本仓 `rewrite/` 重写线：**17 云函数 + `/admin` `/agent` 新后台 + 根路径内容站**（函数数以 `rewrite/cloud/build.mjs` 产物为准），旧线 26 函数与 `/admin2` `/agent2` 并行路径已清退。本仓对该环境的部署/建表/删表等改动**真实生效**，不是隔离沙盒，操作前务必想清楚。
>
> - **next 仓＝封存回滚基线**：`/Users/sparrow/luckyducky-next` 不再迭代、不再止血（生产源已是本仓）；保留价值＝旧线全量代码与旧后台可分钟级重建。除封存标注外不要动它。**旧线在本仓的冻结参照 `packages/` 已于 2026-07-23 瘦身拍板批删除**（用户拍板·旧线唯一参照=next 仓·git 历史可查）。
> - **活代码在 `rewrite/`**：微信端原生 TS+glass-easel（全 WebView 首发）、后端云开发 17 函数（`rewrite/cloud`）、admin/agent（Vue3+Vite）、Astro 内容站（`rewrite/site`）。新线工程约定散在 `rewrite/*/README.md` 与各批记账；旧线专用约定已随旧线退役归档（史料「旧线工程约定-至20260723.md」·参照旧线去 next 仓）。
> - **小程序发布面**：AppID `wxcbd2fb68b81bcfb1`；新 mp（`rewrite/mp`）上传/提审/发布为微信后台人工动作——未发布期间线上旧版 v0.9.4 调用的旧函数已删（无真实用户·用户拍板接受）。
> - **接管 tcb·部署闸**：`scripts/guard-deploy.mjs` 机制不变，规则原样适用——见下方 §3。
> - **8 件控制台正册资产**：微信支付连接器 `wxpay_33nb7su` 等，git 外、勿动，副本正册在本仓 `console-assets/`（本仓即权威源，随变更先 repo 后控制台）。
> - **治理脊柱**：`docs/元模式.md` / `docs/根因账本.md` 延续；进度/账本类见 `docs/现状与路线.md` 等；分叉前 next 全史在 史料「现状与路线-next基线-至20260703.md」 / 史料「重构日志-next基线-至20260703.md」 / 史料「调试日志-next基线-至20260703.md」 / 史料「待办与债-next基线-至20260703.md」。
>
> 以下为工程约定，对全仓（rewrite/ 活线）有效。

Lucky Ducky（小棉鸭）：钩织材料包电商 App。现产物为原生 TS 微信小程序（`rewrite/mp`·待微信后台发布）+ 云开发后端（环境 `cloudbase-d4gcssqbv06865479`、AppID `wxcbd2fb68b81bcfb1`）+ admin/agent 后台 + Astro 内容站。

**本文件 = 全部工程约定（代码怎么写、git 怎么走、质量怎么把），按元模式组织：每条约束尽量配机器守卫。当前完成度与下一步只看 `docs/现状与路线.md`，本文件不放进度。**

## 1. 文档地图

约定只在本文件；`docs/` 其余是记录与参考：

- **记录**：`现状与路线.md`（事实与下一步）· `重构日志.md`（批次账本，里程碑记这）· `调试日志.md`（bug 账本）· `待办与债.md`（欠债+占位决策追踪）· `关键决策记录.md`（为什么这么定）· `巡逻日志.md`（/patrol 轮报账本）· `运营与增长规划.md`（运营/增长/营销/生态战略·上线前钩子纲领）· `人工配置清单.md`（上线人工配置台账·28+3 项）。（生产线史 `工作日志` 已冻结入 git 史料层。）
- **待拍板方案**：`优惠券对接微信小店-方案.md`（未落地·待用户核实商家券灰度）。
- **治理工具**：`判例索引.json`（前车之鉴机器索引·守卫 `precedent-index-synced` 焊）· `工头手册.md`（AI 车队轮值职位手册）。
- **参考**：`系统事实.md`（客观事实总源：接口/集合/数据/守卫，机器维护）· `自动化验证系统.md`（守卫注册表 + 五层验证 + 四主张 T1–T4·元模式§B 实例绑定）· `业务逻辑架构.md`（业务链心智地图）· `云开发参考.md`（云开发踩坑速查·通用 API 查官方）· `微信客服配置手册.md`（微信客服智能客服配置流程 + 排障 runbook）· `运维手册.md`（日常运维 runbook：部署/回滚/密钥轮换/常见故障/例行巡检·区别于一次性 `rewrite/M5-切换runbook.md`）· `验收手册.md`（验收方法论 + 黄金路径）。需求见 `需求清单.md`；设计规格×2 目标设计长文归 archive。
- **子项目活文档家**（明确需求的功能线·规范/蓝图/进度自成一家、README 为入口）：`docs/后台360工作站/`（自建客服 + 360 工作台 + 私域沉淀·决策§19）· `docs/进销存ERP/`（供应链进销存最小闭环·需求 R31）。
- **工程**：`rewrite/`（全部活代码·各包 README 为专项约定入口）· `docs/史料索引.md`（全部历史归档的钥匙——30+ 册正文在 git 史料层·tag `museum-20260723`）。（`design/` 与旧线 `packages/` 已删·git 历史可查。）

记录约定（任务收尾照做）：里程碑记 `重构日志.md` + `现状与路线.md`（`工作日志`=生产线史、已冻结归 archive）；bug → 调试日志；技术债 → 技术债文档；需求变更先改 `需求清单` 再动代码；里程碑收尾附非技术验收单（模板见验收手册）。本文件只在约定 / 技术栈 / 目录变化时才改。

**文档体系规则（防职责渗漏，根因#11）**：① 活文档条目 ≤8 行，溢出沉 `重构日志`，不在原地膨胀；② 卷档机制暂停、待重新设计（2026-07-05 拍板，决策§25）；③ 正册只放「仍会被查」的内容，过期即删，不留考古层；④ 约定（本文件）· 记录（现状/日志/账本）· 参考（架构/规格）三类边界明示，状态只一处权威、不三处漂移；⑤ 本文件只放工程约定，不放进度/bug/欠债；⑥ **客观/主观分治**：客观事实（接口/集合/数据/计数＝能拿代码判真假）只在 `系统事实` 机器维护、别处引用不手抄（防 stale）；主观（需求/决策/计划＝只能问"还认不认"）各归单源（需求→`需求清单`/决策→`关键决策`/计划→`现状与路线`）+ 标 provenance；⑦ **一需求一家**：6 类（治理/意图/客观事实/状态/历史/参考）一需求一份；活文档数不设预算（2026-07-05 拍板取消，决策§25）。**新文档开局即守此规则**。

**退役制（文档生命周期·治熵核心·2026-07-23 第一性原理批改制）**：活文档只留**核心**（意图/理由/当前事实）；**过程账**（已完成批次/已关闭状态/中间边角料）**直接删除——git 历史即归档层，工作区不开博物馆**。退役 = 在 `docs/史料索引.md` 登记一行（册名/主题/原活文档）+ 原处留「→ 已退役·史料索引」指针 + 删正文（重要册打 tag 锚点·首批 30 册锚在 `museum-20260723`）。**唤起** = 查 `docs/史料索引.md` → `git show <tag>:<路径>` 直接读。揪「该退没退的过程账」走 `/doc-audit`。

## 2. 技术栈与命令

活线（`rewrite/`）：mp＝原生 TS+glass-easel（微信开发者工具本地编译，无 bundler 构建）· cloud/shared＝TS（esbuild 打包）· admin/agent＝Vue3+Vite+TS · site＝Astro。各包专项约定见 `rewrite/README.md` 与各包 README。**不要擅自更换技术栈，优先沿用现有模式。**

```bash
npm install              # prepare 会自动注册 git hooks
npm run check            # 提交前全套：structure+typecheck+lint+test（pre-commit 也会自动跑）
npm run build:rw-cloud   # 活线云函数产物（部署另为人工授权动作·经 guard-deploy 闸）
npm run build:rw-admin / build:agent   # 活线后台产物；内容站 npm run build -w @ldrw/site
```

## 3. 元模式与质量闸（约束怎么变守卫）

本项目治理遵 **元模式**（canonical 定义见 `docs/元模式.md`）：每条痛 / 主张 → 一条不变量 → 一个永久守卫；**靠人记的迟早漂移、靠机器守的不会**。§4 每条规则都标来源——`[机器守: <守卫id>]`（有机器守卫，机制在守卫里、本文不复述）或 `[靠人:#N …]`（机器守不了的病根，写清为什么靠人）。覆盖率由 `guard-coverage` 机器核：每条病根都得有守卫或靠人豁免，缺一即红。

**五道网**（被拦先修代码、不绕闸）：① 编辑 hook（改文件即跑 structure 违例当场反馈）→ ② pre-commit（`npm run check` 红灯拦提交）→ ③ CI（push/PR 同样跑）→ ④ 反向自检（每批篡改守卫必红→还原）→ ⑤ 类型系统（TS 非法状态名 / 浮点金额编译期挡）。三道闸单一定义 = `npm run check`，自身由 `gate-single-source` 守。刻意例外：行内注释加 `structure-ok`（先确认是刻意决策）。

## 4. 痛 → 不变量 → 守卫（每条标来源）

**架构主张（T1–T4）**
- **T1 微信原生单源**：H5/App 不连核心交易流程；mp 端 lib/api 只对接云、不引样例数据回退。`[机器守: rw-mp-cloud-only]` ——**代码不变量不松**；**分发范围已放开（决策§19，2026-06-30）**：可经微信小店官方 API「小程序连接小店」拿微信生态多节点分发（不 fork 端、不增回退分支，故不违 T1），H5 自有官网暂缓。
- **T2 云原语经 kit 收口**：业务码禁裸 `cloud.init`/`getWXContext`，身份/初始化一律经 kit（17 函数拓扑以 `rewrite/cloud/build.mjs` 产物为准）。`[机器守: rw-kit-only-cloud-primitives]`
- **T3 云为唯一真相**：商品/课程/页面内容数据单源在云数据库（admin CMS 维护），mp 端只经云读、不落本地样例源。`[机器守: rw-mp-cloud-only]`
- **T4 按链内聚**：mp 依赖方向 pages→lib（叶），不反转、无环。`[机器守: rw-dep-direction]`

**钱 / 权限 / 状态 / 幂等（病根 1–4）**
- **信任边界 fail-closed**：写库必过 kit 闸（withOpenId/withAdminGate/isServerCall/defineNotifyCallback）；回调防伪（见 OPENID 即拒）；越权先验本人。**价格/数量/openid/订单状态一律云函数校验，不信前端。** `[机器守: rw-writes-need-gate]` `[机器守: gate-fail-closed]` `[机器守: notify-forge-proof]`
- **认证端点防爆破（病根13）**：公网口令端点（adminApi）口令校验前先过频控闸（`throttleLocked`/失败 `throttleFail`/成功 `throttleReset`），失败累计达阈即锁定——杜绝无限重试爆破；用户端高频/造数写函数（trackEvent/createOrder/login/updateProfile）经 `withRateLimit` 按 openid 限频。`[机器守: rw-admin-login-throttled]` `[机器守: user-writes-throttled]`
- **并发幂等 + 状态机**：一次性副作用绑首次状态转移；确定性 `_id`（撞 id 即并发方已写，天然幂等）；流转走 `transition()` 携合法流转表，钱相关自动留痕。`[机器守: deterministic-id-concurrency]` `[机器守: transition-atomic-idempotent]` `[机器守: order-status-union]`
- **金额分整数**：全链「分」整数（Fen 品牌类型），元只在展示层；边界收元转分一次。`[机器守: rw-fen-branded-type]` `[机器守: fen-money-chain]`

**规模 / 资产 / 平台 / 文档 / 可观测 / 守卫自身（病根 7,9,11,12,14,16）**
- **分页协议**：列表走 cursor/limit 契约，杜绝固定 limit 静默挤出旧数据。`[机器守: paging-contract]`
- **平台接缝单点**：支付/退款与微信的接缝（`cloudbase_module`）收口 kit `callFlow` 一处；参数 flowId/refundFlowId/notify_url 正册在 `console-assets/`，平台规则单方变化只改这点。`[机器守: rw-flow-seam-single]` `[机器守: rw-flow-seam-via-kit]`
- **git 外资产正册**：控制台 8 件资产 + 库权限期望表副本在 `console-assets/`，变更先 repo 后控制台。`[机器守: console-assets-present]`
- **失败必可观测（病根14）**：动作类失败（接缝外呼/发送/回调验签）禁静默吞——留痕告警走 kit `observe.alert` 单出口（`[LD_ALERT]`+webhook 触达），fail-soft 只改返回语义、不抹可观测性；读路径 `doc.get().catch(()=>null)`（缺席=null）不在此列；刻意静默行内注释写明为什么。`[机器守: rw-flow-observable]`
- **文档防膨胀（政策变更 2026-07-05，决策§25）**：CLAUDE 行数/活文档份数/记录类行数预算取消（原 `docs-budget` 守卫退役），卷档机制待重新设计；「条目 ≤8 行、溢出沉记录类」保留为写作纪律（靠人自律，无机器守卫）。
- **持续义务有传感器（病根17·瘦身大作战 2026-07-23）**：随时间恶化的量不许只活在人记忆里——活线代码量与依赖锁重量走**基线棘轮**（涨超预算红＝膨胀须显式记账；瘦身后基线虚高也红＝成果锁死不回弹）；死导出/幽灵依赖/孤儿资产零容忍即红。基线单源 `scripts/slim-baseline.json`。`[机器守: rw-loc-budget]` `[机器守: rw-lock-budget]` `[机器守: rw-dead-exports]` `[机器守: rw-phantom-deps]` `[机器守: rw-orphan-assets]`
- **守卫自身可信（病根16·盲区体检 2026-07-18）**：守卫的**逻辑**不漂移，但守卫与现实的**绑定**（扫描面/指针/清单镜像）会漂——空样本＝绿不发信号。扫描面统一排除（dot 目录恒不入）+金丝雀夹具常驻；注册表 id 唯一；fileRule 活线活性下限；会动环境的工具脚本禁旧线引用（防回潮）。`[机器守: guard-id-unique]` `[机器守: guard-scan-liveness]` `[机器守: rw-toolchain-no-oldline]`

**多端样式**
（旧线 ⚙ 守卫族与 conventions 扫描器已随旧线于 2026-07-23 退役。新线 `rewrite/mp` 为原生小程序、样式约定见 `rewrite/mp/README.md` 与其 rw-mp 守卫族。）

**靠人（机器守不了的病根，写清为什么）**
- `[靠人:#8 验证样本失真]`：E2E/验收必用**真实尺寸样本**（图走真实大小、列表真实条数、金额真实分）；凭证/签名走**完整请求形状**到最后一步（「拿到」≠「用通」）；兜底覆盖主路径全部失败点并被测试逼出。——样本与真实的距离只有真机/真尺寸证得了，机器证不出「过了 ≠ 真能用」。
- `[靠人:#10 工具实例状态不可信]`：开发者工具是有状态共享实例，build/自动化/真机互踩后表象不可信——跑 build 前先停自动化；遇怪象（`component not found`/白屏/RPC 不回包）先 `cli quit`+重启再排查，别在僵实例查业务码。——工具僵态是运行时现象，静态守卫测不了。

## 5. 目录与命名

**布局**：全部代码在 `rewrite/{golden,mp,shared,cloud,admin,agent,site}`（不预建空目录，约定见 `rewrite/README.md`；旧线 `packages/` 已删·参照去 next 仓）。**模块归属单源＝仓根 `modules.json`**（action/页面/集合 → 业务模块 + 危险分级 `[机器守: module-registry-complete]`）。

## 6. 数据 / 状态 / 样式细则（守卫够不到的判断项）

- **订单/售后里是历史快照**：不回读商品目录——下单时价格/名称落快照，目录后续改动不追溯。
- **mp 云数据走 lib 层对接云函数**（`rw-mp-cloud-only` 守），不走 HTTP request；页面从 lib/store 取、不直连。
- **持久化最小化**：临时态（结算草稿）不持久化；回灌本地缓存必防脏数据。
- **样式**：admin 颜色一律 `var(--ld-*)`、调色板单源 `styles/tokens.css`（`rw-admin-theme-single-source` 守）；mp 样式约定见 `rewrite/mp/README.md`（rpx 为平台正解等随线重议项）。

## 7. 代码质量尺子（自查与审核；深度审核走 `/deep-audit`）

- **边界与依赖**：页面只编排；纯展示组件只 props/emits、不直接 import `data/*`；依赖方向见 T4，无循环；store 不依赖页面数据，utils 不依赖 store。
- **状态归属**：跨页进 store、页面临时态留页、组件交互态留组件。**副作用**：跳转/toast/storage/timer/请求不散进深层展示组件；timer 必清理；storage key 用常量收敛、不散字面量。
- **函数粒度**：一函数一意图，复杂流程拆 validate → mutate → side effect。**错误处理**：请求失败统一处理；storage 解析失败不崩；空数据有空态；用户动作失败有反馈。**注释**：解释为什么而非做什么、mock/demo 必标注。**安全**：不信 storage/query/API 输入；禁 `eval`/`v-html`；敏感信息不进日志。
- **抽象简约（防过度工程）**：内联具体优先；先写最笨能跑通主路径的版本，跑通再单独问「重复到值得提取了吗」（Rule of Three·第三次才抽）；新增接口/层/泛型/配置项旁注一句为什么，理由含「万一以后/方便将来」即删；合并相似两段先问「本质相同还是碰巧长得像」、宁可先重复。判例 S11 不引 xCounts、cs 域不立空册——别为不存在的需求建机制（呼应元模式「别摆设守卫」）。`[靠人：「过度抽象」是判断题、机器证不出，同 #8/#10——别为这条硬上守卫，那本身就是过度工程]`
- **业务预留分流**：「以后/预留/将来」不是自动删除信号。先查需求/ADR/现状路线/用户明确意图：对得上＝业务预留，保留并标清；对不上且只为「方便将来」＝投机抽象，删或延后；不确定先问，不直接改。
- **审核分级**：P0 崩溃/数据错乱/交易错误/安全 ｜ P1 主流程错/状态不一致 ｜ P2 维护成本/重复/错位 ｜ P3 风格/命名/注释。
- **red flags**：展示组件 import data ｜ 页面专属组件躺全局 ｜ store import 页面 data ｜ 同名样式双写 ｜ storage 字面量散落 ｜ 函数又校验又改态又跳转 ｜ 金额数量未校验入库 ｜ 新增接口/层/泛型却无 why 注释、或 why＝「方便将来」。

## 8. Git 协作

云端 GitHub 唯一权威（私有库 `ookiisparrow/luckyducky-fable`·本仓；next 仓为封存回滚基线），main 唯一长期分支。**每批一个 squash 提交直接上 main**（生产源仓快速迭代，不走异步 PR）；`npm run check` 全绿才提交（pre-commit 也拦）。部署是独立的人工动作（见身份段），与 git 提交解耦。

1. squash 合并，main 历史一事一行；阶段节点打 tag（如 `v0.9.1`）。
2. 提交信息 `type：中文说明`（全角冒号，type ∈ feat / fix / docs / refactor / chore / test）；需要时开短命分支 `feature|fix|docs|chore/xxx`。

不入库：`dist/`、`node_modules/`、`*.log`、`.DS_Store`、微信工具的 `project*.config.json`。git 名词扫盲与完整教学见 史料「Git协作约定.md」。

## 9. 工作流 = skills（每个是元模式的一个环，详见 `docs/元模式.md` A5）

反复出现的多步工作流已固化成可直调 skill；调试/审核/验收别从头来，走对应 skill：

- **改一批（genesis）** `/refactor-batch`：根因 → 先守卫(红) → 改到绿 → `npm run check` → 反向自检 → squash + 记账。本仓任何改动都走它。
- **并行编排（genesis·规模档）** `/workflow-fanout`：几十个同构单元的活用 Workflow 多 agent 并行——批量重写/迁移（一单元一 agent＋保管道亲验）或两维 sweep 自修循环（逐页 lane＋对抗验证滤假阳＋正交 concern 维度＋round 零确认闭环）；并行产出、串行亲核，落地仍逐批走 `/refactor-batch`。
- **防过度工程（guardrail）** `/anti-overengineering-check`：喂规模/寿命/用途 → 先具体跑主路径 → 真实脏样本/characterization test 钉行为 → 抽象前查「当前痛点/第三次重复/业务预留来源」→ 小批次改 → `npm run check`。
- **调 bug（intake）** `/systematic-debugging`：复现 → 根因 → 修复带守卫 → 归因病根（不命中现有病根则立新病根 + 配守卫）。
- **体检（health）** `/deep-audit`：P0→P3 逐层验、核每病根有守卫（跑 `guard-coverage`）、分级标状态。
- **浏览器体检（health·web 前端）** `/browser-check`：web 前端体检——`rewrite/admin`/`rewrite/agent`/`rewrite/site` 页面变更收尾前必走，用 Playwright MCP 实起浏览器截图/点击/填表单验渲染与交互，「check 绿+构建过≠能用」在 web 端同样成立。
- **容量体检（health·规模）** `/capacity-check`：量上来扛不扛得住——峰值 QPS 换算、热路径扫规模杀手（聚合封顶/无界查询/缺索引）、基建维度（DB 套餐/视频带宽，代码看不到去控制台）、分清并发正确性 vs 容量、没压测就说推断（根因#8）。
- **文档体检（health·文档·loop ②周期发现的人工节拍）** `/doc-audit`：一句话起一圈——取真值快照 → 并行只读猎手扫全部活文档（清晰/准确/精准/简洁四维）→ **每条 finding 亲核**（猎手会误数/高估，验证不是相信）；「准确」对 git/代码交叉核（看现象不看声称·A7）；能喂回守卫的扩守卫面、不能的改文本，findings 交 refactor-batch 修。
- **治熵一圈（loop 总谱·串全环）** `/anti-entropy-loop`：一整轮对抗熵增的总谱——取真值快照 → ②并行猎手发现(7 类熵 E1–E7·每条亲核) → 三选一闭环(喂回守卫/改文本写明/退役) → 走 `/refactor-batch` 落地（沙箱 PR·本机直上 main）；含跨切判断纪律（验证不是相信/挡猎手 over-reach/不为凑数砍/不递扳机/不破单源）。composes `/doc-audit`(②)+`/refactor-batch`(落地)·不复述。
- **自主巡逻（health·自动节拍·/loop 可挂）** `/patrol`：每轮一次轻量巡逻——停轮闸+基线 → 单镜头轮换（状态文档/台账/守卫抽检/代码红旗）→ 三分诊（机器可修一批小修/要人验记账/拿不准停问）→ 轮报落 `巡逻日志`。/anti-entropy-loop 的 /loop 降档版（单镜头·每轮独立收口）；一句 `/loop /patrol` 起循环。
- **挖 hook（discovery）** `/hook-audit`：扫执行轨迹找该机器化的重复动作（只建议不装）。
- **验收（acceptance）** `/acceptance-check`：非技术看现象、真机验支付退款、验收单 X/Y/Z。
- **写 skill（meta）** `/writing-skills`：把反复用的工作流固化成 skill。

## 10. 关键决策摘要（详见 docs/关键决策记录.md，勿轻易推翻）

- 整体重写定标（决策§23）：原生 TS+glass-easel、云开发后端留任、admin/agent 重写、Astro 内容站——不要擅自换栈。
- 主题色幸运紫；admin 调色板单源 `tokens.css`、mp 见其 README。
- 敏感业务全走云函数，不信前端。
- 代码按技术分层组织，不按业务链重组（决策 §17）；逻辑链整体视图看 `业务逻辑架构.md`。
- 平台接缝单点（根因#12）见 §4「平台接缝单点」；接缝参数正册在 `console-assets/`。
- 旧线专属决策（uni-app 多端/px 不用 rpx/MediaSlot 等）随旧线退役，原文在 `关键决策记录.md` 与 archive。

## 11. 扩展套路与新会话

- mp 加页面：`rewrite/mp/pages/<name>/` 四件套 + `app.json` 注册。
- 加云端能力：`rewrite/cloud/src/functions/app/actions/`（用户端）或 `adminApi/actions/`（后台）+ 登记 `modules.json` 与 `docs/系统事实.md`。
- admin 加页面：`rewrite/admin/src/pages/<Name>.vue` + 路由/侧栏登记（`rw-admin-nav-route-synced` 守）。
- 改主题：admin 只改 `styles/tokens.css`；mp 见其 README。

新会话先看三样：本文件 → `docs/现状与路线.md` → `git status` + `git log --oneline -5`。其余文档按任务类型查（需求 → `需求清单`；系统现状 → `系统事实`；云开发 → 文档梳理；修 bug → 调试日志；重构 → 重构日志）。
