# Lucky Ducky · 外包坐席工作台（承面 C · 车道 B）

外包客服的独立会话工作台（**独立部署单元**·部署到静态托管 `/agent`，与 `/admin` 内容控制台分开）。
承面 C 车道 B 产出：**对 mock 先建全套 UI**，master 整合时接车道 A 真接口（单点接缝，组件零改）。

技术栈对齐 `packages/admin`：Vue 3 `<script setup>` + Vite + vue-router（hash）+ lucide 图标 + 幸运紫 token。

## 跑起来

```bash
npm install                 # 仓根装一次（workspaces）
npm run dev  -w luckyducky-agent    # 本机预览（默认 mock 模式·无需后端）
npm run build -w luckyducky-agent   # 构建（产物 packages/agent/dist）
```

- 默认 **mock 模式**：不配 `VITE_ADMIN_API` 即全走内存 mock（`src/api/mock.js`），可离线开发/演示全套流程。
- 接真接口：配 `VITE_ADMIN_API`（见 `.env.example`）——只改这一处，组件零改。

## 结构

```
src/
  api/agentApi.js     单点接缝：mock ↔ 真 adminApi 网关（组件只调这里·不碰 mock）
  api/mock.js         全站唯一假数据源（按 shared/csAgentDesk.ts 契约 mock 8 action + getCustomer360 + listKb）
  logic/thread.js     纯逻辑：轮询增量合并/去重/排序（tests/agent 单测）
  router.js           /login /desk（hash 路由）
  pages/Login.vue     外包登录（复用 checkKey·校验 agent:handle 能力位）
  pages/Desk.vue      工作台三栏编排（队列 | 会话窗口 | 360+快捷回复）
  components/desk/     QueueList / ConversationWindow / Customer360Panel / QuickReplies / AgentStatusToggle
  components/FeedbackHost.vue  toast/确认弹窗（同 admin）
  styles/tokens.css   幸运紫 token（同 admin/uni.scss 同源）
```

## 契约（对接车道 A）

8 个坐席 action 的入参/返回严格贴 `packages/shared/src/csAgentDesk.ts`（`@luckyducky/shared` `./cs`）：
`listQueue / claimConversation / releaseConversation / sendAgentMessage / getThread / setAgentStatus / escalateToMerchant / closeConversation`（均须 cap `agent:handle`）；
360 侧栏走 `getCustomer360`（`customer:view`），快捷回复走 `listKb`。实时＝轮询（getThread cursor 增量·2.5s）。
