// UI 审查第二轮 15 问（2026-09-30·Claude Design「Lucky Ducky UI 审查 15 问」+ 落地规格文字版·老板选定）。
// 6a 状态名/灯/说明句的行为由 orders-map / aftersales-map / p-mp-order(-list)-page 等测试钉住，这里只管版式。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { navBottom } from '../lib/ground'
import checkoutWxml from '../pages/checkout/checkout.wxml?raw'
import checkoutWxss from '../pages/checkout/checkout.wxss?raw'
import addressWxml from '../pages/address/address.wxml?raw'
import addressWxss from '../pages/address/address.wxss?raw'
import orderWxml from '../pages/order/order.wxml?raw'
import orderWxss from '../pages/order/order.wxss?raw'
import homeWxss from '../pages/home/home.wxss?raw'
import orderListWxml from '../pages/order-list/order-list.wxml?raw'
import orderListWxss from '../pages/order-list/order-list.wxss?raw'
import reviewsWxss from '../pages/reviews/reviews.wxss?raw'
import aftersalesWxml from '../pages/aftersales/aftersales.wxml?raw'
import logisticsWxml from '../pages/logistics/logistics.wxml?raw'
import playerWxml from '../pages/player/player.wxml?raw'
import helpWxml from '../components/help-sheet/help-sheet.wxml?raw'
import myCoursesWxml from '../pages/my-courses/my-courses.wxml?raw'
import meWxml from '../pages/me/me.wxml?raw'
import loginWxml from '../components/login-sheet/login-sheet.wxml?raw'
import privacyWxml from '../components/privacy-sheet/privacy-sheet.wxml?raw'
import leaveWxml from '../components/leave-sheet/leave-sheet.wxml?raw'

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}
const live = (w: string) => w.replace(/<!--[\s\S]*?-->/g, '')
const rule = (s: string, sel: string) => {
  const i = s.indexOf('\n' + sel + ' {')
  expect(i, sel).toBeGreaterThanOrEqual(0)
  return s.slice(i, s.indexOf('}', i))
}

describe('1c 地址卡拆三行：省市区 13 灰 / 详细地址 17·600 墨 / 收件人 15 灰', () => {
  it('大白话：结算页、地址列表、订单详情三处同一结构，详细地址是全卡唯一重点', () => {
    const sets: Array<[string, string, string, string]> = [
      [checkoutWxml, checkoutWxss, 'co', 'co-who'],
      [addressWxml, addressWxss, 'ad', 'ad-name'],
      [orderWxml, orderWxss, 'od', 'od-who'],
    ]
    for (const [w, css, p, who] of sets) {
      const html = live(w)
      const iRegion = html.indexOf(`${p}-region`)
      const iDetail = html.indexOf(`${p}-detail`)
      const iWho = html.indexOf(who)
      expect(iRegion, p).toBeGreaterThan(-1)
      expect(iRegion < iDetail && iDetail < iWho, `${p} 顺序`).toBe(true)
      expect(rule(css, `.${p}-region`)).toContain('font-size: 13px')
      expect(rule(css, `.${p}-detail`)).toMatch(/font-size: 17px;[\s\S]*font-weight: 600;[\s\S]*color: var\(--v5-ink\)/)
      expect(rule(css, `.${who}`)).toMatch(/font-size: 15px;[\s\S]*color: var\(--v5-ink-2\)/)
    }
  })
})

describe('3a 首页买家秀截 3 行、整排等高、署名贴底', () => {
  it('大白话：正文最多 3 行，撑满剩余高度把署名推到底', () => {
    const q = rule(homeWxss, '.hm-rv-quote')
    expect(q).toContain('-webkit-line-clamp: 3')
    expect(q).toContain('flex: 1')
  })
})

describe('4b 「取消订单」墨字', () => {
  it('大白话：危险感只在按住时的红色进度里，平时是墨字', () => {
    expect(rule(orderListWxss, '.ol-danger')).toContain('color: var(--v5-ink)')
  })
})

describe('5a 订单列表页签固定在导航栏下方', () => {
  const g = globalThis as any
  const saved = g.wx
  afterEach(() => {
    g.wx = saved
  })
  it('大白话：页签条贴在导航栏下缘（状态栏 + 44），下面留 52 占位；滚动后才出分隔线', async () => {
    g.wx = { getWindowInfo: () => ({ statusBarHeight: 47, screenHeight: 844 }) }
    expect(navBottom()).toBe(91)
    expect(live(orderListWxml)).toMatch(/class="ol-tabs-bar \{\{scrolled \? 'ol-tabs-bar-line' : ''\}\}" style="top: \{\{navBottom\}\}px"/)
    expect(rule(orderListWxss, '.ol-tabs-bar')).toContain('position: fixed')
    expect(rule(orderListWxss, '.ol-tabs-space')).toContain('height: 52px')
    vi.resetModules()
    await import('../pages/order-list/order-list')
    const patches: Record<string, unknown>[] = []
    const p = { data: { scrolled: false }, setData: (x: Record<string, unknown>) => (patches.push(x), Object.assign(p.data, x)) }
    pageOpts.onPageScroll.call(p, { scrollTop: 0 })
    pageOpts.onPageScroll.call(p, { scrollTop: 120 })
    pageOpts.onPageScroll.call(p, { scrollTop: 300 })
    pageOpts.onPageScroll.call(p, { scrollTop: 0 })
    expect(patches).toEqual([{ scrolled: true }, { scrolled: false }]) // 只在跨过顶端时 setData
  })
})

