// 黄金 learning-content §七（评价读取半边：条数 0 视同无数据/汇总形状/星级拼装）
// （守卫 rw-mp-reviews-golden）。
import { describe, it, expect } from 'vitest'
import { stars, mapReviews, mapSummary } from '../lib/mapReviews'

describe('星级拼装（黄金 §四：实心+空心拼满 5 颗）', () => {
  it('大白话：3 星=三实两空；越界钳 0-5；非数按 0', () => {
    expect(stars(3)).toBe('★★★☆☆')
    expect(stars(5)).toBe('★★★★★')
    expect(stars(0)).toBe('☆☆☆☆☆')
    expect(stars(9)).toBe('★★★★★')
    expect(stars(-2)).toBe('☆☆☆☆☆')
    expect(stars('abc')).toBe('☆☆☆☆☆')
    expect(stars(4.6)).toBe('★★★★★') // 四舍五入
  })
})

describe('列表映射（脏行剔除）', () => {
  it('大白话：正常评价全字段映射；评分非法的行整行剔除不渲染假评；非数组安全', () => {
    const vm = mapReviews([
      { name: '鸭友', rating: 5, tags: ['教程清晰'], text: '好评', spec: '鹅黄', photos: ['https://tmp/a.jpg', '', 'https://tmp/b.jpg'], createdAt: 1783046400000 },
      { name: '无图', rating: 4, createdAt: 1783046400000 },
      { name: '脏行', rating: 0 },
      { name: '脏行2', rating: 'abc' },
      null,
    ])
    expect(vm).toHaveLength(2)
    expect(vm[0].stars).toBe('★★★★★')
    expect(vm[0].timeLabel).toMatch(/^\d{4}-/)
    expect(vm[0].photos).toEqual(['https://tmp/a.jpg', 'https://tmp/b.jpg']) // 买家秀晒图·空址剔除
    expect(vm[1].photos).toEqual([]) // 无图 → 空数组（非 undefined·模板 wx:if 稳）
    expect(mapReviews(undefined)).toEqual([])
  })
})

describe('汇总映射（黄金 §七读取：条数 0 视同无数据）', () => {
  it('大白话：有条数才渲染汇总头；条数 0/缺失/脏形状一律 null（不渲染 0 分假汇总）', () => {
    const vm = mapSummary({
      score: '4.8',
      count: 12,
      dist: [
        ['5 星', 80],
        ['4 星', 10],
        ['坏行'],
      ],
      tags: [
        ['教程清晰', 8],
        [null, 3],
      ],
    })!
    expect(vm.scoreLabel).toBe('4.8')
    expect(vm.count).toBe(12)
    expect(vm.dist).toEqual([
      { label: '5 星', pct: 80 },
      { label: '4 星', pct: 10 },
    ]) // 坏行剔除
    expect(vm.tags).toEqual([{ tag: '教程清晰', n: 8 }]) // 空标签剔除
    expect(mapSummary({ score: '0', count: 0 })).toBeNull() // 条数 0 视同无数据
    expect(mapSummary(null)).toBeNull()
    expect(mapSummary({ count: 'abc' })).toBeNull()
  })
})
