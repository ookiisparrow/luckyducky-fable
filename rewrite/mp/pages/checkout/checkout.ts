// 结算页（M2 批5·批6 接收银）：地址 + 条目预览 + 搭配购 + 金额明细 + 提交订单 + 拉起支付。
// 提交经 app 网关 createOrder（云端定价/校验/预留库存·不信前端）；支付参数经 mapPayResult fail-closed。
import { tapHaptic } from '../../lib/haptics'
import { trackEvent } from '../../api/learning'
import * as addr from '../../lib/address'
import * as checkout from '../../lib/checkout'
import { CHECKOUT_ADDONS } from '../../lib/checkoutConst'
import { createOrder, pay } from '../../api/orders'
import { mapPayResult } from '../../lib/payFlow'
import { freshCover } from '../../lib/cart'
import { getAllProducts } from '../../lib/catalog'
import { goHomeTab } from '../../lib/homeIntent'

Page({
  data: {
    address: null as ReturnType<typeof addr.defaultAddress>,
    items: [] as Array<checkout.DraftLine & { priceNum: string }>,
    addons: CHECKOUT_ADDONS.map((a) => ({ ...a, added: false, priceNum: a.price.toFixed(2) })),
    goodsLabel: '',
    shipLabel: '',
    couponLabel: '',
    amountNum: '', // 实付金额数字（无符号·底坞/明细大字用；金额单源仍在云端/summaryFen）
    count: 0, // 合计件数（草稿含已勾搭配购·底坞展示）
    submitting: false,
  },
  backTimer: null as ReturnType<typeof setTimeout> | null,
  unloaded: false, // 页面已退出标记（守卫扩面统一不变量·同 review/profile-edit/feedback 范式）：本页 backTimer 赋值落在
  // armBackTimer 方法内唯一的同步路径（无 await）——守卫按「无 await 同步路径」判，赋值前任意位置的 this.unloaded 检查即满足。
  ready: false, // onReady 是否已触发（页面转场是否落地的近似信号·2026-07-24 调试日志 S 案）：见 armBackTimer 起表纪律。
  pendingBackTimer: false, // refresh() 在 onReady 之前检测到空草稿——先记待办，onReady 触发后补起计时（见 onReady）。
  onUnload() {
    this.unloaded = true
    if (this.backTimer) clearTimeout(this.backTimer) // 空车延时返回坞清理（守卫 rw-mp-navback-timer-cleaned）
  },
  onReady() {
    this.ready = true
    if (this.pendingBackTimer) {
      this.pendingBackTimer = false
      this.armBackTimer()
    }
  },
  onShow() {
    // onShow 而非 onLoad：从地址列表/编辑页返回时刷新选中地址
    void this.refresh()
  },
  // 600ms 空草稿自动返回起表纪律（2026-07-24 调试日志 S 案）：navigateBack 若打在前向转场未落地的窗口内（冷启动
  // 转场实测可迟至 ~800ms），开发者工具 Nightly≥2.02.2607232 的模拟器导航状态机会死锁（真机同族竞态未必死锁，
  // 但会退化为「返回被吞·空结算页多停留」）。onReady 只在页面自身渲染就绪后触发一次，天然晚于 onShow，用它当
  // 「转场大概率已落地」的近似信号——ready 前检测到空草稿只记 pendingBackTimer，onReady 触发后再起 600ms 计时；
  // ready 已是 true（如从地址页返回，onReady 早已触发过）则照旧立即起表。600ms「可读时长」语义不变，toast 立即弹出。
  armBackTimer() {
    if (this.unloaded) return // pendingBackTimer 补起时也需复核（守卫 rw-mp-navback-timer-cleaned·同步路径任意位置皆可）
    if (this.backTimer) clearTimeout(this.backTimer)
    this.backTimer = setTimeout(() => wx.navigateBack(), 600)
  },
  async refresh() {
    if (this.data.submitting) return // 提交在途不刷：草稿已被 finishSubmitted 清空·支付中后台返回触发 onShow→refresh 会误报「购物车空」+ navigateBack 弹掉支付中的本页（第3轮审计·与 onPickAddress/onToggleAddon 同闸）
    if (!checkout.getDraft().items.length) {
      if (this.unloaded) return // 页面已退出（守卫扩面统一不变量）：不再对下一页 navigateBack
      wx.showToast({ title: '还没有要结算的商品', icon: 'none' })
      if (this.ready) this.armBackTimer()
      else this.pendingBackTimer = true
      return
    }
    // 封面时效兜底（P2·bug sweep Round2 item5·同 cart.ts freshCover 已修根因病根#15 兄弟路径）：草稿里的 cover 可能是
    // 结算前很久（购物车页/详情页）快照下的持久化临时址（约 2h 时效），到本页展示时可能已过期挂图；
    // allRaw 命中会话缓存零云调用（miss 兜底重拉一次，同 cart.ts onLoad 写法）。
    const allRaw = (await getAllProducts()) || []
    if (this.data.submitting || this.unloaded) return // 恢复点复核（Round3 item2）：await 期间用户提交（finishSubmitted 清空草稿）或页面已退出，禁止用陈旧/空草稿渲染
    // draft 挪到 await 之后再读（P2·bug sweep Round2 复审补漏）：与 summaryFen() 取同一时刻的快照——
    // 若挪前面读、await 期间又触发 onToggleAddon（改了 draftItems），items/addons 用旧 draft 渲染却和用
    // 当下 draftItems 算出的 s（总价/搭配购总额）拼进同一次 setData，画面出现「未勾选却已计入总价」的错位。
    const draft = checkout.getDraft()
    const s = checkout.summaryFen()
    this.setData({
      address: addr.defaultAddress(),
      items: draft.items.map((l) => ({ ...l, cover: freshCover(l, allRaw), priceNum: l.price.toFixed(2) })), // 结算页两位小数（财务口径）
      addons: CHECKOUT_ADDONS.map((a) => ({ ...a, added: draft.items.some((l) => l.id === a.id), priceNum: a.price.toFixed(2) })),
      goodsLabel: checkout.fenLabel(s.goodsFen),
      shipLabel: s.shipFen ? checkout.fenLabel(s.shipFen) : '包邮',
      couponLabel: '-' + checkout.fenLabel(s.couponFen),
      amountNum: (s.amountFen / 100).toFixed(2),
      count: draft.items.reduce((n, l) => n + l.qty, 0),
    })
  },
  onPickAddress() {
    if (this.data.submitting) return // 提交在途禁止跳地址页：否则地址页压栈后·下单成功的 redirectTo/switchTab 打到栈顶地址页、劫持返回
    wx.navigateTo({ url: '/pages/address/address?pick=1' })
  },
  onToggleAddon(e: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) return // 提交在途禁止改搭配购：否则下单用 await 前草稿快照·成功页金额 await 后重算，二者分叉展示不一致
    checkout.toggleAddon(String(e.currentTarget.dataset.id))
    void this.refresh()
  },
  async onSubmit() {
    if (this.data.submitting) return
    const a = this.data.address
    if (!a) {
      wx.showToast({ title: '请先添加收货地址', icon: 'none' })
      return
    }
    tapHaptic()
    const draft = checkout.getDraft()
    trackEvent('order_submit', 'checkout', '', { count: draft.items.reduce((n, l) => n + l.qty, 0), amountFen: checkout.summaryFen().amountFen }) // 电商漏斗埋点（R41）
    this.setData({ submitting: true })
    const r = await createOrder(
      draft.items.map((l) => ({ id: l.id, sku: l.sku, qty: l.qty })),
      { name: a.name, phone: a.phone, region: a.region, detail: a.detail },
      checkout.getIdemKey() // 同一草稿的重试复用同一个键（网络超时重试不重复建单·批E）
    )
    // 建单请求在途用户手动退出结算页（同 refresh() unloaded 范式）：不再对无关页面 setData/toast/redirectTo/
    // requestPayment（真实支付授权框）/switchTab——建单失败且已退页直接收尾；建单成功则订单已真实生成，
    // 草稿必须消费、购物车必须扣（不因页面退出而漏账），只留轻提示、不再导航。
    if (this.unloaded) {
      if (!r.ok) return
      checkout.finishSubmitted() // 已退页不进成功页·金额无消费方不再算（评审 P3：不留丢弃返回值的死调用）
      wx.showToast({ title: '订单已生成，可到订单列表继续支付', icon: 'none' })
      return
    }
    if (!r.ok) {
      // 云端拒单如实反馈（缺货/停售/配置缺失等·不吞错）——唯一留在本页的路径·此处才解锁重试
      this.setData({ submitting: false })
      wx.showToast({ title: checkout.mapCreateOrderError(String(r.error || '')), icon: 'none' })
      return
    }
    // 建单成功后每条后续路径都会离开结算页（redirectTo 成功页 / startPay 内 requestPayment 成功→成功页、取消/失败→switchTab 首页），
    // submitting 保持锁定不复位——防「支付发起期间草稿已被 finishSubmitted 清空、第二次点击绕过守卫再 createOrder」（病根#1 双提交）。
    // 成功页金额用回包权威值（order.amount）：前端 summaryFen 是本地估算，缺货重试/搭配购变化等场景可能与云端现算分叉；
    // 回包缺失才回退前端自算值（防御，正常必有）——透传成功页展示用（bug sweep R1 #1）。
    const fallbackFen = checkout.summaryFen().amountFen // 捕获前端估算分（finishSubmitted 消费草稿前）·仅作回退兜底
    const amountFen = checkout.resolveOrderAmountFen(r.order, fallbackFen)
    checkout.finishSubmitted() // 购物车按实际提交数量精确扣
    const order = (r.order || {}) as Record<string, any>
    trackEvent('order_success', 'checkout', String(order.id || ''), { amountFen }) // 电商漏斗埋点（R41）
    if (order.status === 'paid') {
      // mock 模式建单即付（开发环境）——直接进成功页
      wx.redirectTo({ url: '/pages/paysuccess/paysuccess?id=' + order.id + '&amount=' + amountFen })
      return
    }
    await this.startPay(String(order.id || ''), amountFen)
  },
  async startPay(orderId: string, amountFen: number) {
    const outcome = mapPayResult(await pay(orderId))
    // 拉起支付请求在途用户手动退出结算页：不再对无关页面 redirectTo/requestPayment（真实支付授权框）/showModal
    // （同 onSubmit 建单分支范式）——订单已建，轻提示即可，导航/授权框留给用户主动回到订单列表时发起。
    if (this.unloaded) {
      wx.showToast({ title: '订单已生成，可到订单列表继续支付', icon: 'none' })
      return
    }
    if (outcome.kind === 'paid') {
      wx.redirectTo({ url: '/pages/paysuccess/paysuccess?id=' + orderId + '&amount=' + amountFen })
      return
    }
    if (outcome.kind === 'request') {
      wx.requestPayment({
        ...outcome.payment,
        success: () => wx.redirectTo({ url: '/pages/paysuccess/paysuccess?id=' + orderId + '&amount=' + amountFen }),
        fail: (res) => {
          // 取消/失败：订单保留待支付（支付窗口内可续付·订单列表/详情页已上线，见 me.ts:57 入口）
          const cancelled = String(res.errMsg || '').includes('cancel')
          wx.showModal({
            title: cancelled ? '支付已取消' : '支付没成功',
            content: '订单已保留，超时前都可以继续支付。可到「我的-我的订单」继续支付。',
            showCancel: false,
            // 回首页从头逛起：防 tab 实例旧滚动位置残留（收敛见 lib/homeIntent.ts）
            success: () => goHomeTab(),
          })
        },
      })
      return
    }
    wx.showModal({
      title: outcome.kind === 'closed' ? '订单已关闭' : '支付没成功',
      content: outcome.message,
      showCancel: false,
      // 回首页从头逛起：防 tab 实例旧滚动位置残留（收敛见 lib/homeIntent.ts）
      success: () => goHomeTab(),
    })
  },
})
