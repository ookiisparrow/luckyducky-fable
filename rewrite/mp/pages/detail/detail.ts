// 商品详情（M2·重设计对齐 ProductDetail.jsx 方案A）：图册 swiper + 计数 + SKU 价格联动 + 加购/直买 + 客服 + 为你推荐。
import * as cart from '../../lib/cart'
import { prepareBuyNow } from '../../lib/checkout'
import { getProductById } from '../../lib/catalog'
import { getProducts } from '../../api/catalog'
import { mapDetail, priceForSelection, type DetailVM } from '../../lib/mapDetail'
import { mapProducts, type ProductVM } from '../../lib/mapHome'

Page({
  data: {
    loading: true,
    missing: false,
    vm: null as DetailVM | null,
    skuIndex: -1,
    currentPrice: '', // 展示标签「¥198」
    currentPriceNum: 0, // 数字部分（¥ 小、数字大）
    galleryIndex: 0,
    recs: [] as ProductVM[],
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
    })
    void this.loadRecs(id)
  },
  async loadRecs(id: string) {
    const r = await getProducts()
    if (r.ok && Array.isArray(r.list)) {
      this.setData({ recs: mapProducts(r.list).filter((p) => p.id !== id).slice(0, 4) }) // 排除本商品·取 4 个
    }
  },
  onGallery(e: { detail: { current: number } }) {
    this.setData({ galleryIndex: e.detail.current })
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
    wx.showToast({ title: '正在接入客服…', icon: 'none' })
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
    if (id) wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },
})
