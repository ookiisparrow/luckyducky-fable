import cloud from 'wx-server-sdk'
import { alert } from './observe'

// 微信退款单号契约（根因#12 平台接缝契约·2026-07-05 调试案 A 真根因订正）：
// 退款经 callFlow → 微信，`out_refund_no` 仅允许 `^[0-9a-zA-Z_|*@-]{1,64}$`。而内部售后单 _id =
// `orderId__lineId`（lineId = productId__spec）可含**非 ASCII**（中文 SKU/spec，如「sku测试文案」）或**超 64 字**，
// 直接当退款单号必被微信 PARAM_ERROR 拒（案 A 卡单真因·非平台漂移）。此处把内部 _id 派生成合规单号：
// ASCII、≤64、按 _id **确定**（幂等重试同号）、**唯一**（哈希锁定具体 _id）。售后单落 `outRefundNo` 字段
// 供退款回调反查（refundCallback 按此命中·回退 .doc(_id) 兼容纯 ASCII 老单）。守卫 rw-money3/admin3-golden。
const REFUND_NO_RE = /^[0-9a-zA-Z_|*@-]{1,64}$/

/** 单号合规自证（守卫/调用方可断言·避免魔法正则散写）。非字符串（undefined/缺字段）一律不合规——
 *  防 `test(undefined)` 把 'undefined' 判合规的假绿。 */
export const isValidRefundNo = (no: unknown): boolean => typeof no === 'string' && REFUND_NO_RE.test(no)

// cyrb53：确定性 53-bit 非加密哈希（无 node 依赖·可入任意包）→ base36（[0-9a-z] ⊂ 微信许可集）。
function hash53(s: string): string {
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
 * **已合规（纯 ASCII 短单，如旧线 orderId__productId）原样返回**——退款回调 `.doc(_id)` 兼容不变、
 * 微信按单号幂等不受影响；仅当 _id 含非 ASCII / 超 64 时才派生「ASCII 可读前缀（订单号/productId·便于
 * 对账溯源）- 全 _id 短哈希（锁定具体单·防碰撞）」。前缀截 48 + '-' + ≤11 哈希 ≤ 60 < 64；前缀空用 'r' 兜底。
 * 产出恒配 REFUND_NO_RE（守卫 rw-money3-golden 断言）。
 */
export function refundNoFor(afterSaleId: string): string {
  const id = String(afterSaleId || '')
  if (id && isValidRefundNo(id)) return id // 已合规：原样（老单/短单回调兼容·幂等不变）
  const prefix = (id.match(/[0-9A-Za-z]+/g) || []).join('').slice(0, 48) || 'r'
  return `${prefix}-${hash53(id)}`
}

/**
 * 触发云开发工作流（设计约束#12 平台接缝单点：与微信支付的收/退款接缝收口一处，
 * 平台规则变更改动面最小）。返回工作流 result.data（预付单参数/退款结果），异常/无 data 返回 null。
 *
 * 失败必留痕（调试案 A·2026-07-04 真单联测逼出）：旧线 `.catch(() => null)` 把平台真实报错吞成
 * 一句 REFUND_TRIGGER_FAIL、排障只能靠猜——两条失败分支（调用异常/有响应无 data）都落
 * [LD_ALERT] 行带 flowId + 报错摘要（截断防日志爆量·不含 openid/凭证），返回语义不变（fail-soft）。
 */
export async function callFlow(flowId: string, data: unknown): Promise<any> {
  const brief = (v: unknown): string => {
    try {
      return String(v instanceof Error ? v.message : JSON.stringify(v)).slice(0, 300)
    } catch {
      return 'UNSERIALIZABLE'
    }
  }
  let res: any
  try {
    res = await cloud.callFunction({ name: 'cloudbase_module', data: { name: flowId, data } })
  } catch (e) {
    alert('money', 'flow', 'FLOW_CALL_FAIL', { flowId, error: brief(e) })
    return null
  }
  if (res && res.result && res.result.data != null) return res.result.data
  alert('money', 'flow', 'FLOW_NO_DATA', { flowId, result: brief(res && res.result) })
  return null
}
