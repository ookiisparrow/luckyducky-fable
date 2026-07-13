/**
 * 客服会话状态机声明单源（承面C 坐席台·port 自旧线 packages/shared/src/cs.spec.ts——流转表与
 * rewrite 线 agentDesk.ts/dispatch.ts 里实际的 transition('csSession', …) 调用逐条吻合，语义不改）。
 * 类型经 SpecStates 类型级派生，改声明即改类型，零生成器（新线范式同 order.ts，见其头注）。
 */
import { statesOf, type SpecStates } from './status'

/** 客服会话状态机声明（csSession 集合）。 */
export const CS_SESSION_STATUS_SPEC = {
  collection: 'csSession',
  initial: ['pending'],
  terminal: [],
  transitions: [
    { from: ['pending'], to: 'active', trigger: 'claimConversation（坐席认领接起·绑 agentId·受接待上限约束）' },
    { from: ['pending'], to: 'closed', trigger: 'closeConversation（超时未接/顾客离开·放弃排队）' },
    { from: ['active'], to: 'escalated', trigger: 'escalateToMerchant（外包答不了·升级转商户超管·外包最小权只能升不能拍板）' },
    { from: ['active'], to: 'pending', trigger: 'releaseConversation（坐席放手退回待接队列·调 activeCount）' },
    { from: ['active'], to: 'closed', trigger: 'closeConversation（坐席结束会话·触 CSAT）' },
    { from: ['escalated'], to: 'active', trigger: 'claimConversation（商户/坐席重新接手升级来的会话）' },
    { from: ['escalated'], to: 'closed', trigger: 'closeConversation（商户处理完关闭·触 CSAT）' },
    { from: ['closed'], to: 'pending', trigger: 'enqueueSession（顾客再点「找人工」重开·清归属·createdAt 刷新＝重新排队·调试日志 AD）' },
  ],
} as const

export type CsSessionStatus = SpecStates<typeof CS_SESSION_STATUS_SPEC>

// 运行时常量（从声明**运行时派生**，见 order.ts 头注同款范式）：键=值的状态字典，消费方 Object.values() 作状态全集。
const dictOf = <T extends string>(states: readonly string[]) =>
  Object.fromEntries(states.map((s) => [s.toUpperCase(), s])) as Record<string, T>
export const CS_SESSION_STATUS = dictOf<CsSessionStatus>(statesOf(CS_SESSION_STATUS_SPEC))

/** 坐席在线态枚举（agentDesk.ts setAgentStatus 校验用·非状态机，无流转规则）。 */
export const AGENT_STATUS = ['online', 'busy', 'offline'] as const
export type AgentStatus = (typeof AGENT_STATUS)[number]
