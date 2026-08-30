import { describe, expect, it } from 'vitest'
import { mapReviewRows } from '../src/lib/mapReviews'

describe('评价挑选行（mapReviewRows）', () => {
  it('大白话：缺字段归默认；picked 只认真值；非数组回空；无 id 的行丢掉', () => {
    const rows = mapReviewRows([
      { id: 'r1', productId: 'p1', name: '鸭友', rating: 5, tags: ['棒'], text: '好', spec: '红', createdAt: 1783046400000, photos: ['https://a'], picked: true },
      { id: 'r2', picked: 'yes', rating: 'x' }, // 非 true＝待挑选
      { name: '无 id' },
      null,
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0].picked).toBe(true)
    expect(rows[0].text).toBe('好')
    expect(rows[0].photos).toEqual(['https://a'])
    expect(rows[1].picked).toBe(false)
    expect(rows[1].rating).toBe(0)
    expect(rows[1].name).toBe('')
    expect(mapReviewRows(null)).toEqual([])
  })
})
