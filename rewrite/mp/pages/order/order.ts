// 订单详情：状态卡（短状态名 + 右侧小字 + 四步进度 + 异常说明）/条目/地址/金额明细/操作（续付·按住取消·确认收货·申请售后·按住撤回售后·联系客服）。
import { tapHaptic } from '../../lib/haptics'
import { getOrderById, pay, confirmReceive, cancelOrder, applyRefund, estimateRefund, getMyAfterSales, withdrawRefund } from '../../api/orders'
import { mapPayResult } from '../../lib/payFlow'
import { mapOrder, orderSteps, statusHead, detailSub, reviewUrl, payLeftMs, money, type OrderVM, type OrderLineVM, type StepState } from '../../lib/mapOrders'
import { applicableLines, mapAfterSales, mergeAfterSales, refundBlock, afterSalesByOrder, afterSaleOverlay, appliedLineIdsOf, rejectedLineIdsOf, REFUND_REJECTED, withdrawableLines, withdrawErrText, type AfterSaleVM } from '../../lib/mapAftersales'
import { navigateOrRedirect, goBackOrHome } from '../../lib/nav'
import { keyDown, keyUp } from '../../lib/keyFx'
import { fxConfirm, fxHint, fxLoaded, fxLoading, fxToast } from '../../lib/pxFx'
import { createHold, type Hold } from '../../lib/hold'
import { openCustomerService } from '../../utils/customerService'
import { groundGap } from '../../lib/ground'

const HOLD_MS = 700 // 按住多久算取消订单/撤回售后（设计稿 data-ms=700·拍板 7）
const SHEET_OUT_MS = 240 // 半屏关：面板 240ms 下滑后撤节点（app.wxss .sh-panel.out）
const AS_TYPES = ['退款', '换货', '补发'] // 售后类型（设计稿 asf.types）：后台只有退款接口，换货/补发走客服（拍板 7）
const AS_REASONS = ['无理由', '线材缺色', '少件', '做工问题', '其他'] // 「无理由」排第一并默认选中（老板 2026-09-29 拍板 3）
let hold: Hold | null = null
type AsLine = { lineId: string; name: string; spec: string }
const asLineOf = (l: OrderLineVM): AsLine => ({ lineId: l.lineId, name: l.name, spec: l.spec })
const lineText = (l: { name: string; spec: string }): string => l.name + (l.spec ? ' · ' + l.spec : '')

