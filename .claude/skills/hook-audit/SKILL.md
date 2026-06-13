---
name: hook-audit
description: Use when 想系统性找出哪些反复手动做 / 反复被纠正 / 反复忘掉的动作该固化成 Claude Code hook —— 扫执行轨迹（~/.claude/projects/<slug>/*.jsonl）出排序建议。Triggers on "哪些该上 hook", "扫执行轨迹", "hook 机会", "把重复动作变守卫", "哪里能自动化成 hook", "trace 里什么该机器化". 区别 update-config（已知要装什么、去装）：本 skill 是发现端，只建议不安装。
---

# hook-audit —— 从执行轨迹挖 hook 机会

> 本 skill = 元模式的 **discovery 环**（`docs/元模式.md` A5）：从轨迹发现「该机器化却还靠人」的重复动作，喂给 genesis 环（refactor-batch）落成守卫/hook。

Claude Code 在本项目反复手动做的事都记在执行轨迹里。这套＝扫轨迹 → 找可固化为 hook 的位置 → 出排序建议。**只发现、不安装**；安装走 `update-config` + 一个 `refactor-batch` 批次。**本 skill 往仓里不写任何东西。**

## 跑

1. **出 digest**：`node .claude/skills/hook-audit/scan.mjs [项目路径|slug]`
   - 缺省扫当前项目；挖真实模式指向生产仓历史：`… -Users-sparrow-luckyducky-miniprogram`（本仓今天才克隆、轨迹薄）。
   - 读 transcript 是只读、在 `~/.claude` 仓外，不碰「禁动生产仓」红线。
2. digest 只给确定性计数（命令签名 / 编辑落点 / 开局重复读 / 报错·授权摩擦 / 守卫触发 / 收尾验证覆盖）。判断在你。

## 先做减法：减掉已机械化的（别重复建议）

本仓已装的，digest 里再热也不建议：
- `.claude/settings.json`：PreToolUse = guard-deploy（部署闸）；PostToolUse = check-conventions + check-structure。
- pre-commit（`scripts/git-hooks/pre-commit`）：conventions + lint + test。
- npm 守卫：interface-catalog-sync / writes-need-gate / flow-seam-single / docs-budget / visual-check RPC 探活。
- guard-deploy SENSITIVE_FNS（敏感云函数部署确认）。

→ 例：`git commit` 再高频也别建议「提交前跑 check」——pre-commit 已覆盖；digest「守卫触发」段点名某守卫 = 它在干活。

## 信号 → hook 事件（映射表）

| digest 里的信号 | 建议 hook | 为什么 |
|---|---|---|
| 改某类文件后反复忘验证（编辑落点集中 + 收尾验证覆盖低） | PostToolUse（Edit\|Write，按路径细分） | 编辑即校验 |
| 回合结束没跑 check/test 就收尾（edits ≫ validates） | Stop / SubagentStop | 收尾守卫 |
| 每会话开局重复读同几个文件 | SessionStart（additionalContext 注入） | 自动喂上下文，省 re-read |
| 反复被纠正同一个错（确定性可判） | PreToolUse deny + 理由 或 UserPromptSubmit 注入 | 机械拦在动手前 |
| 反复出现的危险命令形态 | PreToolUse deny（仿 guard-deploy） | 安全 |
| 高频确定性命令、只是想少点授权弹窗 | 不是 hook → 交 `fewer-permission-prompts` 配 allowlist | 别拿 hook 解决授权摩擦 |

## 过滤闸（核心纪律——别过度 hook 化）

只有**确定性、可机器检测的触发**才进 hook 候选；每条按 频次 × 确定性 × 收益 − 误报风险 排序。
触发要靠判断的（「看情况该不该…」）**不塞成 hook**，分流：
- 判断型规则 → 成文进 `CLAUDE.md` / 加一条 `check-conventions`·`check-structure` 机器守卫 / 记 memory。
- 授权弹窗摩擦 → `fewer-permission-prompts` skill。

## 产出 & 交接

- 每条存活机会：起草可直接粘的配置草稿（event + matcher + command / 脚本骨架）+ 证据（digest 计数 / 轨迹摘录）。
- **业务语言汇报**（所有者非技术）：排序清单，每条＝「现象（出现 N 次）→ 建议哪种 hook → 收益 / 代价 / 误报风险」。
- 要装：交 `update-config` 配 settings.json，并起一个 `refactor-batch`（改 settings / 脚本＝真改动 → 守卫 → 反向自检 → squash 提交）。

## 红线

- 只读挖矿、零安装；本 skill 不改 settings、不写仓。
- 不重复建议已机械化的（先做减法）。
- 判断型不硬塞成 hook → 分流到 convention-check / CLAUDE / memory。
- 授权白名单交 fewer-permission-prompts，不在这。
- 如实报证据与置信度：近似指标（报错数 / permission 切换 / 收尾覆盖）标「近似、需复核」。
