import cloud from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import type { OrderDoc } from '@ldrw/shared'
import { alert, notifyAlert } from './observe'
import { getDb, getDocOrNull } from './db'
import { restoreStock } from './inventory'

// 微信退款单号契约（根因#12 平台接缝契约）：
// 退款经 callFlow → 微信，`out_refund_no` 仅允许 `^[0-9a-zA-Z_|*@-]{1,64}$`。而内部售后单 _id =
// `orderId__lineId`（lineId = productId__spec）可含**非 ASCII**（中文 SKU/spec，如「sku测试文案」）或**超 64 字**，
// 直接当退款单号必被微信 PARAM_ERROR 拒（非平台漂移）。此处把内部 _id 派生成合规单号：
// ASCII、≤64、按 _id **确定**（幂等重试同号）、**唯一**（哈希锁定具体 _id）。售后单落 `outRefundNo` 字段
// 供退款回调反查（refundCallback 按此命中·回退 .doc(_id) 兼容纯 ASCII 老单）。
const REFUND_NO_RE = /^[0-9a-zA-Z_|*@-]{1,64}$/

/** 单号合规自证（守卫/调用方可断言·避免魔法正则散写）。非字符串（undefined/缺字段）一律不合规——
 *  防 `test(undefined)` 把 'undefined' 判合规的假绿。 */
export const isValidRefundNo = (no: unknown): boolean => typeof no === 'string' && REFUND_NO_RE.test(no)

// cyrb53：确定性 53-bit 非加密哈希（无 node 依赖·可入任意包）→ base36（[0-9a-z] ⊂ 微信许可集）。
// 导出复用（createOrder 幂等键派生 claim _id，同 refundNoFor 的「任意串→确定性短 id」需求）。
export function hash53(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) // 53 bit → ≤11 位 base36
}

/**
 * 内部售后单 _id → 微信合规退款单号（`out_refund_no`）。
 * **已合规（纯 ASCII 短单，如早期 orderId__productId）原样返回**——退款回调 `.doc(_id)` 兼容不变、
 * 微信按单号幂等不受影响；仅当 _id 含非 ASCII / 超 64 时才派生「ASCII 可读前缀（订单号/productId·便于
 * 对账溯源）- 全 _id 短哈希（锁定具体单·防碰撞）」。前缀截 48 + '-' + ≤11 哈希 ≤ 60 < 64；前缀空用 'r' 兜底。
 * 产出恒配 REFUND_NO_RE（tests/app-refund.test.ts 断言）。
 */
export function refundNoFor(afterSaleId: string): string {
  const id = String(afterSaleId || '')
  if (id && isValidRefundNo(id)) return id // 已合规：原样（老单/短单回调兼容·幂等不变）
  const prefix = (id.match(/[0-9A-Za-z]+/g) || []).join('').slice(0, 48) || 'r'
  return `${prefix}-${hash53(id)}`
}

/**
 * 触发云开发工作流（根因#12 平台接缝单点：与微信支付的收/退款接缝收口一处，
 * 平台规则变更改动面最小）。返回工作流 result.data（预付单参数/退款结果），异常/无 data 返回 null；
 * 微信回「订单已支付」时返回 ORDER_PAID_ON_WX（见下）。
 *
 * 失败必留痕：`.catch(() => null)` 会把平台真实报错吞成
 * 一句 REFUND_TRIGGER_FAIL、排障只能靠猜——故两条失败分支（调用异常/有响应无 data）都落
 * [LD_ALERT] 行带 flowId + 报错摘要（截断防日志爆量·不含 openid/凭证），返回语义不变（fail-soft）。
 * quiet：失败不在这里报，改回 { flowFail: { code, ctx } } 交调用方原样补报——pay 要先读回订单，回调已先到
 * （钱已收）时这条钱链告警是假的。
 */
export async function callFlow(flowId: string, data: unknown, opts: { quiet?: boolean } = {}): Promise<any> {
  const text = (v: unknown): string => {
    try {
      return String(v instanceof Error ? v.message : JSON.stringify(v))
    } catch {
      return 'UNSERIALIZABLE'
    }
  }
  const brief = (v: unknown) => text(v).slice(0, 300)
  const fail = (code: string, ctx: Record<string, unknown>) => {
    if (opts.quiet) return { flowFail: { code, ctx } }
    alert('money', 'flow', code, ctx)
    return null
  }
  let res: any
  try {
    res = await cloud.callFunction({ name: 'cloudbase_module', data: { name: flowId, data } })
  } catch (e) {
    if (WX_ORDER_PAID.test(text(e))) return ORDER_PAID_ON_WX
    return fail('FLOW_CALL_FAIL', { flowId, error: brief(e) })
  }
  if (WX_ORDER_PAID.test(text(res && res.result))) return ORDER_PAID_ON_WX
  if (res && res.result && res.result.data != null) return res.result.data
  return fail('FLOW_NO_DATA', { flowId, result: brief(res && res.result) })
}

// 微信说「这单已经付过了」：付款成功、回调未到时用户再点支付，同一单号重复下单会被拒。这是正常业务、不是
// 通道故障，不报钱链告警，交调用方回 ORDER_ALREADY_PAID。微信官方 JSAPI 下单错误码表没列这一项；v2 统一下单
// 文档和社区 v3 接入用的都是 ORDERPAID。工作流把微信报错包在哪一层没有真机样本，所以在整个回包和抛错文案里认
// 这个词：认不出就走原来的失败告警，不会把没付的单当成已付。
const WX_ORDER_PAID = /\bORDERPAID\b/
export const ORDER_PAID_ON_WX = Object.freeze({ orderPaid: true as const })

/**
 * 待付单关单并回补预留：超时关单定时器、pay 惰性关单、用户取消三处共用。回 true＝这次是本次关的（已回补）。
 * 先 closed 后回补：宁可晚到的回调误判售罄（可退款），不冒先回补被并发买走的超卖。
 * 条件写抛错≠没写上：回包丢了而写已落地时，单已 closed、定时器只扫 pending 再也扫不到，这里不回补就永久少卖。
 * 读回按本次写的 closedAt 认领（别人关的不认，回补归关单那一方）；还是 pending＝没写上，照抛——定时器下次扫描重关，
 * 用户那边报错可重试。
 * ponytail: 读回也失败只能告警交人工；要根除得给关单加「待回补」标记让定时器捡。同毫秒两方关单且本次写抛错才会误认领。
 */
export async function closePendingOrder(
  id: string,
  reserved: OrderDoc['reserved'] | undefined,
  extra: Record<string, unknown> = {}
): Promise<boolean> {
  const db = getDb()
  const closedAt = Date.now()
  let moved: boolean
  try {
    const r = await db
      .collection(COLLECTIONS.orders)
      .where({ _id: id, status: 'pending' })
      .update({ data: { ...extra, status: 'closed', closedAt } })
    moved = !!(r.stats && r.stats.updated === 1)
  } catch (e) {
    const now = await getDocOrNull<OrderDoc>(db.collection(COLLECTIONS.orders).doc(id)).catch(() => undefined)
    moved = !!(now && now.status === 'closed' && now.closedAt === closedAt)
    await notifyAlert('money', 'closePendingOrder', 'CLOSE_WRITE_FAIL', {
      id,
      readBack: now === undefined ? 'fail' : moved ? 'landed' : (now && now.status) || 'missing',
    })
    if (now === undefined || (now && now.status === 'pending')) throw e
  }
  if (moved && Array.isArray(reserved) && reserved.length) await restoreStock(reserved)
  return moved
}
