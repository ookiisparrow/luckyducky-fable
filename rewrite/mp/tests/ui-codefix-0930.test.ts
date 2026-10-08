// UI 审查第二轮·纯代码小修（2026-09-30·老板「纯代码问题可以直接处理」）+ 结业页「去评价」对收礼人不再是死路。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { live, rule } from './helpers/wxmlStatic'
import appWxss from '../app.wxss?raw'
import homeWxml from '../pages/home/home.wxml?raw'
import orderWxml from '../pages/order/order.wxml?raw'
import orderWxss from '../pages/order/order.wxss?raw'
import cartWxml from '../pages/cart/cart.wxml?raw'
import reviewWxml from '../pages/review/review.wxml?raw'
import welcomeWxml from '../pages/welcome/welcome.wxml?raw'
import playerWxml from '../pages/player/player.wxml?raw'
import myCoursesWxml from '../pages/my-courses/my-courses.wxml?raw'
import myCoursesWxss from '../pages/my-courses/my-courses.wxss?raw'
import catalogWxml from '../pages/catalog/catalog.wxml?raw'
import feedbackWxml from '../pages/feedback/feedback.wxml?raw'
import feedbackWxss from '../pages/feedback/feedback.wxss?raw'
import addressEditWxml from '../pages/address-edit/address-edit.wxml?raw'
import finishWxml from '../pages/finish/finish.wxml?raw'

