// 主动召回·纯决策规则（后台360工作站 B4.4·根因#8 决策与 I/O 分离便于单测·守卫 recall-via-bot-seam）。
// 从已读出的 bounded 数据切片算出「该主动联系的客户」四类。**纯函数**：不碰 db/await——I/O 在 index.ts，这里只算。
//
// 四类（运营据此触达·非自动发消息给顾客）：
//   催付 unpaid     —— 待支付订单·下单已过 NUDGE 但仍在支付窗口内（将超时·提醒付款）
//   物流 logistics  —— 已发货但 shippedAt 超 STUCK 天仍未确认收货（疑卡件/丢件·主动查）
//   未用 unstarted  —— 已激活课程但从未进课（enteredAt 空·拿了码没开始学·提醒开课）
//   未完 unfinished —— 已进课但无任何学习进度记录（开了没学·提醒继续）

const DAY = 86400_000
const SHIPPED_STUCK_DAYS = 7 // 发货超 7 天未签收＝疑卡件
const NUDGE_AFTER_MS = 5 * 60_000 // 下单 5 分钟还没付＝值得催（仍在支付窗口内·将超时）

export interface RecallInput {
  now: number
  payWindowMs: number
  pendingOrders: any[] // status=pending（含 createdAt/id/_id）
  shippedOrders: any[] // status=shipped（含 shippedAt/id/_id）
  activations: any[] // 激活记录（含 _openid/courseId/enteredAt）
  progress: any[] // 学习进度（含 _openid/courseId）
}
export interface RecallResult {
  unpaid: string[]
  logistics: string[]
  unstarted: string[]
  unfinished: string[]
  total: number
}

const oid = (o: any) => String((o && (o.id || o._id)) || '')

export function recallCandidates(input: RecallInput): RecallResult {
  const { now, payWindowMs, pendingOrders, shippedOrders, activations, progress } = input

  // 催付：pending·下单 5 分钟还没付且仍在支付窗口内（将超时·值得提醒）
  const unpaid = (pendingOrders || [])
    .filter((o) => o && o.status === 'pending' && now - (o.createdAt || 0) > NUDGE_AFTER_MS && now - (o.createdAt || 0) < payWindowMs)
    .map(oid)
    .filter(Boolean)

  // 物流：shipped·发货超 7 天仍未确认收货（疑卡件/丢件）
  const logistics = (shippedOrders || [])
    .filter((o) => o && o.status === 'shipped' && o.shippedAt && now - o.shippedAt > SHIPPED_STUCK_DAYS * DAY)
    .map(oid)
    .filter(Boolean)

  // 未用：已激活未进课（enteredAt 空·owns 课没开始学）
  const unstarted = (activations || []).filter((a) => a && a._openid && !a.enteredAt).map((a) => String(a._openid))

  // 未完：已进课（enteredAt 有）但无任何学习进度记录（开了没学）
  const progressed = new Set((progress || []).map((p) => String(p._openid) + '__' + String(p.courseId)))
  const unfinished = (activations || [])
    .filter((a) => a && a._openid && a.enteredAt && !progressed.has(String(a._openid) + '__' + String(a.courseId)))
    .map((a) => String(a._openid))

  const total = unpaid.length + logistics.length + unstarted.length + unfinished.length
  return { unpaid, logistics, unstarted, unfinished, total }
}
