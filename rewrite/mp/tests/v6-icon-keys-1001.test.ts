// v6 像素图标化（Claude Design 交接包 design_handoff_v6_pixel_icons 2 · icon-picks 采纳 27 项；老板 2026-09-30 定第 2、3 类 19 项施工、
// 代码里没有的 7 项跳过）：按键文案换像素图标；次键收成方键（.k-sq 宽＝高），主键宽度不变；在途态（提交中/保存中）照旧带字。
import { describe, it, expect } from 'vitest'
import appWxss from '../app.wxss?raw'
import detailWxml from '../pages/detail/detail.wxml?raw'
import cartWxml from '../pages/cart/cart.wxml?raw'
import checkoutWxml from '../pages/checkout/checkout.wxml?raw'
import addrEditWxml from '../pages/address-edit/address-edit.wxml?raw'
import paysuccessWxml from '../pages/paysuccess/paysuccess.wxml?raw'
import orderListWxml from '../pages/order-list/order-list.wxml?raw'
import orderWxml from '../pages/order/order.wxml?raw'
import aftersalesWxml from '../pages/aftersales/aftersales.wxml?raw'
import catalogWxml from '../pages/catalog/catalog.wxml?raw'
import playerWxml from '../pages/player/player.wxml?raw'
import profileWxml from '../pages/profile-edit/profile-edit.wxml?raw'
import loginWxml from '../components/login-sheet/login-sheet.wxml?raw'
import privacyWxml from '../components/privacy-sheet/privacy-sheet.wxml?raw'
import { PIXEL_GLYPHS } from '../lib/pixelGlyph'

const live = (w: string) => w.replace(/<!--[\s\S]*?-->/g, '')
// 取含 marker 的那颗键（开标签到对应 </view>·键内最多一层子 view）
const keyOf = (w: string, marker: string) => live(w).match(new RegExp(`<view [^>]*${marker}[^>]*>(?:(?!<view )[\\s\\S])*?(?:<view[^>]*>(?:(?!<view )[\\s\\S])*?</view>(?:(?!<view )[\\s\\S])*?)*</view>`))?.[0] ?? ''
const iconOnly = (k: string, icon: string) => {
  expect(k, k).toContain(`<px-i `)
  expect(k).toMatch(new RegExp(`<px-i [^>]*name="${icon}"`))
  expect(k.replace(/<[^>]+>/g, '').trim(), k).toBe('')
}

describe('v6 图标键：次键收成方键', () => {
  const SQ: [string, string, string, string][] = [
    ['商品详情·客服', detailWxml, 'pd-cs', 'service'],
    ['商品详情·加入购物车', detailWxml, 'pd-add', 'cart'],
    ['空购物车·去首页逛逛', cartWxml, 'bind:tap="onGoHome"', 'home'],
    ['支付成功·回首页', paysuccessWxml, 'ps-home', 'home'],
    ['订单列表·重试', orderListWxml, 'ol-retry', 'replay'],
    ['订单详情·重试', orderWxml, 'od-retry', 'replay'],
    ['订单详情·返回', orderWxml, 'od-back', 'back'],
    ['售后记录·重试', aftersalesWxml, 'as-retry', 'replay'],
    ['编辑地址·删除（按住）', addrEditWxml, 'ae-del ', 'trash'],
    ['课程目录·开始/继续', catalogWxml, 'ct-start', 'play'],
    ['播放页·求助', playerWxml, 'bind:tap="onHelp"', 'help'],
    ['播放页·上一段', playerWxml, 'bind:tap="onPrev"', 'prev'],
    ['播放页·下一段', playerWxml, 'lp-ctl \\{\\{canNext', 'next'],
    ['学完一节·重看本节', playerWxml, 'bind:tap="onReplayLesson"', 'replay'],
    ['登录半屏·暂不登录', loginWxml, 'ls-later', 'times'],
    ['隐私弹窗·拒绝', privacyWxml, 'ps-no', 'times'],
  ]
  for (const [name, w, marker, icon] of SQ)
    it(`大白话：${name} → ${icon} 方键`, () => {
      const k = keyOf(w, marker)
      expect(k, name).toMatch(/class="[^"]*\bk-sq\b/)
      iconOnly(k.replace(/<view class="(ae-del-fill|ae-del-t)[^"]*"[^>]*>\s*<\/view>/g, ''), icon)
    })
  it('大白话：方键宽＝高（44 / 48），不再撑满', () => {
    expect(appWxss).toMatch(/\.k\.k-sq \{[^}]*width: 44px;[^}]*\}/)
    expect(appWxss).toMatch(/\.k\.k-48\.k-sq \{[^}]*width: 48px;/)
  })
})

describe('v6 图标键：主键宽度不变，只换图标', () => {
  it('大白话：确认订单「提交订单」→ ✓；提交中 / 已提交 / 正在拉起支付照旧带字', () => {
    const k = keyOf(checkoutWxml, 'co-submit')
    expect(k).toContain('<px-i wx:else name="check" />')
    expect(k).not.toContain('提交订单')
    for (const t of ['已提交', '正在拉起支付', '提交中']) expect(k).toContain(t)
    expect(k).not.toMatch(/k-sq/)
  })
  it('大白话：编辑地址「保存」（能存 / 没填完两态）、编辑资料「保存」→ ✓；保存中照旧带字', () => {
    for (const k of live(addrEditWxml).match(/<view wx:(?:if|else)[^>]*ae-save[^>]*>[\s\S]*?<\/view>/g) ?? []) iconOnly(k, 'check')
    expect(live(addrEditWxml).match(/ae-save/g)).toHaveLength(2)
    iconOnly(keyOf(profileWxml, 'bind:tap="onSave"'), 'check')
    expect(live(profileWxml)).toContain('>保存中</view>')
  })
  it('大白话：学完一节「继续下一节」→ next（反相主键）；「完成课程」照旧带字', () => {
    iconOnly(keyOf(playerWxml, 'lp-done-main" hover-start-time="20" hover-class="k-inv-down" hover-stay-time="100" bind:tap="onNext"'), 'next')
    expect(live(playerWxml)).toContain('完成课程')
  })
})

describe('v6 新点阵', () => {
  it('大白话：service / prev / next / help / replay / trash 与交接包 pixel-mini.js 一格不差', () => {
    expect(PIXEL_GLYPHS.service).toEqual(['..XXXXX..', '.X.....X.', 'X.......X', 'X.......X', 'XX.....XX', 'XX.....XX', 'XX.....XX', '.......X.', '.....XX..'])
    expect(PIXEL_GLYPHS.prev).toEqual(['X....X', 'X...XX', 'X..XXX', 'X.XXXX', 'X..XXX', 'X...XX', 'X....X'])
    expect(PIXEL_GLYPHS.next).toEqual(['X....X', 'XX...X', 'XXX..X', 'XXXX.X', 'XXX..X', 'XX...X', 'X....X'])
    expect(PIXEL_GLYPHS.help).toEqual(['.XXX.', 'X...X', '....X', '...X.', '..X..', '.....', '..X..'])
    expect(PIXEL_GLYPHS.replay).toEqual(['..XXXX.X.', '.X....XX.', 'X....XXX.', 'X........', 'X.......X', 'X.......X', '.X.....X.', '..XXXXX..'])
    expect(PIXEL_GLYPHS.trash).toEqual(['...XXX...', 'XXXXXXXXX', '.X.....X.', '.X.X.X.X.', '.X.X.X.X.', '.X.X.X.X.', '.X.....X.', '..XXXXX..'])
  })
})
