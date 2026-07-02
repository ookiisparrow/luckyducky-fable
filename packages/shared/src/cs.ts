/**
 * cs 域（承面 C 会话）类型/常量/流转表——**生成物**（单源 cs.spec.ts·勿手改生成段）。
 * 见 cs.spec.ts 头注；改流转改声明再跑 scripts/gen-order-domain.mjs。
 */

// ⚠️ 此段由 scripts/gen-order-domain.mjs 从对应 *.spec.ts 生成——勿手改。改流转改声明源（order.spec.ts/learning.spec.ts）再跑生成器。
// === GENERATED:order-domain BEGIN ===
/** csSession 状态联合（从 cs.spec.ts 生成·写错状态名编译失败·根因#2）。 */
export type CsSessionStatus = 'active' | 'closed' | 'escalated' | 'pending'

export const CS_SESSION_STATUS = {
  ACTIVE: 'active',
  CLOSED: 'closed',
  ESCALATED: 'escalated',
  PENDING: 'pending',
} as const satisfies Record<string, CsSessionStatus>

/** csSession 合法流转表（机读·守卫 order-transitions-declared 对账散落实现）。 */
export const CS_SESSION_TRANSITIONS: ReadonlyArray<{ from: readonly CsSessionStatus[]; to: CsSessionStatus }> = [
  { from: ['pending'], to: 'active' }, // claimConversation（坐席认领接起·绑 agentId·受接待上限约束）
  { from: ['pending'], to: 'closed' }, // closeConversation（超时未接/顾客离开·放弃排队）
  { from: ['active'], to: 'escalated' }, // escalateToMerchant（外包答不了·升级转商户超管·外包最小权只能升不能拍板）
  { from: ['active'], to: 'pending' }, // releaseConversation（坐席放手退回待接队列·调 activeCount）
  { from: ['active'], to: 'closed' }, // closeConversation（坐席结束会话·触 CSAT）
  { from: ['escalated'], to: 'active' }, // claimConversation（商户/坐席重新接手升级来的会话）
  { from: ['escalated'], to: 'closed' }, // closeConversation（商户处理完关闭·触 CSAT）
  { from: ['closed'], to: 'pending' }, // enqueueSession（顾客再点「找人工」重开·清归属·createdAt 刷新＝重新排队·调试日志 AD）
]
// === GENERATED:order-domain END ===