const { ordersMock, courseMock } = vi.hoisted(() => ({ ordersMock: vi.fn(), courseMock: vi.fn() }))
vi.mock('../api/orders', () => ({ getMyOrders: ordersMock }))
vi.mock('../lib/courses', () => ({ getCourseById: courseMock }))
vi.mock('../lib/pxFx', () => ({ fxParty: vi.fn() }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}
const tagOf = (w: string, marker: string) => live(w).match(new RegExp(`<[a-z-]+[^>]*${marker}[^>]*>`))?.[0] ?? ''

describe('结业页「去评价」：收礼人（没有已完成订单）不再被带去空列表', () => {
  async function mount() {
    vi.resetModules()
    await import('../pages/finish/finish')
    const p = Object.create(pageOpts) as Record<string, any>
    p.data = { ...pageOpts.data }
    p.setData = function (patch: Record<string, unknown>) {
      Object.assign(this.data, patch)
    }
    return p
  }
  beforeEach(() => {
    ;(globalThis as any).wx = { getWindowInfo: () => ({ screenHeight: 844 }), redirectTo: vi.fn() }
    courseMock.mockReset().mockResolvedValue(null)
    ordersMock.mockReset()
  })
  // 老板 2026-09-30：结业页取消「课程目录」键——能评价只留「去评价」一颗主键，收礼人底部不出键（左上返回离开）
  it('大白话：自己买过（有已完成订单）——底部只一颗「去评价」', async () => {
    ordersMock.mockResolvedValue({ ok: true, list: [{ id: 'o1' }] })
    const p = await mount()
    await p.onLoad({ courseId: 'c1' })
    expect(ordersMock).toHaveBeenCalledWith(undefined, 1, 'done')
    expect(p.data.canReview).toBe(true)
  })
  it('大白话：别人送的（没有已完成订单）——底部不出键；整页再没有「课程目录」', async () => {
    ordersMock.mockResolvedValue({ ok: true, list: [] })
    const p = await mount()
    await p.onLoad({ courseId: 'c1' })
    expect(p.data.canReview).toBe(false)
    const w = live(finishWxml)
    expect(w).toMatch(/<block wx:if="\{\{canReview\}\}">\s*<view class="fn-dock-space"><\/view>\s*<view class="fn-dock dock">\s*<view class="k k-ink k-48 fn-main"[^>]*bind:tap="onReview"[^>]*>去评价<\/view>\s*<\/view>\s*<\/block>/)
    expect(w).not.toMatch(/课程目录|onCatalog/)
    expect(p.onCatalog).toBeUndefined()
  })
  it('大白话：查订单失败——不误藏，照旧显示「去评价」', async () => {
    ordersMock.mockResolvedValue({ ok: false, error: 'CALL_FAIL' })
    const p = await mount()
    await p.onLoad({ courseId: 'c1' })
    expect(p.data.canReview).toBe(true)
  })
})

describe('编辑资料：iOS 从候选栏选「微信昵称」不触发输入事件——失焦时补同步', () => {
  it('大白话：昵称框失焦时，框里的值和页面记录不一致就同步；其他框失焦不动昵称', async () => {
    vi.resetModules()
    ;(globalThis as any).wx = { getWindowInfo: () => ({ screenHeight: 844 }) }
    await import('../pages/profile-edit/profile-edit')
    const sync = vi.fn()
    const p = { data: { nickname: '旧名' }, sync, setData: vi.fn() }
    pageOpts.onBlur.call(p, { currentTarget: { dataset: { f: 'nickname' } }, detail: { value: '微信昵称' } })
    expect(sync).toHaveBeenCalledWith({ nickname: '微信昵称' })
    sync.mockClear()
    pageOpts.onBlur.call(p, { currentTarget: { dataset: { f: 'phone' } }, detail: { value: '138' } })
    expect(sync).not.toHaveBeenCalled()
  })
})

describe('订单列表切页签不闪「暂无订单」', () => {
  it('大白话：切页签那一刻就进加载态', async () => {
    vi.resetModules()
    ;(globalThis as any).wx = { getWindowInfo: () => ({ screenHeight: 844 }) }
    await import('../pages/order-list/order-list')
    const patches: Record<string, unknown>[] = []
    const p = Object.create(pageOpts) as Record<string, any>
    p.data = { ...pageOpts.data, tabKey: '' }
    p.setData = (x: Record<string, unknown>) => patches.push(x)
    p.reload = vi.fn()
    p.switchTab('done')
    expect(patches.find((x) => x.tabKey === 'done')).toMatchObject({ shown: [], loading: true })
  })
})

describe('静态小修', () => {
  it('大白话：页面默认字号用 px（不随屏宽缩放）', () => {
    expect(rule(appWxss, 'page')).toContain('font-size: 14px')
  })
  it('大白话：属性之间不再漏空格', () => {
    for (const w of [homeWxml, orderWxml]) expect(live(w)).not.toMatch(/"(hover-start-time|hover-class)=/)
  })
  it('大白话：首页买家秀按正文作 key（昵称可能为空或重名）', () => {
    expect(tagOf(homeWxml, 'class="hm-rv[ "]')).toContain('wx:key="quote"')
  })
  it('大白话：订单详情写了省略号的地方真能省略', () => {
    expect(rule(orderWxss, '.od-info-v')).toContain('white-space: nowrap')
  })
  it('大白话：商品卡、购物车缩略图/商品名、查看售后进度、匿名勾选、自绘返回键热区都有按下反馈', () => {
    expect(tagOf(homeWxml, 'class="hm-card"')).toContain('hover-class=')
    expect(tagOf(cartWxml, 'class="ca-thumb[ "]')).toContain('hover-class=')
    expect(tagOf(cartWxml, 'class="ca-mid"')).toContain('hover-class=')
    expect(tagOf(orderWxml, 'od-as-go')).toContain('hover-class=')
    expect(tagOf(reviewWxml, 'rv-anon')).toContain('hover-class=')
    expect(tagOf(welcomeWxml, 'class="wl-hit"')).toContain('hover-class="wl-hit-down"')
    expect(tagOf(playerWxml, 'class="lp-back"')).toContain('hover-class="lp-back-down"')
  })
  it('大白话：我的课程/目录页骨架有微光，缩略占位和真实缩略图一样大', () => {
    for (const w of [myCoursesWxml, catalogWxml]) {
      const bars = live(w).match(/class="[^"]*-skel-(bar|thumb|key)[^"]*"/g) ?? []
      expect(bars.length).toBeGreaterThan(0)
      for (const b of bars) expect(b).toContain('skel')
      for (const b of bars) expect(b).toMatch(/(^|\s|")skel(\s|")/)
    }
    expect(rule(myCoursesWxss, '.mc-skel-thumb')).toContain('width: 64px')
  })
  it('大白话：意见反馈多行框与单行框左边对齐', () => {
    expect(rule(feedbackWxss, '.fb-area')).toContain('padding: 12px 16px 28px')
    expect(tagOf(feedbackWxml, 'class="well fb-area')).toContain('disable-default-padding')
  })
  it('大白话：地址表单光标不贴键盘；填完收货人按「下一项」跳到手机号', () => {
    const w = live(addressEditWxml)
    expect((w.match(/cursor-spacing="24"/g) ?? []).length).toBe(3)
    expect(tagOf(addressEditWxml, 'data-field="name"')).toContain('confirm-type="next"')
    expect(tagOf(addressEditWxml, 'data-field="phone"')).toContain(`focus="{{focusNext === 'phone'}}"`)
  })
})

describe('像素化清点顺手修（2026-09-30）', () => {
  it('大白话：播放页主视频关掉微信自带的中间播放键和加载转圈——我们已有像素转圈和暂停键，别撞在一起', () => {
    const v = tagOf(playerWxml, 'id="lp-video"')
    expect(v).toContain('show-center-play-btn="{{false}}"')
    expect(v).toContain('show-loading="{{false}}"')
  })
  it('大白话：首页收尾大图后台没配图时，整块图框不渲染，不留空灰方块', () => {
    expect(tagOf(homeWxml, 'class="hm-closing-media"')).toContain('wx:if="{{content.closing.img}}"')
  })
})
