/**
 * 商品 store（Pinia）。小程序端从云端拉的商品列表收口于此；页面从这里取，
 * 不再直接 import 静态 catalog。
 *
 * 为什么用 store 而不直接把 catalog.js 改成异步：catalog 是全店同步单一来源
 * （cart、详情推荐位等同步依赖它），改异步会牵一发动全身。这里把"云端商品"
 * 叠加进来，页面优先用 store；api 层在云端失败/非小程序端时已回退本地 catalog，
 * 所以 store 拿到的恒为可用列表。
 *
 * 不持久化：商品价格要每次启动拉最新，不能缓存旧价。
 *
 * 商品形状：{ id, name, tag, price, was, featured, sort }（价为数字，展示层拼 ￥）。
 */
import { defineStore } from 'pinia'
import { getProducts } from '@/api/shop.js'
import { logger } from '@/utils/logger.js'

export const useProductsStore = defineStore('products', {
  state: () => ({
    list: [],
    loaded: false,
    loading: false,
  }),
  getters: {
    // 首页横滑展示的商品
    featured: (s) => s.list.filter((p) => p.featured),
    // 按 id 取单个商品（取不到返回 null）
    getById: (s) => (id) => s.list.find((p) => p.id === id) || null,
  },
  actions: {
    // 拉取商品列表。已加载则跳过；force=true 强制刷新。
    async load(force = false) {
      if (this.loading) return
      if (this.loaded && !force) return
      this.loading = true
      try {
        this.list = await getProducts()
        this.loaded = true
      } catch (e) {
        logger.error('products', 'load 失败', e)
      } finally {
        this.loading = false
      }
    },
  },
})
