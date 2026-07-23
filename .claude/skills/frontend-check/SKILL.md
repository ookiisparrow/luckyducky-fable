---
name: frontend-check
description: Use when 深度检查/审查/体检前端 (Lucky Ducky uni-app 多端, packages/miniapp) for 运行时/真机/多端/交互/UX 问题——机器守卫(npm run check)与构建查不出的那层（根因#8「构建过≠真机能用」）。专抓 mp-weixin 多端坑(page-container 锁滚动 / scroll-view / sticky / 返回拦截无 onBackPress / SVG 走 image / 安全区·胶囊 / 条件编译)、滚动与导航正确性、浮层遮挡交互、卡片对齐与空态。Triggers on "深度检查前端","前端体检","查查前端有没有坑","UI/多端/小程序坑","真机验前端","这页/这交互对不对","改完滚动/返回/浮层了". 区别 /deep-audit（全栈安全/钱/根因守卫，云函数也查）：本 skill 专攻前端运行时与多端表现，不查云函数/钱链。作用面=旧线 packages/miniapp（uni-app 专项坑不适用新线原生栈）；新线 rewrite/mp 的真机走查手册见 rewrite/mp/README.md。
---

# 深度检查前端

> 元模式 health 环的前端专版（`docs/元模式.md`）：`/deep-audit` 管全栈安全/钱/根因守卫；本 skill 管**前端运行时 + 多端表现 + 交互/UX**——专抓「机器守卫绿了、构建过了，但真机上不对/不能用」那层（根因#8）。改了滚动/返回/浮层/媒体必走它。

## 0. 先过机器层（机器能验的不手验）
- `npm run check`（约定+结构+typecheck+lint+test）全绿；`npm run build:mp-weixin` + `build:h5` exit 0。红了先修、别往下。
- 已机器盯、**不复验**：rpx / theme-hex / inline-svg / button / css-compat(backdrop-filter·color-mix) / bg-image（CLAUDE §4）、依赖方向、单一来源。本 skill 只查机器够不到的。

## 1. 真机/多端层（根因#8：构建过 ≠ 真机能用）——**必须真机**，不信模拟器
真机调试（微信开发者工具，基础库够新；遇 component not found/白屏/RPC 不回包先 `cli quit` 重启＝根因#10）。逐项验本次改动碰到的：
- **返回/导航**：Tab 页是栈底（自绘 TabBar `reLaunch` 清栈）→ 返回手势/键 = **直接退出小程序**；mp-weixin **无 onBackPress、拦不住栈底退出**，要拦返回手势只能 `page-container`（调试日志 M）。navigateBack/reLaunch/navigateTo 栈对不对；深链(扫码 scene)进对页。
- **滚动**：页面级滚动 vs `<scroll-view>`；**`page-container` 武装(show=true)时锁页面级滚动**（overlay=false 也锁）→ 可滚页面内容须放 `scroll-view`（调试日志 M）；放进 scroll-view 后 `onPageScroll`/`pageScrollTo` 要换 `@scroll`/受控 `:scroll-top`；`sticky` 在 scroll-view 里是否还吸顶；回到顶部、滚动定位（如「购买」滚到商品卡居中）准不准。
- **浮层/层级**：遮罩/`page-container`/弹窗是否**挡住下层滚动或点击**（隐形容器也可能挡）；z-index 栈别打架（如 splash 300 / 登录弹窗 200 / 固定 logo 50 / TabBar 30）；fixed/sticky 真机定位。
- **媒体**：SVG 走 `<image src>`（同 `Icon.vue`，真机能渲染，别内联 svg）；`mode`(aspectFill/heightFix)；封面图 `cloud://` fileID 能显示；视频同层渲染。
- **安全区/胶囊**：顶部用 `utils/systemBar.js` 动态算、避状态栏 + 右上胶囊（不硬编码 `env()`）；底部安全区/home indicator（**别自绘假指示条**，真机系统会画＝调试日志 L）。
- **条件编译**：端私有能力 `// #ifdef MP-WEIXIN` 隔离；H5/App 有回退、不白屏（api 层云失败回退本地）。

## 2. 交互 / UX 一致性层
- **横滑/网格卡等高**：内容固定行数 `-webkit-line-clamp` + `min-height`、标签保底高，否则名称/文案长短撑出不齐（调试日志 L）。对齐：logo/顶栏/浮动条左右边距一致。间距：板块上下对称。
- **每个交互有反馈**：点击态、加载中、空态、错误态、失败兜底（不静默）——CLAUDE §6/§7；timer 必清（`useTimers`）。
- **文案/占位**：mock/demo 标注；店名/协议等占位项追到 `docs/待办与债.md`（§上线前占位）。

## 3. 逐项真机验 + 分级汇报（业务语言，所有者非技术）
- 列「本次改动影响哪些页/交互」→ 每条**真机验过**才算（根因#8：拿到≠用通；改了滚动/返回/浮层尤其要逐项试）。
- 分级：**P0** 崩/卡死/不能用/误退 ｜ **P1** 主流程错/状态不一致 ｜ **P2** 不一致/体验糙 ｜ **P3** 细节。每条标 已修/待办/刻意。
- 汇报用**现象不用代码**：「购物车能滚、双击退出灵、首页购买滚到商品卡居中」，不是「scroll-view 绑了 @scroll」。

## 红线
- 机器能验的不手验（跑 `npm run check`）；机器验不了的（真机/多端/UX）才是本 skill 的活。
- **「构建过」≠「能用」**——没真机验过的前端结论不下（根因#8）。改了滚动/返回/浮层/媒体 → 必真机逐项验（这些正是构建查不出、最容易翻车的）。
- 发现的坑归因病根：命中现有（#8 真机/#10 工具态/多端样式）就记 `docs/调试日志.md`；是新一类反复坑则立新病根（走 `/systematic-debugging`）。
