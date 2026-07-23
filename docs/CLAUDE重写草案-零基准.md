# CLAUDE.md 零基准重写草案（待拍板·非现行约定）

> 2026-07-23 立。方法：不从现有 CLAUDE.md 删减（删减会继承旧骨架），而是白纸重推——「一个 AI 会话开局，缺了什么信息会做出更差的行为？」只有答得出的信息才准入。按**会话生命周期**组织（进场→干活→设计→判断→查询），不按治理谱系组织。
> 换稿条件：① 保 `[靠人:#8]`/`[靠人:#10]` 锚与所引守卫 id 真实存在（guard-coverage 解析面）；② `skills-referenced-exist` 扫描面同步；③ 走 /refactor-batch 落地。以下横线内为草案全文（约 65 行）。

---

# Lucky Ducky（小棉鸭）— 工程约定

## 0. 你在哪、有多危险（先读这 5 行）

- 钩织材料包电商：微信小程序 + 云开发后端 + admin/agent 后台 + Astro 内容站。
- **本仓是生产源**：云环境 `cloudbase-d4gcssqbv06865479` 的唯一版本就是本仓 `rewrite/` 的产物，部署/建表/删表**真实生效，不是沙盒**。小程序 AppID `wxcbd2fb68b81bcfb1`（发布是微信后台人工动作）。
- **git 外资产勿动**：控制台 8 件（支付连接器/工作流等）权威副本在 `console-assets/`，变更先 repo 后控制台。
- 旧版本参照在 next 仓（`ookiisparrow/luckyducky-next`），本仓不留旧代码。
- 当前阶段与下一步，唯一看 `docs/现状与路线.md`。

## 1. 活代码地图

`rewrite/mp`（原生 TS+glass-easel 小程序·微信开发者工具编译、无 bundler）· `cloud`（TS+esbuild 云函数，拓扑以 `rewrite/cloud/build.mjs` 产物为准）· `shared`（契约/类型）· `admin`/`agent`（Vue3+Vite）· `site`（Astro）。各包细则见各自 README。**不换技术栈**（判例 决策§23）。模块危险分级查仓根 `modules.json`（red=钱链/运维配置，动前问人）。

## 2. 怎么干活（每批的循环）

1. **动手前 grep `docs/判例索引.json`**——这事可能拍板过、否过、修过；别把否掉的方案再做一遍。
2. 任何改动走 `/refactor-batch`：先立守卫（红）→ 改到绿 → 反向自检（篡改守卫必红再还原）→ 一批一个 squash。
3. **验收语言 = `npm run check` 全绿**；快检 `node scripts/check-structure.mjs`（~1.4s）；面板 `npm run report`。编辑 hook 会当场咬违例：**被拦=修代码，不绕闸**（刻意例外行内注明 `structure-ok`）。不许碰 `scripts/check-*.mjs` 与 `.claude/`（裁判不能被球员改写）。
4. 收尾记账，一事一本：过程 → `docs/重构日志.md`；状态 → `docs/现状与路线.md`；bug → `docs/调试日志.md`；债/待拍板 → `docs/待办与债.md`。客观计数不手抄（写「以 X 为准」）；过程账过期直接删——git 历史即归档层，退役登记 `docs/史料索引.md`。
5. 提交 `type：中文说明`（全角冒号，type ∈ feat/fix/docs/refactor/chore/test），main 唯一长期分支。**部署与提交解耦，永远是人工授权动作**（guard-deploy 闸）。

## 3. 不变量表（设计期先知道，省得白干一轮；违例机器会拦）

