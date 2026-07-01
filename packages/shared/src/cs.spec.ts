/**
 * cs 域状态机声明单源（承面 C 外包会话工作台·阶段0地基·P3「安全处生成」扩到 cs）。
 *
 * 与 order.spec.ts / learning.spec.ts 同款声明式权威——状态集合 + 合法流转表（含触发点）。纯「数据」、
 * 零运行时逻辑（根因#8 铁律：只在安全处生成，永不重生成真机验过的运行时/UI）。
 *
 * **背景（决策 §21 修订）**：cs 域此前无自有 status 状态机（kfState 是去重/游标缓存·「机器↔人工」是微信平台
 * service_state 经 wecom.ts 一处 API 设置·dispatch 是纯决策函数），故当时「cs 不扩 P3」。**承面 C 起 cs 有真状态机**
 * ——外包坐席会话有自己的生命周期（待接→接起→结束/升级），与微信平台 service_state 是两层：service_state 管
 * 「谁在微信侧收发」，csSession.status 管「我们自建工作台里这通会话的处理阶段」。故承面 C 起把 cs 纳 P3。
 *
 * 派生物（由 `scripts/gen-order-domain.mjs` 一并生成·勿手改生成段）：
 *   ① TS 类型/常量 → `cs.ts`（CsSessionStatus/CS_SESSION_STATUS/CS_SESSION_TRANSITIONS）
 *   ② 机读流转表   → 并入 `scripts/order-domain.generated.json`（守卫 order-transitions-declared 读它）
 *
 * 守卫 `order-transitions-declared` 扫承面 C 坐席台 actions（B6.1 起落 `transition('csSession', …)`），把散落的
 * 流转写入与本声明对账——私自越流转/写未声明状态即红（根因#2 从「靠人记」升「机器对账」）。
 *
 * 改流转只改这里 → 跑 `node scripts/gen-order-domain.mjs` 同步派生物 → check 绿。
 */

/**
 * 承面 C 会话状态机声明（csSession 集合·一顾客一活会话·确定性 _id=`wxkf:<openKfId>:<externalUserId>`）。
 * 状态：pending 待接入队列 / active 坐席接起处理中 / escalated 外包升级转商户处理 / closed 已结束（终态·触 CSAT）。
 * 说明：closed 是终态——顾客再来新消息＝开一通新会话（新 pending·同微信客服「会话超时结束」语义），不复活旧会话。
 */
export const CS_SESSION_STATUS_SPEC = {
  collection: 'csSession',
  /** 初始态：客户消息进入待接队列（inbound 落库时 upsert 建会话）。 */
  initial: ['pending'] as const,
  /** 终态：会话已结束（无出边·结束即触 CSAT + 归档已在）。 */
  terminal: ['closed'] as const,
  /** 合法流转：from[] → to，trigger 标触发的坐席台 action（守卫据此对账 B6.1 起散落的 transition 实现）。 */
  transitions: [
    { from: ['pending'], to: 'active', trigger: 'claimConversation（坐席认领接起·绑 agentId·受接待上限约束）' },
    { from: ['pending'], to: 'closed', trigger: 'closeConversation（超时未接/顾客离开·放弃排队）' },
    { from: ['active'], to: 'escalated', trigger: 'escalateToMerchant（外包答不了·升级转商户超管·外包最小权只能升不能拍板）' },
    { from: ['active'], to: 'pending', trigger: 'releaseConversation（坐席放手退回待接队列·调 activeCount）' },
    { from: ['active'], to: 'closed', trigger: 'closeConversation（坐席结束会话·触 CSAT）' },
    { from: ['escalated'], to: 'active', trigger: 'claimConversation（商户/坐席重新接手升级来的会话）' },
    { from: ['escalated'], to: 'closed', trigger: 'closeConversation（商户处理完关闭·触 CSAT）' },
  ],
} as const
