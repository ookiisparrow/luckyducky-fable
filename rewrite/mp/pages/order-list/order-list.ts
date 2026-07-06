// 我的订单（M2 批7）：状态分栏 + 游标分页 + 待支付续付 + 确认收货。列表从云端拉取、无本地回退单。
import { getMyOrders, pay, confirmReceive, cancelOrder } from '../../api/orders'
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
  _seq: 0, // reload 代次·同 tab 内多触发点（onShow/取消后 reload）并发时丢弃过期回包（tab-token 只挡切 tab·挡不住同 tab 乱序）
  onLoad(query: Record<string, string | undefined>) {
    if (query.tab && TABS.some((t) => t.key === query.tab)) this.setData({ tabKey: query.tab })
  },
  onShow() {
    void this.reload()
  },
  async reload() {
    // 状态筛选下推服务端（分页与过滤同源）：tabKey 作 status 传下去·从该 tab 重新分页。
    // 修原「客户端过滤 + 服务端全量分页」：短过滤 tab 内容短于视口→不可滚→onReachBottom 不触发→深页匹配单看不到、
    // 且并存「上拉加载更多」死提示与「暂无订单」假空态（审计 P2）。
    const tab = this.data.tabKey // 捕获本次请求的 tab·回包落地前复核，防快速切 tab 慢回包乱序覆盖（同 player playToken）
    const seq = ++this._seq // 代次：同 tab 内被更晚 reload（如取消后 reload）取代的旧回包丢弃
    this.setData({ loading: true })
    const r = await getMyOrders(undefined, 20, tab)
    if (seq !== this._seq || tab !== this.data.tabKey) return // 过期回包（被更晚 reload 取代）或已切 tab：丢弃·不覆盖较新结果
    const all = r.ok ? mapOrders(r.list) : []
    this.setData({ loading: false, all, shown: all.map(decorate), cursor: r.ok ? r.nextCursor : null, hasMore: !!(r.ok && r.hasMore) })
  },
  async onReachBottom() {
    if (!this.data.hasMore || this.data.cursor == null) return
    const tab = this.data.tabKey
    const seq = this._seq // 捕获当前代次（翻页不 bump）：期间若发生 reload（_seq 递增）则本次 append 作废，不并入被替换的列表
    const r = await getMyOrders(this.data.cursor, 20, tab)
    if (!r.ok) return // 翻页失败不覆盖已有数据（黄金 §八口径）
    if (seq !== this._seq || tab !== this.data.tabKey) return // reload 已取代当前列表 / 跨 tab 过期回包：丢弃·不错配游标
    const merged = [...this.data.all]
    const seen = new Set(merged.map((o) => o.id))
    for (const o of mapOrders(r.list)) if (!seen.has(o.id)) merged.push(o) // 追加去重
    this.setData({ all: merged, shown: merged.map(decorate), cursor: r.nextCursor, hasMore: !!r.hasMore })
  },
  onTab(e: WechatMiniprogram.TouchEvent) {
    const k = String(e.currentTarget.dataset.key)
    if (k === this.data.tabKey) return
    this.setData({ tabKey: k, all: [], shown: [], cursor: null, hasMore: false })
    void this.reload() // 切 tab 从服务端按该状态重新分页（过滤与分页同源）
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
  // 取消待支付单（破坏性·二次确认；仅 pending 出此入口·最终裁决在云端）
  onCancel(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id)
    wx.showModal({
      title: '取消订单',
      content: '确定取消这笔待支付订单吗？取消后不可恢复。',
      success: async (res) => {
        if (!res.confirm) return
        const r = await cancelOrder(id)
        wx.showToast({ title: r.ok ? '订单已取消' : '取消没成功，稍后再试', icon: r.ok ? 'success' : 'none' })
        void this.reload()
      },
    })
  },
})
