import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useReviewsStore } from '@/store/reviews.js'
import { getReviews, submitReview } from '@/api/review.js'

beforeEach(() => setActivePinia(createPinia()))

// 测试环境无 wx.cloud → callCloud 返回 null（H5 / App 回退路径的镜像）
describe('reviews api / store（无云回退，样例零回归）', () => {
  it('getReviews 无云返回 null（页面回退样例）', async () => {
    expect(await getReviews('prod-1')).toBeNull()
  })

  it('submitReview 无云返回 null（评价页走演示 Toast 路径，不报错）', async () => {
    expect(await submitReview({ orderId: 'x', productId: 'p', rating: 5 })).toBeNull()
  })

  it('store.load 后 forProduct 仍为 null：不会用空数据顶掉样例', async () => {
    const store = useReviewsStore()
    await store.load('prod-1')
    expect(store.forProduct('prod-1')).toBeNull()
  })

  it('forProduct 只认有真实条数的数据（count 0 视同无数据）', () => {
    const store = useReviewsStore()
    store.byProduct['p1'] = { list: [], summary: { count: 0 } }
    expect(store.forProduct('p1')).toBeNull()
    store.byProduct['p2'] = {
      list: [{ name: '鸭友', rating: 5, text: '好评', createdAt: 1 }],
      summary: { count: 1, score: '5.0', dist: [], tags: [] },
    }
    expect(store.forProduct('p2')).toBeTruthy()
  })
})
