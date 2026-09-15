// 评价列表：ReviewVM 无头像字段。禁止永远空着的灰圆；缺头像画手册约定的 🦆。
import { describe, it, expect } from 'vitest'
import reviewsWxml from '../pages/reviews/reviews.wxml?raw'

describe('评价列表头像缺省（手册：头像缺→🦆）', () => {
  it('大白话：真卡和骨架都画鸭子，不再留空灰圆', () => {
    const wxml = reviewsWxml.replace(/<!--[\s\S]*?-->/g, '')
    expect(wxml).not.toMatch(/<view class="ld-rv-av[^"]*"><\/view>/)
    const ducks = wxml.match(/<view class="ld-rv-av[^"]*">\s*🦆\s*<\/view>/g) || []
    expect(ducks.length).toBe(2)
  })
})
