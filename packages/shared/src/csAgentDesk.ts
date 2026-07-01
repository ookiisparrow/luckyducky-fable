/**
 * 承面 C 坐席台 API 契约（外包会话工作台·阶段0地基 Batch 2·扇出闸单源）。
 *
 * **这是什么**：8 个坐席台 action 的**输入/输出 TS 类型**——车道 A（后端实现）与车道 B（前端对 mock 先搭 UI）
 * 共同遵的**单一契约**。先立此契约再扇出并行，否则各车道各造一套 API＝整合灾难（承面C工单 §0/§2）。纯「类型」、
 * 零运行时（同 cs.spec.ts/order.spec.ts 声明式风格·根因#5 单源防漂移）。会话态引 `./cs` 的 `CsSessionStatus`（状态机单源）。
 *
 * **权限位（§1 定稿·外包最小权·根因#3）**：以下 8 个 action 均须 cap `agent:handle`——**查 + 回复 + 升级**
 * （listQueue/getThread/claim/release/send/escalate/close）；**不含**动钱/动状态/退款那类（留商户超管·外包无权）。
 * **运行时 wire 由车道 A 与 action 同批落·不空守**（本 Batch 不建 dead config——呼应 adminApi/lib.ts「不立无 action
 * 消费者的空 cap·防过度工程」+ CLAUDE §7 + Batch 1 提交「cap 随 B6.1 落」）。车道 A 实现每个 action 时：
 *   ① `adminApi/lib.ts` `ROLES.outsourced` 追加 `'agent:handle'`；
 *   ② `adminApi/index.ts` `ACTION_CAPS` 给这 8 个 action 标 `'agent:handle'`（未 gate 的 action 已默认拒·守卫 agent-rbac-gated 在）；
 *   ③ 守卫 `order-transitions-declared` 扩扫 `functions/cs/`（首个 `transition('csSession')` 出现时·对账流转·承面C工单 §3 车道 A）。
 *
 * **实时＝轮询（§1 定稿）**：getThread 按 `cursor` 增量拉（前端 2-3s 轮询），非长连；分页走 cursor/limit（根因#7）。
 * **响应可带额外字段**：下列 `*Res` 是两车道都需的**最小**形状，车道 A 实现可在其上加字段（TS 结构化子类型兼容）。
 */

import type { CsSessionStatus } from './cs'

/** 会话标识＝csSession._id（确定性 `wxkf:<openKfId>:<externalUserId>`·一顾客一活会话）。 */
export type SessionId = string

/** 坐席在线态（agentState.status·B6.3 排队分配据此选可接坐席）。 */
export type AgentStatus = 'online' | 'busy' | 'offline'

/** 待接队列条目（listQueue·pending 会话摘要·字段取自 csSession 文档）。 */
export interface QueueItem {
  sessionId: SessionId
  externalUserId: string
  openKfId: string
  status: CsSessionStatus
  createdAt: number
  updatedAt: number
}

/** 会话视图（claim/getThread/… 回当前会话态·较 QueueItem 多认领信息 + 身份桥接）。 */
export interface SessionView extends QueueItem {
  openid: string | null // 身份桥接（kfIdentity）已建则有·供前端联动 getCustomer360 侧栏；未建为 null
  agentId: string | null // 认领坐席（active/escalated 有·pending 为 null）
  claimedAt: number | null
}

/** 会话消息流一条（getThread·读 conversations 归档·按 at 升序）。 */
export interface ThreadMessage {
  direction: 'in' | 'out' // in＝入站客户 / out＝出站坐席
  msgtype: string
  text: string
  at: number
}

// ── 8 个 action 的输入/输出 ──

/** ① listQueue：待接队列（pending 会话·bounded·cursor/limit 分页·根因#7）。 */
export interface ListQueueReq {
  limit?: number
  cursor?: string
}
export interface ListQueueRes {
  ok: true
  items: QueueItem[]
  nextCursor?: string
}

/** ② claimConversation：pending→active·绑当前坐席 agentId·接待上限校验（activeCount<limit·B6.3）。 */
export interface ClaimConversationReq {
  sessionId: SessionId
}
export interface ClaimConversationRes {
  ok: true
  session: SessionView
}

/** ③ releaseConversation：active→pending 退回待接队列（坐席放手·调整 activeCount）。 */
export interface ReleaseConversationReq {
  sessionId: SessionId
}
export interface ReleaseConversationRes {
  ok: true
}

/** ④ sendAgentMessage：坐席回复·经 kit/wecom send_msg（48h 接待窗口内）·出站落 conversations。 */
export interface SendAgentMessageReq {
  sessionId: SessionId
  text: string
}
export interface SendAgentMessageRes {
  ok: true
  errcode?: number // 微信 send_msg 回执（0/缺=成功·非 0 便于联调看结果·同 kfSend）
}

/** ⑤ getThread：拉会话消息流·cursor 增量（前端轮询·分配 scope 校验：外包只读自己 claim 的会话）。 */
export interface GetThreadReq {
  sessionId: SessionId
  cursor?: string
}
export interface GetThreadRes {
  ok: true
  session: SessionView
  messages: ThreadMessage[]
  nextCursor?: string
}

/** ⑥ setAgentStatus：坐席切在线/示忙/离线（写 agentState·排队分配据此·B6.3）。 */
export interface SetAgentStatusReq {
  status: AgentStatus
}
export interface SetAgentStatusRes {
  ok: true
}

/** ⑦ escalateToMerchant：active→escalated·甩回商户超管（外包最小权只能升不能拍板·§1 定稿）。 */
export interface EscalateToMerchantReq {
  sessionId: SessionId
}
export interface EscalateToMerchantRes {
  ok: true
}

/** ⑧ closeConversation：→closed（终态·触 CSAT 评分气泡·会话结束）。 */
export interface CloseConversationReq {
  sessionId: SessionId
}
export interface CloseConversationRes {
  ok: true
}

/** ⑨ listMyActive：本坐席在接（active）会话（刷新/重登后恢复在接·多会话切换·bounded·follow-up ②）。 */
export interface ListMyActiveReq {
  limit?: number
}
export interface ListMyActiveRes {
  ok: true
  sessions: SessionView[]
}

/**
 * ⑩ getSessionCustomer360：按**会话**看对应客户 360（外包唯一 360 读路径·follow-up ①·§1.5 双闸）：
 * 分配 scope（assertOwnedByAgent·只看自己 claim 的会话）+ 数据共享同意（assertDataShareConsent·客户未同意即拒）；
 * 超管（数据控制者）两闸 bypass。会话未建身份桥接（openid null）回 ok:false error:'NO_BRIDGE'。
 */
export interface GetSessionCustomer360Req {
  sessionId: SessionId
}
export interface GetSessionCustomer360Res {
  ok: true
  openid: string
  panels: Array<{ key: string; label: string; order?: number; data?: unknown; error?: string }>
}

/** 坐席台 10 个 action 名（车道 A 实现·车道 B 对 mock·共同遵此契约·均须 cap `agent:handle`）。 */
export type AgentDeskAction =
  | 'listQueue'
  | 'claimConversation'
  | 'releaseConversation'
  | 'sendAgentMessage'
  | 'getThread'
  | 'setAgentStatus'
  | 'escalateToMerchant'
  | 'closeConversation'
  | 'listMyActive'
  | 'getSessionCustomer360'
