// 商品详情（v5「字重」稿 A2）：图册 swiper + 方格页码 + SKU 价格联动 + 加购/直买 + 客服。
import { BRAND_SLOGAN_CN } from '../../lib/brand'
import { tapHaptic } from '../../lib/haptics'
import { trackEvent } from '../../api/learning'
import * as cart from '../../lib/cart'
import { prepareBuyNow } from '../../lib/checkout'
import { getAllProducts, getProductDetail } from '../../lib/catalog'
import { getRatingSummary } from '../../api/reviews'
import { mapDetail, type DetailVM } from '../../lib/mapDetail'
import { mapSummary, type SummaryVM } from '../../lib/mapReviews'
import { openCustomerService } from '../../utils/customerService'

// 图册窗口（病根#15 图片面）：current±1 才渲染，circular 时首尾邻接也算窗口内——
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
    loadFailed: false, // 网络/取数失败——不伪装成已下架，给重试
    vm: null as DetailVM | null,
    skuIndex: -1,
    currentPriceNum: 0, // 数字部分（¥ 小、数字大）
    galleryIndex: 0,
    galleryWindow: [] as boolean[], // 随 galleryIndex 同步重算，详见 computeGalleryWindow
    rating: null as SummaryVM | null, // 评分摘要（旁挂·异步·count=0 或失败→null 回退静态入口）
  },
  productId: '',
  _seq: 0, // loadProduct 代次（同 order-list/home 范式）：连点「重试」可并发在途·丢弃被更晚一次取代的过期回包
  onLoad(query: Record<string, string | undefined>) {
    this.productId = String(query.id || '')
    void this.loadProduct()
  },
  // onLoad 与 onRetryLoad 共用：先拿全量表判两态——
  // all===null（网络/取数失败）→ loadFailed 给重试；all 有值但 id 未命中 → 灭 loading（wxml !loading 空态＝真下架）。
  async loadProduct() {
    const id = this.productId
    const seq = ++this._seq
    const all = await getAllProducts()
    if (seq !== this._seq) return // 过期回包（被更晚一次 loadProduct 取代）：丢弃·不覆盖较新结果
    if (all === null) {
      this.setData({ loading: false, loadFailed: true })
      return
    }
    const raw = all.find((p) => String(p.id || p._id || '') === id) || null
    const vm = mapDetail(raw)
    if (!vm) {
      this.setData({ loading: false })
      return
    }
    const i = vm.skus.length ? 0 : -1
    this.setData({
      loading: false,
      vm,
      skuIndex: i,
      currentPriceNum: i >= 0 && vm.skus[i] ? vm.skus[i].price : vm.price,
      galleryWindow: computeGalleryWindow(vm.gallery.length, 0),
    })
    trackEvent('view_product', 'detail', vm.id, { price: vm.price }) // 电商漏斗埋点（R41）
    void this.loadDetail(id, seq)
    void this.loadRating(id, seq)
  },
  // 图册补齐（列表不下发 images·详情页按 id 拉全档补进 swiper·根因#15）：列表项首帧已渲染
  // （gallery 仅 cover·零等待），详情回包到达把完整 gallery setData 补齐；详情失败/无更多图保持列表项降级
  // （gallery 剩 cover·不裂不崩）。沿用 _seq 代次：连点重试/快速切商品时过期回包丢弃。
  async loadDetail(id: string, seq: number) {
    const raw = await getProductDetail(id)
    if (seq !== this._seq) return // 过期回包（被更晚一次 loadProduct 取代）：丢弃·不覆盖较新结果
    const vm = this.data.vm
    if (!vm) return
    const detailVm = mapDetail(raw)
    if (!detailVm) return
    const morePics = detailVm.gallery.length > vm.gallery.length
    this.setData({
      'vm.soldLabel': detailVm.soldLabel, // 详情档带回后台销量（列表项可能还没有这个字段）
      ...(morePics
        ? {
            'vm.gallery': detailVm.gallery,
            galleryWindow: computeGalleryWindow(detailVm.gallery.length, this.data.galleryIndex),
          }
        : {}),
    })
  },
  // data 初值已是加载态，只有重试才需要先切回去
  onRetryLoad() {
    tapHaptic()
    this.setData({ loading: true, loadFailed: false })
    void this.loadProduct()
  },
  // 评分摘要（云端聚合下发·不用列表页缓存自算·云为唯一真相）：count=0 或失败→mapSummary 返 null→回退静态入口
  async loadRating(id: string, seq: number) {
    const r = await getRatingSummary(id)
    if (seq !== this._seq) return // 过期回包（连点重试/离开后迟到）：丢弃·不覆盖较新结果
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
      currentPriceNum: vm.skus[idx] ? vm.skus[idx].price : vm.price,
    })
  },
  // 当前选中规格的成交行（加购/直买同源·价用规格价·双键行身份）。划线价是商品级、现价可能取了规格级：
  // 划线不高于现价就不透传，否则购物车行渲染出「划线比现价还低」（同 lib/quickAdd 那道闸）。
  _line(vm: DetailVM) {
    const s = vm.skus[this.data.skuIndex]
    const price = s ? s.price : vm.price
    return { id: vm.id, sku: s ? s.name : '', name: vm.name, tag: vm.tag, price, cover: vm.gallery[0] || '', was: vm.was !== undefined && vm.was > price ? vm.was : undefined }
  },
  onAddCart() {
    const vm = this.data.vm
    if (!vm) return
    tapHaptic()
    const line = this._line(vm)
    cart.add(line)
    trackEvent('add_to_cart', 'detail', line.id, { sku: line.sku, price: line.price }) // 电商漏斗埋点（R41）
    wx.showToast({ title: '已加入购物车', icon: 'success' })
  },
  onService() {
    openCustomerService()
  },
  onViewReviews() {
    const vm = this.data.vm
    if (vm) wx.navigateTo({ url: '/pages/reviews/reviews?productId=' + vm.id + '&name=' + encodeURIComponent(vm.name) })
  },
  onBuyNow() {
    const vm = this.data.vm
    if (!vm) return
    tapHaptic()
    prepareBuyNow(this._line(vm)) // 直买不动购物车（草稿不收划线价）
    wx.navigateTo({ url: '/pages/checkout/checkout' })
  },

  // 转发/朋友圈钩子（分发前置·决策§29）：路径带 ?id= 保证收到的人打开的是
  // 同一件商品；标题/图取当前商品真身，vm 未就绪回退品牌语不造假。
  onShareAppMessage() {
    const vm = this.data.vm
    return vm
      ? { title: vm.name, path: '/pages/detail/detail?id=' + vm.id, imageUrl: vm.gallery[0] || '' }
      : { title: BRAND_SLOGAN_CN, path: '/pages/home/home' }
  },
  onShareTimeline() {
    const vm = this.data.vm
    return vm ? { title: vm.name, query: 'id=' + vm.id } : { title: BRAND_SLOGAN_CN }
  },
})