| 不变量 | 守卫 |
|---|---|
| 金额全链「分」整数（Fen 类型），元只在展示层，边界收元转分一次 | `[机器守: rw-fen-branded-type]` |
| 写库必过 kit 闸；价格/数量/openid/订单状态一律云端校验，不信前端；回调防伪 | `[机器守: rw-writes-need-gate]` `[机器守: gate-fail-closed]` `[机器守: notify-forge-proof]` |
| 状态流转走 `transition()` 合法表；一次性副作用绑首次转移；确定性 `_id` 天然幂等 | `[机器守: transition-atomic-idempotent]` `[机器守: deterministic-id-concurrency]` `[机器守: order-status-union]` |
| 认证与高频写端点必过频控 | `[机器守: rw-admin-login-throttled]` `[机器守: user-writes-throttled]` |
| 列表走 cursor/limit 分页，禁固定 limit | `[机器守: paging-contract]` |
| mp 只经 lib 层对接云读数，无本地样例回退；依赖方向 pages→lib 不反转 | `[机器守: rw-mp-cloud-only]` `[机器守: rw-dep-direction]` |
| 云原语（init/身份）只在 kit；支付/退款平台接缝单点收 `callFlow` | `[机器守: rw-kit-only-cloud-primitives]` `[机器守: rw-flow-seam-single]` |
| 动作类失败禁静默吞，告警走 `observe.alert` 单出口 | `[机器守: rw-flow-observable]` |
| 代码量/依赖锁基线棘轮；死导出/幽灵依赖/孤儿资产零容忍 | `[机器守: rw-loc-budget]` `[机器守: rw-dead-exports]` |
| admin 颜色一律 `var(--ld-*)`，调色板单源 tokens.css；mp 样式见其 README | `[机器守: rw-admin-theme-single-source]` |

全表唯一真值 = `scripts/check-structure.mjs`（此处只列设计期高频撞到的）；每条为什么存在查 `docs/根因账本.md`。

## 4. 机器守不住的判断题（真正需要记住的）

- `[靠人:#8]` **验证样本必须真实**：真实尺寸图/真实条数/真实分金额；凭证走完整请求形状到最后一步——「拿到」≠「用通」，「过了」≠「真能用」，真机才算数。
- `[靠人:#10]` **开发者工具是有状态共享实例**：build 前停自动化；遇怪象（component not found/白屏/RPC 不回包）先 `cli quit` 重启再排查，别在僵实例上查业务码。
- **防过度工程**：先写最笨能跑通主路径的；第三次重复才抽象；新增接口/层/泛型旁注为什么，理由是「方便将来」就删。
- **业务预留分流**：「以后/预留」不是删除信号——查需求/判例对得上=保留标清，对不上=删或延后，不确定=问。
- **历史快照**：订单/售后存下单时价格/名称快照，不回读商品目录。
- **边界尺子**：页面只编排；金额数量不校验不入库；storage/query/API 输入一律不可信；timer 必清理；敏感信息不进日志；禁 eval/v-html。审核分级 P0 钱/数据/安全 → P1 主流程 → P2 维护 → P3 风格。

## 5. 查询路由（按需查，别全读)

| 要什么 | 去哪 |
|---|---|
| 现在干什么/下一步 | `docs/现状与路线.md` |
| 这事拍板过没 | `docs/判例索引.json`（grep 即可） |
| 接口/集合/计数 | `docs/系统事实.md` |
| 需求 | `docs/需求清单.md` |
| 守卫为什么存在 | `docs/根因账本.md` |
| 部署/回滚/故障 runbook | `docs/运维手册.md` |
| 云开发平台坑 | `docs/云开发参考.md` |
| 历史（全部过程账） | `docs/史料索引.md` → `git show` |
| 治理框架本身 | `docs/元模式.md` |

## 6. 扩展套路与新会话

- mp 加页面：`pages/<name>/` 四件套 + `app.json` 注册；云端加 action：actions 目录 + 登记 `modules.json` 与 `docs/系统事实.md`；admin 加页面：`pages/<Name>.vue` + 路由/侧栏（守卫焊同步）。
- 新会话三步：本文件 → `docs/现状与路线.md` → `git log --oneline -5`。

---

## 草案说明：与现行版的差异（拍板参考）

**丢弃的**（不影响行为）：切换史与全部墓碑；文档体系七条规则（压为 §2.4 三句）；skills 目录复述（自动注入已覆盖，只留 /refactor-batch 纪律）；五道网/元模式叙事；关键决策逐条摘要（被「grep 判例索引」取代）；病根编号谱系组织法；已焊死规则的机制细节。

**新增的**（现行版没有、但影响行为）：开局 5 行危险简报；「动手前查判例」升为干活第一步；快检命令与「被拦=修代码」的反馈回路速查（原散在 AGENTS）；「全表以 check-structure.mjs 为准」的代码即真值声明；不变量改平表、按设计期撞到的频率排序。

**结构性差异**：按会话生命周期组织（在哪→怎么干→设计约束→判断题→查询），不按治理谱系组织——文档为读者的时间线服务，不为写作者的分类学服务。

**风险**：重写可能漏掉某条现行 prose 的隐含约束——但这正是守卫体系的用途：漏掉的若是机器守的，hook 当场咬；若是靠人的，已全数收入 §4。最坏情况可控。
