import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as getReviews } from '../../packages/cloud/src/functions/catalog/getReviews'

// 评价汇总真全量精确（债#13 后半·根因#7 固定样本失真）——守卫 reviews-summary-exact 行为锁。
// 痛：原汇总基于 ≤200 最近样本（approx 标注），某商品评价破 200 时评分/星级分布失真。
// 治：评分/计数/星级分布走 count()+aggregate(sum)（精确·不封顶，与 dashboard GMV 同范式·#18续），approx 恒 false。
// 本测试灌 250 条（>SUMMARY_SAMPLE 200）——原 bounded 实现必红（count 截到 200、approx 真）、精确实现绿。
beforeEach(() => {
  control.reset()
  // 已知分布：100×5 + 60×4 + 40×3 + 30×2 + 20×1 = 250；sum=940 → score 3.76→"3.8"
  const seed = []
  const mk = (n, rating, from) => {
    for (let i = 0; i < n; i++)
      seed.push({ _id: `r${from + i}`, productId: 'p1', name: 'U', rating, tags: ['好'], text: '', createdAt: from + i })
  }
  mk(100, 5, 0)
  mk(60, 4, 1000)
  mk(40, 3, 2000)
  mk(30, 2, 3000)
  mk(20, 1, 4000)
  control.seed('reviews', seed)
})

describe('getReviews 汇总真全量精确（债#13 后半·根因#7）', () => {
  it('250 条（>200 样本上限）：count/score/dist 精确·approx 恒 false', async () => {
    const r = await getReviews({ productId: 'p1' })
    expect(r.ok).toBe(true)
    // 全量计数，不被 200 样本截断（原 bounded 实现这里只会是 200）
    expect(r.summary.count).toBe(250)
    // 精确口径 → 永不标近似（原 bounded：count>=200 即 approx=true）
    expect(r.summary.approx).toBe(false)
    // 精确均分 940/250 = 3.76 → "3.8"
    expect(r.summary.score).toBe('3.8')
    // 星级分布（1 星并入 2 星档）：5★40% 4★24% 3★16% 2★(30+20)/250=20%
    expect(r.summary.dist).toEqual([
      ['5 星', 40],
      ['4 星', 24],
      ['3 星', 16],
      ['2 星', 20],
    ])
  })

  it('空商品：count 0 / score "0" / approx false', async () => {
    const r = await getReviews({ productId: 'nope' })
    expect(r.summary.count).toBe(0)
    expect(r.summary.score).toBe('0')
    expect(r.summary.approx).toBe(false)
  })
})
