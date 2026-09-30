// v6 Lite「降存在感」（Claude Design「Lucky Ducky App v6 Lite」+ handoff/v6-lite-简化说明.md·老板 2026-09-30 施工）：
// 导航、切换、容器退成平面，键帽只留给真正的操作；「紫＝当前」。
import { describe, it, expect } from 'vitest'
import tokens from '../styles/tokens.wxss?raw'
import tabWxml from '../custom-tab-bar/index.wxml?raw'
import tabWxss from '../custom-tab-bar/index.wxss?raw'
import tabTs from '../custom-tab-bar/index.ts?raw'
import homeTs from '../pages/home/home.ts?raw'
import navWxml from '../components/v5-nav/v5-nav.wxml?raw'
import welcomeWxml from '../pages/welcome/welcome.wxml?raw'
import olWxml from '../pages/order-list/order-list.wxml?raw'
import olWxss from '../pages/order-list/order-list.wxss?raw'
import detailWxml from '../pages/detail/detail.wxml?raw'
import detailWxss from '../pages/detail/detail.wxss?raw'
import cartWxml from '../pages/cart/cart.wxml?raw'
import cartWxss from '../pages/cart/cart.wxss?raw'
import orderWxml from '../pages/order/order.wxml?raw'
import orderWxss from '../pages/order/order.wxss?raw'
import checkoutWxml from '../pages/checkout/checkout.wxml?raw'
import meWxml from '../pages/me/me.wxml?raw'
import meWxss from '../pages/me/me.wxss?raw'
import mcWxml from '../pages/my-courses/my-courses.wxml?raw'
import mcWxss from '../pages/my-courses/my-courses.wxss?raw'

const live = (w: string) => w.replace(/<!--[\s\S]*?-->/g, '')
const rule = (css: string, sel: string) => {
  const i = css.indexOf('\n' + sel + ' {')
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i))
}

describe('5a 底栏：三格平面、紫＝当前、不显示件数', () => {
  it('大白话：键帽去掉（不挂 k-light/k-flat），当前图标紫、其余 ink-2；顶部 .10 分隔线', () => {
    const w = live(tabWxml)
    expect(w).not.toMatch(/k-light|k-flat/)
    expect(w).toContain(`tone="{{active === item.id ? 'var(--v5-violet)' : 'var(--v5-ink-2)'}}"`)
    expect(rule(tabWxss, '.ld-tabbar')).toContain('border-top: 1px solid rgba(17, 17, 17, 0.1);')
  })
  it('大白话：购物车件数与加购弹跳一起拿掉（底栏不再数件数）', () => {
    expect(live(tabWxml)).not.toMatch(/cartCount|ld-tab-count|bump/)
    expect(tabTs).not.toMatch(/cartCount|bump/)
    expect(homeTs).not.toMatch(/\.bump\?\.\(\)/)
  })
})

describe('6a 顶栏返回键：去键帽只留像素箭头', () => {
  it('大白话：导航组件与激活页的返回都只放 back 图标，44 热区不变', () => {
    for (const w of [navWxml, welcomeWxml]) {
      expect(live(w)).not.toMatch(/class="k k-sm k-light (nv|wl)-back"/)
      expect(live(w)).toMatch(/class="(nv|wl)-hit"[^>]*>\s*<px-i name="back" \/>/)
    }
  })
})

