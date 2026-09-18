// 小程序残留清理：死样式 / 空 class / 购物车懒加载 / 没人引用的类型导出。
import { describe, expect, it } from 'vitest'
import welcomeWxss from '../pages/welcome/welcome.wxss?raw'
import orderWxss from '../pages/order/order.wxss?raw'
import aftersalesWxss from '../pages/aftersales/aftersales.wxss?raw'
import orderWxml from '../pages/order/order.wxml?raw'
import cartWxml from '../pages/cart/cart.wxml?raw'
import mapPages from '../lib/mapPages.ts?raw'

function live(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('mp 残留清理', () => {
  it('大白话：没人用的样式选择器不再占着', () => {
    expect(live(welcomeWxss)).not.toMatch(/\.ld-w-link\b/)
    expect(live(orderWxss)).not.toMatch(/\.co-shop-chev\b/)
    expect(live(aftersalesWxss)).not.toMatch(/\.coas-sechead-sub\b/)
  })

  it('大白话：订单页空 class 不再挂着', () => {
    expect(live(orderWxml)).not.toContain('co-addr-static')
    expect(live(orderWxml)).not.toContain('co-row-static')
  })

  it('大白话：购物车远程商品图要懒加载，别跟首屏抢带宽', () => {
    const imgs = live(cartWxml).match(/<image\b[^>]*>/g) || []
    const remotes = imgs.filter((t) => t.includes('item.cover'))
    expect(remotes.length).toBeGreaterThan(0)
    for (const t of remotes) expect(t).toMatch(/\blazy-load\b/)
  })

  it('大白话：没人引用的类型不再对外导出', () => {
    const src = live(mapPages)
    expect(src).not.toMatch(/export interface AboutVM\b/)
    expect(src).not.toMatch(/export interface AboutSectionVM\b/)
    expect(src).not.toMatch(/export interface WelcomePointVM\b/)
    expect(src).not.toMatch(/export interface AgreementArticleVM\b/)
    expect(src).not.toMatch(/export interface AgreementVM\b/)
    expect(src).not.toMatch(/export type \{[^}]*MeVM/)
  })
})
