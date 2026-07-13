// 支付结果映射（纯函数·vitest 钉·守卫 rw-mp-pay-golden）：云端 pay 契约 → 页面动作。
// fail-closed：收银台五参缺任一即判错不拉起（半空参数拉起=收银台闪退·比不拉更糟）；
// BAD_STATUS:paid 判已付（并发已付幂等成功·不吓用户）。
export type SignType = 'MD5' | 'HMAC-SHA256' | 'RSA'

export interface PaymentParams {
  timeStamp: string
  nonceStr: string
  package: string
  signType: SignType
  paySign: string
}

const SIGN_TYPES: readonly string[] = ['MD5', 'HMAC-SHA256', 'RSA']

// 必须与 rewrite/shared/src/order.ts 的 buildBadStatus('paid') 输出逐字一致——mp 进不了 @ldrw/shared（开发者工具编译限制），手动同步，改一处两处都要改
const PAID_BAD_STATUS = 'BAD_STATUS:paid'

export type PayOutcome =
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
        if (typeof v !== 'string' || !v) return { kind: 'error', message: '支付参数不完整，请稍后再试' } // 半空不拉起
        clean[f] = v
      }
      if (!SIGN_TYPES.includes(clean.signType)) return { kind: 'error', message: '支付参数不完整，请稍后再试' } // 非法签名类型同 fail-closed
      return { kind: 'request', payment: clean as unknown as PaymentParams }
    }
    return { kind: 'error', message: '支付参数不完整，请稍后再试' }
  }
  const e = String(res.error || '')
  if (e.startsWith(PAID_BAD_STATUS)) return { kind: 'paid' } // 已付幂等
  if (e === 'ORDER_CLOSED') return { kind: 'closed', message: '订单已超时关闭，请重新下单' }
  if (e === 'PAY_NOT_ENABLED') return { kind: 'error', message: '支付暂未开通' }
  if (e === 'UNIFIED_ORDER_FAIL') return { kind: 'error', message: '支付通道繁忙，稍后再试' }
  return { kind: 'error', message: '支付没成功，稍后再试' }
}
