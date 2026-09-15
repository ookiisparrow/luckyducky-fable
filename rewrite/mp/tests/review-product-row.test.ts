// 写评价页商品行：入口只带 name，没有封面。禁止永远空着的灰盒子装成有图。
import { describe, it, expect } from 'vitest'
import reviewWxml from '../pages/review/review.wxml?raw'
import reviewWxss from '../pages/review/review.wxss?raw'

describe('写评价页商品行（无封面不画假图）', () => {
  it('大白话：这页只知道商品名，不画空灰方块假装有封面', () => {
    const wxml = reviewWxml.replace(/<!--[\s\S]*?-->/g, '')
    expect(wxml).toContain('{{name}}')
    expect(wxml).not.toContain('corev-prod-img')
    expect(reviewWxss).not.toContain('.corev-prod-img')
  })
})
