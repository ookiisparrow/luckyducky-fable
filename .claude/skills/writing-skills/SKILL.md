---
name: writing-skills
description: Use when creating, editing, or porting a Claude Code skill (a reusable workflow in .claude/skills/<name>/SKILL.md). Triggers on "写个 skill", "做成技能", "移植 skill/技能", "capture this workflow", or wanting to turn a recurring workflow into a reusable command.
---

# 写 skill 的 skill

把「反复用到的工作流」固化成可复用技能。一次性的事不做 skill。

## 何时该做 skill
- **该做**：会反复出现、有稳定步骤的工作流（调试套路、发版检查、某类评审）。
- **不该做**：一次性任务、一句话能说清的小事、已有 skill 覆盖的。
- **移植外部 skill**（superpowers / gstack 等）：**摘思路、按本项目约定重写，不整包复制**——整包会和本项目 CLAUDE.md / 守卫系统打架，且吃 context（与用户 2026-06-13 的讨论结论）。本仓现有 skill 即范例。

## 解剖（一个 skill 长什么样）
- 目录：`.claude/skills/<kebab-name>/SKILL.md`（项目级，随仓版本管理）或 `~/.claude/skills/`（用户级，跨项目）。
- frontmatter 两字段：
  - `name`：kebab-case，与目录同名。
  - `description`：**这是触发器**——第三人称、写清「何时用」、含真实触发词。Claude 靠它决定何时自动调用。
- 正文：聚焦、可执行的祈使句，一个 skill 一个意图；可引同目录其他文件。

## 写好 description（最关键，决定命不命中）
- 写「何时用」不是「是什么」：`Use when …`，列触发场景 + 用户真会打的词（中英都放，提高命中）。
- 具体 > 笼统：「调试 bug / 测试 flaky / 报错」远胜「帮助调试」。
- 反例：`description: 调试工具`——太泛，要么不触发要么乱触发。

## 正文纪律
- **短**。删一切背景铺陈，留可执行步骤。
- **命令式**：「先复现」「跑 npm run check」，不是「你可以考虑…」。
- **贴本项目**：引 CLAUDE.md 约定、机器守卫（`npm run check` / `check-structure`）、相关文档路径（`docs/根因账本.md` 等），让 skill 和项目长在一起、可读可控。
- 标注 mock / demo / 一次性行为（同代码注释纪律）。

## 验收一个 skill（写完自检）
1. **触发对不对**：在该触发的场景描述下会被选中吗？不该触发时会误触吗？
2. **行为对不对**：照它做，产出是不是预期？
3. **可读**：非技术所有者能看懂它在干嘛吗（本项目所有者非技术，汇报/产物都要业务语言）？

> 一句话：**description 写准触发；正文短、命令式、贴本项目约定；反复用才做，一次性不做。**
