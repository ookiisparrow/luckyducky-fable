/**
 * 商品流水线 store（Pinia）。一款商品 = 一条六步流水线（规格 §七）：
 * ①产品图片（cover 封面图 + images 其余图）②商品信息 ③SKU ④教学视频 ⑤二维码卡片 ⑥码批次。
 * 经 api/cloud.js 适配层读写（当前本地模式，云接线只换适配层）。
 */
import { defineStore } from 'pinia'
import { loadProducts, saveProducts } from '@/api/cloud.js'

export const STEP_NAMES = ['产品图片', '商品信息', '商品 SKU', '教学视频', '二维码卡片', '码批次与印刷包']

function newProduct() {
  const id = 'p' + Date.now().toString(36)
  return {
    id,
    cover: '', // 封面图（商品的「脸」：列表卡与详情头图）
    images: [], // 其余图（有序）
    name: '',
    price: '',
    was: '',
    tag: '',
    brief: '',
    skus: [], // [{ name, price }]
    status: 'preparing', // preparing 筹备中 | onsale 在售
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

// 每步是否已完成（向导圆点与列表进度共用一套判定）
export function stepDone(p, n) {
  switch (n) {
    case 1:
      return !!p.cover
    case 2:
      return !!(p.name && p.price)
    case 3:
      return p.skus.length > 0 && p.skus.every((s) => s.name && s.price)
    case 4:
    case 5:
    case 6:
      return false // ④⑤⑥ 云接线/卡片设计器在 v1.5 接入后判定
    default:
      return false
  }
}

export const useProductsStore = defineStore('products', {
  state: () => ({
    list: [],
    loaded: false,
  }),
  getters: {
    getById: (s) => (id) => s.list.find((p) => p.id === id) || null,
    doneCount: () => (p) => [1, 2, 3, 4, 5, 6].filter((n) => stepDone(p, n)).length,
  },
  actions: {
    async load() {
      if (this.loaded) return
      this.list = await loadProducts()
      this.loaded = true
    },
    async create() {
      const p = newProduct()
      this.list = [p, ...this.list]
      await this.persist()
      return p
    },
    // 局部更新某商品并立即落库（向导每步「自动保存」即此）
    async update(id, patch) {
      const i = this.list.findIndex((p) => p.id === id)
      if (i < 0) return
      this.list[i] = { ...this.list[i], ...patch, updatedAt: Date.now() }
      await this.persist()
    },
    async remove(id) {
      this.list = this.list.filter((p) => p.id !== id)
      await this.persist()
    },
    async persist() {
      await saveProducts(JSON.parse(JSON.stringify(this.list)))
    },
  },
})