describe('7b 评价页小字统一 13px', () => {
  it('大白话：分布条标签/标签计数/评价标签 13px；标签栏 40 宽、行高 19、行距 6', () => {
    expect(rule(reviewsWxss, '.rv-bar-lbl')).toMatch(/flex: 0 0 40px;[\s\S]*font-size: 13px/)
    expect(rule(reviewsWxss, '.rv-tag-n')).toContain('font-size: 13px')
    expect(rule(reviewsWxss, '.rv-itag')).toContain('font-size: 13px')
    expect(rule(reviewsWxss, '.rv-bar')).toContain('height: 19px')
    expect(rule(reviewsWxss, '.rv-bars')).toContain('gap: 6px')
    expect(reviewsWxss).not.toMatch(/font-size: 11px/)
  })
})

describe('8b 售后页：货车先画，只有列表用骨架', () => {
  it('大白话：加载中就画空车停好（不倒车入场），数据回来只加货；骨架与真实行同结构、不闪', () => {
    const w = live(aftersalesWxml)
    expect(w).toContain(`<view wx:if="{{!loadFailed && (loading || list.length)}}" class="as-truck"`)
    expect(w).toContain(`<px-truck pose="park" cargo="{{list.length ? 1 : 0}}" />`)
    expect(w).not.toMatch(/arrive=|as-skel/)
    const sk = w.match(/<view wx:if="\{\{loading && !list.length\}\}" class="as-list">([\s\S]*?)\n {2}<\/view>/)?.[1] ?? ''
    expect(sk).toMatch(/class="as-row"[\s\S]*class="as-ico"[\s\S]*class="as-mid"/)
    expect(sk).not.toMatch(/(^|\s|")skel(\s|")/)
  })
})

describe('9b 物流页失败：标准失败块，失败时不画小货车', () => {
  it('大白话：信号动画 + 网络开小差 + 说明 + 重试；小货车只在没失败时出现', () => {
    const w = live(logisticsWxml)
    expect(w).toContain('<view wx:if="{{!loadFailed}}" class="lg-truck"')
    const fail = w.match(/wx:elif="\{\{loadFailed\}\}">([\s\S]*?)\n<\/view>/)?.[1] ?? ''
    expect(fail).toMatch(/<px-anim name="signal" size="4" \/>[\s\S]*网络开小差[\s\S]*物流信息没加载出来，请重试[\s\S]*重试/)
  })
})

describe('10a 播放页控制行：上一段/下一段是像素图标（v6 换成竖线+三角 prev/next·老板 2026-09-30）', () => {
  it('大白话：不再写字，任何屏宽都是图标', () => {
    const w = live(playerWxml)
    expect(w).toMatch(/bind:tap="onPrev"[^>]*><px-i name="prev" \/><\/view>/)
    expect(w).toMatch(/lp-ctl \{\{canNext[^>]*bind:tap="onNext"[^>]*><px-i name="next" \/><\/view>/)
    expect(w).not.toMatch(/>上一段<|>下一段</)
  })
})

describe('11a 求助面板与加桌引导：全站浅色半屏', () => {
  it('大白话：求助面板高度按内容（播放子页才撑满）、有进退场动画（点遮罩/关闭先播退场 240ms 的行为在 help-sheet.test）', () => {
    const w = live(helpWxml)
    expect(w).toContain(`class="lp-help-sheet sh-panel {{helpOut ? 'out' : ''}}" style="{{helpSrc ? 'top: ' + (statusBarHeight + 44) + 'px' : 'max-height: calc(100% - ' + (statusBarHeight + 44) + 'px)'}}"`)
    expect(live(playerWxml)).toContain('<help-sheet id="help" status-bar-height="{{statusBarHeight}}" bind:pausemain="onHelpPauseMain" />')
  })
  it('大白话：加桌引导——标题 + 关闭键 + 两步 +「知道了」；点遮罩/关闭＝留下，知道了＝继续退出', () => {
    const w = live(playerWxml)
    const i = w.indexOf('<view class="lp-dg-mask sh-mask" wx:if="{{deskGuide}}" bind:tap="onDeskGuideStay"')
    expect(i).toBeGreaterThan(-1)
    const dg = w.slice(i)
    expect(dg).toContain('加到桌面，下次一点就开')
    expect(dg).toMatch(/lp-help-close" bind:tap="onDeskGuideStay"/)
    expect(dg).toMatch(/lp-dg-no[^"]*">1<[\s\S]*lp-dg-no[^"]*">2</)
    expect(dg).toMatch(/k-ink lp-dg-ok"[^>]*bind:tap="onDeskGuideExit"[^>]*>知道了</)
  })
})

describe('12b / 13a 没有课程：统一叫「激活卡」，给「去逛逛」', () => {
  it('大白话：我的课程空态——纸箱 +「还没有课程」+ 激活卡说明 +「去逛逛」；「我」页空卡同一套说法', () => {
    const mc = live(myCoursesWxml)
    expect(mc).toMatch(/<px-ground kind="box" \/>[\s\S]*还没有课程[\s\S]*用微信「扫一扫」材料包里的激活卡，课程会出现在这里[\s\S]*bind:tap="onGoShop"[^>]*>去逛逛</)
    expect(mc).not.toMatch(/包装盒|二维码/)
    const me = live(meWxml)
    expect(me).toMatch(/还没有课程<\/text>\s*<text class="t-sys me-card-sub">用微信扫激活卡开课<\/text>[\s\S]*catch:tap="onGoShop"[^>]*>去逛逛</)
    expect(me).not.toContain('还没有学习记录')
  })
})

describe('14a 全站半屏去掉拖动条', () => {
  it('大白话：登录、隐私、放弃编辑、申请售后、求助、加桌引导都没有拖动条', () => {
    for (const w of [loginWxml, privacyWxml, leaveWxml, orderWxml, playerWxml]) expect(live(w)).not.toMatch(/-(grab|grip)"/)
  })
})
