// 商品详情（M2·重设计对齐 ProductDetail.jsx 方案A）：图册 swiper + 计数 + SKU 价格联动 + 加购/直买 + 客服 + 为你推荐。
import * as cart from '../../lib/cart'
import { prepareBuyNow } from '../../lib/checkout'
import { getProductById, getAllProducts } from '../../lib/catalog'
import { getRatingSummary } from '../../api/reviews'
import { mapDetail, priceForSelection, type DetailVM } from '../../lib/mapDetail'
import { mapSummary, type SummaryVM } from '../../lib/mapReviews'
import { mapProducts, type ProductVM } from '../../lib/mapHome'
import { openCustomerService } from '../../utils/customerService'

// 图册窗口（病根#15 图片面·批B）：current±1 才渲染，circular 时首尾邻接也算窗口内——
// swiper 内 lazy-load 真机不生效，全量 swiper-item 会让画廊全部图并发下载抢首屏带宽。
function computeGalleryWindow(len: number, current: number): boolean[] {
  const circular = len > 1 // 与 wxml `circular="{{vm.gallery.length > 1}}"` 同源判断
  return Array.from({ length: len }, (_, i) => {
    if (i === current || i === current - 1 || i === current + 1) return true
    if (circular && ((current === 0 && i === len - 1) || (current === len - 1 && i === 0))) return true
    return false
  })
}

Page({
  data: {
    loading: true,
    missing: false,
    vm: null as DetailVM | null,
    skuIndex: -1,
    currentPrice: '', // 展示标签「¥198」
    currentPriceNum: 0, // 数字部分（¥ 小、数字大）
    galleryIndex: 0,
    galleryWindow: [] as boolean[], // 随 galleryIndex 同步重算，详见 computeGalleryWindow
    recs: [] as ProductVM[],
    rating: null as SummaryVM | null, // 评分摘要（旁挂·异步·count=0 或失败→null 回退静态入口）
  },
  async onLoad(query: Record<string, string | undefined>) {
    const id = String(query.id || '')
    const vm = mapDetail(await getProductById(id))
    if (!vm) {
      this.setData({ loading: false, missing: true })
      return
    }
    const i = vm.skus.length ? 0 : -1
    this.setData({
      loading: false,
      vm,
      skuIndex: i,
      currentPrice: priceForSelection(vm, i),
      currentPriceNum: i >= 0 && vm.skus[i] ? vm.skus[i].price : vm.price,
      galleryWindow: computeGalleryWindow(vm.gallery.length, 0),
    })
    void this.loadRecs(id)
    void this.loadRating(id)
  },
  async loadRecs(id: string) {
    const list = await getAllProducts() // 复用首页缓存·热路径零云调用（miss 则兜底重拉一次）
    if (list) {
      this.setData({ recs: mapProducts(list).filter((p) => p.id !== id).slice(0, 4) }) // 排除本商品·取 4 个
    }
  },
  // 评分摘要（云端聚合下发·不用列表页缓存自算·云为唯一真相）：count=0 或失败→mapSummary 返 null→回退静态入口
  async loadRating(id: string) {
    const r = await getRatingSummary(id)
    this.setData({ rating: r.ok ? mapSummary(r) : null })
  },
  onGallery(e: { detail: { current: number } }) {
    const vm = this.data.vm
    this.setData({
      galleryIndex: e.detail.current,
      galleryWindow: vm ? computeGalleryWindow(vm.gallery.length, e.detail.current) : [],
    })
  },
  onSelectSku(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index)
    const vm = this.data.vm
    if (!vm) return
    this.setData({
      skuIndex: idx,
      currentPrice: priceForSelection(vm, idx),
      currentPriceNum: vm.skus[idx] ? vm.skus[idx].price : vm.price,
    })
  },
  onAddCart() {
    const vm = this.data.vm
    if (!vm) return
    const sku = vm.skus[this.data.skuIndex] // 选中规格随行入车（价用规格价·双键行身份）
    cart.add({
      id: vm.id,
      sku: sku ? sku.name : '',
      name: vm.name,
      tag: vm.tag,
      price: sku ? sku.price : vm.price,
      was: vm.was,
      cover: vm.gallery[0] || '',
    })
    wx.showToast({ title: '已加入购物车', icon: 'success' })
  },
  onService() {
    openCustomerService()
  },
  onViewReviews() {
    const vm = this.data.vm
    if (vm) wx.navigateTo({ url: '/pages/reviews/reviews?productId=' + vm.id })
  },
  onBuyNow() {
    const vm = this.data.vm
    if (!vm) return
    const sku = vm.skus[this.data.skuIndex]
    prepareBuyNow({ id: vm.id, sku: sku ? sku.name : '', name: vm.name, tag: vm.tag, price: sku ? sku.price : vm.price, cover: vm.gallery[0] || '' }) // 直买不动购物车
    wx.navigateTo({ url: '/pages/checkout/checkout' })
  },
  onTapRec(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    // detail→详情 会叠栈：连点推荐卡逼近微信 10 层上限后 navigateTo 静默失败、卡片变哑。
    // 逼近上限（留 headroom）改 redirectTo 替换本页不叠栈；否则 navigateTo 并补 fail 降级 redirectTo（不静默）。
    const url = '/pages/detail/detail?id=' + id
    if (getCurrentPages().length >= 8) wx.redirectTo({ url })
    else wx.navigateTo({ url, fail: () => wx.redirectTo({ url }) })
  },
})
