import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/catalog/getReviews'

// getReviews（公开读 + 云端现算汇总，catalog 域）。
beforeEach(() => control.reset())

describe('getReviews 汇总', () => {
  it('NO_PRODUCT：缺商品 id', async () => {
    expect((await main({})).error).toBe('NO_PRODUCT')
  })

  it('空集合：count 0、score 0、dist 全 0', async () => {
    const res = await main({ productId: 'p1' })
    expect(res.ok).toBe(true)
    expect(res.summary.count).toBe(0)
    expect(res.summary.score).toBe('0')
  })

  it('均分 1 位小数、星级百分比、1 星并入 2 星、标签 Top5、他品不计', async () => {
    control.seed('reviews', [
      { productId: 'p1', name: 'A', rating: 5, tags: ['好'], createdAt: 3 },
      { productId: 'p1', name: 'B', rating: 4, tags: ['好', '快'], createdAt: 2 },
      { productId: 'p1', name: 'C', rating: 1, tags: [], createdAt: 1 },
      { productId: 'p2', name: 'X', rating: 2, tags: [], createdAt: 1 },
    ])
    const res = await main({ productId: 'p1' })
    expect(res.summary.count).toBe(3)
    expect(res.summary.score).toBe('3.3') // (5+4+1)/3
    const dist = Object.fromEntries(res.summary.dist)
    expect(dist['5 星']).toBe(33)
    expect(dist['2 星']).toBe(33) // 1 星并入 2 星档
    expect(res.summary.tags[0]).toEqual(['好', 2])
  })
})
