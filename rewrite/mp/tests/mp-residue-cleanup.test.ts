// 小程序残留清理：死样式 / 空 class / 购物车懒加载 / 没人引用的类型导出。
import { describe, expect, it } from 'vitest'
import welcomeWxss from '../pages/welcome/welcome.wxss?raw'
import orderWxss from '../pages/order/order.wxss?raw'
import aftersalesWxss from '../pages/aftersales/aftersales.wxss?raw'
import orderWxml from '../pages/order/order.wxml?raw'
import cartWxml from '../pages/cart/cart.wxml?raw'
import mapPages from '../lib/mapPages.ts?raw'
import mapHome from '../lib/mapHome.ts?raw'
import mapMe from '../lib/mapMe.ts?raw'
import quickAdd from '../lib/quickAdd.ts?raw'
import privacyGate from '../lib/privacyGate.ts?raw'
import appVersion from '../lib/appVersion.ts?raw'
import player from '../lib/player.ts?raw'
import address from '../lib/address.ts?raw'
import payFlow from '../lib/payFlow.ts?raw'

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

    const home = live(mapHome)
    expect(home).not.toMatch(/export interface HeroVM\b/)
    expect(home).not.toMatch(/export interface BrandVM\b/)
    expect(home).not.toMatch(/export interface FeatureVM\b/)
    expect(home).not.toMatch(/export interface TrustVM\b/)
    expect(home).not.toMatch(/export interface ReassureItemVM\b/)
    expect(home).not.toMatch(/export interface ReassureVM\b/)
    expect(home).not.toMatch(/export interface ReviewVM\b/)
    expect(home).not.toMatch(/export interface ReviewsVM\b/)
    expect(home).not.toMatch(/export interface FaqVM\b/)
    expect(home).not.toMatch(/export interface ClosingVM\b/)
    expect(home).not.toMatch(/export interface FooterVM\b/)

    const me = live(mapMe)
    expect(me).not.toMatch(/export type MeEntryKey\b/)
    expect(me).not.toMatch(/export interface MeEntryVM\b/)

    expect(live(quickAdd)).not.toMatch(/export interface QuickAddPayload\b/)
    expect(live(privacyGate)).not.toMatch(/export interface PrivacyGate\b/)
    expect(live(appVersion)).not.toMatch(/export type AppChannel\b/)
    expect(live(player)).not.toMatch(/export type UrlFetcher\b/)
    expect(live(address)).not.toMatch(/export interface Address\b/)
    expect(live(payFlow)).not.toMatch(/export type SignType\b/)
    expect(live(payFlow)).not.toMatch(/export interface PaymentParams\b/)
    expect(live(payFlow)).not.toMatch(/export type PayOutcome\b/)
  })
})
