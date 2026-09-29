// UI 审查系统性修复（2026-09-29·老板逐题选定）：弱灰字分两组、点击区透明补到 44、黑体长串可断行。
// 写死 #色值那类由 check-structure 的 rw-mp-banned-patterns 守，不在这里。
import { describe, it, expect } from 'vitest'
import appWxss from '../app.wxss?raw'
import loginWxml from '../components/login-sheet/login-sheet.wxml?raw'
import orderListWxml from '../pages/order-list/order-list.wxml?raw'
import playerWxml from '../pages/player/player.wxml?raw'

const rule = (sel: string): string => {
  const i = appWxss.indexOf(sel + ' {')
  expect(i, `app.wxss 缺 ${sel}`).toBeGreaterThanOrEqual(0)
  return appWxss.slice(i, appWxss.indexOf('}', i))
}
const classOf = (wxml: string, marker: string): string => {
  const m = wxml.match(new RegExp(`class="([^"]*${marker}[^"]*)"`))
  expect(m, `找不到 ${marker}`).toBeTruthy()
  return m![1]
}

describe('弱灰字分两组（能点的 ink-2 ≈5:1，还不能用的保持 ink-3）', () => {
  it('大白话：平面键默认深灰、看得清；只有挂了 k-off 的置灰键才是浅灰', () => {
    expect(rule('.k-flat')).toContain('color: var(--v5-ink-2)')
    expect(rule('.k-flat.k-off')).toContain('color: var(--v5-ink-3)')
  })
  it('大白话：登录半屏——「暂不登录」能点不置灰；「微信一键登录」始终是墨黑主键做视觉引导（老板 2026-09-30·没勾协议点了协议行抖一下提示先勾）', () => {
    expect(classOf(loginWxml, 'ls-later')).not.toContain('k-off')
    expect(classOf(loginWxml, 'ls-go')).toBe('k k-ink k-48 ls-go')
  })
})

describe('点击区透明补到 44（外观不变）', () => {
  it('大白话：共用类纵向撑到 44、横向不扩；折行标签只扩半个行距', () => {
    const after = rule('.hit44::after')
    expect(after).toContain('height: 44px')
    expect(after).toContain('left: 0')
    expect(after).toContain('right: 0')
    expect(rule('.hit44.hit-wrap::after')).toContain('top: -4px')
  })
  it('大白话：订单页签、去支付、播放页拖动条都挂上了', () => {
    expect(classOf(orderListWxml, 'ol-tab ')).toContain('hit44')
    expect(classOf(orderListWxml, 'k-light ol-act hit44 {{payingId')).toContain('hit44')
    expect(classOf(playerWxml, 'lp-seek')).toContain('hit44')
  })
})

describe('黑体长串可断行', () => {
  it('大白话：评价/地址里的连续英文或链接不再把页面撑出横向滚动', () => {
    expect(rule('.t-sys')).toContain('overflow-wrap: anywhere')
  })
})
