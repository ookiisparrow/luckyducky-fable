# 承面 C（外包会话工作台）· 施工工单（细化任务 + 多 CC 并行执行）

> **旧线批次账（2026-07-03 M5 切换前）**：本文全篇写于切换到 `rewrite/` 生产源之前，文中 `shared/cs.spec.ts`、`packages/agent`、`packages/cloud/src/functions/cs/...` 等路径指的都是**旧线**（今已冻结为参照物，见 CLAUDE.md 身份段）。M5 切换后客服/坐席台活代码在 `rewrite/cloud/src/functions/cs/`、`rewrite/cloud/src/functions/adminApi/actions/agentDesk.ts`、`rewrite/agent/`；`shared/cs.spec.ts` 这条注释所指的单源现已在新线落地为 `rewrite/shared/src/cs.spec.ts`（跨系统一致性收敛批新建·守卫 `rw-cs-transitions-declared` 核对账）。本文档其余内容按历史批次记录保留，不再随新线改动同步更新。
>
> **这是什么**：承面 C（L·最大块）的**可执行工单**——把 `施工蓝图.md 阶段六` 的 B6.1–6.4 细化到任务级，切成多 CC 并行车道。并行**机制**（worktree/git-tag 自动中继/master loop/5 单源纪律）在 `并行工作流.md`，本文只讲**承面 C 的活怎么切、每车道做什么**，不重抄机制。
> **决策**：用户 2026-07-01 拍板 **自建·先 C 后 A·直接上·不评 SaaS**；4 未定点按建议值定稿（见 §1）。项目此前单 CC（memory `single-cc-restored`），本次为承面 C **重启多 CC**——你一次性开车道 CC + master 跑 loop。
> **天花板诚实标**（施工蓝图 §95）：承面 C 是「会话+实时+排队+UI 互锁」的紧耦合单件，并行提速来自「车道 C 全程独立 + 车道 B 对 mock 与 A 重叠」，**非数量级**；且「顺手/可靠」只能真坐席真会话验（根因#8 靠人）。

## 0. 当前进度锚（真值见 `README.md` 进度表）

- ✅ **阶段0地基 Batch 1（数据契约）** 已落（commit `b6c2c9b`）：cs 会话状态机 `pending→active→closed(+escalated)`（单源 `shared/cs.spec.ts`·纳 `gen-order-domain-synced`）+ `csSession`/`agentState` 集合登记。
- ✅ **阶段0地基 Batch 2（契约收尾·扇出闸）** 已落：**M0.a** 坐席台 8 action I/O 契约单源 `packages/shared/src/csAgentDesk.ts`（车道 A 实现·车道 B 对 mock 共同遵·经 `@luckyducky/shared` 引·同步导出 `./cs`）；**M0.c** `kfCallback` 转人工分支 upsert `csSession` pending（`enqueueSession`·确定性 _id·幂等不 clobber active·让 csSession 有真实 writer→listQueue 有数据）。**cap `agent:handle` 运行时 wire + `order-transitions-declared` 扩扫 `functions/cs/` 按 §3 归车道 A**（与 action 同批落·不空守·契约里已文档化 cap 要求·本 Batch 不建 dead config）。→ **可扇出**。
- ✅ **三车道并行 + master 整合已落**（`integrate/cs-agent` squash 上 main）：A 坐席台后端 8 action（`adminApi/actions/agentDesk.ts`·cap wire·`transition('csSession')`）‖ B 独立 `/agent` 工作台（新包 `packages/agent`·对 mock）‖ C 前置件（数据共享告知同意 `cs/dataConsent`+同意页 / 外包账号管理 `actions/agents.ts`+admin 页 / 防导出 kit `assertOwnedByAgent`）。**master 安全收敛**：外包 RBAC 收窄为仅 `agent:handle`（去裸 `customer:view`·闭合批量导出洞）+ scope 闸单源化（A 经 `scopedLoad`→C 的 `assertOwnedByAgent`）+ 11 action 注册 adminApi ACTIONS/系统事实 + listKb 标 agent:handle。守卫 117·测试 852·云函数 38·check 全绿·build:cloud+agent 均过。
  - **follow-up（未做·待「接真接口 + 真机」阶段）**：① **scoped-360-for-outsourced**——外包收窄后不能直调 getCustomer360；B 的 360 侧栏（现 mock）接真时须建 scoped 路径（经 `assertOwnedByAgent`+`assertDataShareConsent`·后者是其真实消费者）；② **listMyActive**——契约缺「列我在接会话」，坐席刷新丢 active 会话（listQueue 加 status/mine 或补 action）；③ **B 接真后端**（`VITE_ADMIN_API`）+ 真坐席真会话验顺手/可靠（根因#8）；④ 部署（含 `cs/dataConsent` 新函数·build:agent 静态托管 `/agent`）+ 控制台锁新集合权限。

## 1. 四未定点定稿（2026-07-01·据此实现·别再问）

