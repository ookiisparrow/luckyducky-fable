// 我的售后：列表 + 游标翻页（追加去重·失败不覆盖已有）+ 按住撤回申请中的售后。
import { getMyAfterSales, withdrawRefund } from '../../api/orders'
import { mapAfterSale, mapAfterSales, mergeAfterSales, withdrawErrText, type AfterSaleVM } from '../../lib/mapAftersales'
import { openCustomerService } from '../../utils/customerService'
import { navigateOrRedirect } from '../../lib/nav'
import { keyDown, keyUp } from '../../lib/keyFx'
import { tapHaptic } from '../../lib/haptics'
import { fxHint, fxLoaded, fxLoading, fxToast } from '../../lib/pxFx'
import { createHold, type Hold } from '../../lib/hold'
import { groundGap } from '../../lib/ground'

const HOLD_MS = 700 // 按住多久算撤回（同订单页按住取消·设计稿 data-ms=700）
let hold: Hold | null = null

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    groundGap: groundGap(), // 地面线上方留白（屏高<700 用 56·UI 审查 6 问 2a）
    list: [] as AfterSaleVM[],
    loading: true,
    loadFailed: false, // 失败≠空态（根因#14·守卫 rw-mp-list-loadfailed-state）：与「还没有售后记录」分治
    hasMore: false,
    cursor: null as unknown,
    paging: false, // 触底翻页在途（底部像素 loader 行·同时挡重复触底）
    holdId: '', // 正在按住撤回的售后 id（驱动键内红色进度条）
  },
  _seq: 0, // reload 代次（同 order-list 范式）：onShow 多次触发（如售后详情返回）并发时丢弃过期回包
  _busy: false, // 撤回在途锁：重复触发直接丢
  unloaded: false, // 页面已退出：撤回迟到回包不再提示/刷新
  onShow() {
    void this.reload()
  },
  onHide() {
    hold?.cancel()
  },
  onUnload() {
    this.unloaded = true
    hold?.cancel()
  },
  async reload() {
    const seq = ++this._seq
    const r = await getMyAfterSales()
    if (seq !== this._seq) return // 过期回包（被更晚 reload 取代）：丢弃
    if (!r.ok) {
      // 失败不覆盖已有数据；首载一无所有时落 loadFailed 给重试，不与「还没有售后记录」混同（根因#14）。
      this.setData({ loading: false, loadFailed: !this.data.list.length })
      if (this.data.list.length) fxHint(this, '刷新失败，请稍后重试')
      return
    }
    this.setData({ loading: false, loadFailed: false, list: mapAfterSales(r.list), cursor: r.nextCursor, hasMore: !!r.hasMore })
  },
  onRetryLoad() {
    this.setData({ loading: true, loadFailed: false })
    void this.reload()
  },
  async onReachBottom() {
    if (!this.data.hasMore || this.data.cursor == null || this.data.paging) return // 在途重复触底：丢弃
    const seq = this._seq // 捕获当前代次（翻页不 bump）：期间若发生 reload（_seq 递增）则本次 append 作废
    this.setData({ paging: true })
    const r = await getMyAfterSales(this.data.cursor)
    this.setData({ paging: false })
    if (seq !== this._seq) return // reload 已取代当前列表：丢弃·不错配游标（失败的过期回包也静默丢弃，不误弹 toast）
    if (!r.ok) {
      fxHint(this, '加载失败，上拉重试') // 翻页失败不静默（根因#14）
      return
    }
    this.setData({ list: mergeAfterSales(this.data.list, mapAfterSales(r.list)), cursor: r.nextCursor, hasMore: !!r.hasMore })
  },
  // 撤回申请（破坏性·按住 700ms 才撤，轻点提示；按下带触点坐标、挪开超 10px 作废——顺势滑列表不误撤·lib/hold）
  onWithdrawStart(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.i)
    const a = this.data.list[i]
    if (!a || !a.canWithdraw) return
    const t = e.touches && e.touches[0]
    hold?.cancel()
    hold = createHold(HOLD_MS, () => void this.withdrawNow(i), {
      onQuick: () => fxHint(this, '按住撤回申请'),
      onChange: (v) => this.setData({ holdId: v ? a.id : '' }),
    })
    hold.start(t ? t.clientX : undefined, t ? t.clientY : undefined)
  },
  onWithdrawMove(e: WechatMiniprogram.TouchEvent) {
    const t = e.touches && e.touches[0]
    if (t) hold?.move(t.clientX, t.clientY)
  },
  onWithdrawEnd() {
    hold?.end()
  },
  async withdrawNow(i: number) {
    const a = this.data.list[i]
    if (!a || !a.canWithdraw || this._busy) return
    this._busy = true
    tapHaptic()
    fxLoading(this, '正在撤回')
    let r
    try {
      r = await withdrawRefund(a.orderId, a.lineId)
    } finally {
      fxLoaded(this)
      this._busy = false
    }
    if (this.unloaded) return
    if (r.ok) {
      // 先就地换成「已撤回」（整表刷新没拉到也不回显申请中），再整表刷新
      const next = mapAfterSale(r.afterSale)
      if (next) this.setData({ list: this.data.list.map((x) => (x.id === next.id ? next : x)) })
      fxToast(this, '已撤回')
    } else fxHint(this, withdrawErrText(r.error)) // 没抢过商家等：刷新看最新状态
    await this.reload()
  },
  onTapOrder(e: WechatMiniprogram.TouchEvent) {
    navigateOrRedirect('/pages/order/order?id=' + String(e.currentTarget.dataset.id))
  },
  onKefu() {
    openCustomerService()
  },
})
