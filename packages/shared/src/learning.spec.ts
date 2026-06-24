/**
 * learning 域状态机声明单源（P3「安全处生成」spike 扩到 learning·北极星 A：需求当单一源、向下派生）。
 *
 * 与 order.spec.ts 同款声明式权威——状态集合 + 合法流转表（含触发点）。纯「数据」、零运行时逻辑
 * （根因#8 铁律：只在安全处生成，永不重生成真机验过的运行时/UI）。
 *
 * 派生物（由 `scripts/gen-order-domain.mjs` 一并生成·勿手改生成段）：
 *   ① TS 类型/常量 → `learning.ts`（QrcodeStatus/QRCODE_STATUS/QRCODE_TRANSITIONS）
 *   ② 机读流转表   → 并入 `scripts/order-domain.generated.json`（守卫 order-transitions-declared 读它）
 *
 * 守卫 `order-transitions-declared` 扫 functions/learning/，把散落的 `transition('qrcodes', …)` /
 * `status:'…'` 写入与本声明对账——私自越流转/写未声明状态即红（根因#2 从「靠人记」升「机器对账」）。
 *
 * 改流转只改这里 → 跑 `node scripts/gen-order-domain.mjs` 同步派生物 → check 绿。
 *
 * ⚠️ 范式边界：本范式只管「status 字符串状态机」。learning 的「进课确认」用 activations.enteredAt
 * （null→时间戳 + 条件抢占·根因#1 并发态），不是 status 字符串机、不属本 codegen——其正确性由
 * confirmEnter 的 where({enteredAt:null}).update 原子抢占保证（与本表无关，故不声明）。
 */

/** 激活码状态机声明（qrcodes 集合）。一码一用：genQrcodes 写 unused、activateCourse 原子抢占翻 activated。 */
export const QRCODE_STATUS_SPEC = {
  collection: 'qrcodes',
  /** 初始态：genQrcodes 批量生成时写入。 */
  initial: ['unused'] as const,
  /** 终态：已激活（一码一用·无出边）。 */
  terminal: ['activated'] as const,
  /** 合法流转：unused → activated（守卫据此对账 activateCourse 的 transition 抢占）。 */
  transitions: [
    { from: ['unused'], to: 'activated', trigger: 'activateCourse 扫码激活（一码一用·transition 原子抢占·moved 即赢）' },
  ],
} as const
