/**
 * 客服会话状态机声明单源（坐席台）。流转表与 agentDesk.ts/dispatch.ts 里
 * 实际的 transition('csSession', …) 调用逐条吻合。
 * SPEC 本体被 rw-status-transitions-declared 守卫文本级消费·勿删。
 */

/** 客服会话状态机声明（csSession 集合）。 */
export const CS_SESSION_STATUS_SPEC = {
  collection: 'csSession',
  initial: ['pending'],
  terminal: [],
  transitions: [
    { from: ['pending'], to: 'active', trigger: 'claimConversation（坐席认领接起·绑 agentId·受接待上限约束）' },
    { from: ['pending'], to: 'closed', trigger: 'closeConversation（超时未接/顾客离开·放弃排队）/ refreshTrialSession force（测版强制刷新）/ heldStatus 闲置 15 分钟自动回机器人' },
    { from: ['active'], to: 'escalated', trigger: 'escalateToMerchant（外包答不了·升级转商户超管·外包最小权只能升不能拍板）' },
    { from: ['active'], to: 'pending', trigger: 'releaseConversation（坐席放手退回待接队列·调 activeCount）' },
    { from: ['active'], to: 'closed', trigger: 'closeConversation（坐席结束会话·触 CSAT）/ heldStatus 闲置 15 分钟自动回机器人（不触 CSAT）' },
    { from: ['escalated'], to: 'active', trigger: 'claimConversation（商户/坐席重新接手升级来的会话）' },
    { from: ['escalated'], to: 'closed', trigger: 'closeConversation（商户处理完关闭·触 CSAT）/ heldStatus 闲置 15 分钟自动回机器人（不触 CSAT）' },
    { from: ['closed'], to: 'pending', trigger: 'enqueueSession（顾客再点「找人工」重开·清归属·createdAt 刷新＝重新排队·调试日志 AD）' },
  ],
} as const


/** 坐席在线态枚举（agentDesk.ts setAgentStatus 校验用·非状态机，无流转规则）。 */
export const AGENT_STATUS = ['online', 'busy', 'offline'] as const
