---
name: refactor-batch
description: Use when doing any change/batch/fix in luckyducky-fable — 意图单 → 先写会红的测试/守卫 → 改到绿 → npm run check 全绿 → 反向自检 → 一批一个 squash 提交推分支 → PR 带证据。Triggers on "继续", "做这批", "修…", "加守卫", or any edit landing in luckyducky-fable.
---

# 批次纪律

> 对应 `CLAUDE.md` 流水线第 3、4 步：完成只由机器判，声明带证据。

部署是独立的人工授权动作（`guard-deploy` 闸），与提交解耦。

## 接活前
1. `git fetch` 后看 `origin/main` 的 `git log --oneline -10` 和 `gh issue list --state open`；修 bug 先查 `docs/根因账本.md` 同类病根；读同目录 `执行者错题本.md`。
2. 写意图单：用大白话写清这批改什么、业务规则是什么、为什么。涉钱/库存/权限的规则先让老板点头；其余写明供老板抽查。

## 改
3. **先写一个会红的检查，再改到绿**：
   - 行为（钱/权限/状态/幂等）→ 测试，放 `tests/` 或各包 `tests/`。
   - 金额、状态名这类能用类型表达的 → TS 类型。
   - 仓级结构规则 → `scripts/check-structure.mjs`，但先过下方「守卫准入」，UI 实现细节不加守卫。新守卫标 `roots`（病根号）。
4. **顺手删**：这批让哪条旧守卫/旧测试多余了（被取代、守的功能已删、能并成一张表）？当批删掉。守卫总数没有别的机制管，只能靠每批自省。
5. 新增云函数/action → 登记 `modules.json`；新增写库 → 过 kit 闸；新增敏感云函数 → 加进 `scripts/guard-deploy.mjs` 的名单。
6. 注释里不写「由守卫 X 保证」，除非 grep 确认它真在（`CLAUDE.md` 流水线第 1 步）。

## 验证（缺一不可）
7. `npm run check` 全绿。被拦先修代码，不绕闸，不 `--no-verify`。
8. **反向自检**：把这批的修复或新规则临时改坏，检查必须变红；改坏后先 grep 确认真改到了，还原后也要 grep 确认（错题本 E14/E19/E21）。
9. 碰云函数产物跑 `npm run build:rw-cloud`；碰 admin/agent/site 跑对应 build。

## 收尾
10. 推分支，不直接推 main。一批一个 squash 提交，信息 `type：中文说明`（全角冒号，type ∈ feat/fix/docs/refactor/chore/test）。
11. 提交信息写清：结论、验证证据、反向自检结果、本批删了哪些守卫。新踩的坑记回 `执行者错题本.md`。
12. PR 里凡写「真机验过/压测过」，附日志、截图或命令输出。
13. 向老板汇报用业务语言；红就说红，跳过就说跳过。

## 守卫准入（加一条结构守卫前先过这张表）
| 值得机器守 | 不守（交给行为测试或 review） |
|---|---|
| 钱、权限、状态流转、部署 | UI 实现细节（哪个节点绑了哪个事件、用哪个 CSS 写法） |
| 手抄副本必须一致（小程序进不了 shared、只能落副本的常量） | 治理文档自身：计数、指针、覆盖率 |
| 没有编译器兜底的格式（wxml、wxs、包体积） | 已否决的产品方案，除非真的回潮过 |

新守卫要说得出防的是哪次真实事故或哪条红线；同类窄守卫攒多了合成「一张注册表 + 一条守卫」；只在反向自检里红过、从没拦过真实改动的，复查时优先删。

## 红线
- 部署不绕 `guard-deploy`；不删 `console-assets/` 正册资产。
- 被守卫拦 = 修代码。确属刻意例外才行内加 `structure-ok`，先确认。
