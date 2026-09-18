# rewrite/ — 生产源（重写线）

> 定标依据：`docs/关键决策记录.md §23`。进度权威看 `docs/现状与路线.md`。
> 本目录即生产源；新代码只进本目录。各包细则见各自 README。

## 活包

页数 / 函数数 / 测试数以各包源码与 `npm run check` 为准，此处不手抄。

| 包 | 内容 |
|---|---|
| `rewrite/mp/` | 微信原生小程序（TypeScript + glass-easel）。走查手册：`rewrite/mp/README.md` |
| `rewrite/shared/` | 全仓契约 `@ldrw/shared`（Fen / 状态机 / 集合册 / 错误码） |
| `rewrite/cloud/` | 云函数 `@ldrw/cloud`（kit 横切原语 + 各域函数；函数数以 `build.mjs` 产物为准） |
| `rewrite/admin/` | 管理控制台（Vue3+Vite+TS，正式路径 `/admin`） |
| `rewrite/agent/` | 客服坐席台（Vue3+Vite+TS，正式路径 `/agent`） |
| `rewrite/site/` | Astro SSG 内容站+官网 |

## 治理地基

- **方法论**：`docs/元模式.md §A`（痛→不变量→守卫→反向自检→归因）。新线每批走 `/refactor-batch`。
- **架构宪法（ADR §24·Clean Architecture 采纳边界）**：五条不变量——①依赖方向单向且无环 ②业务规则 hermetic 可测（内存桩、不触真云） ③平台接缝依赖反转、单点收口 ④框架不绑架架构（业务层不为框架便利倒灌） ⑤测试一等公民。**明确不采**：四层同心圆/全面 Repository/DTO/微信抽象层（§22 防过度工程判例，理由见 ADR §24）。
- **设计约束**：确定性主键+CAS、状态机单一权威、安检 fail-closed、金额整数分品牌类型、镜像消灭为单源、降级不吞拒绝、统一分页协议、真实样本验证、代码外资产正册、工具先复位、文档预算、平台接缝单点、端点默认限速——全文见 `docs/根因账本.md`。
- **验收基准**：活线各包 tests + `scripts/check-structure.mjs`（计数以其输出为准）。
- **守卫接线**：`scripts/check-structure.mjs` 的扫描范围已含 `rewrite/`。
