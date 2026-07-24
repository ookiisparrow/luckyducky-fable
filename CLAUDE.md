# Lucky Ducky（小棉鸭）— 工程约定

> **第一条·沟通铁律**：全程说中文；项目情况的解释与反馈一律用大白话（非技术人能听懂）；称呼用户「赵老板」。代码/命令/标识符保留英文。

## 0. 你在哪、有多危险（先读这几行）

- 钩织材料包电商：微信小程序 + 云开发后端 + admin/agent 后台 + Astro 内容站。
- **本仓是生产源**：云环境 `cloudbase-d4gcssqbv06865479` 的唯一版本就是本仓 `rewrite/` 的产物，部署/建表/删表**真实生效，不是沙盒**。小程序 AppID `wxcbd2fb68b81bcfb1`（上传/提审/发布是微信后台人工动作）。
- **git 外资产勿动**：控制台 8 件资产（支付连接器/工作流等）权威副本在 `console-assets/`，变更先 repo 后控制台。`[机器守: console-assets-present]`
- 旧版本参照在 next 仓（`ookiisparrow/luckyducky-next`·封存回滚基线），本仓不留旧代码。
- 当前阶段与下一步，唯一看 `docs/现状与路线.md`。

## 1. 活代码地图

`rewrite/mp`（原生 TS+glass-easel 小程序·微信开发者工具编译、无 bundler）· `rewrite/cloud`（TS+esbuild 云函数·拓扑以 `rewrite/cloud/build.mjs` 产物为准）· `rewrite/shared`（契约/类型）· `rewrite/admin`/`rewrite/agent`（Vue3+Vite）· `rewrite/site`（Astro）。各包细则见各自 README。**不换技术栈**（判例 决策§23）。模块归属与危险分级单源＝仓根 `modules.json`（red=钱链/运维配置）。`[机器守: module-registry-complete]`

```bash
npm install              # prepare 自动注册 git hooks
npm run check            # 验收语言：structure+typecheck+lint+test（pre-commit/CI 同源）
node scripts/check-structure.mjs   # 快检 ~1.4s，改一个文件就跑
npm run build:rw-cloud   # 云函数产物（部署另为人工授权动作·guard-deploy 闸）
npm run build:rw-admin / build:agent；内容站 npm run build -w @ldrw/site
```

## 2. 怎么干活（每批的循环）

1. **动手前 grep `docs/判例索引.json`**——这事可能拍板过、否过、修过；别把否掉的方案再做一遍。
2. 任何改动走 `/refactor-batch`：先立守卫（红）→ 改到绿 → 反向自检（篡改守卫必红再还原）→ 一批一个 squash。体检走 `/audit`（文档面 `/doc-audit` + 代码面 `/deep-audit` 可单独调）；修 bug 走 `/systematic-debugging`；验收走 `/acceptance-check`；其余按系统注入的 skill 描述自选。
3. **被闸拦=修代码，不绕闸**（编辑 hook 当场咬违例；刻意例外行内注明 `structure-ok`）。不碰 `scripts/check-*.mjs` 与 `.claude/`（裁判不被球员改写；治理批经用户拍板除外）。
4. **派活与红区**：机械批量活可派子代理并行、产出亲核；立不出红灯的判断题亲自做、不下放。red 模块/钱链语义/删守卫/合规文案/部署与数据库不可逆操作——先问老板，**宁停勿猜**。
5. 收尾记账，一事一本：过程 → `docs/重构日志.md`；状态 → `docs/现状与路线.md`；bug → `docs/调试日志.md`；债/待拍板 → `docs/待办与债.md`；需求变更先改 `docs/需求清单.md` 再动代码。客观计数不手抄（写「以 X 为准」）；过程账过期直接删——git 历史即归档层，退役登记 `docs/史料索引.md`。
6. **文档写作三纪律**：引用文档一律 `docs/`+实名可 resolve 格式；防御性墓碑（「已删/已退役」注记）要么配守卫要么不写；给本文件加内容先过准入测试——「删了这行，典型会话会变差吗」。
7. 提交 `type：中文说明`（全角冒号，type ∈ feat/fix/docs/refactor/chore/test），main 唯一长期分支、一批一 squash。**部署与提交解耦，永远是人工授权动作**。

## 3. 不变量表（设计期先知道，省得白干一轮；违例机器会拦）

