import { callApp, type ApiResult } from '../utils/cloud'

export const getCouponOffer = (): Promise<ApiResult> => callApp('getCouponOffer')
export const claimCoupon = (): Promise<ApiResult> => callApp('claimCoupon')
