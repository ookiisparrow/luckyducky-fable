/**
 * 订单接口。订单是敏感业务：小程序端一律走云函数（createOrder 云端定价，
 * 不信任前端价格）；H5 / App 端回退本地生成（调试日志 C 的前端快照方案，
 * 仅会话内，用于演示贯通）。页面不直接调这里，统一经 store/orders.js 收口。
 *
 * 订单形状：{ id, items:[{ productId, name, spec, price, qty, refundable }],
 *           goods, coupon, ship, amount, address, status, createdAt, paidAt }
 */
import { callCloud } from '@/utils/cloud.js'
import { CATALOG } from '@/data/catalog.js'
import { CHECKOUT_ADDONS, COUPON, SHIP } from '@/data/checkout.js'
import { logger } from '@/utils/logger.js'

// 本地订单号：与云端同风格（yyyyMMddHHmm + 4 位随机）
function localOrderNo(now) {
  const d = new Date(now)
  const p = (n) => String(n).padStart(2, '0')
  const rand = String(Math.floor(Math.random() * 9000) + 1000)
  return (
    '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + rand
  )
}

// H5 / App 回退：按与云函数同一套规则本地生成（价格查本地 catalog / 搭配购表）
function localCreateOrder({ items, address }) {
  const lines = (Array.isArray(items) ? items : []).filter(
    (l) => l && l.id && Number.isInteger(l.qty) && l.qty > 0,
  )
  if (!lines.length) throw new Error('EMPTY_ITEMS')
  const built = lines.map((l) => {
    const addon = CHECKOUT_ADDONS.find((a) => a.id === l.id)
    if (addon) {
      return { productId: addon.id, name: addon.name, spec: '', price: addon.price, qty: l.qty, refundable: true }
    }
    const p = CATALOG[l.id]
    if (!p) throw new Error('UNKNOWN_ITEM:' + l.id)
    // 本地回退无 skus 价表：规格名透传进快照，价格用本地目录价（演示链路；云端才做规格定价）
    return { productId: p.id, name: p.name, spec: l.sku || p.tag || '', price: p.price, qty: l.qty, refundable: true }
  })
  const goods = built.reduce((s, it) => s + it.price * it.qty, 0)
  const a = address || {}
  const now = Date.now()
  return {
    id: localOrderNo(now),
    items: built,
    goods,
    coupon: COUPON,
    ship: SHIP,
    amount: Math.max(0, goods + SHIP - COUPON),
    address: {
      name: String(a.name || ''),
      phone: String(a.phone || ''),
      region: String(a.region || ''),
      detail: String(a.detail || ''),
    },
    status: 'paid',
    createdAt: now,
    paidAt: now,
  }
}

// 下单（审核批次A-5）：本地回退**只限无云环境**（H5/App 演示，callCloud 约定返回 null）。
// 小程序端云调用异常或云函数拒单一律向上抛——真实交易不得本地伪成功（原「异常也回退」
// 顺带吞掉了拒单 throw，已一并修正）。
export async function createOrder(payload) {
  let res
  try {
    res = await callCloud('createOrder', payload)
  } catch (e) {
    logger.error('order', 'createOrder 云端异常，阻断提交', e)
    throw e instanceof Error ? e : new Error('CREATE_ORDER_FAILED')
  }
  if (res === null) return localCreateOrder(payload) // 无云演示环境
  if (res?.ok && res.order) return res.order
  throw new Error(res?.error || 'CREATE_ORDER_FAILED') // 云函数拒单：页面按 error 提示
}

// 发起微信支付（仅小程序端有真实链路）：云函数 pay 校验本人 pending 单并按库内金额
// 下单 → 拉起微信收银台。错误语义：PAY_CANCELLED=用户取消；ORDER_CLOSED=已超时关单；
// PAY_NOT_ENABLED=支付通道未启用（PAY_MODE 未切 real）。0 元单云端直接置 paid 不拉收银台。
export async function payOrder(id) {
  const res = await callCloud('pay', { id })
  if (!res) throw new Error('PAY_UNAVAILABLE') // 非小程序端无云调用，调用方界面不应暴露入口
  if (!res.ok) throw new Error(res.error || 'PAY_FAILED')
  if (res.paid) return { paid: true } // 0 元单：云端已直接置 paid
  await new Promise((resolve, reject) => {
    uni.requestPayment({
      provider: 'wxpay',
      ...res.payment,
      success: resolve,
      fail: (e) => {
        const cancelled = e && e.errMsg && e.errMsg.includes('cancel')
        reject(new Error(cancelled ? 'PAY_CANCELLED' : 'PAY_FAILED'))
      },
    })
  })
  return { paid: true }
}

// 确认收货：云端流转 shipped → done（仅本人订单）。本地完成**只限无云环境**（H5/App
// 演示，且回退单恒为待发货、按钮通常不可达）；小程序云端异常一律向上抛（审核批次A-5）。
export async function confirmReceive(id) {
  let res
  try {
    res = await callCloud('confirmReceive', { id })
  } catch (e) {
    logger.error('order', 'confirmReceive 云端异常', e)
    throw e instanceof Error ? e : new Error('CONFIRM_FAILED')
  }
  if (res === null) return { doneAt: Date.now() } // 无云演示环境
  if (res?.ok) return { doneAt: res.doneAt }
  throw new Error(res?.error || 'CONFIRM_FAILED')
}

// 按单号取本人订单（详情兜底：列表 limit 之外的老单也能打开）；无云/未找到返回 null
export async function getOrderById(id) {
  try {
    const res = await callCloud('getOrderById', { id })
    if (res?.ok && res.order) return res.order
  } catch (e) {
    logger.warn('order', 'getOrderById 云端失败', e)
  }
  return null
}

export async function getMyOrders() {
  try {
    const res = await callCloud('getMyOrders')
    if (res?.ok && Array.isArray(res.list)) return res.list
  } catch (e) {
    logger.warn('order', 'getMyOrders 云端失败，回退空列表', e)
  }
  return []
}
