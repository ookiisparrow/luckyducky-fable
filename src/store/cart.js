/**
 * 购物车状态（Pinia）。详情页/推荐位「加入购物车」会写到这里，
 * 购物车页据此显示「空车 / 有货」，并算合计、做选中与结算。
 *
 * 注：TabBar 用 uni.reLaunch 切页，但不会重启 JS 运行时，
 * 所以本 store 的内存状态在三个 Tab 间是保留的（加购后切去购物车能看到）。
 *
 * 以后接后端：把 add/remove/setQty 改成调用 api/shop.js 的购物车接口，
 * 字段结构尽量保持一致，购物车页模板无需改动。
 *
 * 条目结构：{ id, name, tag, price, was, qty, selected }
 *   price / was 为数字（便于算合计），展示时模板再拼 ￥。
 */
import { defineStore } from 'pinia'

export const useCartStore = defineStore('cart', {
  state: () => ({
    items: [],
    // 结算草稿：进入结算页时的下单清单快照。
    // fromCart=true 表示来自购物车（提交成功后从车里移除这些条目）；
    // false 表示详情页「立即购买」（不影响购物车）。
    checkoutItems: [],
    checkoutFromCart: false,
  }),
  getters: {
    isEmpty: (s) => s.items.length === 0,
    // 全部条目的件数（用于 Tab 角标等）
    count: (s) => s.items.reduce((n, it) => n + it.qty, 0),
    // 选中条目的件数与金额（结算栏用）
    selectedCount: (s) => s.items.reduce((n, it) => (it.selected ? n + it.qty : n), 0),
    selectedTotal: (s) => s.items.reduce((n, it) => (it.selected ? n + it.price * it.qty : n), 0),
    allSelected: (s) => s.items.length > 0 && s.items.every((it) => it.selected),
  },
  actions: {
    // 加入购物车：已在车里则数量 +1，否则新建一条（默认选中）
    add(p) {
      const ex = this.items.find((it) => it.id === p.id)
      if (ex) {
        ex.qty += 1
      } else {
        this.items.push({
          id: p.id,
          name: p.name,
          tag: p.tag || '',
          price: p.price,
          was: p.was,
          qty: 1,
          selected: true,
        })
      }
    },
    remove(id) {
      this.items = this.items.filter((it) => it.id !== id)
    },
    setQty(id, qty) {
      const it = this.items.find((x) => x.id === id)
      if (it) it.qty = Math.max(1, qty)
    },
    toggle(id) {
      const it = this.items.find((x) => x.id === id)
      if (it) it.selected = !it.selected
    },
    toggleAll() {
      const next = !this.allSelected
      this.items.forEach((it) => (it.selected = next))
    },

    // —— 结算草稿 ——
    // 购物车「去结算」：把选中条目快照进草稿
    prepareCheckoutFromCart() {
      this.checkoutItems = this.items.filter((it) => it.selected).map((it) => ({ ...it }))
      this.checkoutFromCart = true
    },
    // 详情页「立即购买」：单件直接进草稿（不动购物车）
    prepareBuyNow(p) {
      this.checkoutItems = [
        { id: p.id, name: p.name, tag: p.tag || '', price: p.price, was: p.was, qty: 1 },
      ]
      this.checkoutFromCart = false
    },
    // 提交成功后：来自购物车的条目「按本次实际提交的数量」精确扣减（减到 0 才移除该条），
    // 而不是按 id 整条删掉 —— 否则结算页把 3 件改成 1 件提交后，购物车会错误地清掉全部 3 件。
    // lines 传结算页最终清单（含改后数量）；不传则退回按草稿原数量扣减。
    finishCheckout(lines) {
      if (this.checkoutFromCart) {
        const submitted = Array.isArray(lines) && lines.length ? lines : this.checkoutItems
        submitted.forEach((line) => {
          const it = this.items.find((x) => x.id === line.id)
          if (!it) return
          it.qty -= line.qty || 0
          if (it.qty <= 0) this.remove(it.id)
        })
      }
      this.checkoutItems = []
      this.checkoutFromCart = false
    },
  },
})
