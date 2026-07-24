---
name: deep-audit
description: Use when 全面/深度审核 the Lucky Ducky codebase — 按 P0(钱/数据/安全)→P3 尺子逐层验证(不靠声称)、核每条根因有没有机器守卫、分级 findings 并标 已修/延后/刻意、业务语言汇报。Triggers on "彻底审核", "全面深度审核", "深度安全审计", "能自动化的都自动化了吗", "code review", "体检", or assessing an external review report.
---

# 深度审核

> 本 skill = 元模式的 **health 环**（`docs/元模式.md` A5）：周期体检——按尺子逐层验 + 核每病根有守卫。循环定义见元模式。

审核 = **验证，不是相信**。每条结论去代码核实（上次正因只信声称，把"金额安全做完了"吹过了被抓）。好的说好、该挑往死里挑、不吹。

## 尺子（CLAUDE §4 分级）
P0 崩溃 / 数据错乱 / 交易错误 / 安全 ｜ P1 主流程错 / 状态不一致 ｜ P2 维护成本 / 重复 ｜ P3 风格 / 命名。

## 逐层扫（高危先、且逐行读真实现，不凭记忆）
1. **交易链**：createOrder（库内价二次校验？数量/条数上限？分整数算？）→ pay（金额取库内、换分）→ payCallback/refundCallback（`defineNotifyCallback` 防伪、金额核验 fail-closed）→ applyRefund（分摊 ≤ 实付、确定性 _id）。
2. **安全闸（kit）**：`withOpenId`/`withAdminGate`/`isServerCall`/`checkKey` 是否 fail-closed；越权先验本人再动；写库点是否都过闸（`writes-need-gate` 守卫）。
3. **状态机**：转移走 `transition()` 原子幂等？副作用绑首次（confirmEnter）？
4. **每条根因有没有机器守卫**：跑 `npm run check`（含 `guard-coverage`：机器核每病根有守卫或 CLAUDE `[靠人:#N]` 锚，缺一即红）。靠人项（#8 验收样本 / #10 工具僵态）按 CLAUDE 锚人工复核；新发现的缺口能机器化就补守卫 + 标 `roots`（曾抓到 #3 写库没过闸、#4 Fen 没接钱链）。
5. **自动化元审**：哪些规矩还靠人？能结构化的补 `scripts/check-structure.mjs` 守卫；不能的（方法论/守则）成文并写清"为什么靠人"。
6. **接口/契约**：`docs/系统事实.md`（接口正册）与代码同步（`interface-catalog-sync`）；新接口登记、敏感函数入名单。
7. **依赖/发布**：`npm audit`（分清运行时 vs 构建工具链——后者暴露近零）；manifest urlCheck 发布前恢复。

## 够不到的，诚实标注（别假装覆盖）
库集合权限 / 云存储私有读 / 真支付退款 / 真机 —— 代码证不了，列为"上线前按验收单 X/Y/Z 控制台+真机核"。

## 产出
- 分级 findings 表，每条标：**已修 / 延后(给理由) / 刻意(产品级) / 够不到(人工核)**。
- 区分"外部 review 基线"与"当前 HEAD"——报告可能跑在旧基线，先核实哪些已修。
- 发现真问题 → 按 `refactor-batch` 修（先加守卫红、改到绿、反向自检、收尾）。
- **业务语言汇报**（所有者非技术）：结论先行、给收益/代价、不吹。

> 一句话：去代码验证、按 P0→P3 挑、核每根因有没有机器守卫、分级标状态、够不到的老实说、真问题按 refactor-batch 修。
