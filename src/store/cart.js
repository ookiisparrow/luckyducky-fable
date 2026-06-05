/**
 * 购物车状态（预留）。
 * 以后做「加入购物车 / 结算 / 下单」时在这里管理购物车条目与合计。
 * 现在首页的「加入」只弹 Toast，不真正入车；接入时把 add() 实现起来即可。
 */
import { defineStore } from 'pinia'

export const useCartStore = defineStore('cart', {
  state: () => ({
    items: [], // [{ id, name, price, qty, ... }]
  }),
  getters: {
    count: (state) => state.items.reduce((n, it) => n + it.qty, 0),
    total: (state) => state.items.reduce((n, it) => n + it.price * it.qty, 0),
  },
  actions: {
    // TODO: 接入购物车流程后实现
    add(/* product */) {},
    remove(/* id */) {},
  },
})
