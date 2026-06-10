/**
 * 订单 store（Pinia）。下单与订单查询收口于此；checkout / paysuccess / order 页
 * 从这里取，不再各自造数据（关调试日志 C：提交 → 支付成功 → 订单详情同一笔）。
 *
 * 不持久化：订单是服务端状态，小程序端每次从云端拉；H5 / App 回退单
 * （api 层本地生成）仅存活于会话内，load 时与远端列表按 id 合并不丢失。
 */
import { defineStore } from 'pinia'
import { createOrder, getMyOrders } from '@/api/order.js'
import { logger } from '@/utils/logger.js'

export const useOrdersStore = defineStore('orders', {
  state: () => ({
    list: [],
    loaded: false,
    loading: false,
  }),
  getters: {
    getById: (s) => (id) => s.list.find((o) => o.id === id) || null,
    // 各 status 的订单数（「我」页九宫格角标用）：{ paid: 2, ... }
    countByStatus: (s) =>
      s.list.reduce((m, o) => {
        m[o.status] = (m[o.status] || 0) + 1
        return m
      }, {}),
  },
  actions: {
    // 下单（云端定价；失败会抛错，由页面提示）。成功后插入列表头部并返回订单。
    async create(payload) {
      const order = await createOrder(payload)
      this.list = [order, ...this.list.filter((o) => o.id !== order.id)]
      return order
    },
    // 拉取我的订单。远端列表与本地（H5 回退单）按 id 合并，本地独有的保留在前。
    async load(force = false) {
      if (this.loading) return
      if (this.loaded && !force) return
      this.loading = true
      try {
        const remote = await getMyOrders()
        const remoteIds = new Set(remote.map((o) => o.id))
        const localOnly = this.list.filter((o) => !remoteIds.has(o.id))
        this.list = [...localOnly, ...remote]
        this.loaded = true
      } catch (e) {
        logger.error('orders', 'load 失败', e)
      } finally {
        this.loading = false
      }
    },
  },
})
