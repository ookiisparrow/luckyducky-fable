// 商品详情（M2 批3）：图册 swiper + SKU 选择（价格联动）+ 参数/段落/材料清单。
// 加购/立即购买本批占位 toast（批4 接购物车·按钮不做摆设、点了有明确反馈）。
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
    wx.showToast({ title: '购物车即将开通', icon: 'none' })
  },
  onBuyNow() {
    wx.showToast({ title: '下单链路随后开通', icon: 'none' })
  },
})
