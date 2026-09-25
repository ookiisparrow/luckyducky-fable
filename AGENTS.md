# AGENTS.md — 任何 AI 代理的进场入口（厂商中立）

> 工程约定单源在 `CLAUDE.md`，本文件只做路由。Cursor 等非 Claude 代理原生读本文件进场。

## 进场三步

1. **读约定**：`CLAUDE.md`（危险速览/干活流水线/不变量/判断题，全在里面）。
2. **认地图**：仓根 `modules.json`（模块归属 + 危险分级 `tier: red/yellow/green`）；动手前 grep `docs/关键决策记录.md` 与 `docs/根因账本.md` 查有没有判过。
3. **看现状**：先 `git fetch` 对 origin/main（本地历史可能落后·错题本 E24）→ `docs/现状与路线.md` + `git log --oneline -5`。

## 三条铁律（无论厂商）

- **验收共同语言 = `npm run check` 全绿**；快检 `node scripts/check-structure.mjs`（秒级）。
- **不许碰**：`scripts/check-*.mjs` 与 `.claude/`（裁判不被球员改写）、部署命令（`tcb`/`deploy-fns`/wechatide 写类＝人工授权动作）。
- **改动纪律**：任何批次走 `.claude/skills/refactor-batch/SKILL.md`（先写会红的测试 → 改到绿 → 反向自检 → 一批一 squash）；执行前必读同目录 `执行者错题本.md`。

## 非 Claude 代理的边界

- 只碰**非 red 面**（分级以 `modules.json` 为准）；red 两模块（订单交易钱链/运维观测与系统配置）、部署、数据库不可逆操作恒禁，先问老板，**宁停勿猜**。
- **MCP/云扩展禁自装**：任何引入 MCP 或云端直连能力的扩展，接入前必须复刻 `.claude/settings.json` 的全部 deny 规则并经老板确认；裸 `tcb`/`wechatide` 写命令同属部署面人工授权，不因没有钩子拦着就自跑。
- 工单单源：GitHub Issues；不自派任务。

## 一句话地形

钩织材料包电商小程序 + 云开发后端 + 管理后台 + 内容站。活代码全在 `rewrite/`，**本仓＝生产源**、部署真实生效于生产云环境——这不是沙盒。
写 admin UI 先读 `rewrite/admin/DESIGN.md`。色值只许来自 `rewrite/admin/src/styles/tokens.css`。
