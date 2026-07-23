# AGENTS.md — 任何 AI 代理的进场入口（厂商中立）

> 本仓由 AI 施工队维护：不同公司的模型都可能在此干活。本文件是**通用进场手册**——不管你是哪家的模型、跑在哪个工具里，从这里开始。完整工程约定的单源在 `CLAUDE.md`（本文件只做路由，不复述，防双源漂移）。

## 进场三步

1. **读约定**：`CLAUDE.md`（全部工程约定·按「痛→不变量→守卫」组织）。旧线 `packages/` 专用条款在 `docs/旧线工程约定.md`（不碰旧线不用读）。
2. **认地图**：仓根 `modules.json` = 模块正册——你要动的 action/页面/集合属于哪个模块、什么危险档（`tier: red/yellow/green`），先查它。red 模块（钱链/运维配置）不是你该独自动的。
3. **看现状**：`docs/现状与路线.md` + `git log --oneline -5`。

## 铁律（对所有代理，无论厂商）

- **验收的共同语言 = `npm run check` 全绿**（conventions+structure+typecheck+lint+test）。改完必跑；红灯就是你的任务清单，报错是处方级的、照着修。
- **快速反馈**：改完一个文件先跑 `node scripts/check-structure.mjs`（约 1.4 秒，覆盖全部仓级不变量），别等到最后才发现登记漏了。
- **不许碰**：`packages/`（字节级冻结）、`scripts/check-*.mjs` 与 `.claude/`（验收机器本身，裁判不能被球员改写）、部署命令（`tcb`/`deploy-fns` 是人工授权动作）。
- **改动纪律**：任何批次走 `.claude/skills/refactor-batch/SKILL.md`（先立守卫红→改到绿→反向自检→记账 `docs/重构日志.md`）。
- **动手前查判例**：项目大量「拍板不做/故意不修」的决定记录在 `docs/关键决策记录.md`、`docs/待办与债.md`、`docs/根因账本.md`——别把老板否掉的方案再做一遍。

## 一句话地形

钩织材料包电商小程序 + 云开发后端 + 管理后台 + 内容站。活代码全在 `rewrite/`（mp 小程序 / cloud 云函数 / shared 契约 / admin·agent 后台 / site 内容站），部署真实生效于生产云环境——这不是沙盒。
