// 我的订单：状态分栏 + 游标分页 + 待支付续付（倒计时）+ 按住取消 + 查看物流 + 确认收货 + 写评价。列表从云端拉取、无本地回退单。
import { tapHaptic } from '../../lib/haptics'
import { getMyOrders, pay, confirmReceive, cancelOrder } from '../../api/orders'
import { mapPayResult } from '../../lib/payFlow'
import { mapOrders, statusHead, listRight, reviewUrl, payLeftMs, type OrderVM, type OrderLineVM } from '../../lib/mapOrders'
import { mapAfterSales, afterSalesByOrder, afterSaleOverlay, type OrderAfterSales } from '../../lib/mapAftersales'
import { swipeDir, nextTabKey } from '../../lib/orderSwipe'
import { goHomeTab } from '../../lib/homeIntent'
import { keyDown, keyUp } from '../../lib/keyFx'
import { fxConfirm, fxHint, fxLoaded, fxLoading, fxToast } from '../../lib/pxFx'
import { createHold, type Hold } from '../../lib/hold'
import { navBottom } from '../../lib/ground'
import { FRESH_MS, isFresh } from '../../utils/fresh'

const HOLD_MS = 700 // 按住多久算取消（设计稿 data-ms=700·拍板 7）
let hold: Hold | null = null // 当前按住取消的那张卡（lib/hold）

const TABS = [
  { key: '', label: '全部' },
  { key: 'pending', label: '待支付' },
  { key: 'paid', label: '待发货' },
  { key: 'shipped', label: '待收货' },
  { key: 'done', label: '已完成' },
]

// 去 ¥ 前缀（label 已含半角 ¥·拆出纯数字供模板把货币符号做小号处理，展示不改口径）。
const stripCny = (s: string): string => (s || '').replace(/^¥/, '')

// 列表行＝模板用得到的字段，别的不进 setData（Issue #442·开发者工具实测整表 22KB）：订单的收件人地址、物流单号、
// 商品明细等列表不显示，发到渲染层既白占传输与比对，也不该把收件人送过去。完整订单留在 _all（倒计时/写评价从那里取）。
// 模板加字段时这里同步加；order-list-tabs.test 锁了键集合。
type OrderRow = {
  id: string
  status: string
  amountNum: string
  amountTitle: string
  count: number
  reviewedAll: boolean
  thumbs: { lineId: string; cover: string }[] // 缩略图最多 3 张（设计稿 thumbs.slice(0,3)）
  label: string
  labelColor: string // 状态名字色（已退款绿字），空＝默认
  led: { tone: string; halo: string }
  truck: boolean // 待收货且没有售后叠加：状态灯位出小货车
  cd: string
  right: string
  expired: boolean // 待支付倒计时已归零：藏「去支付」、右上角写「已超时」（云端关单前）
}

