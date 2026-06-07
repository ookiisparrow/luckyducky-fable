import { describe, it, expect } from 'vitest'
import { money, yuan, stars } from '@/utils/format.js'

describe('format 展示格式化', () => {
  it('money：数字 → 两位小数字符串', () => {
    expect(money(198)).toBe('198.00')
    expect(money(0)).toBe('0.00')
    expect(money(1.5)).toBe('1.50')
  })
  it('yuan：带 ￥ 两位小数', () => {
    expect(yuan(198)).toBe('￥198.00')
  })
  it('stars：实心 + 空心拼满 5 颗', () => {
    expect(stars(4)).toBe('★★★★☆')
    expect(stars(5)).toBe('★★★★★')
    expect(stars(0)).toBe('☆☆☆☆☆')
  })
})