describe('6b 我的订单筛选：纯文字页签 + 紫色像素条', () => {
  it('大白话：去凹槽和白色选中键；每项 40 高 15 号字；当前紫字 + 底部 20×4 紫条压在分隔线上', () => {
    const w = live(olWxml)
    expect(w).not.toMatch(/well ol-tabs/)
    expect(w).not.toMatch(/class="k ol-tab/)
    expect(rule(olWxss, '.ol-tabs')).toContain('border-bottom: 1px solid var(--v5-hair-soft);')
    expect(rule(olWxss, '.ol-tab')).toContain('height: 40px;')
    expect(rule(olWxss, '.ol-tab')).toContain('font-size: 15px;')
    expect(rule(olWxss, '.ol-tab-on')).toContain('color: var(--v5-violet-text);')
    const bar = rule(olWxss, '.ol-tab-on::before')
    for (const d of ['width: 20px;', 'height: 4px;', 'bottom: -1px;', 'background: var(--v5-violet);']) expect(bar).toContain(d)
  })
})

describe('6c 商品详情款式：横排文字、紫＝当前、不再有键帽和 LED', () => {
  it('大白话：去凹槽/键帽/LED；间距 20、每项 44 高；选中紫字', () => {
    const w = live(detailWxml)
    expect(w).not.toMatch(/well pd-vars|class="k pd-var|name="led"/)
    expect(rule(detailWxss, '.pd-vars')).toMatch(/gap: (0 )?20px;/) // 横向间距 20（换行时行距 0）
    expect(rule(detailWxss, '.pd-var')).toContain('height: 44px;')
    expect(rule(detailWxss, '.pd-var-on')).toContain('color: var(--v5-violet-text);')
  })
})

describe('6d 信息卡片：取消白卡，改顶部分隔线、内容贴页边距', () => {
  it('大白话：订单详情/订单列表/确认订单/我/我的课程不再挂像素白卡', () => {
    for (const w of [orderWxml, olWxml, checkoutWxml, meWxml, mcWxml]) expect(live(w)).not.toMatch(/px-card/)
  })
  it('大白话：卡片只剩顶部 .08 分隔线、左右内边距归零', () => {
    for (const [css, sel] of [[orderWxss, '.od-card'], [olWxss, '.ol-card'], [meWxss, '.me-card'], [mcWxss, '.mc-card']] as const) {
      const r = rule(css, sel)
      expect(r, sel).toContain('box-shadow: inset 0 1px 0 var(--v5-hair-soft);')
      expect(r, sel).toMatch(/padding: 16px 0;/)
    }
  })
})

describe('6e 购物车数量步进：去键帽、整组一道细框', () => {
  it('大白话：−/+/删除 不再是浅色键；外框高 28、圆角 6、1px 发丝线', () => {
    expect(live(cartWxml)).not.toMatch(/class="k k-sm k-light ca-step-key/)
    const r = rule(cartWxss, '.ca-step')
    for (const d of ['height: 28px;', 'border-radius: 6px;', 'box-shadow: inset 0 0 0 1px var(--v5-hair);']) expect(r).toContain(d)
    expect(rule(cartWxss, '.ca-step-key')).toContain('color: var(--v5-ink-2);')
  })
})

describe('6f 商品详情底栏：客服退成平面图标', () => {
  it('大白话：客服不是键帽，44×48 灰色图标；加入购物车仍是 48 浅色方键', () => {
    const w = live(detailWxml)
    expect(w).toMatch(/class="pd-cs"[^>]*><px-i name="service" tone="var\(--v5-ink-2\)" \/><\/view>/)
    expect(w).toMatch(/class="k k-light k-48 pd-add[^"]*k-sq"/)
    const r = rule(detailWxss, '.pd-cs')
    expect(r).toContain('width: 44px;')
    expect(r).toContain('height: 48px;')
  })
})

describe('6g 分隔线淡到 .08、规格四格去上下线', () => {
  it('大白话：新 token hair-soft＝.08；全仓不再有 1px solid 的 .14 发丝线（键帽描边仍 .14）', () => {
    expect(tokens).toContain('--v5-hair-soft: rgba(17, 17, 17, 0.08);')
    expect(tokens).toContain('--v5-hair: rgba(17, 17, 17, 0.14);')
    for (const css of [olWxss, detailWxss, cartWxss, orderWxss, meWxss, mcWxss]) expect(css).not.toMatch(/solid var\(--v5-hair\)/)
  })
  it('大白话：规格四格不要上下边线，首格左内边距归零', () => {
    const r = rule(detailWxss, '.pd-specs')
    expect(r).not.toMatch(/border-(top|bottom)/)
    expect(rule(detailWxss, '.pd-spec:first-child')).toContain('padding-left: 0;')
  })
})
