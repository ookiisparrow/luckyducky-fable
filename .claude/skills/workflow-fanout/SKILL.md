---
name: workflow-fanout
description: Use when 要用 Workflow 多 agent 并行编排干一大片同构工作——批量并行重写/迁移（一单元一 agent + 保管道亲验）或 逻辑自修循环（逐页 lane 并行审计 + 对抗验证滤假阳 + 正交 concern 维度 sweep + round 收敛零确认闭环）。Triggers on "多 agent 并行", "并行重写", "workflow 并行", "fan out", "一屏一 agent", "自修循环", "两维 sweep", "并行审计", "逻辑 bug 扫一遍", "扫到零确认". 与 /refactor-batch 之别：那是单批落地纪律，本 skill 是把几十个单元的活编排成并行批的方法，落地仍逐批走 /refactor-batch。
---

# Workflow 多 agent 并行编排（fanout 方法）

> 实战来源：M-adminImpl（30 页并行重写·6 批）、admin2 迭代I（两维 sweep·round6 零确认）、bug 清除战役 I（4 轮 81 项）、**战役 II（9 轮 55 项·13 批·Round9 零确认·规格预审 4 次咬中真矛盾）**，账在 `docs/重构日志.md`。核心信条：**并行产出、串行亲核——验证不是相信**（元模式 A7）。用户已拍板分层执行：fable 做大脑、执行派下层模型，agent 只返回精简结构化结果。

## 何时用哪个模式
- **模式A 并行重写/迁移**：几十个同构单元（页/屏/函数域）各自独立改写，彼此无依赖。
- **模式B 自修循环（sweep）**：改完一大片后要把逻辑 bug 扫到干净，或用户说「自检自修至无 bug」。
- 单元 <5 个或互相纠缠 → 别 fanout，直接顺序做。

## 模式A：一批一交付的并行重写
1. **先立契约再放 agent**：写执行跟踪 plan（`~/.claude/plans/`）钉死——铁律（不编数/诚实空态）、保管道清单（哪些 lib/api import 逐字保留）、单元→靶（如 frame ID→页面 映射表）、共享视觉语言/kit。
2. **按域分批**（一批 5-8 单元），Workflow `pipeline` 一单元一 agent；每个 agent prompt 必含四件：读靶（设计帧/规格）＋读现页保管道＋套共享 kit＋诚实空态不编数。
3. **每批收口三亲验**（不信 agent 声称）：① script diff 亲验管道（对 lib/api 的改动应仅 +import、契约零改）；② `npm run check` 全绿＋build 绿；③ 无源区块记 flag 给用户定，不造数糊过。
4. 每批走 `/refactor-batch` 提交（精确路径 git add——并行会话可能有别的未提交改动）。

## 模式B：两维 sweep 自修循环
1. **维度一 逐页 lane**：N 页 = N 个审计 agent 并行，各返回结构化 findings。
2. **每条 finding 对抗验证**：另派 agent 专职反驳（能否复现？前提真吗？），滤假阳后才进修复批——迭代I 首轮 20 条滤掉 4 假阳。
3. **修复批 + re-audit**：修完限范围复审，专逮自引入回归（迭代I 批7 逮出 5 条）。
4. **换正交维度 concern sweep**：按不变量/失败态跨页扫（如「载入失败→还敢破坏性写吗」「成功提示会被 reload 吞吗」）——逐页 eyes 看不出的跨页合谋类靠它逮（迭代I 由此逮出 2 条 P1 删档）。
5. **round 收敛**：每轮=发现→对抗验证→修→复审；直到一整轮**零确认**才算闭环，不许「感觉差不多」收工。
6. 修出的类问题能焊守卫的焊守卫（反向自检咬红），走 `/refactor-batch` 逐批落地。

