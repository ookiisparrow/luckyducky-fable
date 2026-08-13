# 微信开发者工具官方 Agent API 调用指南

> 面向 luckyducky-fable 项目的官方自动化方案。经实测验证（微信开发者工具 36.6.0 / skill 0.3.9）。

## 一、核心结论

微信开发者工具官方推出的 Agent 调用方式是 **`wechatide` CLI 命令**（不是 `cli`，也不是必须 MCP）：

```bash
wechatide -c <clientName> <toolName> [flags...] [--token <cliAccessToken>]
```

- `-c <clientName>`：调用方标识（如 `pi-agent`、`CodeBuddy`），需与授权弹窗一致
- `<toolName>`：下划线工具名，共 47 个，按 7 个场景（scene）分组
- 工具的 `--help` 可查参数：`wechatide -c pi-agent <tool> --help`

官方 skill 文档位于工具安装目录（随工具版本发布，天然与工具版本一致）：

```
/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/wechatide-skill/
├── SKILL.md                          # 根入口：门禁、路由、调用方式
├── skills/<scene>/SKILL.md           # 各场景细则（initializer/compiler/automator/debugger...）
└── references/
    ├── tool-index.md                 # 47 个工具索引 + 场景归属
    ├── async-task-polling.md         # 异步回调轮询机制
    └── environment-readiness.md      # 运行前检查
```

## 二、认证（门禁检查）

调用业务工具前，先做一次状态检查（登录态 + skill 版本 + token）：

```bash
wechatide -c pi-agent check_wechatide_status --skill-version 0.3.9
```

返回关键字段：
- `loginExpired: false` → 已登录，可继续
- `versionRelation: "equal"` → skill 版本与工具匹配
- `tokenRequired: false` → 无需 CLI token（若为 true，需在工具「设置 → 安全」获取）

## 三、真机调试完整流程（官方姿势）

按场景路由：**initializer（开窗）→ compiler（编译）→ automator（真机调试）**

```bash
# 1. 门禁检查（会话首次）
wechatide -c pi-agent check_wechatide_status --skill-version 0.3.9

# 2. 打开项目窗口（initializer）
wechatide -c pi-agent open_project_window --project /Users/sparrow/luckyducky-fable/rewrite/mp

# 3. 编译并打开首页（compiler）
wechatide -c pi-agent simulator_open_page --project /Users/sparrow/luckyducky-fable/rewrite/mp --page pages/home/home

# 4. 触发真机调试（automator；--auto 自动真机调试，配合局域网模式免扫码）
wechatide -c pi-agent automation_viewport_action --project /Users/sparrow/luckyducky-fable/rewrite/mp --action remote --auto
```

实测返回：

```json
{
  "ok": true,
  "tool": "automation_viewport_action",
  "clientName": "pi-agent",
  "result": { "success": true }
}
```

### 局域网模式（关键）

- 工具「设置」里开启**局域网模式**（`useLanWhenRemoteDebug: true`），真机与电脑 WiFi 直连，**不走微信服务器**，稳定且 `--auto` 可自动连接已配对设备（实测免扫码成功）。
- 默认的微信服务器通道会偶发「服务器忙 / 连接断开」。

## 四、回调机制（异步任务轮询）

官方文档 `async-task-polling.md` 规定：

1. 任何 toolCall 返回 `status: pending` + `taskId` 时，表示需要用户授权/扫码/确认（交互在开发者工具内）。
2. **仅两类必须主动轮询**：`login`（扫码登录）和 `wechatide auth`（客户端授权）。每 10 秒查一次：

```bash
wechatide -c pi-agent polling_task_result --task-id <taskId>
```

3. 轮询最多 10 次；状态终态：
   - `success` → 继续依赖步骤
   - `failed` / `cancelled` / `expired` → 不得继续
   - 仍 `pending` → 停止轮询，保留上下文（taskId + 工具名 + 参数摘要）

4. 其他 pending（upload、auto_preview、云写确认等）：提醒用户在工具内确认即可，**不要**盲目轮询或重发。

## 五、其他常用官方工具（按场景）

| 场景 | 工具 | 用途 |
|------|------|------|
| previewer | `auto_preview` | 推送预览到开发者微信（零扫码上真机） |
| previewer | `create_preview_qrcode` | 生成预览二维码 |
| compiler | `simulator_refresh` | 重新编译刷新 |
| debugger | `get_simulator_console` / `get_simulator_network` | 读 console / 网络请求（`--command 'grep -n .'`） |
| debugger | `simulator_screenshot` | 截图取证 |
| automator | `automation_evaluate` | 运行时执行 JS |
| automator | `automation_navigate` / `automation_element_action` | 导航 / 点击输入 |
| cloudbase-operator | `cloud_fn_*` / `cloud_db_*` | 云函数 / 云数据库 |

## 六、示例代码

仓库内 `scripts/wechat-agent.mjs` 封装了官方调用：

```bash
npm run agent:status   # 门禁检查
npm run agent:open     # 打开项目窗口
npm run agent:debug    # 官方 API 真机调试（自动开窗+编译+触发）
npm run agent:preview  # 推送预览到微信
npm run agent:read     # automator 读页面数据
npm run agent:nav      # automator 导航
npm run agent:eval     # automator 执行 JS
npm run agent:net      # 读网络请求
```

## 八、automator 自动化通道（重点：IPv6！）

miniprogram-automator 连接工具的 WebSocket 端点是 **`ws://[::1]:9420`（IPv6）**，不是 `127.0.0.1`！

- 工具 9420 端口双监听：IPv4 = HTTP/MCP 服务；IPv6 = automator WebSocket
- 连 IPv4 会 404/挂起，连 IPv6 秒连
- 前置条件：`cli agent start`（automation 服务器）+ `open_project_window` + `simulator_open_page`（编译运行）
- ticket：官方 API `automation_testaccount --action getTicket` 获取（需工具「设置→安全」开启 ticket）

已验证能力（实测）：

```js
const automator = require('miniprogram-automator');
const mini = await automator.connect({ wsEndpoint: 'ws://[::1]:9420' });
const sys = await mini.systemInfo();          // 读系统信息
const page = await mini.currentPage();        // 读当前页面
const data = await page.data();               // 读页面数据
await mini.navigateTo('/pages/detail/detail?id=x'); // 导航
await mini.evaluate('function(){ return 1+1 }');    // 执行 JS
```

> 架构说明：automator 驱动**模拟器**运行时（与真机同一份代码，数据一致）；真机调试（手机运行）是另一条通道，二者配合即为完整自动化。

## 七、常见问题

| 问题 | 处理 |
|------|------|
| `agent.skills is empty in app.json` | 不要用 `cli agent tool`（那是另一套 skill 体系）；改用 `wechatide -c <client> <tool>` |
| 真机调试不弹二维码 | 局域网模式下 `--auto` 会直接连已配对设备；首次需扫码一次配对 |
| 「服务器忙 / 连接断开」 | 切局域网模式 |
| 调试窗口找不到 | 二维码在 RemoteDebugWindow（远程调试窗口），可能被主窗口遮挡 |
