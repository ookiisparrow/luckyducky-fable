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
    return { productId: p.id, name: p.name, spec: p.tag || '', price: p.price, qty: l.qty, refundable: true }
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

export async function createOrder(payload) {
  try {
    const res = await callCloud('createOrder', payload)
    if (res?.ok && res.order) return res.order
    // res 非空说明云函数拒单（契约/未知条目），不回退、向上抛（提交守卫已挡常规场景）
    if (res) throw new Error(res.error || 'CREATE_ORDER_FAILED')
  } catch (e) {
    // 小程序端云端异常也回退本地：模拟支付阶段保流程贯通；P4 接真实支付后改为阻断提交
    logger.warn('order', 'createOrder 云端不可用，回退本地', e)
  }
  return localCreateOrder(payload)
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