### 收敛与判定纪律（战役 II 增补·9 轮实录）
- **收敛非单调**：换新镜头角度会再挖出一批（战役 II R6 新开「kit 可观测/过期文案」角度 +4 条）。「零确认」判定的前提是**每个产出过 finding 的角度都被扫到 0 才算关闭**（R7 对 kit 全目录终扫=0 才关角度）；终判轮=批回归+已知角度浓缩对账+无镜头 fresh-eyes。
- **同 pattern 残漏别逐条追**：一族 pattern 连续两轮漏点名（如 admin 表单误关族）→ 停止点名制，改**pattern 全量清扫批**：grep 枚举全部实例、命中即修、免修的列「已查免修」清单留档（文件+函数+理由一行一条）——给下一轮零确认创造条件。
- **每轮必配 regression lane**：git show 逐个复审上一轮修复提交 ±上下文，专找自引入缺陷——真会有（战役 II 逮出「修 open/act 漏 send 同族」「云端半修使前端新分支永不命中」）。
- **对抗验证判据写死进 verifier prompt**：「同步 resolve 的 await 微任务间隙≠竞态窗口——事件循环推演要严谨」这一句驳回了 4 条貌似合理的假阳；「已登记债→REFUTED 注明已知债」防重复报。
- **防线自身进扫描面**：守卫判据/取真源测试/mock 注入也是审计对象（战役 II 逮出：取真源不剥注释→注释掉保护代码断言仍绿；spyOn 无 try/finally 污染共享原型；守卫字面量判据对可选链假红）。收官前跑一轮 guard-audit lane。

## 编排纪律（两模式通用）
- **模型分层遵流程 v2**（单源＝memory `layered-execution-preference`，此处只列钩子不复述）：执行者 `model:'sonnet'`＋提示词先读 `.claude/skills/refactor-batch/执行者错题本.md`；承重 hunk（钱/权限/并发/状态机）fable 亲读或派高档评审员攻击；批次必配无镜头评审员；改动文件 ⊆ 白名单在脚本层断言；优先用模板 `.claude/workflows/batch-pipeline.mjs`。
- Workflow 脚本默认 `pipeline()`，只有真需要全量汇合（去重/早退）才用 `parallel()` barrier。
- agent 返回**精简结构化结果**（schema 钉死），不要大段散文；主会话只拿结论做亲核与编排。
- 并行期 git 纪律：精确路径 add、每批 check 全绿、冻结仓（`../luckyducky-next`）零改动核验。
- 进度记账：plan 文件记批次勾选与 flag 汇总；里程碑落 `docs/重构日志.md`。

### 规格与流水线机制坑（战役 II 增补）
- **规格预审是与对抗验证并列的最大杠杆——但主脑的「钉死」也会失真**：战役 II 预审 4 次咬中真矛盾，全是我写规格时没亲读现场（pageQuery 硬编码 desc 与队列 FIFO 不可兼得、函数名 saveAgent 不存在、文件路径指错、footerLink 钉死实现与测试段自相矛盾）。规格里给字面代码前**必须先读那几行现场**；预审报「矛盾」也要人工裁决——lint agent 会把「未发现矛盾」的说明误塞进 contradictions 数组造成假中止。
- **改规格后不许 resume**：Workflow resume 按 (prompt,opts) 回放缓存——lint/finder 的 prompt 若未变会回放旧判决。改了 spec 一律新 run；预审已人工核过的可 `skipSpecLint: true`。
- **worktree 作业先修模板 REPO**：`batch-pipeline.mjs` 的 REPO 写死主 checkout——后台 job 在 worktree 里跑会让执行者改到用户工作区。拷一份 sed 改指 worktree 路径再用（scriptPath 指向拷贝）。
- **批间串行**：同一 worktree 的多批不可并发——边界断言 `git status` 会把别批改动误判越界；提交一批再发下一批。
- **交付形态**：后台 job = worktree 分支多批多 commit + PR；合并用 rebase/merge commit **不用 squash merge**（保批次账一事一行）；用户自己的插件/设置类未提交改动列入边界断言 `ignore` 且不 add。

## 验收
照本 skill 跑完应有：plan 文件（契约+批次勾选）、每批一个 squash commit、flag 清单（待用户定的产品决策）、模式B 另有「round N 零确认」的收敛证据——都拿得出来才算照做了。
