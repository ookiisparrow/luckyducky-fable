// 缺头像画品牌 logo，不画鸭子表情。手册与「我」/资料/评价三处同式。
// rewrite/mp tsconfig 无 node:fs，走 ?raw（见 raw-imports.d.ts）。
import { describe, it, expect } from 'vitest'
import meWxml from '../pages/me/me.wxml?raw'
import profileWxml from '../pages/profile-edit/profile-edit.wxml?raw'
import reviewsWxml from '../pages/reviews/reviews.wxml?raw'
import readme from '../README.md?raw'

const LOGO = '/static/logo-wordmark.svg'
const DUCK = '\u{1F986}'

function stripWxml(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '')
}

describe('缺头像用品牌 logo（手册单源）', () => {
  it('大白话：「我」页没头像时画店标 SVG，不画小鸭子表情', () => {
    const wxml = stripWxml(meWxml)
    expect(wxml).not.toContain(DUCK)
    expect(wxml).toMatch(/ld-me-avatar-empty[\s\S]{0,160}src="\/static\/logo-wordmark\.svg"/)
  })

  it('大白话：改资料页没头像时画同一张店标，不画小鸭子表情', () => {
    const wxml = stripWxml(profileWxml)
    expect(wxml).not.toContain(DUCK)
    expect(wxml).toMatch(/coprof-avatar-empty[\s\S]{0,160}src="\/static\/logo-wordmark\.svg"/)
  })

  it('大白话：评价列表真卡和转圈骨架都画店标，不再留空灰圆、不画表情', () => {
    const wxml = stripWxml(reviewsWxml)
    expect(wxml).not.toContain(DUCK)
    expect(wxml).not.toMatch(/<view class="ld-rv-av[^"]*"><\/view>/)
    const logos = wxml.match(new RegExp(`ld-rv-av[\\s\\S]{0,200}${LOGO.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`, 'g')) || []
    expect(logos.length).toBe(2)
  })

  it('大白话：手册写明缺头像走店标 SVG，不再教画表情', () => {
    expect(readme).not.toContain(DUCK)
    expect(readme).toContain(LOGO)
  })
})