| 不变量 | 守卫 |
|---|---|
| 金额全链「分」整数（Fen 品牌类型），元只在展示层，边界收元转分一次 | `[机器守: rw-fen-branded-type]` `[机器守: fen-money-chain]` |
| 写库必过 kit 闸；价格/数量/openid/订单状态一律云端校验，不信前端；回调防伪（见 OPENID 即拒） | `[机器守: rw-writes-need-gate]` `[机器守: gate-fail-closed]` `[机器守: notify-forge-proof]` |
| 状态流转走 `transition()` 合法表；一次性副作用绑首次转移；确定性 `_id` 天然幂等 | `[机器守: transition-atomic-idempotent]` `[机器守: deterministic-id-concurrency]` `[机器守: order-status-union]` |
| 认证与高频写端点必过频控 | `[机器守: rw-admin-login-throttled]` `[机器守: user-writes-throttled]` |
| 列表走 cursor/limit 分页契约，禁固定 limit | `[机器守: paging-contract]` |
| mp 只经 lib 层对接云读数、无本地样例回退；依赖方向 pages→lib 不反转 | `[机器守: rw-mp-cloud-only]` `[机器守: rw-dep-direction]` |
| 云原语（init/身份）只在 kit；支付/退款平台接缝单点收 kit `callFlow` | `[机器守: rw-kit-only-cloud-primitives]` `[机器守: rw-flow-seam-single]` |
| 动作类失败禁静默吞，告警走 `observe.alert` 单出口（读路径缺席=null 不在此列） | `[机器守: rw-flow-observable]` |
| 代码量/依赖锁走基线棘轮；死导出/幽灵依赖/孤儿资产零容忍 | `[机器守: rw-loc-budget]` `[机器守: rw-lock-budget]` `[机器守: rw-dead-exports]` `[机器守: rw-phantom-deps]` `[机器守: rw-orphan-assets]` |
| 守卫自身可信：id 唯一、扫描面够得着活线、工具脚本禁旧线引用 | `[机器守: guard-id-unique]` `[机器守: guard-scan-liveness]` `[机器守: rw-toolchain-no-oldline]` |
| admin 颜色一律 `var(--ld-*)`、调色板单源 tokens.css；mp 样式见 `rewrite/mp/README.md` | `[机器守: rw-admin-theme-single-source]` |

全表唯一真值＝`scripts/check-structure.mjs`（此处只列设计期高频撞到的）；每条守卫为什么存在查 `docs/根因账本.md`。

## 4. 机器守不住的判断题（真正需要记住的）

- `[靠人:#8 验证样本失真]` **验证样本必须真实**：真实尺寸图/真实条数/真实分金额；凭证/签名走完整请求形状到最后一步——「拿到」≠「用通」，「过了」≠「真能用」，真机才算数。
- `[靠人:#10 工具实例状态不可信]` **微信开发者工具是有状态共享实例**：跑 build 前先停自动化；遇怪象（component not found/白屏/RPC 不回包）先 `cli quit` 重启再排查，别在僵实例上查业务码。
- **防过度工程**：先写最笨能跑通主路径的；第三次重复才抽象（Rule of Three）；新增接口/层/泛型/配置项旁注为什么，理由是「万一以后/方便将来」就删；合并相似两段先问「本质相同还是碰巧长得像」。
- **业务预留分流**：「以后/预留」不是删除信号——查需求/判例对得上=业务预留标清保留，对不上且只为「方便将来」=删或延后，不确定=问。
- **历史快照**：订单/售后存下单时价格/名称快照，不回读商品目录；临时态（结算草稿）不持久化；回灌本地缓存必防脏数据。
- **边界尺子**：页面只编排；纯展示组件只 props/emits；跨页状态进 store、页面临时态留页；timer 必清理、storage key 用常量；storage/query/API 输入一律不可信；禁 `eval`/`v-html`；敏感信息不进日志；请求失败统一处理、空数据有空态、用户动作失败有反馈、storage 解析失败不崩；注释解释为什么而非做什么、mock/demo 必标注。审核分级：P0 崩溃/数据错乱/交易错误/安全 ｜ P1 主流程错/状态不一致 ｜ P2 维护成本/重复 ｜ P3 风格/命名。

## 5. 查询路由（按需查，别全读）

| 要什么 | 去哪 |
|---|---|
| 现在干什么/下一步 | `docs/现状与路线.md` |
| 这事拍板过没 | `docs/判例索引.json`（grep 即可·命中后按 source 读原文） |
| 接口/集合/计数 | 代码即真值（查询钥匙卡 `docs/系统事实.md`） |
| 需求 | `docs/需求清单.md` |
| 守卫为什么存在（病根） | `docs/根因账本.md` |
| 部署/回滚/故障/巡检 runbook | `docs/运维手册.md` |
| 云开发平台坑 | `docs/云开发参考.md` |
| 上线人工配置台账 | `docs/人工配置清单.md` |
| 历史（全部过程账） | `docs/史料索引.md` → `git show` |
| 治理框架本身 | `docs/元模式.md` |
| 子项目线 | `docs/后台360工作站/` · `docs/进销存ERP/`（各自 README 为入口） |

## 6. 扩展套路与新会话

- mp 加页面：`rewrite/mp/pages/<name>/` 四件套 + `app.json` 注册。加云端 action：`rewrite/cloud/src/functions/` 对应域 + 登记 `modules.json`（守卫焊双向一致）。admin 加页面：`rewrite/admin/src/pages/<Name>.vue` + 路由/侧栏登记（守卫焊同步）。改主题：admin 只改 `styles/tokens.css`。
- 新会话三步：本文件 → `docs/现状与路线.md` → `git status` + `git log --oneline -5`。
