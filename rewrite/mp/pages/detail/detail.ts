// 商品详情（M2 批3·批4 接购物车·批5 接立即购买）：图册 swiper + SKU 选择（价格联动）+ 加购/直买。
import * as cart from '../../lib/cart'
import { prepareBuyNow } from '../../lib/checkout'
import { getProductById } from '../../lib/catalog'
import { mapDetail, priceForSelection, type DetailVM } from '../../lib/mapDetail'

Page({
  data: {
    loading: true,
    missing: false,
    vm: null as DetailVM | null,
    skuIndex: -1,
    currentPrice: '',
  },
  async onLoad(query: Record<string, string | undefined>) {
    const id = String(query.id || '')
    const vm = mapDetail(await getProductById(id))
    if (!vm) {
      this.setData({ loading: false, missing: true })
      return
    }
    this.setData({ loading: false, vm, skuIndex: vm.skus.length ? 0 : -1, currentPrice: priceForSelection(vm, vm.skus.length ? 0 : -1) })
  },
  onSelectSku(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index)
    const vm = this.data.vm
    if (!vm) return
    this.setData({ skuIndex: idx, currentPrice: priceForSelection(vm, idx) })
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
  onBuyNow() {
    const vm = this.data.vm
    if (!vm) return
    const sku = vm.skus[this.data.skuIndex]
    prepareBuyNow({ id: vm.id, sku: sku ? sku.name : '', name: vm.name, tag: vm.tag, price: sku ? sku.price : vm.price, cover: vm.gallery[0] || '' }) // 直买不动购物车
    wx.navigateTo({ url: '/pages/checkout/checkout' })
  },
})
