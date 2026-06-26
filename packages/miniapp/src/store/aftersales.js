/**
 * 售后 store（Pinia）。我的售后单与申请动作收口于此（链10）；售后页从这里取。
 * 不持久化：售后单是服务端状态，每次进页从云端拉；H5 / App 无云时维持空列表。
 */
import { defineStore } from 'pinia'
import { getMyAfterSales, applyRefund } from '@/api/aftersales.js'

export const useAfterSalesStore = defineStore('aftersales', {
  state: () => ({
    list: [],
    loaded: false,
    loading: false,
    nextCursor: null,
    hasMore: false,
  }),
  getters: {
    // 该订单该行是否已有售后单（可申请列表过滤用；含已拒绝，v1 拒后重申走人工）。
    // 按有效行键（外审 P1.1）：新售后有 lineId / 旧售后回退 productId——同商品多 SKU 是不同行、各自可申请。
    has: (s) => (orderId, lineId) =>
      s.list.some((a) => a.orderId === orderId && (a.lineId || a.productId) === lineId),
  },
  actions: {
    async load(force = false) {
      if (this.loading) return
      if (this.loaded && !force) return
      this.loading = true
      try {
        const paged = await getMyAfterSales()
        if (paged) {
          this.list = paged.list
          this.nextCursor = paged.nextCursor
          this.hasMore = paged.hasMore
        }
        this.loaded = true
      } finally {
        this.loading = false
      }
    },
    // 加载更多（游标翻页，根因#7）：追加下一页、去重防重入；失败/无更多静默
    async loadMore() {
      if (this.loading || !this.hasMore || this.nextCursor == null) return
      this.loading = true
      try {
        const paged = await getMyAfterSales(this.nextCursor)
        if (paged) {
          const ids = new Set(this.list.map((a) => a._id))
          this.list = [...this.list, ...paged.list.filter((a) => !ids.has(a._id))]
          this.nextCursor = paged.nextCursor
          this.hasMore = paged.hasMore
        }
      } finally {
        this.loading = false
      }
    },
    // 申请退款：成功插到列表头部并返回；云端拒绝向上抛；无云（演示）返回 null
    async apply(payload) {
      const rec = await applyRefund(payload)
      if (rec) this.list = [rec, ...this.list.filter((a) => a._id !== rec._id)]
      return rec
    },
  },
})
