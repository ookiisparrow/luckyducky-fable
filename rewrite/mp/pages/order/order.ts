// 订单详情：状态卡（短状态名 + 右侧小字 + 四步进度 + 异常说明）/条目/地址/金额明细/操作（续付·按住取消·确认收货·申请售后·联系客服）。
import { tapHaptic } from '../../lib/haptics'
import { getOrderById, pay, confirmReceive, cancelOrder, applyRefund, getMyAfterSales } from '../../api/orders'
import { mapPayResult } from '../../lib/payFlow'
import { mapOrder, orderSteps, cardLabel, detailSub, reviewUrl, type OrderVM, type StepState } from '../../lib/mapOrders'
import { applicableLines, mapAfterSales } from '../../lib/mapAftersales'
import { navigateOrRedirect, goBackOrHome } from '../../lib/nav'
import { keyDown, keyUp } from '../../lib/keyFx'
import { fxToast, fxHint } from '../../lib/pxFx'
import { createHold, type Hold } from '../../lib/hold'
import { openCustomerService } from '../../utils/customerService'

const HOLD_MS = 700 // 按住多久算取消（设计稿 data-ms=700·拍板 7）
const SHEET_OUT_MS = 240 // 半屏关：面板 240ms 下滑后撤节点（app.wxss .sh-panel.out）
const AS_TYPES = ['退款', '换货', '补发'] // 售后类型（设计稿 asf.types）：后台只有退款接口，换货/补发走客服（拍板 7）
const AS_REASONS = ['线材缺色', '少件', '做工问题', '其他']
let hold: Hold | null = null

