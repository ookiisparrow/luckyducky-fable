// 锁现行为：评价精确汇总的星级分布/均分/标签，评分摘要，以及聚合失败时各自的兜底口径。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>

const rv = (i: number, rating: number, extra: Record<string, unknown> = {}) => ({
  _id: 'r' + i,
  productId: 'p1',
  picked: true,
  rating,
  tags: ['好评'],
  createdAt: i,
  ...extra,
})

// 打挂精确汇总的聚合调用，逼落兜底口径
const failSummary = () => {
  control.setBeforeAggregate(({ coll }: any) => {
    if (coll === 'reviews') throw new Error('MOCK_AGG_FAIL')
  })
}

beforeEach(() => {
  control.reset()
  control.seed('reviews', [
    rv(1, 5),
    rv(2, 5),
    rv(3, 4, { tags: ['可爱', '好评'] }),
    rv(4, 3, { tags: ['可爱'] }),
    rv(5, 2, { tags: [] }),
    rv(6, 1),
    rv(7, 1),
    rv(8, 5, { picked: false }),
    rv(9, 1, { productId: 'p2' }),
  ])
})

describe('评价汇总', () => {
  it('精确口径：五档分布（1 星并入 2 星）、均分、标签排序', async () => {
    const r = await call('getReviews', { productId: 'p1' })
    expect(r.summary).toEqual({
      score: '3.0',
      count: 7,
      approx: false,
      dist: [
        ['5 星', 29],
        ['4 星', 14],
        ['3 星', 14],
        ['2 星', 43],
      ],
      tags: [
        ['好评', 5],
        ['可爱', 2],
      ],
    })
    expect(await call('getRatingSummary', { productId: 'p1' })).toEqual({ ok: true, score: '3.0', count: 7 })
  })

  it('聚合失败：getReviews 落兜底样本口径；getRatingSummary 回 0 分 0 条', async () => {
    failSummary()
    const r = await call('getReviews', { productId: 'p1' })
    expect(r.summary).toEqual({
      score: '3.0',
      count: 7,
      approx: false,
      dist: [
        ['5 星', 29],
        ['4 星', 14],
        ['3 星', 14],
        ['2 星', 43],
      ],
      tags: [
        ['好评', 5],
        ['可爱', 2],
      ],
    })
    expect(await call('getRatingSummary', { productId: 'p1' })).toEqual({ ok: true, score: '0', count: 0 })
  })
})