// 待退款 / 支付异常：状态卡出「联系客服」（说明句已含原因·UI 审查 15 问 6a 起不再另起警示行）
const HELP = new Set(['refund_required', 'payment_exception'])
// 云端判微信那边已付、回调还没落库：库里仍是 pending，但不能再让人去支付或取消（云端取消不问微信，
// 会把已付的钱关进已关闭单，只能人工退）
const CONFIRMING = { head: '已付款，正在确认', sub: { text: '微信已收到付款，订单状态稍后更新', tone: '' } }
// 小货车姿态（设计稿 tpose）：待发货/待收货在路上、完成卸货、待退款倒车，其余停着
const POSE: Record<string, string> = { paid: 'drive', shipped: 'drive', done: 'unload', refund_required: 'reverse' }

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    groundGap: groundGap(), // 地面线上方留白（屏高<700 用 56·UI 审查 6 问 2a）
    loading: true,
    loadFailed: false, // 失败≠不存在（根因#14·守卫 rw-mp-list-loadfailed-state）：刚付款用户弱网打开不该看到「订单不存在」
    vm: null as OrderVM | null,
    head: '', // 状态卡左侧短状态名（设计稿 ST）；有售后时叠加「售后中 / 已退款」（lib/mapAftersales afterSaleOverlay）
    asLed: null as { tone: string; halo: string } | null, // 售后叠加状态灯（售后中紫 / 已退款绿），null＝不出灯
    asHas: false, // 该单有任何售后记录：出「查看售后进度」入口
    lineTags: {} as Record<string, string>, // 行标 lineId→「退款中 / 已退款」
    // 可撤回的售后行（申请中且没被商家批过·lib/mapAftersales withdrawableLines）：非空时底部「撤回申请」代替「申请售后」
    // （老板 2026-09-29）；按住一次撤回本单全部申请中的售后
    wdLines: [] as string[],
    wdHold: false, // 正在按住撤回（驱动键内红色进度条）
    sub: { text: '', tone: '' } as { text: string; tone: string }, // 状态卡右侧小字（倒计时/签收日期…）
    help: false, // 待退款/支付异常：底部「返回 + 联系客服」
    dock: false, // 已关闭不出底部栏
    canAfterSale: false,
    ended: false, // 整单退完＝订单结束（reload 里算）
    paying: false, // 继续支付在途（锁 + 按钮 dim）：pay 往返最长 12s，连点会重复发 pay、重复拉起收银台
    confirming: false, // 云端回过 ORDER_ALREADY_PAID（微信已付、回调没落库）：订单离开待付款前都按「已付款，正在确认」显示
    holding: false, // 按住取消进行中（驱动键内红色进度条）
    expired: false, // 待支付倒计时已归零（藏「去支付」·云端关单前先按超时展示）
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
    asReason: AS_REASONS[0],
    asLines: [] as AsLine[], // 当前类型可选的商品（退款＝可退行；换货/补发＝全部商品）·规格单列，同款不同色分得清
    asLine: '',
    asBlock: '', // 「退款」段置灰原因（没有可退行时·lib/mapAftersales refundBlock），空＝可退
    asRej: '', // 还能退别的行时，被拒的那几件（「小鸭 · 黄、…」）——弹层点名「已被拒绝，有疑问联系客服」（拍板 5）
    asRejKefu: false, // 有被拒的行：弹层给「联系客服」键
    asEst: '', // 预计退款（拍板 4·云端 estimateRefund 试算）：「计算中…」/「预计退款 ¥X.XX」/「预计金额以审核为准」；非退款段为空
  },
  onLoad(query: Record<string, string | undefined>) {
    this.orderId = String(query.id || '')
    this.pickHint = query.pick === 'review' // 订单列表多件单点「写评价」落到这里：加载后提示选一件
  },
  orderId: '',
  pickHint: false,
  _busy: false, // 网络动作在途锁（确认收货/取消/售后前置拉取）：重复点直接丢
  _asOk: [] as AsLine[], // 售后半屏：可退行
  _asAll: [] as AsLine[], // 售后半屏：全部商品（换货/补发转客服用）
  _asRejLines: [] as AsLine[], // 售后半屏：被拒的行（客服入口带上下文）
  _estSeq: 0, // 试算代次：切商品/切类型后，旧的试算回包作废（别把上一件的数盖到这一件上）
  _asList: null as AfterSaleVM[] | null, // 最近一次拉到的本人售后（reload 并行拉）：叠加显示 + 申请售后复用；null＝还没拉到过
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
    if (!vm || vm.status !== 'pending' || this.data.confirming) return // 正在确认：倒计时不再改卡片、不判超时
    const now = Date.now()
    const sub = detailSub(vm, now)
    if (sub.text !== this.data.sub.text || sub.tone !== this.data.sub.tone) this.setData({ sub })
    // 首次归零：先藏「去支付」，再自动刷新一次看云端是否已关单（刷回来仍待支付时 reload 按时间重算 expired 仍为真，不会再触发）
    if (payLeftMs(vm, now) === 0 && !this.data.expired) {
      const sh = statusHead(vm, now)
      this.setData({ expired: true, head: sh.label, asLed: sh.led })
      void this.reload()
    }
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
    // 订单状态/钱路径页：多 reload 触发点（onShow + 取消/支付/确认收货各自 reload）并发时，慢回包迟到落地会把
    // 状态卡盖回过期态（如取消成功已 closed 又被在途 onShow 的 pending 盖回·重现取消/支付按钮）。代次不符即丢弃。
    const seq = ++this._seq
    // 并行拉本单售后（云端退款不改订单状态，靠它叠加「售后中 / 已退款」·#443 按单号只取本单）；失败静默不叠加（保留上次拉到的，首次则不叠加）。
    // Promise.resolve().then 包一层：接口桩/异常实现同步抛错或返回非 Promise 时也只当「没拉到」，不拖垮订单主体
    const asReq = Promise.resolve()
      .then(() => getMyAfterSales(undefined, 100, this.orderId))
      .catch(() => null)
    const [r, asRes] = await Promise.all([getOrderById(this.orderId), asReq])
    if (seq !== this._seq) return
    if (asRes && asRes.ok) this._asList = mapAfterSales(asRes.list)
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
      if (this.data.vm) fxHint(this, notFound ? '这单已经不在了' : '刷新失败，请稍后重试')
      return
    }
    const vm = mapOrder(r.order)
    if (!vm) {
      this.setData({ loading: false, loadFailed: false, vm: null })
      return
    }
    const s = vm.status
    const asOf = this._asList ? afterSalesByOrder(this._asList)[vm.id] : undefined
    const ov = afterSaleOverlay(vm.items, asOf)
    const wd = this._asList ? withdrawableLines(this._asList, vm.id) : {}
    const ended = ov?.head === '已退款' // 整单退完＝订单结束：不出售后入口、货车换静止纸箱、进度收在「退款」（老板 2026-10-03）
    const confirming = this.data.confirming && s === 'pending' // 回调到了（不再 pending）就自然退出
    this.setData({
      loading: false,
      loadFailed: false,
      vm,
      confirming,
      head: confirming ? CONFIRMING.head : ov ? ov.head : statusHead(vm, Date.now()).label,
      asLed: ov ? ov.led : statusHead(vm, Date.now()).led,
      asHas: !!asOf,
      lineTags: asOf ? asOf.lines : {},
      wdLines: vm.items.map((it) => it.lineId).filter((id) => wd[id]),
      sub: confirming ? CONFIRMING.sub : ov ? { text: ov.detail, tone: '' } : detailSub(vm, Date.now()),
      help: HELP.has(s),
      dock: s !== 'closed',
      canAfterSale: ['paid', 'shipped', 'done'].includes(s) && !ended,
      ended,
      steps: orderSteps(s, ended),
      truckPose: ov || s === 'refund_required' ? 'reverse' : POSE[s] || 'park', // 退货/售后/退款：货车倒车开回
      cargo: s !== 'closed' ? Math.min(3, vm.items.length) : 0,
      expired: s === 'pending' && !confirming && payLeftMs(vm, Date.now()) === 0,
    })
    if (this.pickHint && s === 'done') {
      this.pickHint = false
      fxHint(this, '选一件来评价')
    }
  },
  // 底部「返回」键（v5 底部操作区首位）：深链进来没上一页时回首页
  onBack() {
    goBackOrHome()
  },
  // 待退款/支付异常「联系客服」：先把订单号 + 商品 + 状态复制好，客服那边直接粘贴
  onKefu() {
    const vm = this.data.vm
    const copy = vm ? `订单号：${vm.id}\n商品：${vm.items.map(lineText).join('、')}\n状态：${vm.statusLabel}` : ''
    openCustomerService(copy, () => this.copiedHint())
  },
  copiedHint() {
    fxHint(this, '已复制订单信息，粘贴给客服')
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
      success: () => fxHint(this, '已复制单号'),
      fail: () => fxHint(this, '复制没成功，长按单号手动复制'),
    })
  },
  onCopyTracking() {
    const no = this.data.vm && this.data.vm.trackingNo
    if (!no) return
    wx.setClipboardData({
      data: no,
      success: () => fxHint(this, '已复制运单号'),
      fail: () => fxHint(this, '复制没成功，长按运单号手动复制'),
    })
  },
  // 「查看售后进度」→ 我的售后（售后↔详情会互跳，防叠栈）
  onGoAfterSales() {
    navigateOrRedirect('/pages/aftersales/aftersales')
  },
  // 物流卡 → 物流页壳（运单号大字 + 快递100 插件入口·pages/logistics）
  onViewLogistics() {
    if (!this.data.vm || !this.data.vm.trackingNo) return
    wx.navigateTo({ url: '/pages/logistics/logistics?id=' + this.orderId })
  },
  // 取消待支付单（破坏性·按住 700ms 才取消，设计稿 data-hold；仅 pending 出此入口·最终裁决在云端）
  // 按下带触点坐标、touchmove 挪开超 10px 作废（lib/hold）——顺势滑页不误取消
  onCancelStart(e?: WechatMiniprogram.TouchEvent) {
    const t = e && e.touches && e.touches[0]
    hold?.cancel()
    hold = createHold(HOLD_MS, () => void this.cancelNow(), {
      onQuick: () => fxHint(this, '按住取消订单'),
      onChange: (v) => this.setData({ holding: v }),
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
  // 撤回申请中的售后（底部键·代替「申请售后」·按住 700ms，同按住取消手感；最终裁决在云端）
  onWithdrawStart(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.wdLines.length) return
    const t = e.touches && e.touches[0]
    hold?.cancel()
    hold = createHold(HOLD_MS, () => void this.withdrawNow(), {
      onQuick: () => fxHint(this, '按住撤回申请'),
      onChange: (v) => this.setData({ wdHold: v }),
    })
    hold.start(t ? t.clientX : undefined, t ? t.clientY : undefined)
  },
  onWithdrawMove(e: WechatMiniprogram.TouchEvent) {
    this.onCancelMove(e)
  },
  onWithdrawEnd() {
    hold?.end()
  },
  async withdrawNow() {
    const vm = this.data.vm
    const lines = this.data.wdLines
    if (!vm || !lines.length) return
    tapHaptic()
    // 逐行撤回（一行一售后·云端逐单裁决）；任一行失败即停，提示原因后刷新看最新状态
    const r = await this.withLoading('正在撤回', async () => {
      let last: any = null
      for (const lineId of lines) {
        last = await withdrawRefund(vm.id, lineId)
        if (!last.ok) break
        // 撤回结果先并进本地售后：刷新时售后没拉到也能去掉「售后中」叠加
        if (this._asList) this._asList = mergeAfterSales(mapAfterSales([last.afterSale]), this._asList)
      }
      return last
    })
    if (!r || this.unloaded) return
    if (r.ok) fxToast(this, '已撤回')
    else fxHint(this, withdrawErrText(r.error)) // 没抢过商家等：下面刷新看最新状态
    await this.reload()
  },
  async cancelNow() {
    const vm = this.data.vm
    if (!vm || vm.status !== 'pending' || this.data.confirming) return
    tapHaptic()
    const r = await this.withLoading('正在取消', () => cancelOrder(this.orderId))
    if (!r || this.unloaded) return // 在途重复触发 / await 恢复点复核：用户已退出详情页——非钱副作用，静默收尾即可
    if (r.ok) fxToast(this, '订单已取消')
    else fxHint(this, '取消没成功，稍后再试')
    void this.reload() // 状态卡按映射自动翻「已关闭」
  },
  async onPay() {
    if (this.data.paying) return
    tapHaptic()
    this.setData({ paying: true })
    fxLoading(this, '正在发起支付')
    const outcome = mapPayResult(await pay(this.orderId))
    fxLoaded(this)
    // 收银台关掉（成功/取消/失败）或没拉起都要解锁，否则按钮永久点不动
    const settle = () => {
      this.setData({ paying: false })
      void this.reload()
    }
    // await 恢复点复核（同 checkout startPay 范式）：用户在支付发起在途退出详情页，迟到回包
    // 不再对已退页 toast/reload/拉起支付授权框——订单已在云端，用户下次重新打开详情页续付即可。requestPayment 的
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
    if (outcome.kind === 'confirming') {
      this.setData({ confirming: true, head: CONFIRMING.head, sub: CONFIRMING.sub }) // 先上屏：重拉失败也不能退回「待付款」
      settle() // 重新拉订单：回调到了就翻已付
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
    fxHint(this, outcome.message)
    settle()
  },
  async onConfirm() {
    if (this._busy) return
    tapHaptic()
    if (!(await fxConfirm(this, { title: '确认收货', content: '确认已收到宝贝了吗？', confirmText: '确认收货' }))) return
    const r = await this.withLoading('正在确认', () => confirmReceive(this.orderId))
    if (!r || this.unloaded) return // 在途重复 / await 恢复点复核：用户已退出详情页——非钱副作用，静默收尾即可
    if (r.ok) fxToast(this, '已确认收货')
    else fxHint(this, '操作没成功，稍后再试')
    void this.reload()
  },
  onWriteReview(e: WechatMiniprogram.TouchEvent) {
    const line = this.data.vm && this.data.vm.items[Number(e.currentTarget.dataset.i)]
    if (line && !line.reviewed) wx.navigateTo({ url: reviewUrl(this.orderId, line) }) // 已评价行出灰标不可点（拍板 6）
  },
  // 申请售后：先算可申请行（入口收窄·最终裁决在云端），再开自绘半屏选 类型/原因/商品（多件单在半屏里点选商品）。
  // 没有可退行（如激活过课程）也照开：「退款」段置灰写原因，换货/补发照常走联系客服——不留死路。
  async onAfterSale() {
    const vm = this.data.vm
    if (!vm) return
    // 该单已申请过的行：按单号向云端只取本单售后（#443）。reload 已并行拉过就复用（不重复请求），没拉到才现拉。
    // 页长仍给 100：旧版云端不认 orderId 时回本人最近 100 条（api 默认 20 会把本单较早的申请截掉），下方按单号筛照样对。
    let list = this._asList
    if (!list) {
      const asRes = await this.withLoading('正在加载', () => getMyAfterSales(undefined, 100, vm.id))
      if (!asRes || this.unloaded) return // 在途重复点 / await 恢复点复核：用户已退出详情页——非钱副作用，静默收尾即可
      if (!asRes.ok) {
        fxHint(this, '售后记录没加载出来，稍后再试') // 失败≠一条都没申请过
        return
      }
      list = this._asList = mapAfterSales(asRes.list)
    }
    const appliedIds = appliedLineIdsOf(list, vm.id) // 已撤回的行不算申请过，可再申请
    const rejIds = rejectedLineIdsOf(list, vm.id) // 被拒维持永久锁（拍板 5）：弹层写清并给客服入口
    this._asOk = applicableLines(vm.status, vm.items, appliedIds).map(asLineOf)
    this._asAll = vm.items.map(asLineOf)
    this._asRejLines = this._asAll.filter((l) => rejIds.includes(l.lineId))
    const asBlock = refundBlock(vm.status, vm.items, appliedIds, rejIds)
    const asLines = asBlock ? this._asAll : this._asOk
    if (!asLines.length) return // 脏单无条目：没东西可选
    const asType = asBlock ? AS_TYPES[1] : AS_TYPES[0]
    this.setData({
      asOpen: true,
      asOut: false,
      asBusy: false,
      asType,
      asReason: AS_REASONS[0],
      asBlock,
      asRej: asBlock === REFUND_REJECTED ? '' : this._asRejLines.map(lineText).join('、'), // 全被拒时置灰原因已说清，不重复点名
      asRejKefu: this._asRejLines.length > 0,
      asLines,
      asLine: asLines[0].lineId,
    })
    this.estimate()
  },
  // 预计退款（拍板 4）：只在「退款」段按所选商品向云端试算（与 applyRefund 同一份算额·前端不算钱）；
  // 在途「计算中…」，失败「预计金额以审核为准」不挡提交。代次防旧回包覆盖。
  estimate() {
    const seq = ++this._estSeq
    const vm = this.data.vm
    if (!vm || this.data.asType !== '退款' || this.data.asBlock || !this.data.asLine) {
      this.setData({ asEst: '' })
      return
    }
    this.setData({ asEst: '计算中…' })
    estimateRefund(vm.id, this.data.asLine)
      .catch(() => null)
      .then((r) => {
        if (seq !== this._estSeq || this.unloaded) return
        const fen = r && r.ok ? Number(r.refundFen) : NaN
        this.setData({ asEst: Number.isInteger(fen) && fen > 0 ? '预计退款 ' + money(fen / 100) : '预计金额以审核为准' })
      })
  },
  // 被拒的行「联系客服」：订单号 + 被拒商品先复制，客服那边直接粘贴
  onAsKefu() {
    const vm = this.data.vm
    if (!vm) return
    const copy = `订单号：${vm.id}\n商品：${this._asRejLines.map(lineText).join('、')}\n售后：退款已被拒绝`
    openCustomerService(copy, () => this.copiedHint())
  },
  onAsType(e: WechatMiniprogram.TouchEvent) {
    const v = String(e.currentTarget.dataset.v)
    if (!AS_TYPES.includes(v)) return
    if (v === '退款' && this.data.asBlock) {
      fxHint(this, this.data.asBlock) // 置灰段点了说原因，不切过去
      return
    }
    const asLines = v === '退款' ? this._asOk : this._asAll
    const asLine = asLines.some((l) => l.lineId === this.data.asLine) ? this.data.asLine : asLines[0].lineId
    this.setData({ asType: v, asLines, asLine })
    this.estimate()
  },
  onAsReason(e: WechatMiniprogram.TouchEvent) {
    const v = String(e.currentTarget.dataset.v)
    if (AS_REASONS.includes(v)) this.setData({ asReason: v })
  },
  onAsLine(e: WechatMiniprogram.TouchEvent) {
    const v = String(e.currentTarget.dataset.v)
    if (!this.data.asLines.some((l) => l.lineId === v) || v === this.data.asLine) return
    this.setData({ asLine: v })
    this.estimate()
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
      // 换货/补发：订单号 + 商品 + 类型原因先复制，客服那边直接粘贴（复制失败不挡打开客服）
      const l = this.data.asLines.find((x) => x.lineId === this.data.asLine)
      const copy = `订单号：${vm.id}\n商品：${l ? lineText(l) : ''}\n售后：${this.data.asType} · ${this.data.asReason}`
      this.onAsClose()
      openCustomerService(copy, () => this.copiedHint())
      return
    }
    if (this.data.asBlock) {
      fxHint(this, this.data.asBlock) // 没有可退行：退款不可提交（最终裁决仍在云端）
      return
    }
    tapHaptic()
    this.setData({ asBusy: true })
    const r = await applyRefund(vm.id, this.data.asLine, this.data.asReason)
    if (this.unloaded) return // await 恢复点复核：申请已真实提交，非钱副作用，静默收尾即可（不再对已退页 toast/导航）
    if (r.ok) {
      // 新售后单先并进本地记录：回到详情时就算这次刷新售后没拉到，也能显示「售后中」
      if (this._asList) this._asList = mergeAfterSales(mapAfterSales([r.afterSale]), this._asList)
      this.setData({ asOpen: false, asOut: false, asBusy: false })
      fxToast(this, '已提交申请') // 紧接着跳售后页：提示由新页接着显示（px-fx 跨页接力）
      navigateOrRedirect('/pages/aftersales/aftersales')
      return
    }
    this.setData({ asBusy: false })
    const e = String(r.error || '')
    const msg = e === 'ALREADY_APPLIED' ? '这条已申请过了' : e === 'NOT_REFUNDABLE' ? '该条目不可退（已开课）' : e === 'NOTHING_LEFT' ? '本单可退额度已用完' : '申请没成功，稍后再试'
    fxHint(this, msg)
  },
})
