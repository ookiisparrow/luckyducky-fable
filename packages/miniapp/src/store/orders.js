/**
 * 订单 store（Pinia）。下单与订单查询收口于此；checkout / paysuccess / order 页
 * 从这里取，不再各自造数据（关调试日志 C：提交 → 支付成功 → 订单详情同一笔）。
 *
 * 不持久化：订单是服务端状态，小程序端每次从云端拉；H5 / App 回退单
 * （api 层本地生成）仅存活于会话内，load 时与远端列表按 id 合并不丢失。
 */
import { defineStore } from 'pinia'
import { createOrder, getMyOrders, confirmReceive, payOrder, getOrderById } from '@/api/order.js'
import { logger } from '@/utils/logger.js'

export const useOrdersStore = defineStore('orders', {
  state: () => ({
    list: [],
    loaded: false,
    loading: false,
    nextCursor: null,
    hasMore: false,
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
    // 发起支付（pending → paid）。成功后本笔乐观置 paid（权威 paidAt 由支付回调写云端，
    // 下次 load(force) 对齐）；云端判定超时关单时本地同步 closed，错误继续向上抛由页面提示。
    async pay(id) {
      try {
        await payOrder(id)
        const o = this.list.find((x) => x.id === id)
        if (o) {
          o.status = 'paid'
          o.paidAt = Date.now()
        }
      } catch (e) {
        if (e && e.message === 'ORDER_CLOSED') {
          const o = this.list.find((x) => x.id === id)
          if (o) {
            o.status = 'closed'
            o.closedAt = Date.now()
          }
        }
        throw e
      }
    },
    // 确认收货（shipped → done）。成功后就地更新本笔，详情页 / 列表响应式刷新。
    async confirmReceive(id) {
      const { doneAt } = await confirmReceive(id)
      const o = this.list.find((x) => x.id === id)
      if (o) {
        o.status = 'done'
        o.doneAt = doneAt
      }
    },
    // 详情兜底（审核批次B）：列表 limit 之外的老单按 id 单独取回并入列表
    async fetchById(id) {
      if (!id || this.getById(id)) return
      const order = await getOrderById(id)
      if (order) this.list = [...this.list, order]
    },
    // 拉取我的订单。远端列表与本地（H5 回退单）按 id 合并，本地独有的保留在前。
    async load(force = false) {
      if (this.loading) return
      if (this.loaded && !force) return
      this.loading = true
      try {
        const { list: remote, nextCursor, hasMore } = await getMyOrders()
        const remoteIds = new Set(remote.map((o) => o.id))
        const localOnly = this.list.filter((o) => !remoteIds.has(o.id))
        this.list = [...localOnly, ...remote]
        this.nextCursor = nextCursor
        this.hasMore = hasMore
        this.loaded = true
      } catch (e) {
        logger.error('orders', 'load 失败', e)
      } finally {
        this.loading = false
      }
    },
    // 加载更多（游标翻页，根因#7）：追加下一页、按 id 去重防重入；失败/无更多静默
    async loadMore() {
      if (this.loading || !this.hasMore || this.nextCursor == null) return
      this.loading = true
      try {
        const { list: more, nextCursor, hasMore } = await getMyOrders(this.nextCursor)
        const ids = new Set(this.list.map((o) => o.id))
        this.list = [...this.list, ...more.filter((o) => !ids.has(o.id))]
        this.nextCursor = nextCursor
        this.hasMore = hasMore
      } catch (e) {
        logger.error('orders', 'loadMore 失败', e)
      } finally {
        this.loading = false
      }
    },
  },
})
