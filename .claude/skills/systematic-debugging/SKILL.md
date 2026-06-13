---
name: systematic-debugging
description: Use when debugging a bug, failure, flaky test, or unexpected behavior — enforces 复现→根因→修复带守卫→记账 instead of guess-and-check. Triggers on "为什么报错/不对", "调试", "修 bug", "this is failing", "排查", flaky tests, or any "it's not working" symptom.
---

# 系统化调试

调试不是猜，是收敛。任何「为什么不对」的问题按四步走，**没复现前禁止改代码，没守卫不算修完**。

## 0. 先看证据，别先改代码
- 读 `utils/logger.js` 输出（本项目 src 禁裸 console，日志统一走 logger）。
- 读完整报错/堆栈，不要只看最后一行。
- **工具怪象先疑工具僵态**：白屏 / 假性「component not found」/ RPC 卡死 → `cli quit` 彻底退出再 `cli auto` 重启，别在僵实例上查业务代码（调试日志 D/E 的教训：build 覆盖 dist 期间 + 强杀自动化后工具状态不可信）。

## 1. 复现（Reproduce）
- 找到**稳定复现的最小路径**。复现不了就不算理解，别动手。
- 测试样本必须贴近真实数据尺寸/形状——最小样本只验逻辑不验边界（调试日志 F：1×1 图过、真照片必炸；G：凭证「拿到」≠「能用」，方法/字段都参与签名）。

## 2. 隔离 + 根因（Isolate → Root cause）
- 二分夹逼：日志/注释/断点逐步缩小，定位到**具体一行或一个状态**。
- 追到**结构性根因**，别停在表面现象。问：这属于哪一类？（并发先查后写？状态反查窄化？信任边界？回退双路径？金额浮点？——对照 `docs/根因账本.md` 十二类病根）
- 形成**可证伪的假设**再验证；一次只改一处，别同时动多处碰运气。

## 3. 修复 + 守卫（Fix + Guard）—— 本项目铁律
- 修根因，不修症状。
- **先写一条锁住问题的用例（红）→ 修到绿**；反向自检：把修复还原，用例必须重新变红（证明守卫真在咬）。
- **顺藤摸同类隐患**：同一根因在别处还有没有？一并修或记账——调试日志 K 的「同类隐患」栏就是干这个，不做碎片化救火。
- 能升级成机器守卫就升级：数据契约（persist sanitize）、结构不变量（`scripts/check-structure.mjs` 加一条规则）、TS 类型（非法状态不可表达）——把「这次的 bug」变成「这类 bug 机器永久拦」。

## 4. 记账（Ledger）
- 结案记 `docs/调试日志.md`，格式：日期 / 现象 / 根因 / 同类隐患（启发式）/ 是否结构性 / 状态。
- 目的不是记 bug 本身，是**追到根因、顺出同类**。

## 收尾验证
- 跑 `npm run check`（conventions + structure + typecheck + lint + test 全绿）再算关账。

> 一句话：复现 → 根因 → 修复带守卫 → 记账。**没复现别改，没反向自检别算修完。**
