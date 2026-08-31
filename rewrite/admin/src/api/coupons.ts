import { client } from './index'

export const getCouponConfig = () => client.post('getCouponConfig')
export const saveCouponConfig = (offer: Record<string, unknown>) => client.post('saveCouponConfig', { offer })
export const setCouponNotifyUrl = () => client.post('setCouponNotifyUrl')
