/**
 * learning 域类型/常量/流转表——**生成物**（单源 learning.spec.ts·勿手改生成段）。
 * 见 learning.spec.ts 头注；改流转改声明再跑 scripts/gen-order-domain.mjs。
 */

// ⚠️ 此段由 scripts/gen-order-domain.mjs 从对应 *.spec.ts 生成——勿手改。改流转改声明源（order.spec.ts/learning.spec.ts）再跑生成器。
// === GENERATED:order-domain BEGIN ===
/** qrcodes 状态联合（从 learning.spec.ts 生成·写错状态名编译失败·根因#2）。 */
export type QrcodeStatus = 'activated' | 'unused'

export const QRCODE_STATUS = {
  ACTIVATED: 'activated',
  UNUSED: 'unused',
} as const satisfies Record<string, QrcodeStatus>

/** qrcodes 合法流转表（机读·守卫 order-transitions-declared 对账散落实现）。 */
export const QRCODE_TRANSITIONS: ReadonlyArray<{ from: readonly QrcodeStatus[]; to: QrcodeStatus }> = [
  { from: ['unused'], to: 'activated' }, // activateCourse 扫码激活（一码一用·transition 原子抢占·moved 即赢）
]
// === GENERATED:order-domain END ===
