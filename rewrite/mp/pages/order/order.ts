// 订单详情（M2 批7·批8 接售后）：状态横幅/条目/地址/金额明细/操作（续付·确认收货·申请售后）。
import { getOrderById, pay, confirmReceive, cancelOrder, applyRefund, getMyAfterSales } from '../../api/orders'
import { mapPayResult } from '../../lib/payFlow'
import { mapOrder, type OrderVM } from '../../lib/mapOrders'
import { applicableLines, mapAfterSales } from '../../lib/mapAftersales'
import { expressCode } from '../../lib/express'

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
  refund_required: { icon: 'wallet', tint: 'lilac', head: '退款处理中', sub: '商家正在处理你的退款申请，请耐心等待' },
}

Page({
  data: {
    loading: true,
    missing: false,
    vm: null as OrderVM | null,
    banner: null as BannerVM | null,
    amountNum: '',
    canAfterSale: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.orderId = String(query.id || '')
  },
  orderId: '',
  _seq: 0, // reload 代次·丢弃过期回包（onShow/取消/支付/确认收货多触发点并发·慢回包别把横幅盖回过期态）
  onShow() {
    void this.reload()
  },
  async reload() {
    // 订单状态/钱路径页：多 reload 触发点（onShow + 取消/支付/确认收货各自 reload）并发时，慢回包迟到落地会把
    // 横幅盖回过期态（如取消成功已 closed 又被在途 onShow 的 pending 盖回·重现取消/支付按钮）。代次不符即丢弃。
    const seq = ++this._seq
    const r = await getOrderById(this.orderId)
    if (seq !== this._seq) return
    const vm = r.ok ? mapOrder(r.order) : null
    const banner = vm ? BANNER[vm.status] || { icon: 'info', tint: 'muted', head: vm.statusLabel, sub: '' } : null
    const amountNum = vm ? (vm.amountLabel || '').replace(/[^0-9.]/g, '') : ''
    const canAfterSale = !!vm && ['paid', 'shipped', 'done'].includes(vm.status)
    this.setData({ loading: false, missing: !vm, vm, banner, amountNum, canAfterSale })
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
        wx.showToast({ title: r.ok ? '订单已取消' : '取消没成功，稍后再试', icon: r.ok ? 'success' : 'none' })
        void this.reload() // 横幅按映射自动翻 closed
      },
    })
  },
  async onPay() {
    const outcome = mapPayResult(await pay(this.orderId))
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
        fail: () => void this.reload(),
      })
      return
    }
    wx.showToast({ title: outcome.message, icon: 'none' })
    void this.reload()
  },
  onConfirm() {
    wx.showModal({
      title: '确认收货',
      content: '确认已收到宝贝了吗？',
      success: async (res) => {
        if (!res.confirm) return
        const r = await confirmReceive(this.orderId)
        wx.showToast({ title: r.ok ? '已确认收货' : '操作没成功，稍后再试', icon: r.ok ? 'success' : 'none' })
        void this.reload()
      },
    })
  },
  onWriteReview(e: WechatMiniprogram.TouchEvent) {
    const { lineid, name } = e.currentTarget.dataset as { lineid: string; name: string }
    wx.navigateTo({ url: `/pages/review/review?orderId=${this.orderId}&lineId=${lineid}&name=${encodeURIComponent(name || '')}` })
  },
  async onAfterSale() {
    const vm = this.data.vm
    if (!vm) return
    // 该单已申请过的行（入口收窄·最终裁决在云端）：从我的售后里筛本单
    const asRes = await getMyAfterSales()
    const appliedIds = asRes.ok ? mapAfterSales(asRes.list).filter((a) => a.orderId === vm.id).map((a) => a.lineId) : []
    const eligible = applicableLines(vm.status, vm.items, appliedIds)
    if (!eligible.length) {
      wx.showToast({ title: '没有可申请售后的条目', icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: eligible.slice(0, 6).map((l) => `${l.name}${l.spec ? '（' + l.spec + '）' : ''}`),
      success: (res) => {
        const line = eligible[res.tapIndex]
        wx.showModal({
          title: '申请退款',
          editable: true,
          placeholderText: '退款原因（选填）',
          success: async (m) => {
            if (!m.confirm) return
            const r = await applyRefund(vm.id, line.lineId, String(m.content || ''))
            if (r.ok) {
              wx.showToast({ title: '已提交申请', icon: 'success' })
              wx.navigateTo({ url: '/pages/aftersales/aftersales' })
            } else {
              const e = String(r.error || '')
              const msg = e === 'ALREADY_APPLIED' ? '这条已申请过了' : e === 'NOT_REFUNDABLE' ? '该条目不可退（已开课）' : e === 'NOTHING_LEFT' ? '本单可退额度已用完' : '申请没成功，稍后再试'
              wx.showToast({ title: msg, icon: 'none' })
            }
          },
        })
      },
    })
  },
})
