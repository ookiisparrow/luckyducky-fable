/**
 * 商品流水线 store（Pinia）。一款商品 = 一条六步流水线（规格 §七）：
 * ①产品图片（cover 封面图 + images 其余图）②商品信息 ③SKU ④教学视频 ⑤二维码卡片 ⑥码批次。
 * 经 api/cloud.js 适配层读写（云模式存云端 productsDraft；本地模式 localStorage）。
 */
import { defineStore } from 'pinia'
import { loadProducts, saveProduct, deleteProduct } from '@/api/cloud.js'

export const STEP_NAMES = ['产品图片', '商品信息', '商品 SKU', '教学视频', '二维码卡片', '码批次与印刷包']

function newProduct() {
  const id = 'p' + Date.now().toString(36)
  return {
    id,
    cover: '', // 封面图（商品的「脸」：列表卡与详情头图）；云模式为 fileID
    images: [], // 其余图（有序）
    name: '',
    price: '',
    was: '',
    tag: '',
    brief: '',
    skus: [], // [{ name, price }]
    courseId: '', // 配套课程（步骤④ 首次进入时生成 course-<pid>）
    videoStats: null, // { total, done } 由步骤④ 保存草稿时同步
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
      // 视频编排：StepVideos 保存草稿时同步 videoStats = { total, done }
      return !!(p.videoStats && p.videoStats.total > 0 && p.videoStats.done >= p.videoStats.total)
    case 5:
    case 6:
      return false // ⑤⑥ 在 v1.5 接入后判定
    default:
      return false
  }
}

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
        this.list = list
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
