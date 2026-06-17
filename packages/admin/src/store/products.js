/**
 * 商品流水线 store（Pinia）。一款商品 = 一条六步流水线（规格 §七）：
 * ①产品图片（cover 封面图 + images 其余图）②商品信息 ③SKU ④教学视频 ⑤二维码卡片 ⑥码批次。
 * 经 api/cloud.js 适配层读写（云模式存云端 productsDraft；本地模式 localStorage）。
 */
import { defineStore } from 'pinia'
import { loadProducts, saveProduct, deleteProduct } from '@/api/cloud.js'
import { STEP_NAMES, newProduct, normalizeProduct, stepDone } from './productShape.js'

// 纯形状逻辑在 productShape.js（无云依赖·可被测试直接 import）；这里 re-export 保持调用方 import 不变
export { STEP_NAMES, normalizeProduct, stepDone }

export const useProductsStore = defineStore('products', {
  state: () => ({
    list: [],
    urls: {}, // fileID → 临时展示 URL（云模式；本地模式 dataURL 直接可显）
    loaded: false,
    error: '',
  }),
  getters: {
    getById: (s) => (id) => s.list.find((p) => p.id === id) || null,
    doneCount: () => (p) => [1, 2, 3, 4, 5, 6].filter((n) => stepDone(p, n)).length,
    // 图引用 → 可显示地址：dataURL 原样；fileID 查映射（取不到给空，由占位兜底）
    imgUrl: (s) => (ref) => (!ref ? '' : ref.startsWith('cloud://') ? s.urls[ref] || '' : ref),
  },
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return
      try {
        const { list, urls } = await loadProducts()
        this.list = list.map(normalizeProduct) // 入库归一·脏商品降级安全形状不白屏（根因#8）
        this.urls = urls
        this.loaded = true
        this.error = ''
      } catch (e) {
        this.error = '加载失败：' + e.message
      }
    },
    addUrl(ref, url) {
      if (ref && url) this.urls = { ...this.urls, [ref]: url }
    },
    async create() {
      const p = newProduct()
      this.list = [p, ...this.list]
      await saveProduct(JSON.parse(JSON.stringify(p)))
      return p
    },
    // 局部更新某商品并立即落库（向导每步「自动保存」即此）
    async update(id, patch) {
      const i = this.list.findIndex((p) => p.id === id)
      if (i < 0) return
      this.list[i] = { ...this.list[i], ...patch, updatedAt: Date.now() }
      const ok = await saveProduct(JSON.parse(JSON.stringify(this.list[i])))
      if (!ok) this.error = '保存失败，请检查网络后重试'
    },
    async remove(id) {
      this.list = this.list.filter((p) => p.id !== id)
      await deleteProduct(id)
    },
  },
})
