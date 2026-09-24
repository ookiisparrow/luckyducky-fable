// 赵老板体验定稿：顾客可见文案/入口（A1–A11）。源码扫描 + 运行时口号。
import { describe, expect, it } from 'vitest'
import { BRAND_SLOGAN_CN, BRAND_SLOGAN_EN } from '../lib/brand'

describe('小程序体验定稿文案', () => {

  it('A2 口号正册只改 mp：体验钩织；英文仍走 brand 单源', () => {
    expect(BRAND_SLOGAN_CN).toBe('体验钩织，创造幸运。')
    expect(BRAND_SLOGAN_EN).toMatch(/ducky/i)
    expect(BRAND_SLOGAN_CN).not.toContain('学习钩织')
  })
})
