# AGENTS.md — 任何 AI 代理的进场入口（厂商中立）

> 工程约定单源在 `CLAUDE.md`，本文件只做路由。2026-08-02 决策§34 恢复：多代理放开（双轨试运行·去单一供应商锁定），oh-my-pi 等代理原生读本文件进场。

## 进场三步

1. **读约定**：`CLAUDE.md`（危险简报/干活循环/不变量表/判断题/查询路由，全在里面）。
2. **认地图**：仓根 `modules.json`（模块归属 + 危险分级 `tier: red/yellow/green`）；动手前 grep `docs/判例索引.json` 查有没有判过。
3. **看现状**：先 `git fetch` 对 origin/main（本地历史可能落后·错题本 E24）→ `docs/现状与路线.md` + `git log --oneline -5`。

## 三条铁律（无论厂商）

- **验收共同语言 = `npm run check` 全绿**；快检 `node scripts/check-structure.mjs`（秒级）。
- **不许碰**：`scripts/check-*.mjs` 与 `.claude/`（裁判不被球员改写）、部署命令（`tcb`/`deploy-fns`/wechatide 写类＝人工授权动作）。
- **改动纪律**：任何批次走 `.claude/skills/refactor-batch/SKILL.md`（守卫先红 → 改到绿 → 反向自检 → 一批一 squash）；执行前必读同目录 `执行者错题本.md`。

## 双轨边界（2026-08-02 起）

试运行代理只碰 **green 模块**的低危批次；red 区（钱链/运维配置）、部署、数据库不可逆操作先问老板，**宁停勿猜**。

## 一句话地形

钩织材料包电商小程序 + 云开发后端 + 管理后台 + 内容站。活代码全在 `rewrite/`，**本仓＝生产源**、部署真实生效于生产云环境——这不是沙盒。
