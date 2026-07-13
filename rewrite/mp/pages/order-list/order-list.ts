// 我的订单（M2 批7）：状态分栏 + 游标分页 + 待支付续付 + 确认收货。列表从云端拉取、无本地回退单。
import { getMyOrders, pay, confirmReceive, cancelOrder } from '../../api/orders'
import { mapPayResult } from '../../lib/payFlow'
import { mapOrders, type OrderVM, type OrderLineVM } from '../../lib/mapOrders'
import { swipeDir, nextTabKey } from '../../lib/orderSwipe'

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
    loadFailed: false, // 失败≠空态（根因#14·守卫 rw-mp-list-loadfailed-state）：一无所有时的网络失败态，与「暂无订单」分治
    hasMore: false,
    cursor: null as unknown,
    anim: '', // 切 tab 滑入动画类（anim-next/anim-prev）：由 switchTab 置向、reload 落新数据时应用一次；onShow/翻页不带
  },
  _seq: 0, // reload 代次·同 tab 内多触发点（onShow/取消后 reload）并发时丢弃过期回包（tab-token 只挡切 tab·挡不住同 tab 乱序）
  unloaded: false, // 页面已退出标记（同 checkout/review 范式·bug sweep II 批E）：onPay 支付回包在途用户退出列表页，迟到回包不再对已退页 toast/reload
  _swX: 0, // 手势起点 clientX（非渲染态直挂·仿 _seq 写法）
  _swY: 0, // 手势起点 clientY
  _swT: 0, // 手势起点 timeStamp（ms）——一律用事件 timeStamp，不引 Date.now
  _animDir: '', // 待应用的滑入方向类（非渲染态）：switchTab 置、reload 成功落数据时消费一次；onShow/翻页 reload 读到空＝不动画
  onLoad(query: Record<string, string | undefined>) {
    if (query.tab && TABS.some((t) => t.key === query.tab)) this.setData({ tabKey: query.tab })
  },
  onUnload() {
    this.unloaded = true
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
    // 失败≠空态（根因#14）：失败不覆盖已有列表（onShow 返回抖动一次不该把待支付订单清空）；
    // 一无所有时落 loadFailed 给重试，不与「暂无订单」混同。
    if (!r.ok) {
      this._animDir = '' // 切 tab 失败无新内容·丢弃待应用方向（下次成功 reload 才动画，不留陈旧向）
      this.setData({ loading: false, loadFailed: !this.data.all.length })
      if (this.data.all.length) wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
      return
    }
    const all = mapOrders(r.list)
    const anim = this._animDir // 消费一次：仅切 tab 触发的 reload 带方向动画；onShow/翻页 _animDir 为空＝不动画
    this._animDir = ''
    this.setData({ loading: false, loadFailed: false, all, shown: all.map(decorate), cursor: r.nextCursor, hasMore: !!r.hasMore, anim })
  },
  onRetryLoad() {
    void this.reload()
  },
  async onReachBottom() {
    if (!this.data.hasMore || this.data.cursor == null) return
    const tab = this.data.tabKey
    const seq = this._seq // 捕获当前代次（翻页不 bump）：期间若发生 reload（_seq 递增）则本次 append 作废，不并入被替换的列表
    const r = await getMyOrders(this.data.cursor, 20, tab)
    if (seq !== this._seq || tab !== this.data.tabKey) return // reload 已取代当前列表 / 跨 tab 过期回包：丢弃·不错配游标（失败的过期回包也在此静默丢弃，不该对已离开的 tab 弹 toast——评审修复）
    if (!r.ok) {
      wx.showToast({ title: '加载失败，上拉重试', icon: 'none' }) // 翻页失败不静默（根因#14）
      return // 不覆盖已有数据（黄金 §八口径）
    }
    const merged = [...this.data.all]
    const seen = new Set(merged.map((o) => o.id))
    for (const o of mapOrders(r.list)) if (!seen.has(o.id)) merged.push(o) // 追加去重
    this.setData({ all: merged, shown: merged.map(decorate), cursor: r.nextCursor, hasMore: !!r.hasMore })
  },
  onTab(e: WechatMiniprogram.TouchEvent) {
    this.switchTab(String(e.currentTarget.dataset.key))
  },
  // 切换到目标 tab（同 key 早退 + 清空重拉）：onTab 与手势滑动共用此私有方法。
  switchTab(key: string) {
    if (key === this.data.tabKey) return
    const from = TABS.findIndex((t) => t.key === this.data.tabKey)
    const to = TABS.findIndex((t) => t.key === key)
    this._animDir = to > from ? 'anim-next' : 'anim-prev' // 目标 tab 在右→新内容自右滑入；在左→自左滑入（reload 落数据时应用）
    // 先清 anim 类：reload 落新数据时才把方向类应用上去→动画重新触发（连续同向切换也重播，不是「类没变不重放」）
    this.setData({ tabKey: key, all: [], shown: [], cursor: null, hasMore: false, anim: '' })
    void this.reload() // 切 tab 从服务端按该状态重新分页（过滤与分页同源）
  },
  // 手势滑动换 tab（bind 不 catch，不影响纵向滚动/上拉翻页）：抬指判定，不做跟手动画（需求未要求）。
  onSwipeStart(e: WechatMiniprogram.TouchEvent) {
    const t = e.touches[0]
    this._swX = t.clientX
    this._swY = t.clientY
    this._swT = e.timeStamp
  },
  onSwipeEnd(e: WechatMiniprogram.TouchEvent) {
    const t = e.changedTouches[0]
    const dx = t.clientX - this._swX
    const dy = t.clientY - this._swY
    const dt = e.timeStamp - this._swT
    const dir = swipeDir(dx, dy, dt)
    if (dir === 0) return
    const k = nextTabKey(this.data.tabs, this.data.tabKey, dir)
    if (k === null) return
    this.switchTab(k)
  },
  onTapOrder(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: '/pages/order/order?id=' + String(e.currentTarget.dataset.id) })
  },
  async onPay(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id)
    const outcome = mapPayResult(await pay(id))
    // await 恢复点复核（同 checkout startPay 范式·bug sweep II 批E）：用户在支付发起在途退出列表页，迟到回包
    // 不再对已退页 toast/reload/拉起支付授权框——订单已在云端，用户下次进详情页续付即可。requestPayment 的
    // success/fail 回调内不加同款复核：授权框是模态、卸载窗口小，无需评估。
    if (this.unloaded) {
      wx.showToast({ title: '可到订单详情继续支付', icon: 'none' })
      return
    }
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
        if (this.unloaded) return // await 恢复点复核（bug sweep II 批E round2）：用户已退出列表页——非钱副作用，静默收尾即可
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
        if (this.unloaded) return // await 恢复点复核（bug sweep II 批E round2）：用户已退出列表页——非钱副作用，静默收尾即可
        wx.showToast({ title: r.ok ? '订单已取消' : '取消没成功，稍后再试', icon: r.ok ? 'success' : 'none' })
        void this.reload()
      },
    })
  },
})
