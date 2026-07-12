---
name: browser-check
description: Use when 深度检查/审查 web 线（rewrite/admin 管理控制台 · rewrite/agent 客服工作台 · rewrite/site 内容站）的 UI/UX——机器守卫(npm run check)与构建通过查不出的那层（根因#8「构建过≠真的能用」在 web 端的翻版）。用 Playwright MCP 实际起浏览器截图/点击/填表单，验渲染、对齐、交互反馈、页签联动、响应式断点。Triggers on "检查 admin 前端","控制台 UI 对不对","浏览器验一下","admin 页面视觉验证","这个页签/表单/预览对不对","改完 admin/agent/site 页面了","UI/UX 有没有问题". 区别 `/frontend-check`（管小程序 mp-weixin 真机/微信开发者工具，不管 web）；区别 `/deep-audit`（全栈安全/钱/根因守卫，不管视觉）。任何 rewrite/admin、rewrite/agent、rewrite/site 的页面新增或修改收尾前必须走它——不能只凭 check 绿+构建过就报完成。
---

# 浏览器视觉体检（web 线）

> 元模式 health 环、web 端专版：`/frontend-check` 管小程序真机，本 skill 管 **rewrite/admin·rewrite/agent·rewrite/site 三条 web 线**。补的病根：CLAUDE.md 主提示「对 UI/前端变更先启动 dev server 在浏览器里实际用一遍」这条纪律，此前无工具落地、全靠记性——2026-07-12 页面内容 CMS 战役证实记性会漏（五页签工作台上线全程零浏览器验证）。**依赖 Playwright MCP**（`claude mcp list` 查 `playwright` 是否 Connected；未装先 `claude mcp add playwright --scope user npx '@playwright/mcp@latest'`，装完需下一次新会话才加载工具，当次会话调不到）。

## 0. 先过机器层（机器能验的不手验）
- `npm run check` 全绿；对应 `npm run build:rw-admin` / `build:rw-agent` / 内容站构建 exit 0。红了先修，别往下走。
- 已机器盯、不复验：typecheck/lint/依赖方向/单一来源守卫。本 skill 只查机器够不到的「渲染出来到底对不对」。

## 1. 起浏览器、连到目标页面
- **本地 dev**：`cd rewrite/admin && npm run dev`（或 agent/site 对应目录）。⚠️ **admin 的 dev server 直连生产云函数**（`.env.development`/`.env.production` 的 `VITE_ADMIN_API` 是同一个生产 cloudbase 地址，无 mock 登录）——默认**不要真登录**，防止误触生产写操作。
- **绕开真口令**：用 Playwright 的网络拦截（route 一类工具）对 `login` action 造假 `{ok:true, sessionToken:'test-token'}`，后续业务 action 按场景造假 JSON。这样真实前端代码路径（router 会话闸、表单、自动保存）原样跑，但零网络触达、零生产风险。
- 只有**用户明确同意**才用真口令真登录测（例如要验证真实数据渲染）；同意前不假设。
- 部署站点（如 `/admin` 生产 URL）同理可连，但优先本地 dev——改动往往还没部署。

## 2. 逐屏截图 + 结构核对
- 每个受影响页面/页签：截图 + 读一遍 accessibility snapshot。核对：
  - **渲染完整**：文字/图标/图片都出来了，没有空白块、没有「(default)」类占位露馅。
  - **对齐与溢出**：卡片对齐、表单标签对齐、长文案不撑破布局、内容不被裁切。
  - **状态**：加载态、空态、错误态、禁用态各出现一次（别只看默认态）。
  - **响应式**：至少窄屏（~375）+ 桌面宽（~1440，admin 场景常见）两档，别只测一种视口。

## 3. 真驱动关键交互（不能只看静态截图）
- 点击、填表单、切页签/切路由、触发保存——**真的操作一遍**，不是脑内推演代码会怎么执行。
- 表单类：填字段→触发自动保存/提交→核对状态提示（如「已自动保存」「保存全部」）→（若造假网络层）核对请求体形状是否符合契约。
- 联动类（如页面内容工作台的手机实时预览）：改左侧表单字段，核对右侧预览是否同步更新。
- 每条交互反馈（toast/高亮/禁用态）都要看见，不能假设「代码写了就该有」。

## 4. 分级汇报（业务语言，所有者非技术）
- **P0** 页面打不开/白屏/关键功能点不动 ｜ **P1** 主流程走不通/数据显示错 ｜ **P2** 对齐/间距/响应式糙 ｜ **P3** 细节（文案、图标风格）。
- 汇报现象不汇报代码：「切到『欢迎与激活』页签，表单加载出来，改标题后右侧手机预览同步刷新」，不是「WelcomeTab.vue 的 computed 触发了」。
- 发现的坑：命中现有病根（#8 构建≠能用）记 `docs/调试日志.md`；反复出现的新一类坑走 `/systematic-debugging` 立新病根。

## 红线
- 机器能验的不手验；机器验不了的（渲染/交互/响应式/联动）才是本 skill 的活。
- **没有真正截图/操作过的 web UI 结论不能下**——check 绿 + 构建过 ≠ 能用，这是本 skill 存在的全部理由。
- admin 类页面涉及生产口令：默认网络拦截造假，真登录须用户明确同意。
- 装 Playwright MCP 装在中途的会话里调不到工具，需提醒用户下一次新会话才生效，不要在原会话里假装能调。
