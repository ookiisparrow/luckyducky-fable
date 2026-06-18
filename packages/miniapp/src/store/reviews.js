/**
 * 评价 store（Pinia）。按商品缓存云端评价（列表 + 汇总），详情页与「全部评价」
 * 页共用一份，避免重复请求。不持久化：评价是服务端状态，会话内缓存即可。
 * 云端无评价（count 0）或无云端（H5 / App）时 forProduct 返回 null，页面回退样例。
 */
import { defineStore } from 'pinia'
import { getReviews } from '@/api/review.js'

export const useReviewsStore = defineStore('reviews', {
  state: () => ({
    byProduct: {}, // productId -> { list, summary, cursor, done, loadingMore } | null（已请求但无数据）
  }),
  getters: {
    // 有真实评价才返回数据（空列表视同无数据，让页面走样例）
    forProduct: (s) => (id) => {
      const r = s.byProduct[id]
      return r && r.summary && r.summary.count > 0 ? r : null
    },
  },
  actions: {
    async load(productId, force = false) {
      if (!productId) return
      if (!force && productId in this.byProduct) return
      this.byProduct[productId] = this.byProduct[productId] || null
      const r = await getReviews(productId) // 首页：列表 + 汇总
      if (r)
        this.byProduct[productId] = {
          list: r.list || [],
          summary: r.summary,
          cursor: r.nextCursor || null,
          done: !r.hasMore,
          loadingMore: false,
        }
    },
    // 续页（债#13·根因#7）：取下一页评价追加，汇总沿用首页不重算。
    async loadMore(productId) {
      const cur = this.byProduct[productId]
      if (!cur || cur.done || cur.loadingMore || !cur.cursor) return
      cur.loadingMore = true
      const r = await getReviews(productId, cur.cursor)
      cur.loadingMore = false
      if (!r) return
      cur.list = cur.list.concat(r.list || [])
      cur.cursor = r.nextCursor || null
      cur.done = !r.hasMore
    },
  },
})
