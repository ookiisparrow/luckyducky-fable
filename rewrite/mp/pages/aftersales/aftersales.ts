// 我的售后（M2 批8）：列表 + 游标翻页（追加去重·失败不覆盖已有——黄金 §八）。
import { getMyAfterSales } from '../../api/orders'
import { mapAfterSales, mergeAfterSales, type AfterSaleVM } from '../../lib/mapAftersales'
import { openCustomerService } from '../../utils/customerService'

Page({
  data: {
    list: [] as AfterSaleVM[],
    loading: true,
    loadFailed: false, // 失败≠空态（根因#14·守卫 rw-mp-list-loadfailed-state）：与「还没有售后记录」分治
    hasMore: false,
    cursor: null as unknown,
  },
  _seq: 0, // reload 代次（同 order-list 范式）：onShow 多次触发（如售后详情返回）并发时丢弃过期回包
  onShow() {
    void this.reload()
  },
  async reload() {
    const seq = ++this._seq
    const r = await getMyAfterSales()
    if (seq !== this._seq) return // 过期回包（被更晚 reload 取代）：丢弃
    if (!r.ok) {
      // 失败不覆盖已有数据；首载一无所有时落 loadFailed 给重试，不与「还没有售后记录」混同（根因#14）。
      this.setData({ loading: false, loadFailed: !this.data.list.length })
      if (this.data.list.length) wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
      return
    }
    this.setData({ loading: false, loadFailed: false, list: mapAfterSales(r.list), cursor: r.nextCursor, hasMore: !!r.hasMore })
  },
  onRetryLoad() {
    this.setData({ loading: true, loadFailed: false })
    void this.reload()
  },
  async onReachBottom() {
    if (!this.data.hasMore || this.data.cursor == null) return
    const seq = this._seq // 捕获当前代次（翻页不 bump）：期间若发生 reload（_seq 递增）则本次 append 作废
    const r = await getMyAfterSales(this.data.cursor)
    if (seq !== this._seq) return // reload 已取代当前列表：丢弃·不错配游标（失败的过期回包也静默丢弃，不误弹 toast——评审修复）
    if (!r.ok) {
      wx.showToast({ title: '加载失败，上拉重试', icon: 'none' }) // 翻页失败不静默（根因#14）
      return
    }
    this.setData({ list: mergeAfterSales(this.data.list, mapAfterSales(r.list)), cursor: r.nextCursor, hasMore: !!r.hasMore })
  },
  onTapOrder(e: WechatMiniprogram.TouchEvent) {
    // order↔aftersales 互跳环无叠栈守卫（P3·bug sweep Round2 item6·同 detail.ts onTapRec 范式）：
    // 反复「我的售后→订单详情→回售后→再点单」会持续叠栈，逼近上限改 redirectTo 替换本页。
    const url = '/pages/order/order?id=' + String(e.currentTarget.dataset.id)
    if (getCurrentPages().length >= 8) wx.redirectTo({ url })
    else wx.navigateTo({ url, fail: () => wx.redirectTo({ url }) })
  },
  onKefu() {
    openCustomerService()
  },
})
