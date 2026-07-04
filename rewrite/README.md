# rewrite/ — 重写线新代码根目录（M0 骨架·2026-07-04）

> 定标依据：`docs/关键决策记录.md §23` + `docs/现状与路线.md §路线图 M0–M5`。
> 边界铁律：**新代码只进本目录；`packages/` 旧线字节级冻结**（守卫 `oldline-frozen`，止血走 next 仓）；M5 切换完成后旧线清退、本目录转正。

## 布局（按里程碑立包，不预建空目录）

| 包 | 里程碑 | 内容 | 状态 |
|---|---|---|---|
| `rewrite/golden/` | M0 | 黄金用例册：旧线 1033 测试（123 文件）的行为断言提炼成栈无关验收基准，约 650 条·七册（orders-money / kit-security / learning-content / cs-agent / inventory-scm / frontend-store / admin-misc），123 文件全认领无静默丢弃 | ✅ 2026-07-04 |
| `rewrite/mp/` | M0 spike → M2 | 微信原生小程序（TypeScript + glass-easel，默认 WebView、按页 Skyline） | ⬜ |
| `rewrite/shared/` | M1 | 新线契约（Fen/状态机声明/集合册/错误码——13 设计约束的类型层落点） | ⬜ |
| `rewrite/cloud/` | M1 | 云函数重写（新命名空间与旧函数并行；回调点位 M5 切换日同名替换） | ⬜ |
| `rewrite/admin/` `rewrite/agent/` | M3 | 后台重写（Vue3+Vite；坐席台新旧并行零断档） | ⬜ |
| `rewrite/site/` | M4（与 M1 并行） | Astro SSG 内容站+官网（GEO 语料源） | ⬜ |

## 治理地基（新线开局即有）

- **方法论**：`docs/元模式.md §A` 整体沿用（痛→不变量→守卫→反向自检→归因；五层验证网；覆盖率闸）。新线每批走 `/refactor-batch`。
- **设计约束**：13 条病根提炼的栈无关约束（确定性主键+CAS、状态机单一权威、安检 fail-closed 结构强制、金额整数分品牌类型、镜像消灭为单源、降级不吞拒绝、统一分页协议、真实样本验证、代码外资产正册、工具先复位、文档预算、平台接缝单点、端点默认限速）——全文见 `docs/archive/深度理解报告-重写定标-20260703.md §六`，新线各域动工时逐条配守卫。
- **验收基准**：`rewrite/golden/` 用例册 + 旧线 115 条永恒不变量守卫清单（重建等价物，非照搬代码）。
- **守卫接线**：第一个 rewrite 包落地时，把 `scripts/check-structure.mjs` 的 `listPackageJsons()` 扫描范围与 lint/test 配置扩到 `rewrite/`（登记在该批守卫里，勿默默漏扫）。
