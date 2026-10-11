// 云端 pay 回包 → 页面动作。云端改回包字段时 rewrite/cloud/tests/contract-shape.test.ts 会红，两头一起改。
// 收银台五个参数缺任一就判错不拉起：半空参数拉起会让收银台闪退，比不拉更糟。
// BAD_STATUS:paid 按已付处理（并发下别处已付成功，不该吓用户）。
type SignType = 'MD5' | 'HMAC-SHA256' | 'RSA'

interface PaymentParams {
  timeStamp: string
  nonceStr: string
  package: string
  signType: SignType
  paySign: string
}

const SIGN_TYPES: readonly string[] = ['MD5', 'HMAC-SHA256', 'RSA']

// 手抄自 shared buildBadStatus('paid')（mp 引不了 @ldrw/shared），两边须逐字一致，check-structure 会核
const PAID_BAD_STATUS = 'BAD_STATUS:paid'

type PayOutcome =
  | { kind: 'paid' }
  | { kind: 'request'; payment: PaymentParams }
  | { kind: 'closed'; message: string }
  | { kind: 'error'; message: string }

export function mapPayResult(r: unknown): PayOutcome {
  const res = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  if (res.ok === true) {
    if (res.paid === true) return { kind: 'paid' } // 0 元单直付/并发已付
    const p = res.payment
    if (p && typeof p === 'object') {
      const fields = ['timeStamp', 'nonceStr', 'package', 'signType', 'paySign'] as const
      const clean: Record<string, string> = {}
      for (const f of fields) {
        const v = p[f]
        if (typeof v !== 'string' || !v) return { kind: 'error', message: '支付参数不完整，请稍后再试' }
        clean[f] = v
      }
      if (!SIGN_TYPES.includes(clean.signType)) return { kind: 'error', message: '支付参数不完整，请稍后再试' }
      return { kind: 'request', payment: clean as unknown as PaymentParams }
    }
    return { kind: 'error', message: '支付参数不完整，请稍后再试' }
  }
  const e = String(res.error || '')
  if (e.startsWith(PAID_BAD_STATUS)) return { kind: 'paid' }
  if (e === 'ORDER_CLOSED') return { kind: 'closed', message: '订单已超时关闭，请重新下单' }
  if (e === 'PAY_NOT_ENABLED') return { kind: 'error', message: '支付暂未开通' }
  if (e === 'UNIFIED_ORDER_FAIL') return { kind: 'error', message: '支付通道繁忙，稍后再试' }
  return { kind: 'error', message: '暂时付不了，稍后再试' } // 弹窗标题已是「支付没成功」，正文不再重复
}