// 待退款 / 支付异常：状态卡内说明行（设计稿 WARN·文案与 admin 同口径，不承诺不存在的自动化流程）
const WARN: Record<string, { text: string; tone: string }> = {
  refund_required: { text: '该订单需人工处理退款，请联系客服协助处理', tone: '#F4BD3F' },
  payment_exception: { text: '到账金额与订单金额不一致，请联系客服处理退款', tone: '#D9483B' },
}
// 小货车姿态（设计稿 tpose）：待发货/待收货在路上、完成卸货、待退款倒车，其余停着
const POSE: Record<string, string> = { paid: 'drive', shipped: 'drive', done: 'unload', refund_required: 'reverse' }

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    loading: true,
    loadFailed: false, // 失败≠不存在（根因#14·守卫 rw-mp-list-loadfailed-state）：刚付款用户弱网打开不该看到「订单不存在」
    vm: null as OrderVM | null,
    head: '', // 状态卡左侧短状态名（设计稿 ST）
    sub: { text: '', tone: '' } as { text: string; tone: string }, // 状态卡右侧小字（倒计时/签收日期…）
    warn: null as { text: string; tone: string } | null,
    help: false, // 待退款/支付异常：底部「返回 + 联系客服」
    dock: false, // 已关闭不出底部栏
    amountNum: '',
    canAfterSale: false,
    paying: false, // 继续支付在途（锁 + 按钮 dim）：pay 往返最长 12s，连点会重复发 pay、重复拉起收银台
    holding: false, // 按住取消进行中（驱动键内红色进度条）
    steps: [] as Array<{ label: string; state: StepState }>, // 进度四步（v5·纯展示派生）
    truckPose: 'park',
    cargo: 0,
    // 申请售后半屏（设计稿 sheet aftersales）
    asOpen: false,
    asOut: false,
    asBusy: false,
    asTypes: AS_TYPES,
    asReasons: AS_REASONS,
    asType: '退款',
    asReason: '线材缺色',
    asLines: [] as Array<{ lineId: string; label: string }>,
    asLine: '',
  },
  onLoad(query: Record<string, string | undefined>) {
    this.orderId = String(query.id || '')
  },
  orderId: '',
  _seq: 0, // reload 代次·丢弃过期回包（onShow/取消/支付/确认收货多触发点并发·慢回包别把状态卡盖回过期态）
  _ticker: null as ReturnType<typeof setInterval> | null, // 待支付倒计时每秒刷新
  unloaded: false, // 页面已退出标记（同 checkout/review 范式）：onPay/售后回包在途用户退出详情页，迟到回包不再对已退页 toast/reload/导航
  onUnload() {
    this.unloaded = true
    this.onHide()
  },
  onShow() {
    void this.reload()
    if (!this._ticker) this._ticker = setInterval(() => this.tick(), 1000)
  },
  onHide() {
    hold?.cancel()
    if (this._ticker) clearInterval(this._ticker)
    this._ticker = null
  },
  tick() {
    const vm = this.data.vm
    if (!vm || vm.status !== 'pending') return
    const sub = detailSub(vm, Date.now())
    if (sub.text !== this.data.sub.text || sub.tone !== this.data.sub.tone) this.setData({ sub })
  },
  async reload() {
    // 订单状态/钱路径页：多 reload 触发点（onShow + 取消/支付/确认收货各自 reload）并发时，慢回包迟到落地会把
    // 状态卡盖回过期态（如取消成功已 closed 又被在途 onShow 的 pending 盖回·重现取消/支付按钮）。代次不符即丢弃。
    const seq = ++this._seq
    const r = await getOrderById(this.orderId)
    if (seq !== this._seq) return
    // 失败≠不存在（根因#14）：请求失败落 loadFailed 给重试（已有 vm 时保留不覆盖）；
    // 查无此单保持 vm 空、loadFailed 灭，wxml 的 !loading 空态就是「订单不存在」。
    if (!r.ok) {
      // 「查无此单」≠「网络失败」（根因#14 反向）：云端 getOrderById 对
      // 订单不存在/非本人一律 err(NOT_FOUND)、缺 id 是 err(NO_ID)，都是 ok:false——只看 ok 会把
      // 这两类落进 loadFailed，用户对着不存在的单反复点重试。按错误码分流：确定性的「没有」
      // 灭 loadFailed（空态走 !loading，不是死代码），其余（超时/未部署/云异常）才落 loadFailed 给重试。
      const notFound = r.error === 'NOT_FOUND' || r.error === 'NO_ID'
      this.setData({
        loading: false,
        loadFailed: !notFound && !this.data.vm,
      })
      // 已有 vm（页内刷新失败）：不动已渲染内容，只轻提示——含单据刚被后台删除的边界。
      if (this.data.vm) wx.showToast({ title: notFound ? '这单已经不在了' : '刷新失败，请稍后重试', icon: 'none' })
      return
    }
    const vm = mapOrder(r.order)
    if (!vm) {
      this.setData({ loading: false, loadFailed: false, vm: null })
      return
    }
    const s = vm.status
    this.setData({
      loading: false,
      loadFailed: false,
      vm,
      head: cardLabel(s),
      sub: detailSub(vm, Date.now()),
      warn: WARN[s] || null,
      help: !!WARN[s],
      dock: s !== 'closed',
      amountNum: (vm.amountLabel || '').replace(/[^0-9.]/g, ''),
      canAfterSale: ['paid', 'shipped', 'done'].includes(s),
      steps: orderSteps(s),
      truckPose: POSE[s] || 'park',
      cargo: s !== 'closed' ? Math.min(3, vm.items.length) : 0,
    })
  },
  // 底部「返回」键（v5 底部操作区首位）：深链进来没上一页时回首页
  onBack() {
    goBackOrHome()
  },
  onKefu() {
    openCustomerService()
  },
  onRetryLoad() {
    tapHaptic()
    this.setData({ loading: true, loadFailed: false })
    void this.reload()
  },
  onCopyOrderNo() {
    if (!this.orderId) return
    wx.setClipboardData({
      data: this.orderId,
      success: () => wx.showToast({ title: '已复制单号', icon: 'none' }),
    })
  },
  onCopyTracking() {
    const no = this.data.vm && this.data.vm.trackingNo
    if (!no) return
    wx.setClipboardData({
      data: no,
      success: () => wx.showToast({ title: '已复制运单号', icon: 'none' }),
    })
  },
  // 物流卡 → 物流页壳（运单号大字 + 快递100 插件入口·pages/logistics）
  onViewLogistics() {
    if (!this.data.vm || !this.data.vm.trackingNo) return
    wx.navigateTo({ url: '/pages/logistics/logistics?id=' + this.orderId })
  },
  // 取消待支付单（破坏性·按住 700ms 才取消，设计稿 data-hold；仅 pending 出此入口·最终裁决在云端）
  onCancelStart() {
    hold?.cancel()
    hold = createHold(HOLD_MS, () => void this.cancelNow(), {
      onQuick: () => fxHint(this, '按住取消订单'),
      onChange: (v) => this.setData({ holding: v }),
    })
    hold.start()
  },
  onCancelEnd() {
    hold?.end()
  },
  async cancelNow() {
    const vm = this.data.vm
    if (!vm || vm.status !== 'pending') return
    tapHaptic()
    const r = await cancelOrder(this.orderId)
    if (this.unloaded) return // await 恢复点复核：用户已退出详情页——非钱副作用，静默收尾即可
    wx.showToast({ title: r.ok ? '订单已取消' : '取消没成功，稍后再试', icon: r.ok ? 'success' : 'none' })
    void this.reload() // 状态卡按映射自动翻「已关闭」
  },
  async onPay() {
    if (this.data.paying) return
    tapHaptic()
    this.setData({ paying: true })
    wx.showLoading({ title: '正在发起支付', mask: true })
    const outcome = mapPayResult(await pay(this.orderId))
    wx.hideLoading()
    // 收银台关掉（成功/取消/失败）或没拉起都要解锁，否则按钮永久点不动
    const settle = () => {
      this.setData({ paying: false })
      void this.reload()
    }
    // await 恢复点复核（同 checkout startPay 范式）：用户在支付发起在途退出详情页，迟到回包
    // 不再对已退页 toast/reload/拉起支付授权框——订单已在云端，用户下次重新打开详情页续付即可。requestPayment 的
    // success/fail 回调内不加同款复核：授权框是模态、卸载窗口小，无需评估。
    if (this.unloaded) {
      wx.showToast({ title: '订单已保留，可到订单列表继续支付', icon: 'none' })
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
        fail: settle,
      })
      return
    }
    wx.showToast({ title: outcome.message, icon: 'none' })
    settle()
  },
  onConfirm() {
    tapHaptic()
    wx.showModal({
      title: '确认收货',
      content: '确认已收到宝贝了吗？',
      success: async (res) => {
        if (!res.confirm) return
        const r = await confirmReceive(this.orderId)
        if (this.unloaded) return // await 恢复点复核：用户已退出详情页——非钱副作用，静默收尾即可
        wx.showToast({ title: r.ok ? '已确认收货' : '操作没成功，稍后再试', icon: r.ok ? 'success' : 'none' })
        void this.reload()
      },
    })
  },
  onWriteReview(e: WechatMiniprogram.TouchEvent) {
    const line = this.data.vm && this.data.vm.items[Number(e.currentTarget.dataset.i)]
    if (line) wx.navigateTo({ url: reviewUrl(this.orderId, line) })
  },
  // 申请售后：先算可申请行（入口收窄·最终裁决在云端），再开自绘半屏选 类型/原因/商品（多件单在半屏里点选商品）。
  async onAfterSale() {
    const vm = this.data.vm
    if (!vm) return
    // 该单已申请过的行：从我的售后里筛本单。云端按申请时间倒序截断，
    // 页长取云端默认 100（api 默认 20 会把本单较早的申请截掉，用户选了才被 ALREADY_APPLIED 拒）。
    // ponytail: 只取首页·不看 hasMore——本人售后超 100 条时本单更早的申请仍会被截掉（云端 ALREADY_APPLIED 兜底）；
    // 根治=云端 getMyAfterSales 接 orderId 过滤后改传 vm.id、删下方客户端 filter。
    const asRes = await getMyAfterSales(undefined, 100)
    if (this.unloaded) return // await 恢复点复核：用户已退出详情页——非钱副作用，静默收尾即可
    if (!asRes.ok) {
      wx.showToast({ title: '售后记录没加载出来，稍后再试', icon: 'none' }) // 失败≠一条都没申请过
      return
    }
    const appliedIds = mapAfterSales(asRes.list).filter((a) => a.orderId === vm.id).map((a) => a.lineId)
    const eligible = applicableLines(vm.status, vm.items, appliedIds)
    if (!eligible.length) {
      wx.showToast({ title: '没有可申请售后的条目', icon: 'none' })
      return
    }
    const asLines = eligible.map((l) => ({ lineId: l.lineId, label: `${l.name}${l.spec ? '（' + l.spec + '）' : ''}` }))
    this.setData({ asOpen: true, asOut: false, asBusy: false, asType: AS_TYPES[0], asReason: AS_REASONS[0], asLines, asLine: asLines[0].lineId })
  },
  onAsType(e: WechatMiniprogram.TouchEvent) {
    const v = String(e.currentTarget.dataset.v)
    if (AS_TYPES.includes(v)) this.setData({ asType: v })
  },
  onAsReason(e: WechatMiniprogram.TouchEvent) {
    const v = String(e.currentTarget.dataset.v)
    if (AS_REASONS.includes(v)) this.setData({ asReason: v })
  },
  onAsLine(e: WechatMiniprogram.TouchEvent) {
    const v = String(e.currentTarget.dataset.v)
    if (this.data.asLines.some((l) => l.lineId === v)) this.setData({ asLine: v })
  },
  onAsClose() {
    if (!this.data.asOpen || this.data.asOut) return
    this.setData({ asOut: true })
    setTimeout(() => this.setData({ asOpen: false, asOut: false }), SHEET_OUT_MS)
  },
  noop() {},
  // 提交：只有「退款」调 applyRefund（reason＝所选原因标签）；换货/补发后台没有接口，转客服办理，不碰钱（拍板 7）
  async onAsSubmit() {
    const vm = this.data.vm
    if (this.data.asBusy || !this.data.asLine || !vm) return
    if (this.data.asType !== '退款') {
      this.onAsClose()
      openCustomerService()
      return
    }
    tapHaptic()
    this.setData({ asBusy: true })
    const r = await applyRefund(vm.id, this.data.asLine, this.data.asReason)
    if (this.unloaded) return // await 恢复点复核：申请已真实提交，非钱副作用，静默收尾即可（不再对已退页 toast/导航）
    if (r.ok) {
      this.setData({ asOpen: false, asOut: false, asBusy: false })
      wx.showToast({ title: '已提交申请', icon: 'success' }) // 紧接着跳售后页：原生提示跨页不断
      navigateOrRedirect('/pages/aftersales/aftersales')
      return
    }
    this.setData({ asBusy: false })
    const e = String(r.error || '')
    const msg = e === 'ALREADY_APPLIED' ? '这条已申请过了' : e === 'NOT_REFUNDABLE' ? '该条目不可退（已开课）' : e === 'NOTHING_LEFT' ? '本单可退额度已用完' : '申请没成功，稍后再试'
    wx.showToast({ title: msg, icon: 'none' })
  },
})
