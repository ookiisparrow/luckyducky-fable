// 商品详情（M2·重设计对齐 ProductDetail.jsx 方案A）：图册 swiper + 计数 + SKU 价格联动 + 加购/直买 + 客服 + 为你推荐。
import * as cart from '../../lib/cart'
import { prepareBuyNow } from '../../lib/checkout'
import { getAllProducts } from '../../lib/catalog'
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
    missing: false, // 网络成功、id 未命中——真下架/无效链接
    loadFailed: false, // 网络/取数失败——不伪装成已下架，给重试（P2·bug sweep R1 #3）
    vm: null as DetailVM | null,
    skuIndex: -1,
    currentPrice: '', // 展示标签「¥198」
    currentPriceNum: 0, // 数字部分（¥ 小、数字大）
    galleryIndex: 0,
    galleryWindow: [] as boolean[], // 随 galleryIndex 同步重算，详见 computeGalleryWindow
    recs: [] as ProductVM[],
    rating: null as SummaryVM | null, // 评分摘要（旁挂·异步·count=0 或失败→null 回退静态入口）
  },
  productId: '',
  _seq: 0, // loadProduct 代次（同 order-list/home 范式）：连点「重试」可并发在途·丢弃被更晚一次取代的过期回包
  onLoad(query: Record<string, string | undefined>) {
    this.productId = String(query.id || '')
    void this.loadProduct()
  },
  // 加载失败重试入口（onLoad 与 onRetryLoad 共用）：先拿全量表判两态——
  // all===null（网络/取数失败）→ loadFailed 给重试；all 有值但 id 未命中 → missing（真下架）。
  async loadProduct() {
    const id = this.productId
    const seq = ++this._seq
    this.setData({ loading: true, missing: false, loadFailed: false })
    const all = await getAllProducts()
    if (seq !== this._seq) return // 过期回包（被更晚一次 loadProduct 取代）：丢弃·不覆盖较新结果
    if (all === null) {
      this.setData({ loading: false, loadFailed: true })
      return
    }
    const raw = all.find((p) => String(p.id || p._id || '') === id) || null
    const vm = mapDetail(raw)
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
  onRetryLoad() {
    void this.loadProduct()
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

  // 转发/朋友圈钩子（分发前置·决策§29·守卫 rw-mp-share-wired）：路径带 ?id= 保证收到的人打开的是
  // 同一件商品（守卫钉此）；标题/图取当前商品真身，vm 未就绪（loading/missing）回退品牌语不造假。
  onShareAppMessage() {
    const vm = this.data.vm
    return vm
      ? { title: vm.name, path: '/pages/detail/detail?id=' + vm.id, imageUrl: vm.gallery[0] || '' }
      : { title: '小棉鸭钩织材料包', path: '/pages/home/home' }
  },
  onShareTimeline() {
    const vm = this.data.vm
    return vm ? { title: vm.name, query: 'id=' + vm.id } : { title: '小棉鸭钩织材料包' }
  },
})
