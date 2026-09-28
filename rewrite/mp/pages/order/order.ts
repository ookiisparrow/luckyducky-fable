// 订单详情：状态横幅/条目/地址/金额明细/操作（续付·确认收货·申请售后）。
import { tapHaptic } from '../../lib/haptics'
import { getOrderById, pay, confirmReceive, cancelOrder, applyRefund, getMyAfterSales } from '../../api/orders'
import { mapPayResult } from '../../lib/payFlow'
import { mapOrder, orderSteps, type OrderVM, type StepState } from '../../lib/mapOrders'
import { applicableLines, mapAfterSales } from '../../lib/mapAftersales'
import { expressCode } from '../../lib/express'
import { navigateOrRedirect, goBackOrHome } from '../../lib/nav'
import { keyDown, keyUp } from '../../lib/keyFx'
import { fxToast } from '../../lib/pxFx'

// 状态横幅配置（纯展示派生·icon/tint/文案随订单态·不含业务判定）。
interface BannerVM {
  icon: string
  tint: string
  head: string
  sub: string
}
const BANNER: Record<string, BannerVM> = {
  pending: { icon: 'wallet', tint: 'lilac', head: '等待付款', sub: '请尽快完成支付，超时订单将自动取消' },
  paid: { icon: 'package', tint: 'lilac', head: '已付款，等待商家发货', sub: '商家将于 48 小时内为你打包发出' },
  shipped: { icon: 'truck', tint: 'lilac', head: '商家已发货，包裹运送中', sub: '请注意查收，确认收货前请先验货' },
  done: { icon: 'badge-check', tint: 'sage', head: '交易已完成', sub: '期待你钩出的小鸭，欢迎来晒图~' },
  closed: { icon: 'info', tint: 'muted', head: '订单已关闭', sub: '订单已取消或超时未支付' },
  // PAID_BUT_OOS 死信（已付但缺货·待人工退款）：客户没申请过退款、商家也没在自动处理——诚实描述需人工介入，
  // 不承诺不存在的自动化流程（与 admin 标签「待退款」同口径，见 admin/src/lib/format.ts）。
  refund_required: { icon: 'wallet', tint: 'lilac', head: '待退款', sub: '该订单需人工处理退款，请联系客服协助处理' },
  payment_exception: { icon: 'info', tint: 'muted', head: '支付异常，待人工处理', sub: '到账金额与订单金额不一致，请联系客服处理退款' },
}

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    loading: true,
    loadFailed: false, // 失败≠不存在（根因#14·守卫 rw-mp-list-loadfailed-state）：刚付款用户弱网打开不该看到「订单不存在」
    vm: null as OrderVM | null,
    banner: null as BannerVM | null,
    amountNum: '',
    canAfterSale: false,
    paying: false, // 继续支付在途（锁 + 按钮 dim）：pay 往返最长 12s，连点会重复发 pay、重复拉起收银台
    steps: [] as Array<{ label: string; state: StepState }>, // 进度四步（v5·纯展示派生）
    truckPose: 'park', // 小货车姿态随订单态：已发货在路上、完成卸货，其余停着（纯展示）
    cargo: 0,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.orderId = String(query.id || '')
  },
  orderId: '',
  _seq: 0, // reload 代次·丢弃过期回包（onShow/取消/支付/确认收货多触发点并发·慢回包别把横幅盖回过期态）
  unloaded: false, // 页面已退出标记（同 checkout/review 范式）：onPay/onAfterSale 回包在途用户退出详情页，迟到回包不再对已退页 toast/reload/导航
  onUnload() {
    this.unloaded = true
  },
  onShow() {
    void this.reload()
  },
  async reload() {
    // 订单状态/钱路径页：多 reload 触发点（onShow + 取消/支付/确认收货各自 reload）并发时，慢回包迟到落地会把
    // 横幅盖回过期态（如取消成功已 closed 又被在途 onShow 的 pending 盖回·重现取消/支付按钮）。代次不符即丢弃。
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
    const banner = vm ? BANNER[vm.status] || { icon: 'info', tint: 'muted', head: vm.statusLabel, sub: '' } : null
    const amountNum = vm ? (vm.amountLabel || '').replace(/[^0-9.]/g, '') : ''
    const canAfterSale = !!vm && ['paid', 'shipped', 'done'].includes(vm.status)
    const steps = vm ? orderSteps(vm.status) : []
    const truckPose = vm && vm.status === 'shipped' ? 'drive' : vm && vm.status === 'done' ? 'unload' : 'park'
    const cargo = vm && vm.status !== 'closed' ? Math.min(3, vm.items.length) : 0
    this.setData({ loading: false, loadFailed: false, vm, banner, amountNum, canAfterSale, steps, truckPose, cargo })
  },
  // 底部「返回」键（v5 底部操作区首位）：深链进来没上一页时回首页
  onBack() {
    goBackOrHome()
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
  // 查看物流：快递100 插件结果页（同 AppID 已授权·app.json 声明即用）。插件打不开（未安装/版本不匹配等）
  // 不静默——回退复制运单号语义，用户仍能拿到号码自行查（根因#14 可观测·fail-soft 不裸吞）。
  onViewLogistics() {
    const vm = this.data.vm
    const no = vm && vm.trackingNo
    if (!no) return
    const com = expressCode(vm!.shipCompany)
    const url = 'plugin://kuaidi100/index?num=' + no + '&appName=' + encodeURIComponent('小棉鸭') + (com ? '&com=' + com : '')
    wx.navigateTo({
      url,
      fail: () => this.onCopyTracking(),
    })
  },
  // 取消待支付单（破坏性·二次确认；仅 pending 出此入口·最终裁决在云端）
  onCancel() {
    const vm = this.data.vm
    if (!vm || vm.status !== 'pending') return
    wx.showModal({
      title: '取消订单',
      content: '确定取消这笔待支付订单吗？取消后不可恢复。',
      success: async (res) => {
        if (!res.confirm) return
        const r = await cancelOrder(this.orderId)
        if (this.unloaded) return // await 恢复点复核：用户已退出详情页——非钱副作用，静默收尾即可
        wx.showToast({ title: r.ok ? '订单已取消' : '取消没成功，稍后再试', icon: r.ok ? 'success' : 'none' })
        void this.reload() // 横幅按映射自动翻 closed
      },
    })
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
    const { lineid, name } = e.currentTarget.dataset as { lineid: string; name: string }
    // lineId 与 name 同一往返约定：编码/解码成对（review.ts onLoad 对应 decodeURIComponent）——
    // lineId 未编码时若含 URL 保留字符（如 productId 里的 &/#）会截断查询串。
    wx.navigateTo({ url: `/pages/review/review?orderId=${this.orderId}&lineId=${encodeURIComponent(lineid || '')}&name=${encodeURIComponent(name || '')}` })
  },
  async onAfterSale() {
    const vm = this.data.vm
    if (!vm) return
    // 该单已申请过的行（入口收窄·最终裁决在云端）：从我的售后里筛本单。云端按申请时间倒序截断，
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
    const label = (l: (typeof eligible)[number]) => `${l.name}${l.spec ? '（' + l.spec + '）' : ''}`
    // wx.showActionSheet 一屏最多 6 项：放不下时每屏 5 行 + 「更多…」翻下一屏，保证每一行都选得到
    const pick = (start: number) => {
      const paged = eligible.length - start > 6
      const page = eligible.slice(start, paged ? start + 5 : undefined)
      wx.showActionSheet({
        itemList: page.map(label).concat(paged ? ['更多…'] : []),
        success: (res) => (res.tapIndex < page.length ? this.applyFor(vm.id, page[res.tapIndex].lineId) : pick(start + 5)),
      })
    }
    pick(0)
  },
  applyFor(orderId: string, lineId: string) {
    wx.showModal({
      title: '申请退款',
      editable: true,
      placeholderText: '退款原因（选填）',
      success: async (m) => {
        if (!m.confirm) return
        const r = await applyRefund(orderId, lineId, String(m.content || ''))
        if (this.unloaded) return // await 恢复点复核：用户已退出详情页——申请已真实提交，非钱副作用，静默收尾即可（不再对已退页 toast/导航）
        if (r.ok) {
          wx.showToast({ title: '已提交申请', icon: 'success' }) // 紧接着跳售后页：原生提示跨页不断
          navigateOrRedirect('/pages/aftersales/aftersales')
        } else {
          const e = String(r.error || '')
          const msg = e === 'ALREADY_APPLIED' ? '这条已申请过了' : e === 'NOT_REFUNDABLE' ? '该条目不可退（已开课）' : e === 'NOTHING_LEFT' ? '本单可退额度已用完' : '申请没成功，稍后再试'
          wx.showToast({ title: msg, icon: 'none' })
        }
      },
    })
  },
})
