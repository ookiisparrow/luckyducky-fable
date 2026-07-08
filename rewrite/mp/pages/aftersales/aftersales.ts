// 我的售后（M2 批8）：列表 + 游标翻页（追加去重·失败不覆盖已有——黄金 §八）。
import { getMyAfterSales } from '../../api/orders'
import { mapAfterSales, mergeAfterSales, type AfterSaleVM } from '../../lib/mapAftersales'
import { openCustomerService } from '../../utils/customerService'

Page({
  data: {
    list: [] as AfterSaleVM[],
    loading: true,
    hasMore: false,
    cursor: null as unknown,
  },
  onShow() {
    void this.reload()
  },
  async reload() {
    const r = await getMyAfterSales()
    if (!r.ok) {
      this.setData({ loading: false }) // 拉取失败不覆盖已有数据
      return
    }
    this.setData({ loading: false, list: mapAfterSales(r.list), cursor: r.nextCursor, hasMore: !!r.hasMore })
  },
  async onReachBottom() {
    if (!this.data.hasMore || this.data.cursor == null) return
    const r = await getMyAfterSales(this.data.cursor)
    if (!r.ok) return
    this.setData({ list: mergeAfterSales(this.data.list, mapAfterSales(r.list)), cursor: r.nextCursor, hasMore: !!r.hasMore })
  },
  onTapOrder(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: '/pages/order/order?id=' + String(e.currentTarget.dataset.id) })
  },
  onKefu() {
    openCustomerService()
  },
})
