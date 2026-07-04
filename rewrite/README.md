# rewrite/ — 重写线新代码根目录（M0 骨架·2026-07-04）

> 定标依据：`docs/关键决策记录.md §23` + `docs/现状与路线.md §路线图 M0–M5`。
> 边界铁律：**新代码只进本目录；`packages/` 旧线字节级冻结**（守卫 `oldline-frozen`，止血走 next 仓）；M5 切换完成后旧线清退、本目录转正。

## 布局（按里程碑立包，不预建空目录）

| 包 | 里程碑 | 内容 | 状态 |
|---|---|---|---|
| `rewrite/golden/` | M0 | 黄金用例册：旧线 1033 测试（123 文件）的行为断言提炼成栈无关验收基准，约 650 条·七册（orders-money / kit-security / learning-content / cs-agent / inventory-scm / frontend-store / admin-misc），123 文件全认领无静默丢弃 | ✅ 2026-07-04 |
| `rewrite/spike-skyline/` | M0 | Skyline 真机 spike——已验（2026-07-04）：三存疑全过、T4 过、T5 吸顶双引擎未吸（增益未证实·M2 纯结构复验后即删本工程） | ✅ 已验·留作复验台 |
| `rewrite/mp/` | M2 | 微信原生小程序（TypeScript + glass-easel，默认 WebView、按页 Skyline）——工程骨架已立（devtools 直导 rewrite/mp·TS 经编译插件·守卫 rw-mp-line-in-gates） | 🚧 批13 我页完善·M2 页面面收齐 |
| `rewrite/shared/` | M1 | 新线契约 `@ldrw/shared`（Fen 品牌类型/状态机声明类型级派生/37 集合册/42 错误码册·与旧线 parity 焊死） | 🟢 批1 已立（2026-07-04） |
| `rewrite/cloud/` | M1 | 云函数重写 `@ldrw/cloud`（kit 八件横切原语 ✅ 批2·函数域逐批立·新命名空间与旧函数并行；回调点位 M5 切换日同名替换） | 🟢 kit 已立（2026-07-04） |
| `rewrite/admin/` `rewrite/agent/` | M3 | 后台重写（Vue3+Vite+TS；坐席台新旧并行零断档）——admin 骨架已立（登录/会话/壳布局六组 IA·守卫 rw-admin-ui-in-gates） | ✅ admin 24 页全满 · 🚧 agent 批8 坐席台 |
| `rewrite/site/` | M4 | Astro SSG 内容站+官网（GEO 语料源·成交留小程序）——骨架已立·四类结构化数据·首批 2 篇 AI 起草待审 | 🚧 批2 十页·5 篇待审 |

## 治理地基（新线开局即有）

- **方法论**：`docs/元模式.md §A` 整体沿用（痛→不变量→守卫→反向自检→归因；五层验证网；覆盖率闸）。新线每批走 `/refactor-batch`。
- **架构宪法（ADR §24·Clean Architecture 采纳边界）**：五条不变量——①依赖方向单向且无环 ②业务规则 hermetic 可测（内存桩、不触真云） ③平台接缝依赖反转、单点收口 ④框架不绑架架构（业务层不为框架便利倒灌） ⑤测试一等公民。各配守卫随 M1 各域批次先红后绿地立（旧线 dep-direction/stub-only-sdk/flow-seam-single 有现成范式）。**明确不采**：四层同心圆/全面 Repository/DTO/微信抽象层（§22 防过度工程判例，理由见 ADR §24）。
- **设计约束**：13 条病根提炼的栈无关约束（确定性主键+CAS、状态机单一权威、安检 fail-closed 结构强制、金额整数分品牌类型、镜像消灭为单源、降级不吞拒绝、统一分页协议、真实样本验证、代码外资产正册、工具先复位、文档预算、平台接缝单点、端点默认限速）——全文见 `docs/archive/深度理解报告-重写定标-20260703.md §六`，新线各域动工时逐条配守卫。
- **验收基准**：`rewrite/golden/` 用例册 + 旧线 115 条永恒不变量守卫清单（重建等价物，非照搬代码）。
- **守卫接线**：第一个 rewrite 包落地时，把 `scripts/check-structure.mjs` 的 `listPackageJsons()` 扫描范围与 lint/test 配置扩到 `rewrite/`（登记在该批守卫里，勿默默漏扫）。
