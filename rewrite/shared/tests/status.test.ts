// 新线状态机声明——结构健全性 + 与旧线声明逐字 parity（数据零迁移前提；M5 清退旧线时 parity 段随之退役）。
import { describe, it, expect } from 'vitest'
import { statesOf } from '../src/status'
import { ORDER_STATUS_SPEC, AFTERSALE_STATUS_SPEC, ORDER_STATUS, AFTERSALE_STATUS } from '../src/order'
import { ORDER_STATUS as OLD_OS, AFTERSALE_STATUS as OLD_AS_DICT } from '../../../packages/shared/src/order'
import { QRCODE_STATUS_SPEC } from '../src/learning'
import { PURCHASE_ORDER_STATUS_SPEC, OUTWORK_ORDER_STATUS_SPEC } from '../src/scm.spec'
import { ORDER_STATUS_SPEC as OLD_ORDER, AFTERSALE_STATUS_SPEC as OLD_AS } from '../../../packages/shared/src/order.spec'
import { QRCODE_STATUS_SPEC as OLD_QR } from '../../../packages/shared/src/learning.spec'
import { PURCHASE_ORDER_STATUS_SPEC as OLD_PO, OUTWORK_ORDER_STATUS_SPEC as OLD_OW } from '../../../packages/shared/src/scm.spec'

const SPECS = [ORDER_STATUS_SPEC, AFTERSALE_STATUS_SPEC, QRCODE_STATUS_SPEC, PURCHASE_ORDER_STATUS_SPEC, OUTWORK_ORDER_STATUS_SPEC]

describe('声明结构健全性', () => {
  it.each(SPECS.map((s) => [s.collection, s] as const))('%s：初始/终态非空，流转两端都是已声明状态', (_c, spec) => {
    expect(spec.initial.length).toBeGreaterThan(0)
    expect(spec.terminal.length).toBeGreaterThan(0)
    const states = new Set(statesOf(spec))
    for (const t of spec.transitions) {
      expect(states.has(t.to)).toBe(true)
      for (const f of t.from) expect(states.has(f)).toBe(true)
    }
  })

  it.each(SPECS.map((s) => [s.collection, s] as const))('%s：终态出边须在例外登记内（不许悄悄给终态开口）', (_c, spec) => {
    // 显式例外：orders 的 closed 是「可复活终态」——关单后钱到账必须能复活（closed→paid / closed→refund_required）。
    const ALLOWED = new Set(['orders:closed→paid', 'orders:closed→refund_required'])
    for (const t of spec.transitions) {
      for (const f of t.from) {
        if (spec.terminal.includes(f)) {
          expect(ALLOWED.has(`${spec.collection}:${f}→${t.to}`), `${spec.collection} 终态 ${f} 有未登记出边 →${t.to}`).toBe(true)
        }
      }
    }
  })
})

describe('与旧线声明逐字 parity（并存期铁律）', () => {
  it('orders：状态全集与每条流转 from→to 逐字一致', () => {
    expect(statesOf(ORDER_STATUS_SPEC)).toEqual(statesOf(OLD_ORDER as never))
    expect(ORDER_STATUS_SPEC.transitions.map((t) => `${[...t.from].join(',')}→${t.to}`)).toEqual(
      OLD_ORDER.transitions.map((t) => `${[...t.from].join(',')}→${t.to}`)
    )
  })
  it('运行时状态字典与旧线生成器产物逐键一致（消费方 Object.values 口径不漂）', () => {
    expect(Object.keys(ORDER_STATUS).sort()).toEqual(Object.keys(OLD_OS).sort())
    expect(Object.keys(AFTERSALE_STATUS).sort()).toEqual(Object.keys(OLD_AS_DICT).sort())
  })

  it('afterSales / qrcodes：状态全集与流转逐字一致', () => {
    expect(statesOf(AFTERSALE_STATUS_SPEC)).toEqual(statesOf(OLD_AS as never))
    expect(statesOf(QRCODE_STATUS_SPEC)).toEqual(statesOf(OLD_QR as never))
    expect(AFTERSALE_STATUS_SPEC.transitions.map((t) => `${[...t.from].join(',')}→${t.to}`)).toEqual(
      OLD_AS.transitions.map((t) => `${[...t.from].join(',')}→${t.to}`)
    )
    expect(QRCODE_STATUS_SPEC.transitions.map((t) => `${[...t.from].join(',')}→${t.to}`)).toEqual(
      OLD_QR.transitions.map((t) => `${[...t.from].join(',')}→${t.to}`)
    )
  })

  // purchaseOrders / outworkOrders（SCM 域·批C）：两条线各有一份 scm.spec.ts，目前手工保持逐字一致
  // （scm.ts 的生成器覆盖面见 gen-order-domain.mjs DOMAINS·守卫 gen-order-domain-synced 焊派生物同步，
  // 但两条线各自的 *声明源* scm.spec.ts 之间没有机器焊接——这条 parity 测试补上「声明源不分叉」这一环）。
  it('purchaseOrders / outworkOrders：状态全集与流转逐字一致', () => {
    expect(statesOf(PURCHASE_ORDER_STATUS_SPEC)).toEqual(statesOf(OLD_PO as never))
    expect(statesOf(OUTWORK_ORDER_STATUS_SPEC)).toEqual(statesOf(OLD_OW as never))
    expect(PURCHASE_ORDER_STATUS_SPEC.transitions.map((t) => `${[...t.from].join(',')}→${t.to}`)).toEqual(
      OLD_PO.transitions.map((t) => `${[...t.from].join(',')}→${t.to}`)
    )
    expect(OUTWORK_ORDER_STATUS_SPEC.transitions.map((t) => `${[...t.from].join(',')}→${t.to}`)).toEqual(
      OLD_OW.transitions.map((t) => `${[...t.from].join(',')}→${t.to}`)
    )
  })
})
