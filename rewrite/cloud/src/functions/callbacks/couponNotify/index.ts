/**
 * 商品券发放通知草稿（HTTP·以后才部 yaliceshi）。
 * 收通知 → 验签 → 解密 → 确认发放。幂等靠确认单号钉死券码。独立函数，不改现网支付转发。
 */
import {
  loadCouponOffer,
  loadBrandCreds,
  verifyBrandNotify,
  decryptBrandResource,
  confirmProductCoupon,
  couponReqNo,
  brandFail,
} from '../../../kit/wxbrand'

function header(h: Record<string, string> | undefined, name: string): string {
  const keys = Object.keys(h || {})
  const hit = keys.find((k) => k.toLowerCase() === name.toLowerCase())
  return hit ? String((h as Record<string, string>)[hit] || '') : ''
}

function ack(ok: boolean, message: string) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: ok ? 'SUCCESS' : 'FAIL', message }),
  }
}

export const main = async (event: any) => {
  const headers = event?.headers || {}
  const raw = event?.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : String(event?.body || '')
  const creds = await loadBrandCreds()
  if (!creds.ok) {
    await brandFail('couponNotify', creds.error)
    return ack(false, 'NO_CERT')
  }
  const signature = header(headers, 'wechatpay-signature')
  const timestamp = header(headers, 'wechatpay-timestamp')
  const nonce = header(headers, 'wechatpay-nonce')
  if (!verifyBrandNotify({ timestamp, nonce, body: raw, signature, publicKey: creds.creds.publicKey })) {
    await brandFail('couponNotify', 'BAD_SIGN')
    return ack(false, 'BAD_SIGN')
  }
  let payload: any
  try {
    payload = JSON.parse(raw || '{}')
  } catch {
    await brandFail('couponNotify', 'BAD_JSON')
    return ack(false, 'BAD_JSON')
  }
  const res = payload.resource || {}
  const plain = decryptBrandResource({
    apiKey: creds.creds.apiKey,
    ciphertext: String(res.ciphertext || ''),
    nonce: String(res.nonce || ''),
    associatedData: String(res.associated_data || ''),
  })
  if (!plain) {
    await brandFail('couponNotify', 'DECRYPT_FAIL')
    return ack(false, 'DECRYPT_FAIL')
  }
  let info: any
  try {
    info = JSON.parse(plain)
  } catch {
    await brandFail('couponNotify', 'BAD_RESOURCE')
    return ack(false, 'BAD_RESOURCE')
  }
  const openid = String(info.openid || '')
  const couponCode = String(info.coupon_code || '')
  const productCouponId = String(info.product_coupon_id || '')
  const stockId = String(info.stock_id || '')
  if (!openid || !couponCode || !productCouponId || !stockId) {
    await brandFail('couponNotify', 'BAD_RESOURCE')
    return ack(false, 'BAD_RESOURCE')
  }
  const offer = await loadCouponOffer()
  const confirmed = await confirmProductCoupon(
    {
      openid,
      couponCode,
      productCouponId,
      stockId,
      appid: offer.appid,
      outRequestNo: couponReqNo('c', couponCode),
    },
    creds.creds
  )
  if (!confirmed.ok) {
    await brandFail('couponNotify', confirmed.error || 'CONFIRM_FAIL', { status: confirmed.status })
    return ack(false, 'CONFIRM_FAIL')
  }
  return ack(true, '成功')
}
