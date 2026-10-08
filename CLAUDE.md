# Lucky Ducky（小棉鸭）— 工程约定

> **沟通铁律**：全程说中文；解释与反馈用大白话（非技术人能听懂）；称呼用户「赵老板」。代码/命令/标识符保留英文。

## 0. 危险速览（动手前必读）
- 钩织材料包电商：微信小程序 + 云开发后端 + admin/agent 后台 + Astro 内容站。
- **本仓是生产源**：云环境 `cloudbase-d4gcssqbv06865479` 的唯一版本就是 `rewrite/` 的产物，部署/建表/删表真实生效。小程序 AppID `wxcbd2fb68b81bcfb1`，上传/提审/发布是微信后台人工动作。
- **先问老板、宁停勿猜**：红区（订单交易钱链、运维观测与系统配置、身份闸，名单以 `scripts/lib/red-paths.mjs` 为准）、部署与数据库不可逆操作、删守卫、合规文案、改 `scripts/check-*.mjs` 或 `.claude/`。
- **git 外资产**：控制台资产的权威副本在 `console-assets/`，变更先 repo 后控制台。
- **非 Claude 代理（Cursor 等）同守本文件**；不自装 MCP 或云端直连扩展（要装须复刻 `.claude/settings.json` 的全部 deny 并经老板确认）；不自派任务。
- **新会话先 `git fetch`**，对 `origin/main` 看（本地常落后几十个提交，错题本 E24）；现状与待办看 `gh issue list`。

## 1. 干活流水线
1. **事实只从代码取**：名字、数字、清单以代码为准，文档写「以 X 为准」不抄值；注释不写「由守卫 X 保证」，除非 grep 确认它在。动手前 grep `docs/关键决策记录.md`（含「拍板不做」）与 `docs/根因账本.md`，别把否掉的方案再做一遍。
2. **危险区靠硬闸**：红区提交要 `RED_ALLOWED`、红区 PR 还要老板打 `red-ok` 标签（CI 闸 `red-zone.yml`），部署要 `DEPLOY_ALLOWED`，都由老板授权。被闸拦 = 修代码，不绕闸，不 `--no-verify`。
3. **完成只由机器判**：`npm run check`（pre-commit 与 CI 同源）全绿才算；先写会红的测试再实现，反向自检（改坏必红，再还原）。改动走 `/refactor-batch`，体检走 `/audit`，修 bug 走 `/systematic-debugging`，验收走 `/acceptance-check`。
4. **声明带证据**：PR 里写「真机验过/压测过」必须附截图、日志或命令输出，没附当没做。一批一个 squash，推分支不推 main。

## 2. 不变量（设计期先知道；多数有守卫，`npm run check` 会拦）
- 金额全链「分」整数（`Fen` 品牌类型），元只在展示层，边界收元转分一次。
- 写库必过 kit 闸；价格/数量/openid/订单状态一律云端校验；回调见 OPENID 即拒。
- 状态流转走 `transition()` 合法表；一次性副作用绑首次转移；确定性 `_id` 天然幂等。
- 认证与高频写端点必过频控。列表走 cursor/limit 分页，禁固定 limit。
- 小程序只经 lib 层读云、无本地样例回退；依赖方向 pages→lib 不反转。
- 云原语只在 kit；支付/退款平台接缝单点走 kit `callFlow`。
- 动作类失败禁静默吞，告警走 `observe.alert`；失败≠空态。
- 小程序进不了 `@ldrw/shared` 的常量落副本，改一边必须改另一边。

## 3. 机器守不住的判断题
- `[靠人:#8]` **验证样本必须真实**：真实尺寸图、真实条数、真实分金额；凭证/签名走完整请求到最后一步。「拿到」≠「用通」，真机才算数。
- `[靠人:#10]` **微信开发者工具是有状态共享实例**：跑 build 前先停自动化；遇白屏、component not found、RPC 不回包，先 `cli quit` 重启再排查。
- **防过度工程**：先写最笨能跑通的；第三次重复才抽象；理由是「万一以后/方便将来」就删。「以后/预留」先查需求清单和判例，对得上才留，不确定就问。刻意简化标 `ponytail:` 注释。
- **历史快照**：订单/售后存下单时的价格和名称，不回读商品目录；结算草稿不持久化。
- **边界**：storage/query/API 输入一律不可信；禁 `eval`/`v-html`；敏感信息不进日志。

## 4. 记账
- 过程写进 commit 信息；待办/债/待拍板/状态开 GitHub Issue；需求变更先改 `docs/需求清单.md` 再动代码；拍板写 `docs/关键决策记录.md`。
- 过期文档直接删，git 即归档层；不写「已删/已退役」墓碑。
- 提交信息 `type：中文说明`（全角冒号，type ∈ feat/fix/docs/refactor/chore/test）。同一 PR 不重复 squash merge，不 force-push 改历史。

## 5. 代码地图与命令
`rewrite/mp`（原生 TS 小程序，无 bundler）· `rewrite/cloud`（TS+esbuild 云函数）· `rewrite/shared`（契约/类型）· `rewrite/admin`、`rewrite/agent`（Vue3+Vite）· `rewrite/site`（Astro）。不换技术栈（决策§23）。
```bash
npm run check                      # 质量闸
node scripts/check-structure.mjs   # 结构快检，秒级
npm run build:rw-cloud             # 云函数产物（部署另为人工授权）
npm run preview:mp                 # 推真机预览
```
- mp 加页面：`rewrite/mp/pages/<name>/` 四件套 + `app.json` 注册。加云端 action：放进对应域 + 登记 `modules.json`。admin 加页面：页面 + 路由/侧栏登记；写 admin UI 先读 `rewrite/admin/DESIGN.md`，色值只来自 `rewrite/admin/src/styles/tokens.css`。
- 查别的：需求 `docs/需求清单.md` · 业务链与状态机 `docs/业务逻辑架构.md` · 病根 `docs/根因账本.md` · 运维/发布/巡检/平台坑 `docs/运维手册.md` · 外部平台配置 `docs/外部配置手册.md` · 环境 `npm run env:resolve` · 历史 `git log`。
