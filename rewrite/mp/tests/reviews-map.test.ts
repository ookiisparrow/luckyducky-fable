// 黄金 learning-content §七（评价读取半边：条数 0 视同无数据/汇总形状/星级拼装）。
import { describe, it, expect } from 'vitest'
import { stars, mapReviews, mapSummary, hiddenByTag } from '../lib/mapReviews'
import reviewsWxml from '../pages/reviews/reviews.wxml?raw'

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
    expect(vm[0].timeLabel).toMatch(/^\d{2}-\d{2}$/) // 设计稿 A3 日期只写月-日
    expect(mapReviews([{ rating: 5, createdAt: new Date(2026, 8, 21, 10, 30).getTime() }])[0].timeLabel).toBe('09-21')
    expect(mapReviews([{ rating: 5 }])[0].timeLabel).toBe('') // 缺时间不写假日期
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
      { label: '5 星', pct: 80, w: 112 },
      { label: '4 星', pct: 10, w: 10 },
    ]) // 坏行剔除
    expect(vm.tags).toEqual([{ tag: '教程清晰', n: 8 }]) // 空标签剔除
    expect(mapSummary({ score: '0', count: 0 })).toBeNull() // 条数 0 视同无数据
    expect(mapSummary(null)).toBeNull()
    expect(mapSummary({ count: 'abc' })).toBeNull()
  })

  it('大白话：分布条按 6px 一格取整（24 格共 142px），有评分的星级占比再小也至少亮 1 格；0% 一格不亮（老板拍板 7）', () => {
    const w = (pct: number) => mapSummary({ score: '5', count: 1, dist: [['5', pct]] })!.dist[0].w
    expect(w(100)).toBe(142) // 满格 24×6−2
    expect(w(82)).toBe(118) // round(19.68)=20 格
    expect(w(1)).toBe(4) // round(0.24)=0 → 至少 1 格
    expect(w(0)).toBe(0) // 没人打这个星级＝一格不亮
    expect(w(-5)).toBe(0) // 脏值同 0
    expect(reviewsWxml).toContain('width: {{item.w}}px')
  })

  it('大白话：云端汇总只数了最近一批（approx）——条数写「近 N 条」，不装成全部只有 N 条', () => {
    expect(mapSummary({ score: '4.5', count: 200, approx: true })!.countLabel).toBe('近 200 条评价')
    expect(mapSummary({ score: '4.5', count: 12, approx: false })!.countLabel).toBe('12 条评价')
    expect(reviewsWxml).toContain('{{summary.countLabel}}') // 评价页头用这句，不再自己拼 count
  })
})

describe('标签筛选（v5 A3）', () => {
  it('大白话：点一个标签只留带它的评价；再点同一个（tag 空）全部放回；翻页追加的新行接着按同一标签藏', () => {
    const list = mapReviews([
      { rating: 5, tags: ['教程清晰'] },
      { rating: 4, tags: ['好看'] },
      { rating: 5, tags: ['好看', '教程清晰'] },
    ])
    expect(hiddenByTag(list, '好看')).toEqual([true, false, false])
    expect(hiddenByTag(list, '')).toEqual([false, false, false])
    expect(hiddenByTag(list, '教程清晰', 2)).toEqual([false])
  })
})
