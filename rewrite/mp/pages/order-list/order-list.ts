// 我的订单（M2 批7）：状态分栏 + 游标分页 + 待支付续付 + 确认收货。列表从云端拉取、无本地回退单。
import { getMyOrders, pay, confirmReceive } from '../../api/orders'
import { mapPayResult } from '../../lib/payFlow'
import { mapOrders, type OrderVM, type OrderLineVM } from '../../lib/mapOrders'

const TABS = [
  { key: '', label: '全部' },
  { key: 'pending', label: '待支付' },
  { key: 'paid', label: '待发货' },
  { key: 'shipped', label: '待收货' },
  { key: 'done', label: '已完成' },
]

// 状态→设计染色（coolist-* tint）：进行中紫、已完成鸭黄、关闭/退款弱灰。仅视觉，不改状态语义。
const TINT: Record<string, string> = {
  pending: 'purple',
  paid: 'purple',
  shipped: 'purple',
  done: 'sage',
  closed: 'muted',
  refund_required: 'muted',
}
// 去 ¥ 前缀（label 已含半角 ¥·拆出纯数字供模板把货币符号做小号处理，展示不改口径）。
const stripCny = (s: string): string => (s || '').replace(/^¥/, '')

type LineRow = OrderLineVM & { priceNum: string }
type OrderRow = Omit<OrderVM, 'items'> & { items: LineRow[]; tint: string; amountNum: string }

// 视图装饰：附 tint + 拆分货币符号（不动 mapOrders 单源/守卫 rw-mp-orders-golden）。
function decorate(o: OrderVM): OrderRow {
  return {
    ...o,
    tint: TINT[o.status] || 'purple',
    amountNum: stripCny(o.amountLabel),
    items: o.items.map((l) => ({ ...l, priceNum: stripCny(l.priceLabel) })),
  }
}

Page({
  data: {
    tabs: TABS,
    tabKey: '',
    all: [] as OrderVM[],
    shown: [] as OrderRow[],
    loading: true,
    hasMore: false,
    cursor: null as unknown,
  },
  onLoad(query: Record<string, string | undefined>) {
    if (query.tab && TABS.some((t) => t.key === query.tab)) this.setData({ tabKey: query.tab })
  },
  onShow() {
    void this.reload()
  },
  async reload() {
    this.setData({ loading: true })
    const r = await getMyOrders()
    const all = r.ok ? mapOrders(r.list) : []
    this.setData({ loading: false, all, cursor: r.ok ? r.nextCursor : null, hasMore: !!(r.ok && r.hasMore) })
    this.applyTab()
  },
  async onReachBottom() {
    if (!this.data.hasMore || this.data.cursor == null) return
    const r = await getMyOrders(this.data.cursor)
    if (!r.ok) return // 翻页失败不覆盖已有数据（黄金 §八口径）
    const merged = [...this.data.all]
    const seen = new Set(merged.map((o) => o.id))
    for (const o of mapOrders(r.list)) if (!seen.has(o.id)) merged.push(o) // 追加去重
    this.setData({ all: merged, cursor: r.nextCursor, hasMore: !!r.hasMore })
    this.applyTab()
  },
  applyTab() {
    const k = this.data.tabKey
    const filtered = k ? this.data.all.filter((o) => o.status === k) : this.data.all
    this.setData({ shown: filtered.map(decorate) })
  },
  onTab(e: WechatMiniprogram.TouchEvent) {
    this.setData({ tabKey: String(e.currentTarget.dataset.key) })
    this.applyTab()
  },
  onTapOrder(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: '/pages/order/order?id=' + String(e.currentTarget.dataset.id) })
  },
  async onPay(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id)
    const outcome = mapPayResult(await pay(id))
    if (outcome.kind === 'paid') {
      wx.showToast({ title: '已支付', icon: 'success' })
      void this.reload()
      return
    }
    if (outcome.kind === 'request') {
      wx.requestPayment({
        ...outcome.payment,
        success: () => {
          wx.showToast({ title: '支付成功', icon: 'success' })
          void this.reload()
        },
        fail: () => void this.reload(), // 取消：订单保留·刷新即可
      })
      return
    }
    wx.showToast({ title: outcome.message, icon: 'none' })
    void this.reload() // 超时关单等状态变化如实刷出来
  },
  onConfirm(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id)
    wx.showModal({
      title: '确认收货',
      content: '确认已收到宝贝了吗？',
      success: async (res) => {
        if (!res.confirm) return
        const r = await confirmReceive(id)
        wx.showToast({ title: r.ok ? '已确认收货' : '操作没成功，稍后再试', icon: r.ok ? 'success' : 'none' })
        void this.reload()
      },
    })
  },
})
