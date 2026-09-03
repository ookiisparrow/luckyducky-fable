// 店铺展示名（决策 R23·2026-09-03 两行全名）：核名钉死 brand.ts，全名由 shop.ts 拼接。
import { describe, it, expect } from 'vitest'
import { BRAND_NAME, BRAND_SHORT } from '../lib/brand'
import { SHOP_FULL_NAME, SHOP_NAME_LINE1, SHOP_NAME_LINE2 } from '../lib/shop'
import shopSrc from '../lib/shop.ts?raw'
import meSrc from '../pages/me/me.ts?raw'
import welcomeSrc from '../pages/welcome/welcome.ts?raw'

describe('店铺展示名（两行）', () => {
  it('大白话：核名不动；全名=第一行+空格+第二行；不切片、不硬编码核名', () => {
    expect(SHOP_NAME_LINE1).toBe(BRAND_NAME)
    expect(SHOP_NAME_LINE2).toBe('初学钩织入门')
    expect(SHOP_FULL_NAME).toBe(`${BRAND_NAME} ${SHOP_NAME_LINE2}`)
    expect(BRAND_SHORT).toBe('小棉鸭')
    expect(shopSrc).toContain('SHOP_FULL_NAME = `${BRAND_NAME} ${SHOP_NAME_LINE2}`')
    expect(meSrc).not.toContain('BRAND_NAME.replace')
    expect(welcomeSrc).not.toContain('BRAND_NAME.replace')
  })
})