| # | 定稿 | 落到哪 |
|---|---|---|
| 外包能做什么 | **最小权：查 + 回复 + 升级**（改钱/改状态/退款留商户超管·外包无权） | cap `agent:handle` 只标 listQueue/getThread/claim/release/send/escalate/close·**不标**动钱动状态 action |
| 外包能见范围 | **分配制：只看自己 claim 的会话 + 对应 360**（防批量导出） | 守卫 `outsourced-reads-scoped`：outsourced 角色读会话/360 须带自己 agentId 的分配 scope + 限频 |
| 升级机制 | **escalateToMerchant**：state `active→escalated`·甩回商户超管处理 | 车道 A action + 状态机（已声明） |
| 实时 | **轮询**（云函数不适合长连 WS）：`getThread` cursor 增量·2-3s | 车道 A getThread + 车道 B 前端轮询 |

## 2. 阶段0地基 Batch 2（master 串行·扇出前必完成）

> 目的：把「所有车道遵的 API 契约 + 权限位 + 会话写入者」立齐，车道才能各自对着契约干、不打架。

- **M0.a 坐席台 API 契约声明**：`packages/cloud/src/functions/cs/agentDesk/contract.ts`（或 shared）——8 个 action 的 **输入/输出 TS 类型**（不含实现）：`listQueue`/`claimConversation`/`releaseConversation`/`sendAgentMessage`/`getThread`/`setAgentStatus`/`escalateToMerchant`/`closeConversation`。这是车道 A（实现）与车道 B（对 mock）**共同 import 的单一契约**。
- **M0.b cap `agent:handle`**：`ROLES.outsourced` 加 `agent:handle`；`ACTION_CAPS` 给上述 8 action 标 `agent:handle`（**与 action 同批落·不空守**）。→ **✅ 决策：不在 Batch 2 造 dead config，随车道 A 的 action 落**（现网 `ACTION_CAPS` 仅登记有实现的 action、未 gate 者默认拒 `admin:write`·守卫 `agent-rbac-gated` 在；空标 8 个不存在的 action = 空守，违 `lib.ts`「不立无 action 消费者的空 cap」+ Batch 1 提交明示）。Batch 2 已把「8 action 均须 `agent:handle`」写进契约（`csAgentDesk.ts` 头注 + 逐 action），车道 A wire 时引同一 cap 串（防漂移·根因#5）。
- **M0.c 会话入队写入者**：`kfCallback` 转人工分支（dispatch `transfer`）→ upsert `csSession`（`pending`·确定性 _id）——让 csSession 有真实 writer（会话进待接队列）。→ **✅ 已落 `enqueueSession`**（`.add` 撞确定性 _id 天然幂等·不 clobber 已认领的 active·根因#1；行为测试钉）。守卫 `order-transitions-declared` 扩扫 `functions/cs/` 随**首个 `transition('csSession')`**（车道 A claim/close/escalate 用字面量 `transition('csSession',…)` 时守卫才真发挥·§3 车道 A 办）。
- 产出：**✅ 契约 types（M0.a·shared）+ 队列写入（M0.c）+ `npm run check` 全绿（测试 787·守卫 112）**；cap 运行时 wire + 守卫扩扫 = 车道 A（§3）。→ **可扇出**（打 `cs/c-base/ready` 由 master 起并行时执行）。

## 3. 三车道细化拆分（阶段0地基 Batch 2 后并行）

### 🅰 车道 A · 坐席台后端（**关键路径·最长杆**·M-L）
> worktree `feat/cs-agent-be`·实现契约 actions·收发经 `kit/wecom`·状态机 `transition('csSession')`。

- **A1 = B6.1 会话收发**：实现 `listQueue`(pending 会话·bounded)/`claimConversation`(pending→active·绑 agentId·接待上限校验·`transition`)/`getThread`(读 conversations·cursor 增量·分配 scope)/`sendAgentMessage`(经 `kfSend`/`kit.wecom` send_msg·窗口内·出站落 conversations)/`escalateToMerchant`(active→escalated)/`closeConversation`(→closed·触 CSAT)/`releaseConversation`(active→pending 退回)。
- **A2 = B6.2 实时**：`getThread` cursor 增量（入站已由 kfCallback 落 `conversations`✅）；`csSession.lastCursor` 推进。
- **A3 = B6.3 排队/坐席态**：`setAgentStatus`(写 `agentState` online/busy/offline)·claim 时校验接待上限（activeCount<limit）+ 示忙排除·release/close 调整 activeCount。
- **守卫**：`order-transitions-declared` 对账 cs 承面C 流转 + `outsourced-reads-scoped`（分配 scope·**与车道 C 协调谁立**）+ 每 action bounded（纳 `capacity-reads-bounded`）+ `agent-send-window`（send 仅会话窗口·防越窗）。
- **登记面报 master**：新 action×8（adminApi ACTIONS + 系统事实）·cap·守卫。

### 🅱 车道 B · 坐席台前端（**对 mock 先建**·M）
> worktree `feat/cs-agent-fe`·独立 `/agent` 工作台（**不进 `/admin`**）·借开源聊天 UI 组件（非整套系统）。

