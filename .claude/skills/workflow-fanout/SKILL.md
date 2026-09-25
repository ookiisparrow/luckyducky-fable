---
name: workflow-fanout
description: Use when 要用 Workflow 多 agent 并行编排干一大片同构工作——批量并行重写/迁移（一单元一 agent + 保管道亲验）或逻辑自修循环（逐页 lane 并行审计 + 对抗验证滤假阳 + 正交维度 sweep + 扫到一整轮零确认）。Triggers on "多 agent 并行", "并行重写", "workflow 并行", "fan out", "一屏一 agent", "自修循环", "两维 sweep", "并行审计", "逻辑 bug 扫一遍", "扫到零确认". 与 /refactor-batch 之别：那是单批落地纪律，本 skill 是把几十个单元编排成并行批的方法，落地仍逐批走 /refactor-batch。
---

# Workflow 多 agent 并行编排

> 核心信条：**并行产出、串行亲核**——agent 的声称一律当待核线索（`CLAUDE.md` 流水线第 3、4 步）。单元 <5 个或互相纠缠 → 别 fanout，顺序做。

## 模式A：并行重写/迁移（几十个同构单元，彼此无依赖）
1. **先立契约再放 agent**：写 plan 钉死铁律（不编数、诚实空态）、保管道清单（哪些 lib/api import 逐字保留）、单元→靶映射、共享视觉语言。规格里给字面代码前**先读那几行现场**。
2. **按域分批**（一批 5–8 单元），`pipeline` 一单元一 agent；prompt 必含：读靶、读现页保管道、套共享 kit、诚实空态。
3. **每批收口三亲验**：① diff 核管道（对 lib/api 应仅 +import、契约零改）；② `npm run check` + build 全绿；③ 无数据源的区块记 flag 给用户定，不造数。
4. 每批走 `/refactor-batch` 提交，精确路径 `git add`。

## 模式B：两维 sweep 自修循环
1. **逐页 lane**：N 页 = N 个审计 agent，返回结构化 findings。
2. **对抗验证**：另派 agent 专职反驳每条（能复现吗？前提真吗？），滤掉假阳才修。判据写死进 verifier prompt（例：「同步 resolve 的 await 微任务间隙 ≠ 竞态窗口」；「已登记的债 → 驳回注明已知」）。
3. **修复批 + 限范围复审**，专逮自引入回归；每轮配 regression lane，逐个复审上一轮的修复提交。
4. **换正交维度**：按不变量/失败态跨页扫（「载入失败还敢破坏性写吗」「成功提示会被 reload 吞吗」），逐页看不出的跨页问题靠它。
5. **收敛**：每个产出过 finding 的角度都扫到 0、再加一轮无镜头 fresh-eyes 也是 0，才算闭环。同一 pattern 连续两轮漏点名 → 改成 grep 全量清扫批，免修的列「已查免修」清单。
6. 守卫判据、取真源测试、mock 注入本身也是审计对象，收官前扫一轮。

## 编排纪律
- 执行者用低一档模型，prompt 先读 `.claude/skills/refactor-batch/执行者错题本.md`；承重 hunk（钱/权限/并发/状态机）主会话亲读或派高档评审员攻击；每批配一个无镜头评审员；改动文件 ⊆ 白名单在脚本层断言。模板 `.claude/workflows/batch-pipeline.mjs`。
- 默认 `pipeline()`；只有真要全量汇合（去重/早退）才用 `parallel()`。agent 返回 schema 钉死的精简结果。
- **改了规格不许 resume**（resume 按 prompt 回放缓存，会回放旧判决），一律新 run。
- **worktree 里跑先改模板 REPO**：`batch-pipeline.mjs` 的 REPO 写死主 checkout，拷一份改指 worktree 再用。
- **同一 worktree 批间串行**：边界断言看 `git status`，并发会把别批改动误判越界。
- 交付：worktree 分支多批多 commit + PR，合并用 rebase/merge commit（保一批一行），不用 squash。

## 模式C：多个 Claude Code 会话分线并行（人不当中继）
- 车道＝自包含板块（禁互相 import）；地基（框架/守卫/共同契约）由 master 串行先做完再开并行。
- 每车道一棵 worktree、各自 `npm install`（错题本 E11）；只有 master 树推 main。
- 中继靠 git tag：车道 check 绿 → push `feat/<线>-<lane>` → 打 `<线>/<lane>/ready-<seq>`；master 轮询 tag → merge → 全局 check → 绿则推 main 打 `merged-<n>`，解不了打 `blocked-<n>` 转人工。车道下一批前 `git fetch --tags` 决定续做还是修。
- 注册表类冲突热点（集合登记、ACTIONS、守卫表）只由 master 改；车道在 ready 信号里报要登记什么；禁 `git add -A`。

## 验收
拿得出：plan 文件（契约 + 批次勾选）、每批的提交、flag 清单（待用户定的产品决策）；模式B 另有「一整轮零确认」的证据。
