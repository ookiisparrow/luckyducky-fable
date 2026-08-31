import { ERR, COLLECTIONS } from '@ldrw/shared'
import { withOpenId, withRateLimit, ok, err, ensureDoc } from '../../../kit'
import {
  loadCouponOffer,
  loadBrandCreds,
  sendProductCoupon,
  couponReqNo,
  brandFail,
} from '../../../kit/wxbrand'

/** 只回开关与展示文案；关则 mp 不出领券。openid 不从这里取。 */
export async function getCouponOffer() {
  const offer = await loadCouponOffer()
  if (!offer.enabled) return ok({ enabled: false, label: '' })
  return ok({ enabled: true, label: offer.label || '领取优惠' })
}

export const claimCoupon = withOpenId(
  withRateLimit('claimCoupon', { max: 8, windowMs: 60_000 }, async ({ db, OPENID }) => {
    const offer = await loadCouponOffer(db)
    if (!offer.enabled) return err(ERR.COUPON_DISABLED)
    if (!offer.brandId || !offer.productCouponId || !offer.stockId) return err(ERR.COUPON_NOT_CONFIGURED)

    const claimId = couponReqNo('u', OPENID + '|' + offer.stockId)
    const existed = await db.collection(COLLECTIONS.couponClaims).doc(claimId).get().catch(() => null)
    if (existed && existed.data) return err(ERR.COUPON_ALREADY_CLAIMED)

    const creds = await loadBrandCreds(db)
    if (!creds.ok) {
      await brandFail('claimCoupon', creds.error)
      return err(ERR.COUPON_NOT_CONFIGURED)
    }

    const sent = await sendProductCoupon(
      {
        openid: OPENID,
        productCouponId: offer.productCouponId,
        stockId: offer.stockId,
        appid: offer.appid,
        sendRequestNo: couponReqNo('s', OPENID + '|' + offer.stockId),
      },
      creds.creds
    )
    if (!sent.ok) {
      await brandFail('claimCoupon', sent.error || 'COUPON_SEND_FAIL', { status: sent.status })
      return err(ERR.COUPON_SEND_FAIL)
    }

    const couponCode = String(sent.json?.coupon_code || '')
    await ensureDoc(COLLECTIONS.couponClaims, claimId, {
      stockId: offer.stockId,
      productCouponId: offer.productCouponId,
      couponCode,
      createdAt: Date.now(),
    })
    return ok({ couponCode: couponCode || undefined })
  })
)
