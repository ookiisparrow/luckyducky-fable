# @ldrw/shared — 全仓契约单源

**一句话**：全仓契约唯一权威（金额/状态机/集合名/错误码/action↔模块映射），**改一处全仓震动**；本包多数文件是红区（数据契约不可改名）或黄区（镜像/生成物，改动需连带同步）。

## 逐文件职责

- `money.ts` 金额品牌类型 Fen（全链整数分·浮点编译期挡·`toFen`/`asFen` 唯一转换口）
- `contracts.ts` mp↔cloud 响应契约人类正本（cloud 侧编译锚 + mp 手抄副本对照源·哨兵 `rewrite/cloud/tests/contract-shape.test.ts`）
- `status.ts` 状态机声明公共形状 + 类型级派生 · `statusLabels.ts` 状态→中文标签单源（漏配编译期报错）
- `order.ts` / `learning.ts` / `cs.spec.ts` / `scm.spec.ts` 各域状态机声明单源（状态串=前后端契约+库内数据，**不可改名**）
- `scm.ts` SCM 类型/流转表生成物（单源 `scm.spec.ts`·勿手改生成段）· `scmBom.ts` 配方解析纯函数 · `scmKey.ts` 组合键定界符防护
- `collections.ts` 集合名册（同一生产库·名字是数据契约不可改·新集合先登记再用）
- `errors.ts` 错误码权威登记册（前端分支契约·只追加不改名）· `limits.ts` 交易输入边界常量 · `checkout.ts` 结算/优惠/运费常量单源
- `moduleMap.ts` app action→业务模块映射（仓根 `modules.json` 的运行时镜像·守卫 `module-map-synced` 焊死）
- `observability.ts` 运行期可观测契约 · `index.ts` 桶导出
- `seed/products.ts` + `seed/course.ts` 商品/课程种子单一来源（mp 与 cloud seed 函数都从这派生·样例数据只改这一处）

## 红线

- **Fen 品牌类型**：金额全链整数分，元只在展示层；普通 number 当 Fen 用编译失败。
- **集合名是数据契约**：`collections.ts` 的键即生产库集合名，不可改。
- **状态机流转表改动 = 工头级**：状态串是前后端契约+库内数据，多处有 parity 测试焊死。
- **mp 侧 4 处手抄消费点**（mp 物理进不了本包·靠手抄同步·改键必连带）：`rewrite/mp/lib/payFlow.ts`（收银台五参）· `lib/mapOrders.ts`（订单文档）· `lib/playbackCache.ts`（r.url）· `pages/order-list/order-list.ts`（nextCursor/hasMore）——改 `contracts.ts` 后同步这四处 + 哨兵测试。

## 模块归属

某集合/action 属哪个模块 → 查仓根 `modules.json`；`moduleMap.ts` 与它的同步由守卫 `module-map-synced` 焊死，漏改即 `npm run check` 红。
