/**
 * 售后退款接口（链10）。写侧 applyRefund（敏感业务：退款金额云端分摊，不信任前端）；
 * 读侧 getMyAfterSales（只读本人）。H5 / App 无云：读侧返回 null（页面空态），
 * 写侧返回 null（页面走演示 Toast）。页面不直接调这里，统一经 store/aftersales.js 收口。
 */
import { callCloud } from '@/utils/cloud.js'
import { logger } from '@/utils/logger.js'

// 我的售后单列表；无云 / 失败返回 null（与「空列表」区分，避免覆盖已有数据）
export async function getMyAfterSales() {
  try {
    const res = await callCloud('getMyAfterSales')
    if (res?.ok && Array.isArray(res.list)) return res.list
  } catch (e) {
    logger.warn('aftersales', 'getMyAfterSales 云端失败', e)
  }
  return null
}

// 申请退款。成功返回售后单；云函数拒绝向上抛（页面按 error 提示）；无云返回 null
export async function applyRefund(payload) {
  const res = await callCloud('applyRefund', payload)
  if (res === null) return null
  if (!res.ok) throw new Error(res.error || 'APPLY_FAILED')
  return res.afterSale
}
