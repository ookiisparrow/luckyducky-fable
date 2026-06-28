---
name: refactor-batch
description: Use when doing any change/batch/audit/fix in the Lucky Ducky 重构样板房 (/Users/sparrow/luckyducky-next) — enforces 根因→先立守卫(红)再改到绿→npm run check 全绿→反向自检→squash 提交+推送+核验生产仓零改动→记 重构日志/memory. Triggers on "继续(重构)", "做这批", "修…", "审核", "加守卫", or any edit landing in luckyducky-next.
---

# 重构批次纪律

> 本 skill = 元模式的 **genesis 环**（`docs/元模式.md` A5）：一批改动从「先守卫后实现」到「反向自检 + 归因」。循环定义见元模式，本文是它在样板房的执行纪律。

样板房每一处改动（功能/审计/修复/加守卫）都按这套走。**铁律：生产仓 `/Users/sparrow/luckyducky-miniprogram` 零改动；一切在 `luckyducky-next`；本仓禁部署（guard-deploy 一律 deny，勿绕）。**

## 接活前
1. 读 `docs/重构日志.md` 最新一批 + `git log --oneline -5`；修 bug 先查 `docs/根因账本.md` 同类病根。
2. 定位这批治哪条根因/主张。**每主张 / 不变量 → 一条机器守卫**（不是靠人记）。

## 改造（意图先行：先守卫后实现）
3. **能机器化的先加守卫、让它红**，再改代码到绿：
   - 跨文件 / 仓级不变量 → `scripts/check-structure.mjs` 的 repoCheck / fileRule。
   - 单文件样式 / 多端写法 → `scripts/check-conventions.mjs`。
   - 类型层（金额 Fen、状态联合）→ TS 编译期。
   - 行为不变量（钱 / 权限 / 状态 / 幂等）→ `tests/`，业务不变量优先锁。
   - **新加守卫标 `roots`**（治哪条病根 `#N` / 主张 `TN`）+ reverseTest；`guard-coverage` 据此核每病根有守卫，漏标即覆盖率红。新治一条病根 → 先在 `docs/根因账本.md` §一立条目，守卫才有归属。
4. 不能干净机器化的（方法论 / 守则）→ 成文进 CLAUDE / 验收手册，并写清「为什么靠人」。
5. 新增云函数 → 登记 `docs/系统事实.md`（接口正册·`interface-catalog-sync` 会拦）；新增写库 → 必过 kit 闸（`writes-need-gate` 会拦）；新增敏感云函数 → 加进 `scripts/guard-deploy.mjs` SENSITIVE_FNS。

## 验证（缺一不可）
6. `npm run check` 全绿（conventions + structure + typecheck + lint + test）。被拦先修代码、不绕闸。
7. **反向自检**：临时篡改这批新加的守卫 / 不变量 → 必须红 → 还原 → 绿。证明守卫真在咬、不是摆设。
8. 碰云产物 / 部署形态：`npm run build:cloud`；碰页面：至少 `npm run build:h5` DONE。

## 收尾
9. 直接上本仓 main（样板房不走异步 PR），**一批一个 squash 提交**；信息 `type：中文说明`（type ∈ feat / fix / docs / refactor / chore / test，全角冒号）。
10. `git push`（GitHub 备份库 `ookiisparrow/luckyducky-next`）。
11. **核验生产仓零改动**：`git -C /Users/sparrow/luckyducky-miniprogram status --short`（空）+ HEAD 未变。
12. 记 `docs/重构日志.md`（结论 + 净化指标 / 根治病根 + 验证证据 + 反向自检）；更新 memory `rebuild-parallel-repo`。
13. 向用户汇报用**业务语言**、决策给收益 / 代价（用户非技术）；如实报结果（红就说红、跳过就说跳过）。

## 红线
- 生产仓不碰、不部署、不删 8 件控制台正册资产。
- 守卫被拦 = 修代码，不是加 `convention-ok` / `structure-ok` 绕过（确属刻意例外才加，先确认）。
- 主张没守卫不算做完；守卫反向自检不变红不算可靠。
