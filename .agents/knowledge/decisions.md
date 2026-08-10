# 决策日志（append-only）

## 条目 PL-001-01

- 时间: 2026-08-11T00:25:00
- 操作者: main
- 输入快照 hash: a854d42
- 结论: P2 核心实现双票审查均判"不通过（需再修）"
- 依据: .agents/archives/PL-001-w6p1.md (codex 9 项) + PL-001-w7p1.md (kimi 11 项, 含重复)
- 适用条件: P2 组件 (route.mjs / orchestrator.sh / pipeline-guard.ts)
- 失效条件: P2.1 修复完成且双票复核通过时
- 置信度: high
- 来源: B票(codex)+C票(kimi) 双拒
- 验证状态: 已验证[双票独立审查]
- 覆盖/推翻原因: -

## 双票交集必修（高置信）

1. 审查快照未真正绑定输入版本（工作区有未提交变更, 快照仅 HEAD commit 引用）
   → 修复: 审查前冻结工作区（commit 或 tar+sha256 快照包）, B/C 只读该快照
2. 子 agent 无隔离（kimi 在 /Users/sparrow 可访问项目, 非独立只读副本）
   → 修复: orchestrator 生成专用只读审查目录/worktree
3. pipeline 三组件无自身测试（1583 tests 不含流水线代码）
   → 修复: route.classify 导出 + 单测; guard 规则表测试; orchestrator 冒烟
4. 归档非真不可变（git add 未 commit; recent-unwrapped 可能读旧内容——kimi 实际发生）
   → 修复: 归档真正 commit; 读取源先 visible 后 recent; LD 参数路径穿越过滤

## 单方重要（主控采纳）

- codex: 守卫是黑名单非白名单——rm -fr/rm -r -f/git reset --hard 可绕过; 非 bash 工具(edit/write)未拦截 → 补规则 + 拦截写类工具
- codex: guard 在全局目录不受项目版本控制 → 项目内 .pi/extensions/ 同步受管副本
- codex: 未知任务默认 L2 可被含糊描述绕过 → 改 fail-closed: 无命中默认需人工确认(L0+human)
- codex: L1 审计失败静默 → 失败时 notify
- kimi: red 模块保护未落地 → guard 增加 red 文件写操作确认

## 判定
双票都拒 → 打回修改 → P2.1 修复清单执行

## 条目 PL-001-02

- 时间: 2026-08-11T00:45:00
- 操作者: main
- 输入快照 hash: da4ca4a
- 结论: P2.1 修复后双票复核仍判"不通过"（codex 9 项含严重 / kimi 12 项含 5 严重）
- 依据: .agents/archives/PL-001-w6p1.md + kimi 完整输出
- 适用条件: P2 组件
- 失效条件: P2.2 修复完成且双票复核通过时
- 置信度: high
- 来源: B票(codex)+C票(kimi) 双拒
- 验证状态: 已验证[双票独立审查]
- 覆盖/推翻原因: -

## 双票交集必修（P2.2）

1. 冻结包不含代码 → B/C 读活仓库（快照失效）→ freeze 用 git archive 打包代码
2. archive 自动 git commit --no-verify → 污染主仓库历史+绕过复核钩子 → 归档只写文件+sha256, 不自动 commit
3. guard 硬编码绝对路径 → 不可移植 → 环境变量/相对解析
4. 正则绕过 (git -C / rm 大写R / find -delete / npx cloudbase / python rmtree) → 补规则
5. red 文件匹配: codex 说遗漏 + kimi 说 includes 误报 → 精确目录边界匹配
6. orchestrator 无测试 → 冒烟测试
7. 归档读取 200 行截断 → 扩到 400 行
