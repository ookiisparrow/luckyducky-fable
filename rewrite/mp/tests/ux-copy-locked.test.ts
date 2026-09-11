// 赵老板体验定稿：顾客可见文案/入口（A1–A11）。源码扫描 + 运行时口号。
import { describe, expect, it } from 'vitest'
import { BRAND_SLOGAN_CN, BRAND_SLOGAN_EN, HOME_SHARE_TITLE } from '../lib/brand'
import loginRaw from '../components/login-sheet/login-sheet.wxml?raw'
import cartWxml from '../pages/cart/cart.wxml?raw'
import cartTs from '../pages/cart/cart.ts?raw'
import coursesRaw from '../pages/my-courses/my-courses.wxml?raw'
import homeTs from '../pages/home/home.ts?raw'
import detailTs from '../pages/detail/detail.ts?raw'
import checkoutWxml from '../pages/checkout/checkout.wxml?raw'

function live(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('小程序体验定稿文案', () => {
  it('A1 登录半屏不再提收藏', () => {
    const src = live(loginRaw)
    expect(src).toContain('登录后同步你的订单 · 学习进度')
    expect(src).not.toContain('收藏')
  })

  it('A2 口号正册只改 mp：体验钩织；英文不动', () => {
    expect(BRAND_SLOGAN_CN).toBe('体验钩织，创造幸运。')
    expect(BRAND_SLOGAN_EN).toBe('Get ducky get lucky')
    expect(BRAND_SLOGAN_CN).not.toContain('学习钩织')
  })

  it('A3/A4 分享标题走正册，缺商品名才用口号兜底', () => {
    expect(HOME_SHARE_TITLE).toBe('小棉鸭初学者钩织学习套装｜体验钩织，创造幸运')
    expect(live(homeTs)).toContain('HOME_SHARE_TITLE')
    expect(live(detailTs)).toContain('BRAND_SLOGAN_CN')
    expect(live(homeTs)).not.toContain('小棉鸭钩织材料包')
    expect(live(detailTs)).not.toContain('小棉鸭钩织材料包')
  })

  it('A5 我的课程空态改成扫描二维码开始', () => {
    const src = live(coursesRaw)
    expect(src).toContain('扫描二维码开始')
    expect(src).not.toContain('买了材料包')
    expect(src).not.toContain('激活码开课')
  })

  it('A8 顾客看见的是购物车，不再写购物袋', () => {
    expect(live(cartWxml)).toContain('购物车')
    expect(live(cartWxml)).not.toContain('购物袋')
    expect(live(cartTs)).toContain('已加入购物车')
    expect(live(cartTs)).not.toContain('已加入购物袋')
  })

  it('A6 页脚 Lucky Ducky小棉鸭 和关于我们一样进关于页', () => {
    expect(live(homeTs)).toContain("label === 'Lucky Ducky小棉鸭'")
    expect(live(homeTs)).toContain("label === '关于我们'")
  })

  it('A9 购买先找小棉鸭详情，没有才滚商品轨', () => {
    const src = live(homeTs)
    expect(src).toContain('pickDuckKit')
    expect(src).toContain('/pages/detail/detail?id=')
    expect(src).toContain("scrollTo('friends')")
  })

  it('A10 没有真搭配购时整块不画', () => {
    expect(live(checkoutWxml)).toContain('wx:if="{{addons.length}}"')
  })
})
