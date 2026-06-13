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
  }),
  getters: {
    // 该订单该商品是否已有售后单（可申请列表过滤用；含已拒绝，v1 拒后重申走人工）
    has: (s) => (orderId, productId) =>
      s.list.some((a) => a.orderId === orderId && a.productId === productId),
  },
  actions: {
    async load(force = false) {
      if (this.loading) return
      if (this.loaded && !force) return
      this.loading = true
      try {
        const list = await getMyAfterSales()
        if (list) this.list = list
        this.loaded = true
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
