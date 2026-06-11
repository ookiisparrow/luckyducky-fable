import { describe, it, expect } from 'vitest'
import { money, yuan, stars, mmss, parseDur, timeAgo } from '@/utils/format.js'

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
  it('mmss：秒数 → m:ss，负数/非法值按 0', () => {
    expect(mmss(95)).toBe('1:35')
    expect(mmss(0)).toBe('0:00')
    expect(mmss(600)).toBe('10:00')
    expect(mmss(-5)).toBe('0:00')
    expect(mmss(undefined)).toBe('0:00')
    expect(mmss(59.6)).toBe('1:00') // 四舍五入后进位
  })
  it("parseDur：'mm:ss' → 秒数，非法段按 0", () => {
    expect(parseDur('02:40')).toBe(160)
    expect(parseDur('0:07')).toBe(7)
    expect(parseDur('abc')).toBe(0)
    expect(parseDur('')).toBe(0)
  })
  it('timeAgo：相对时间（评价时间显示），超 30 天落回日期，非法返回空串', () => {
    const now = new Date(2026, 5, 11, 12, 0).getTime()
    expect(timeAgo(now - 30_000, now)).toBe('刚刚')
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(timeAgo(now - 4 * 3600_000, now)).toBe('4 小时前')
    expect(timeAgo(now - 3 * 86400_000, now)).toBe('3 天前')
    expect(timeAgo(now - 40 * 86400_000, now)).toBe('2026-05-02')
    expect(timeAgo(null)).toBe('')
    expect(timeAgo('abc')).toBe('')
  })
})