// 视图装饰：拆分货币符号 + 卡片状态名/状态灯/右上角（设计稿 B1 oview·不动 mapOrders 单源）。
// 有售后时叠加「售后中 / 已退款」（云端退款不改订单状态·lib/mapAftersales afterSaleOverlay），订单状态本身不动。
function decorate(o: OrderVM, as: Record<string, OrderAfterSales>): OrderRow {
  const now = Date.now()
  const r = listRight(o, now)
  const ov = afterSaleOverlay(o.items, as[o.id])
  const sh = statusHead(o, now)
  return {
    id: o.id,
    status: o.status,
    amountNum: stripCny(o.amountLabel),
    amountTitle: o.amountTitle,
    count: o.count,
    reviewedAll: o.reviewedAll,
    thumbs: o.items.slice(0, 3).map((l: OrderLineVM) => ({ lineId: l.lineId, cover: l.cover })),
    label: ov ? ov.head : sh.label,
    labelColor: '', // 状态名一律墨色（颜色只在灯上·UI 审查 15 问 6a）
    led: ov ? ov.led : sh.led,
    truck: !ov && o.status === 'shipped',
    cd: r.cd,
    right: ov ? ov.sub : r.text,
    expired: o.status === 'pending' && payLeftMs(o, now) === 0,
  }
}

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    navBottom: navBottom(), // 页签条 top＝状态栏 + 44 导航栏（UI 审查 15 问 5a）
    scrolled: false, // 页面已下滚：页签条下缘出发丝线
    tabs: TABS,
    tabKey: '',
    shown: [] as OrderRow[],
    loading: true,
    loadFailed: false, // 失败≠空态（根因#14·守卫 rw-mp-list-loadfailed-state）：一无所有时的网络失败态，与「暂无订单」分治
    hasMore: false,
    cursor: null as unknown,
    holding: '', // 正在按住取消的订单 id（驱动键内红色进度条）
    payingId: '', // 继续支付在途的订单（锁 + 按钮 dim）：pay 往返最长 12s，连点会重复发 pay、重复拉起收银台
    anim: '', // 切 tab 滑入动画类（anim-next/anim-prev）：由 switchTab 置向、reload 落新数据时应用一次；onShow/翻页不带
    paging: false, // 触底翻页在途（底部像素 loader 行·同时挡重复触底）
  },
  _busy: false, // 网络动作在途锁（确认收货/取消）：重复点直接丢
  _all: [] as OrderVM[], // 全量已拉列表（迁出 data·wxml 不绑定它）：仅供翻页去重与游标基准；shown 才是渲染源，翻页用路径键 shown[N] 增量追加（根因#7 规模·整表重发传输 O(n²)）
  _as: {} as Record<string, OrderAfterSales>, // 本人售后按订单汇总（reload 并行拉·翻页复用）：卡片叠加「售后中 / 已退款」
  _asAt: 0, // 上次带回售后的时刻（utils/fresh·#442）：30s 内且没做过订单写操作，切页签/重拉不再重带同一份售后
  _seq: 0, // reload 代次·同 tab 内多触发点（onShow/取消后 reload）并发时丢弃过期回包（tab-token 只挡切 tab·挡不住同 tab 乱序）
  unloaded: false, // 页面已退出标记（同 checkout/review 范式）：onPay 支付回包在途用户退出列表页，迟到回包不再对已退页 toast/reload
  _swX: 0, // 手势起点 clientX（非渲染态直挂·仿 _seq 写法）
  _swY: 0, // 手势起点 clientY
  _swT: 0, // 手势起点 timeStamp（ms）——一律用事件 timeStamp，不引 Date.now
  _ticker: null as ReturnType<typeof setInterval> | null, // 待支付倒计时每秒刷新（onShow 起、onHide/onUnload 停）
  _animDir: '', // 待应用的滑入方向类（非渲染态）：switchTab 置、reload 成功落数据时消费一次；onShow/翻页 reload 读到空＝不动画
  _freshAt: 0, // 上次 reload 成功落地的时刻（utils/fresh）：从别页返回 30s 内且期间没做过订单写操作就不重拉（不闪 loading）
  onLoad(query: Record<string, string | undefined>) {
    if (query.tab && TABS.some((t) => t.key === query.tab)) this.setData({ tabKey: query.tab })
  },
  onUnload() {
    this.unloaded = true
    this.onHide()
  },
  onShow() {
    // 返回免重拉（性能批 #2）：支付/取消/收货/售后等写完 api 层已标脏，回来必拉；只是看了眼详情/物流就不拉
    if (!isFresh('orders', this._freshAt, FRESH_MS)) void this.reload()
    if (!this._ticker) this._ticker = setInterval(() => this.tick(), 1000)
  },
  onHide() {
    hold?.cancel()
    if (this._ticker) clearInterval(this._ticker)
    this._ticker = null
  },
  // 待支付倒计时：只按路径键刷新待支付卡的 cd（不整表重发）；过点状态名改「已超时」、右侧「未按时支付」、藏「去支付」，
  // 首次归零自动刷新一次（真正关单以云端为准）
  tick() {
    const now = Date.now()
    const patch: Record<string, unknown> = {}
    let zeroHit = false
    // 完整订单在 _all（行已瘦身·见 OrderRow），与 shown 同序一一对应：算时间用 o，对比显示值用 row
    this._all.forEach((o, i) => {
      const row = this.data.shown[i]
      if (!row || o.status !== 'pending') return
      const r = listRight(o, now)
      if (r.cd !== row.cd) patch['shown[' + i + '].cd'] = r.cd
      if (r.text !== row.right) patch['shown[' + i + '].right'] = r.text
      // 只在「未超时→超时」那一下触发刷新：刷回来仍待支付时 decorate 按时间重算 expired 仍为真，不会再刷
      if (!row.expired && payLeftMs(o, now) === 0) {
        const sh = statusHead(o, now) // 过点：状态名换「已超时」、灯换灰圈（UI 审查 15 问 6a）
        patch['shown[' + i + '].expired'] = true
        patch['shown[' + i + '].label'] = sh.label
        patch['shown[' + i + '].led'] = sh.led
        zeroHit = true
      }
    })
    if (Object.keys(patch).length) this.setData(patch)
    if (zeroHit) void this.reload()
  },
  // 网络动作统一：在途锁 + 加载遮罩，回包后解锁；在途重复触发回 undefined（调用方直接收手）
  async withLoading<T>(title: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (this._busy) return undefined
    this._busy = true
    fxLoading(this, title)
    try {
      return await fn()
    } finally {
      fxLoaded(this)
      this._busy = false
    }
  },
  async reload() {
    // 状态筛选下推服务端（分页与过滤同源）：tabKey 作 status 传下去·从该 tab 重新分页。
    // 不做「客户端过滤 + 服务端全量分页」：短过滤 tab 内容短于视口→不可滚→onReachBottom 不触发→深页匹配单看不到、
    // 且并存「上拉加载更多」死提示与「暂无订单」假空态。
    const tab = this.data.tabKey // 捕获本次请求的 tab·回包落地前复核，防快速切 tab 慢回包乱序覆盖（同 player playToken）
    const seq = ++this._seq // 代次：同 tab 内被更晚 reload（如取消后 reload）取代的旧回包丢弃
    if (!this.data.loading) this.setData({ loading: true }) // 切 tab 已在同一次 setData 里置好加载态：不再多发一次（#442）
    // 本人售后随订单一次往返带回（性能批 #3·withAfterSales·云端最近 100 条）：卡片靠它叠加「售后中 / 已退款」（云端退款不改订单状态）；
    // 云端售后读失败不带 afterSales 键＝不叠加（保留上次拉到的）。翻页复用不重拉。
    // 新鲜期内不重带（#442）：售后在切页签之间不会变；申请/撤回售后等写操作在 api 层标脏 orders，回来必重带。
    // ponytail: 只取最近 100 条售后，超出不叠加；上限升级路径＝云端按订单汇总售后态。
    const withAs = !isFresh('orders', this._asAt, FRESH_MS)
    const r = await getMyOrders(undefined, 20, tab, withAs)
    if (seq !== this._seq || tab !== this.data.tabKey) return // 过期回包（被更晚 reload 取代）或已切 tab：丢弃·不覆盖较新结果
    if (r.ok && Array.isArray(r.afterSales)) {
      this._as = afterSalesByOrder(mapAfterSales(r.afterSales))
      this._asAt = Date.now()
    }
    // 失败≠空态（根因#14）：失败不覆盖已有列表（onShow 返回抖动一次不该把待支付订单清空）；
    // 一无所有时落 loadFailed 给重试，不与「暂无订单」混同。
    if (!r.ok) {
      this._animDir = '' // 切 tab 失败无新内容·丢弃待应用方向（下次成功 reload 才动画，不留陈旧向）
      this.setData({ loading: false, loadFailed: !this._all.length })
      if (this._all.length) fxHint(this, '刷新失败，请稍后重试')
      return
    }
    const all = mapOrders(r.list)
    const anim = this._animDir // 消费一次：仅切 tab 触发的 reload 带方向动画；onShow/翻页 _animDir 为空＝不动画
    this._animDir = ''
    this._all = all // 全量重发（新列表本该全发·非增量场景）：迁实例字段后 shown 仍整表替换
    this._freshAt = Date.now()
    this.setData({ loading: false, loadFailed: false, shown: all.map((o) => decorate(o, this._as)), cursor: r.nextCursor, hasMore: !!r.hasMore, anim })
  },
  onRetryLoad() {
    tapHaptic()
    void this.reload()
  },
  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    const s = e.scrollTop > 0
    if (s !== this.data.scrolled) this.setData({ scrolled: s }) // 只在跨过顶端时 setData
  },
  async onReachBottom() {
    if (!this.data.hasMore || this.data.cursor == null || this.data.paging) return // 在途重复触底：丢弃
    const tab = this.data.tabKey
    const seq = this._seq // 捕获当前代次（翻页不 bump）：期间若发生 reload（_seq 递增）则本次 append 作废，不并入被替换的列表
    this.setData({ paging: true })
    const r = await getMyOrders(this.data.cursor, 20, tab)
    this.setData({ paging: false })
    if (seq !== this._seq || tab !== this.data.tabKey) return // reload 已取代当前列表 / 跨 tab 过期回包：丢弃·不错配游标（失败的过期回包也在此静默丢弃，不该对已离开的 tab 弹 toast）
    if (!r.ok) {
      fxHint(this, '加载失败，上拉重试') // 翻页失败不静默（根因#14）
      return // 不覆盖已有数据
    }
    // 增量 setData（根因#7 规模）：翻页只把新增行按路径键 shown[N] 追加，不重发已渲染卡（整表 setData 传输 O(n²)）。
    // _all 迁实例字段仅供去重/游标基准；shown 用路径键局部更新（wxml 只绑定 shown）。
    const seen = new Set(this._all.map((o) => o.id))
    const patch: Record<string, unknown> = { cursor: r.nextCursor, hasMore: !!r.hasMore }
    let idx = this._all.length
    for (const o of mapOrders(r.list)) {
      if (seen.has(o.id)) continue // 追加去重
      seen.add(o.id)
      this._all.push(o)
      patch['shown[' + idx + ']'] = decorate(o, this._as)
      idx++
    }
    this.setData(patch)
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
    this._all = [] // 切 tab 清空全量基准（迁实例字段·随后 reload 从服务端按该状态重新分页）
    this.setData({ tabKey: key, shown: [], cursor: null, hasMore: false, anim: '', loading: true }) // 同帧进加载态：不闪「暂无订单」
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
  // 空态「去逛逛」：回首页从头逛起（同 cart/paysuccess 口径·lib/homeIntent）
  onGoHome() {
    tapHaptic()
    goHomeTab()
  },
  onTapOrder(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: '/pages/order/order?id=' + String(e.currentTarget.dataset.id) })
  },
  async onPay(e: WechatMiniprogram.TouchEvent) {
    if (this.data.payingId) return // 同一时刻只容一笔在途：收银台是模态，别的单等它关掉再付
    const id = String(e.currentTarget.dataset.id)
    tapHaptic()
    this.setData({ payingId: id })
    fxLoading(this, '正在发起支付')
    const outcome = mapPayResult(await pay(id))
    fxLoaded(this)
    // 收银台关掉（成功/取消/失败）或没拉起都要解锁，否则按钮永久点不动
    const settle = () => {
      this.setData({ payingId: '' })
      void this.reload()
    }
    // await 恢复点复核（同 checkout startPay 范式）：用户在支付发起在途退出列表页，迟到回包
    // 不再对已退页 toast/reload/拉起支付授权框——订单已在云端，用户下次进详情页续付即可。requestPayment 的
    // success/fail 回调内不加同款复核：授权框是模态、卸载窗口小，无需评估。
    if (this.unloaded) {
      fxHint(this, '订单已保留，可在订单详情继续支付')
      return
    }
    if (outcome.kind === 'paid') {
      fxToast(this, '已支付')
      settle()
      return
    }
    if (outcome.kind === 'request') {
      wx.requestPayment({
        ...outcome.payment,
        success: () => {
          fxToast(this, '支付成功')
          settle()
        },
        fail: settle, // 取消：订单保留·刷新即可
      })
      return
    }
    fxHint(this, outcome.message)
    settle() // 超时关单等状态变化如实刷出来
  },
  async onConfirm(e: WechatMiniprogram.TouchEvent) {
    if (this._busy) return
    const id = String(e.currentTarget.dataset.id)
    if (!(await fxConfirm(this, { title: '确认收货', content: '确认已收到宝贝了吗？', confirmText: '确认收货' }))) return
    const r = await this.withLoading('正在确认', () => confirmReceive(id))
    if (!r || this.unloaded) return // 在途重复 / await 恢复点复核：用户已退出列表页——非钱副作用，静默收尾即可
    if (r.ok) fxToast(this, '已确认收货')
    else fxHint(this, '操作没成功，稍后再试')
    void this.reload()
  },
  onLogistics(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: '/pages/logistics/logistics?id=' + String(e.currentTarget.dataset.id) })
  },
  // 写评价：单件单直达评价页；多件单进详情逐件评（评价按行记·一行一评），带 pick=review 让详情提示「选一件来评价」
  onReview(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id)
    const o = this._all.find((x) => x.id === id)
    if (o && o.reviewedAll) return // 全评完出灰标不可点（拍板 6）
    if (o && o.items.length === 1) wx.navigateTo({ url: reviewUrl(id, o.items[0]) })
    else wx.navigateTo({ url: '/pages/order/order?id=' + id + '&pick=review' })
  },
  noop() {},
  // 取消待支付单（破坏性·按住 700ms 才取消，设计稿 data-hold；仅 pending 出此入口·最终裁决在云端）。
  // 按下带触点坐标、touchmove 挪开超 10px 作废（lib/hold）——顺势滑列表不误取消
  onCancelStart(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id)
    const t = e.touches && e.touches[0]
    hold?.cancel()
    hold = createHold(HOLD_MS, () => void this.cancelNow(id), {
      onQuick: () => fxHint(this, '按住取消订单'),
      onChange: (v) => this.setData({ holding: v ? id : '' }),
    })
    hold.start(t ? t.clientX : undefined, t ? t.clientY : undefined)
  },
  onCancelMove(e: WechatMiniprogram.TouchEvent) {
    const t = e.touches && e.touches[0]
    if (t) hold?.move(t.clientX, t.clientY)
  },
  onCancelEnd() {
    hold?.end()
  },
  async cancelNow(id: string) {
    tapHaptic()
    const r = await this.withLoading('正在取消', () => cancelOrder(id))
    if (!r || this.unloaded) return // 在途重复 / await 恢复点复核：用户已退出列表页——非钱副作用，静默收尾即可
    if (r.ok) fxToast(this, '订单已取消')
    else fxHint(this, '取消没成功，稍后再试')
    void this.reload()
  },
})
