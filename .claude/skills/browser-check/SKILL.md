---
name: browser-check
description: Use when 改完或审查 web 线（rewrite/admin 管理控制台 · rewrite/agent 坐席台 · rewrite/site 内容站）的页面——用 Playwright MCP 真起浏览器截图、点击、填表单，验渲染、对齐、交互反馈、页签联动、响应式。check 绿 + 构建过查不出这层（根因#8）。任何 admin/agent/site 页面新增或修改，收尾前都要走。Triggers on "检查 admin 前端", "控制台 UI 对不对", "浏览器验一下", "这个页签/表单/预览对不对", "改完 admin/agent/site 页面了", "UI/UX 有没有问题". 小程序走查不归这里，见 `rewrite/mp/README.md`。
---

# 浏览器视觉体检（web 线）

> 只查机器够不到的「渲染出来到底对不对」。依赖 Playwright MCP：`claude mcp list` 看 `playwright` 是否 Connected；没装先 `claude mcp add playwright --scope user npx '@playwright/mcp@latest'`，装完要**下一次新会话**才能调到，当次会话别假装能用。

## 0. 先过机器层
`npm run check` 全绿；对应的 `npm run build:rw-admin` / `build:agent` / 内容站构建 exit 0。红了先修。

## 1. 起浏览器
- 本地 dev：`cd rewrite/admin && npm run dev`（agent/site 同理）。⚠️ **admin 的 dev server 直连生产云函数**（`.env.development` 与 `.env.production` 的 `VITE_ADMIN_API` 是同一个生产地址，没有 mock 登录），默认**不要真登录**。
- 绕开真口令：用 Playwright 网络拦截给 `login` action 造假 `{ok:true, sessionToken:'test-token'}`，其余 action 按场景造假 JSON。真实前端代码路径照跑，零生产风险。
- 只有用户明确同意才真登录。优先本地 dev（改动往往还没部署）。

## 2. 逐屏截图 + 结构核对
每个受影响页面/页签截图并读 accessibility snapshot，核：
- 渲染完整：文字、图标、图片都出来，没有空白块或占位露馅。
- 对齐与溢出：卡片、表单标签对齐，长文案不撑破、不被裁。
- 状态：加载态、空态、错误态、禁用态各看一次。
- 响应式：至少 ~375 窄屏和 ~1440 桌面两档。

## 3. 真驱动关键交互
点击、填表单、切页签/路由、触发保存都**真操作一遍**，不脑内推演。表单核对状态提示和（造假网络层时）请求体形状；联动类（如页面内容工作台的手机预览）改左边、看右边同步。每条 toast/高亮/禁用态都要亲眼看到。

## 4. 汇报（业务语言）
- **P0** 打不开/白屏/关键功能点不动 ｜ **P1** 主流程走不通/数据显示错 ｜ **P2** 对齐/间距/响应式糙 ｜ **P3** 文案、图标细节。
- 说现象不说代码：「切到『欢迎与激活』页签，改标题后右侧手机预览同步刷新」。
- 新坑开 GitHub Issue；反复出现的新一类走 `/systematic-debugging`。

## 红线
- **没真截图、真操作过，不下 web UI 结论。**
- admin 默认网络拦截造假，真登录须用户明确同意。