- **B1 外包独立登录**：`/agent` 入口 + 外包账号登录（复用 adminApi checkKey·outsourced 角色）·在线/示忙切换。
- **B2 工作区组件**：待接队列（未读）/ 会话窗口（消息流·轮询 getThread）/ **360 侧栏嵌入**（复用 `getCustomer360`✅·iframe/组件）/ 快捷回复（读 `kb`✅）/ 升级转商户 / 结束会话（触 CSAT）。
- **对 mock 建**：按 M0.a 契约 types mock 8 action 响应先搭全 UI；master 整合时接车道 A 真接口。
- **登记面报 master**：新前端路由/页（`/agent`·独立部署单元）。

### 🅲 车道 C · 前置件（**独立·全程可并行**·S 多）
> worktree `feat/cs-agent-prereq`·与 A/B 无耦合·随时并。

- **C1 数据共享告知同意（B3.3）**：声明文案 + 同意 + 可撤回·守卫 `cs-data-share-consented`（**外包看客户数据的触发**·法律定稿归律师·CC 只机械化「文案已声明」）。
- **C2 外包账号管理 UI**：商户侧 `createAgent`/`disableAgent`/`listAgents`（后端·adminConfig 多账号·B5.2 骨架已在）+ admin 管理页（前端）。
- **C3 防导出守卫 `outsourced-reads-scoped`**：outsourced 读会话/360 须带分配 scope + 限频（与车道 A 协调：守卫定义在 C、A 的 action 遵它）。
- **已 done 不重做**：B5.4 审计 agent_id（`audit-operator-threaded`✅）。

## 4. 依赖与整合顺序

```
master 阶段0地基 Batch 2（契约+cap+队列写入·串行·扇出闸）
   ↓ 打 cs/c-base/ready
[并行] 车道 A 坐席台后端  ‖  车道 B 前端(对 mock)  ‖  车道 C 前置件
   ↕ 各自 check 绿 → git tag cs/<lane>/ready-<seq>（机制见 并行工作流.md §4）
master loop 轮询 tag → 整合（取并集解 5 单源面）→ 全局 check → push main
   ↓ 车道 B 整合时接车道 A 真接口（build 期对 mock 与 A 重叠）
🏁 master 部署（adminApi + /agent 外包台）+ 真人验收（真坐席真会话·根因#8 靠人·留足迭代）
```

- **闸**：阶段0地基 Batch 2 没完不开并行（契约未定=各造一套）。
- **关键路径**：车道 A（最长杆）；车道 B 对 mock 与 A 重叠、C 全程独立——提速来自这两处重叠，非数量级。

## 5. 多 CC 执行机制（引 `并行工作流.md`·不重抄）

- **worktree 布局**：master=`luckyducky-next`(main·唯一上 main·5 单源 owner·跑 loop)；`…-csA`(feat/cs-agent-be)·`…-csB`(feat/cs-agent-fe)·`…-csC`(feat/cs-agent-prereq)。每树首次 `npm install`。
- **自动中继**：车道 CC 一批绿 → push + `git tag cs/<lane>/ready-<n>`；master `/loop` 轮询 tag 自动 merge+check+push+`merged-<n>`；解不了的冲突打 `blocked-<n>` 报警转人工（不硬解）。
- **5 单源登记面只 master 串行改**：`kit/collections.ts`·adminApi ACTIONS+`系统事实.md`·`check-structure.mjs` 守卫·`README.md` 进度表·provider registry。车道**报**、master 整合时统一登记/取并集。
- **禁 `git add -A`**：各车道显式路径 add 自己文件（防扫别人半成品·memory `dont-commit-user-live-edits`）。

## 6. 三张 CC 冷启动工单（每车道自包含·你开会话时贴给它）

> 每个并行 CC 独立冷启动。开法：`cd <worktree> && claude` → 贴对应工单。

**车道 A / B / C 共同开头**：
> 你是承面 C 车道 <A坐席台后端 / B前端 / C前置件>。**先读** `docs/后台360工作站/`（`承面C工单.md`[本文]·`施工蓝图.md`·`架构规范.md`·`README.md`·`并行工作流.md`）进入状态。**守** 架构规范五铁律 + §1.5 信任边界 + CLAUDE 既有 112 守卫 + 走 `/refactor-batch`（先立守卫红→改绿→反向自检→squash）。**只做本车道**（§3 对应段的任务）。**不改 5 单源登记面**（§5·在 ready 信号里列要登记什么·master 办）。**产出** 本车道 action/UI/守卫/测试/记账·`npm run check` 全绿 → push `feat/cs-agent-<lane>` → `git tag cs/<lane>/ready-<seq>` + push tags → 完事（master loop 自动整合）。下一批前 `git fetch --tags` 看 merged/blocked。

## 7. 你的一次性动作

1. 等 master（本会话/主树）做完 **阶段0地基 Batch 2**（§2·契约扇出闸）。
2. master 预铺 3 棵 worktree + `npm install`。
3. 你 `cd` 各 worktree `claude` 开 3 个 CC，贴 §6 工单。
4. master 终端跑一次 `/loop` 启动整合循环。
5. 之后你只在 master `blocked` 报警时裁决 + 决定何时进下一波。真人验收靠你。
