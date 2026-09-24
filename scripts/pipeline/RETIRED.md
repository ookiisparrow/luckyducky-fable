# scripts/pipeline 退役记录

## guard-hook.mjs（已删除）

- **原用途**：计划作为 codex/kimi 共用的 PreToolUse 权限守卫 hook，与 pi 的 pipeline-guard.ts 共用 `guard-rules.mjs` 规则表。
- **删除原因**：该脚本默认项目根路径硬编码为 `~/luckyducky-fable`（与真实路径 `/home/ookii/Work/github/luckyducky-fable` 不符），且仓内无任何引用、未注册进 `scripts/check-structure.mjs`、未在 `package.json` / git hooks / `.claude/settings.json` 中接线，属于“死实现”。
- **功能替代**：
  - 红区/钱链写保护已由 `scripts/git-hooks/pre-commit`（`MONEYCHAIN_ALLOWED`）、`scripts/git-hooks/commit-msg`（`[red-review:]`）以及 `scripts/check-structure.mjs` 的 `moneychain-gate-present` 等守卫覆盖；
  - 编辑期权限控制已由 `.claude/settings.json` 的 `permissions.allow/deny` 与 `PreToolUse`/`PostToolUse` hooks 覆盖。
- **保留项**：`guard-rules.mjs` 仍作为规则表被 `scripts/check-structure.mjs` 和 `tests/scripts/pipeline/guard-rules.test.js` 引用，继续生效。
- **决定**：赵大爷令 Kimi 于 2026-08-26 按 `refactor-batch` 流程删除并新增守卫防止再生。
