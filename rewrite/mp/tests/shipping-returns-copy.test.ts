// 顾客看见的运费/退货说法必须对齐已拍板政策（详情/购物车/结算/支付成功）。
// rewrite/mp tsconfig 无 @types/node，走 ?raw（见 raw-imports.d.ts）。
import { describe, expect, it } from 'vitest'
import detailRaw from '../pages/detail/detail.wxml?raw'
import cartRaw from '../pages/cart/cart.wxml?raw'
import checkoutRaw from '../pages/checkout/checkout.wxml?raw'
import paysuccessRaw from '../pages/paysuccess/paysuccess.wxml?raw'
import kbRaw from '../../admin/src/pages/Kb.vue?raw'

function live(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '')
}

const detail = live(detailRaw)
const cart = live(cartRaw)
const checkout = live(checkoutRaw)
const paysuccess = live(paysuccessRaw)

describe('详情/购物车/结算运费与退货话术', () => {
  it('大白话：详情、结算和支付成功页顾客短句都是「包邮到家·售后无忧」，不再写满额包邮、全场包邮或疆蒙藏长句', () => {
    for (const src of [detail, checkout, paysuccess]) {
      expect(src).toContain('包邮到家·售后无忧')
      expect(src).not.toContain('除新疆、内蒙古、西藏外包邮')
      expect(src).not.toContain('除疆蒙藏外')
      expect(src).not.toMatch(/满\s*¥?\s*100\s*包邮/)
      expect(src).not.toContain('全场包邮')
      expect(src).not.toContain('全场无门槛包邮')
      expect(src).not.toContain('次日达')
    }
  })

  it('大白话：支付成功页可留顺丰，履约只承诺 48 小时内发出，不硬承诺次日达', () => {
    expect(paysuccess).toContain('顺丰速运')
    expect(paysuccess).toContain('48 小时内发出')
    expect(paysuccess).not.toContain('次日达')
    expect(paysuccess).not.toMatch(/满\s*¥?\s*100\s*包邮/)
    expect(paysuccess).not.toContain('全场包邮')
    expect(paysuccess).not.toContain('全场无门槛包邮')
  })

  it('大白话：详情写开课后不可退；顾客短句不再说无条件七天无理由', () => {
    expect(detail).toContain('开课后')
    expect(detail).toContain('不可退货')
    expect(detail).not.toContain('无理由退换')
    expect(detail).not.toContain('七天无理由')
    expect(checkout).not.toContain('七天无理由')
    expect(paysuccess).not.toContain('七天无理由')
  })

  it('大白话：购物车是首页栏，信任条跟短粗口径，不写七天无理由或满额/全场包邮', () => {
    expect(cart).not.toContain('七天无理由')
    expect(cart).not.toMatch(/满\s*¥?\s*100\s*包邮/)
    expect(cart).not.toContain('全场包邮')
    expect(cart).toContain('包邮到家·售后无忧')
    expect(cart).not.toContain('官方正品保障')
    expect(cart).not.toContain('除新疆、内蒙古、西藏外包邮')
    expect(cart).not.toContain('次日达')
  })

  it('大白话：客服知识库退货预设跟同一套说法，发票那句还在', () => {
    const refund = kbRaw.match(/key:\s*'aftersale:refund'[\s\S]*?answer:\s*'([^']+)'/)?.[1] ?? ''
    expect(refund).toContain('除新疆、内蒙古、西藏外包邮')
    expect(refund).toContain('确认进课后不可退')
    expect(refund).toContain('如需发票，请联系客服。')
    expect(refund).not.toMatch(/满\s*¥?\s*100\s*包邮/)
  })
})
