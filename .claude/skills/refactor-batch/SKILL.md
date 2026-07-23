---
name: refactor-batch
description: Use when doing any change/batch/audit/fix in the Lucky Ducky 重构线仓 (/Users/sparrow/luckyducky-fable) — enforces 根因→先立守卫(红)再改到绿→顺手退役被取代的旧守卫(删与加对等)→npm run check 全绿→反向自检→squash 提交+推送+核验冻结仓零改动→记 重构日志. Triggers on "继续(重构)", "做这批", "修…", "审核", "加守卫", or any edit landing in luckyducky-fable.
---

# 重构批次纪律

> 本 skill = 元模式的 **genesis 环**（`docs/元模式.md` A5）：一批改动从「先守卫后实现」到「反向自检 + 归因」。循环定义见元模式，本文是它在本仓的执行纪律。

本仓（fable 重构线）每一处改动（功能/审计/修复/加守卫）都按这套走。**铁律：冻结仓 `/Users/sparrow/luckyducky-next`（回滚基线）零改动——紧急止血除外且须用户明示；一切迭代在 `luckyducky-fable`；部署是独立人工动作、必过 `guard-deploy` 部署闸（共用真实云环境，见 CLAUDE 身份段），git 提交与部署解耦。**

## 接活前
1. 读 `docs/重构日志.md` 最新一批 + `git log --oneline -5`；修 bug 先查 `docs/根因账本.md` 同类病根；执行前必读同目录 `执行者错题本.md`（历任执行者踩坑清单）。
2. 定位这批治哪条根因/主张。**每主张 / 不变量 → 一条机器守卫**（不是靠人记）。

## 改造（意图先行：先守卫后实现）
3. **能机器化的先加守卫、让它红**，再改代码到绿：
   - 跨文件 / 仓级不变量 → `scripts/check-structure.mjs` 的 repoCheck / fileRule。
   - 单文件样式 / 多端写法 → `scripts/check-conventions.mjs`。
   - 类型层（金额 Fen、状态联合）→ TS 编译期。
   - 行为不变量（钱 / 权限 / 状态 / 幂等）→ `tests/`，业务不变量优先锁。
   - **新加守卫标 `roots`**（治哪条病根 `#N` / 主张 `TN`）+ reverseTest；`guard-coverage` 据此核每病根有守卫，漏标即覆盖率红。新治一条病根 → 先在 `docs/根因账本.md` §一立条目，守卫才有归属。
4. **顺手退役（「删」和「加」对等·治「只增不减」的熵）**：改完先问一句——这批让某条**旧守卫变多余**了吗？三种信号：① 被本批新守卫/注册表**取代**；② 所守的功能/分支**已删**（守一个不存在的东西＝纪念碑）；③ N 条窄守卫可**折成「一张表 + 一条守卫」**（`known-collections-only`/`known-error-codes` 范式·元模式 A2「守卫粒度会收敛」）。命中就**当批退役**：删守卫 + 若某病根/主张因此失守，补挡或在 CLAUDE 转「靠人」豁免（`guard-coverage` 会拦覆盖缺口）。退役与新增**同批走完 step 7–8 验证**。为什么必须每批自省：**守卫总数没有守卫管它**（元模式 A2）——「加」有 step 3 的流程、「删」只能靠本步，不自省就必然只增不减。
5. 不能干净机器化的（方法论 / 守则）→ 成文进 CLAUDE / 验收手册，并写清「为什么靠人」。
6. 新增云函数 → 登记 `docs/系统事实.md`（接口正册·`interface-catalog-sync` 会拦）；新增写库 → 必过 kit 闸（`writes-need-gate` 会拦）；新增敏感云函数 → 加进 `scripts/guard-deploy.mjs` SENSITIVE_FNS。

## 验证（缺一不可）
7. `npm run check` 全绿（conventions + structure + typecheck + lint + test）。被拦先修代码、不绕闸。
8. **反向自检**：临时篡改这批新加的守卫 / 不变量 → 必须红 → 还原 → 绿。证明守卫真在咬、不是摆设。
9. 碰云产物 / 部署形态：活线 `npm run build:rw-cloud`（旧线参照才用 `build:cloud`）；碰页面：活线 `rewrite/mp` 为原生小程序无 bundler 构建、`npm run typecheck` 即等价校验（旧线页面才跑 `build:h5`）DONE。

## 收尾
10. 直接上本仓 main（本仓不走异步 PR），**一批一个 squash 提交**；信息 `type：中文说明`（type ∈ feat / fix / docs / refactor / chore / test，全角冒号）。
11. `git push`（GitHub 备份库 `ookiisparrow/luckyducky-fable`）。
12. **核验冻结仓零改动**：`git -C /Users/sparrow/luckyducky-next status --short`（空）+ HEAD 未变。
13. 记 `docs/重构日志.md`（结论 + 净化指标 / 根治病根 + 验证证据 + 反向自检 + **本批退役/折叠了哪些守卫**）+ 新踩的坑记回 `执行者错题本.md`。
14. 向用户汇报用**业务语言**、决策给收益 / 代价（用户非技术）；如实报结果（红就说红、跳过就说跳过）。

## 红线
- 冻结仓（next）不碰；部署不绕 guard-deploy 闸；不删 8 件控制台正册资产。
- 守卫被拦 = 修代码，不是加 `convention-ok` / `structure-ok` 绕过（确属刻意例外才加，先确认）。
- 主张没守卫不算做完；守卫反向自检不变红不算可靠。
