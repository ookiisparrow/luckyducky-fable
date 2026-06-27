# luckyducky-next · 重构样板房

「**高纬度自动化完全重构**」平行仓：用程序哲学与美学重构 Lucky Ducky（小棉鸭）整个项目，从生产仓 `ookiisparrow/luckyducky-miniprogram` 克隆而来（克隆点 `2dd5a72`，v0.9 即将上线版 + 外部审核批次 A/B）。

- **本仓禁部署**：与生产共用云环境 `cloudbase-d4gcssqbv06865479`，`scripts/guard-deploy.mjs` 拦截一切 tcb 部署/发布命令。切换上线由用户另行拍板（总计划 B8 runbook）。
- **设计宪章三原则**：意图是资产、删减的艺术（每批报净化指标）、让错误无处藏身（TS 非法状态不可表达）。
- 总计划与批次表（Phase A / B0–B8）见 `/Users/sparrow/.claude/plans/encapsulated-swimming-truffle.md`；仓内身份声明与执行纪律见 `CLAUDE.md` 头部。
