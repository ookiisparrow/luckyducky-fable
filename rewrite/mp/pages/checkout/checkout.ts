// 结算页：地址 + 条目预览 + 搭配购 + 金额明细 + 提交订单 + 拉起支付。
// 提交经 app 网关 createOrder（云端定价/校验/预留库存·不信前端）；支付参数经 mapPayResult fail-closed。
import { tapHaptic } from '../../lib/haptics'
import { trackEvent } from '../../api/learning'
import * as addr from '../../lib/address'
import * as checkout from '../../lib/checkout'
import { createOrder, pay } from '../../api/orders'
import { mapPayResult } from '../../lib/payFlow'
import { freshCover } from '../../lib/cart'
import { getAllProducts } from '../../lib/catalog'
import { goHomeTab } from '../../lib/homeIntent'
import { keyDown, keyUp } from '../../lib/keyFx'
import { fxHint } from '../../lib/pxFx'
import { groundGap } from '../../lib/ground'

const SUBMITTED_MS = 600 // 设计稿 submitOrder：建单成功后按键打勾「已提交」停 600ms 再拉起支付
// 取消支付提示（老板拍板 4·设计稿 payClose）。15 分钟＝云端付款时限 shared PAY_WINDOW_MS（小程序进不了 shared，
// 手抄一份；u-mp-checkout-pay.test 读云端源码对数，改一边那里就红）
const PAY_CANCEL_TIP = '订单已保存，请在 15 分钟内支付'
// 已退页/订单已生成时的去处指引（文案口径：订单入口说「我 → 我的订单」）
const ORDER_KEPT_TIP = '订单已生成，可到「我 → 我的订单」继续支付'

type Addr = NonNullable<ReturnType<typeof addr.defaultAddress>>
/** 地址卡展示（设计稿 co.who / co.where）：姓名 · 打码手机号一行；省市区去空格直接接详址。下单仍用原始字段。 */
const view = (a: Addr) => ({ ...a, who: a.name + ' · ' + addr.maskPhone(a.phone), where: a.region.replace(/ /g, '') + a.detail })

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    groundGap: groundGap(), // 地面线上方留白（屏高<700 用 56·UI 审查 6 问 2a）
    address: null as (Addr & { who: string; where: string }) | null,
    items: [] as Array<checkout.DraftLine & { priceNum: string; step: boolean; canDec: boolean; canInc: boolean }>,
    addons: checkout.sellableAddons().map((a) => ({ ...a, added: false, priceNum: a.price.toFixed(2) })),
    goodsLabel: '',
    shipLabel: '',
    amountNum: '', // 实付金额数字（无符号·底坞/明细大字用；金额单源仍在云端/summaryFen）
    count: 0, // 合计件数（草稿含已勾搭配购·底坞展示）
    submitting: false,
    submitted: false, // 建单成功：按键打勾「已提交」（拉起支付前的 600ms 展示·锁仍由 submitting 管）
    paying: false, // 调支付参数在途：按键转圈「正在拉起支付」（只是展示·锁仍由 submitting 管）
    cargo: 0, // 小货车车斗箱数（商品行数·最多 3）
  },
  backTimer: null as ReturnType<typeof setTimeout> | null,
  unloaded: false, // 页面已退出标记（守卫扩面统一不变量·同 review/profile-edit/feedback 范式）：本页 backTimer 赋值落在
  // armBackTimer 方法内唯一的同步路径（无 await）——守卫按「无 await 同步路径」判，赋值前任意位置的 this.unloaded 检查即满足。
  ready: false, // onReady 是否已触发（页面转场是否落地的近似信号）：见 armBackTimer 起表纪律。
  pendingBackTimer: false, // refresh() 在 onReady 之前检测到空草稿——先记待办，onReady 触发后补起计时（见 onReady）。
  onUnload() {
    this.unloaded = true
    if (this.backTimer) clearTimeout(this.backTimer) // 空车延时返回坞清理
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
  // 600ms 空草稿自动返回起表纪律：navigateBack 若打在前向转场未落地的窗口内（冷启动
  // 转场实测可迟至 ~800ms），开发者工具 Nightly≥2.02.2607232 的模拟器导航状态机会死锁（真机同族竞态未必死锁，
  // 但会退化为「返回被吞·空结算页多停留」）。onReady 只在页面自身渲染就绪后触发一次，天然晚于 onShow，用它当
  // 「转场大概率已落地」的近似信号——ready 前检测到空草稿只记 pendingBackTimer，onReady 触发后再起 600ms 计时；
  // ready 已是 true（如从地址页返回，onReady 早已触发过）则照旧立即起表。600ms「可读时长」语义不变，toast 立即弹出。
  armBackTimer() {
    if (this.unloaded) return // pendingBackTimer 补起时也需复核（同步路径任意位置皆可）
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
    // 封面时效兜底（同 lib/cart freshCover·病根#15）：草稿里的 cover 可能是
    // 结算前很久（购物车页/详情页）快照下的持久化临时址（约 2h 时效），到本页展示时可能已过期挂图；
    // allRaw 命中会话缓存零云调用（miss 兜底重拉一次，同 cart.ts onLoad 写法）。
    // 默认地址是同步本地读：先上屏，不等 await——否则首帧先闪黄灯「添加收货地址」（UI 审查 2026-09-29）。
    // 商品行/金额仍等最新价再渲染：宁可短暂留空，也不在付款页先显旧价再跳金额。
    const a0 = addr.defaultAddress()
    this.setData({ address: a0 && view(a0) })
    const allRaw = (await getAllProducts()) || []
    if (this.data.submitting || this.unloaded) return // 恢复点复核：await 期间用户提交（finishSubmitted 清空草稿）或页面已退出，禁止用陈旧/空草稿渲染
    // 草稿里是加购/进页时的价，云端按现价扣：按最新商品档覆盖后再算应付（不在货架的行不动，提交时云端拒单点名移出）
    if (checkout.syncDraftPrices(allRaw)) fxHint(this, '价格有变动，已按最新价计算')
    // draft 在 await 之后读：与 summaryFen() 取同一时刻的快照——
    // 若在前面读、await 期间又触发 onToggleAddon（改了 draftItems），items/addons 用旧 draft 渲染却和用
    // 当下 draftItems 算出的 s（总价/搭配购总额）拼进同一次 setData，画面出现「未勾选却已计入总价」的错位。
    const draft = checkout.getDraft()
    const s = checkout.summaryFen()
    const a = addr.defaultAddress()
    this.setData({
      address: a && view(a),
      // 结算页两位小数（财务口径）；step＝显示 −/+（搭配购恒 1 件不显示），canDec/canInc＝到头的键置灰
      items: draft.items.map((l) => ({
        ...l,
        cover: freshCover(l, allRaw),
        priceNum: l.price.toFixed(2),
        step: !checkout.isAddon(l.id),
        canDec: l.qty > 1,
        canInc: l.qty < checkout.MAX_QTY,
      })),
      cargo: Math.min(3, draft.items.length),
      addons: checkout.sellableAddons().map((a) => ({ ...a, added: draft.items.some((l) => l.id === a.id), priceNum: a.price.toFixed(2) })),
      goodsLabel: checkout.fenLabel(s.goodsFen),
      shipLabel: s.shipFen ? checkout.fenLabel(s.shipFen) : '包邮',
      amountNum: (s.amountFen / 100).toFixed(2),
      count: draft.items.reduce((n, l) => n + l.qty, 0),
    })
  },
  onPickAddress() {
    if (this.data.submitting) return // 提交在途禁止跳地址页：否则地址页压栈后·下单成功的 redirectTo/switchTab 打到栈顶地址页、劫持返回
    // 地址簿空：直接进新增页（pick=1＝存完设默认、退 1 页回本页）；有地址进选址列表
    wx.navigateTo({ url: this.data.address ? '/pages/address/address?pick=1' : '/pages/address-edit/address-edit?pick=1' })
  },
  onToggleAddon(e: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) return // 提交在途禁止改搭配购：否则下单用 await 前草稿快照·成功页金额 await 后重算，二者分叉展示不一致
    checkout.toggleAddon(String(e.currentTarget.dataset.id))
    void this.refresh()
  },
  // 改数量（老板拍板 9）：只改本次草稿、不回写购物车；应付随之重算（展示用·最终以云端为准）。
  // 提交在途禁改：否则下单用的是 await 前的草稿快照，画面上的数量/应付与真正下的单对不上（同 onToggleAddon 闸）
  onQtyInc(e: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) return
    if (checkout.bumpQty(String(e.currentTarget.dataset.line), 1)) void this.refresh()
  },
  onQtyDec(e: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) return
    if (checkout.bumpQty(String(e.currentTarget.dataset.line), -1)) void this.refresh()
  },
  // 协议小字（老板拍板 10）：提交在途不跳——下单成功的 redirectTo 会替掉栈顶协议页、结算页残留在栈里
  onAgreement(e: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) return
    wx.navigateTo({ url: '/pages/agreement/agreement?type=' + (e.currentTarget.dataset.type === 'privacy' ? 'privacy' : 'user') })
  },
  async onSubmit() {
    if (this.data.submitting) return
    const a = this.data.address
    if (!a) {
      fxHint(this, '先添加收货地址')
      return
    }
    tapHaptic()
    const draft = checkout.getDraft()
    trackEvent('order_submit', 'checkout', '', { count: draft.items.reduce((n, l) => n + l.qty, 0), amountFen: checkout.summaryFen().amountFen }) // 电商漏斗埋点（R41）
    this.setData({ submitting: true })
    const r = await createOrder(
      draft.items.map((l) => ({ id: l.id, sku: l.sku, qty: l.qty })),
      { name: a.name, phone: a.phone, region: a.region, detail: a.detail },
      checkout.getIdemKey() // 同一草稿的重试复用同一个键（网络超时重试不重复建单）
    )
    // 建单请求在途用户手动退出结算页（同 refresh() unloaded 范式）：不再对无关页面 setData/toast/redirectTo/
    // requestPayment（真实支付授权框）/switchTab——建单失败且已退页直接收尾；建单成功则订单已真实生成，
    // 草稿必须消费、购物车必须扣（不因页面退出而漏账），只留轻提示、不再导航。
    if (this.unloaded) {
      if (!r.ok) return
      checkout.finishSubmitted() // 已退页不进成功页·金额无消费方不再算（不留丢弃返回值的死调用）
      wx.showToast({ title: ORDER_KEPT_TIP, icon: 'none' })
      return
    }
    if (!r.ok) {
      // 云端拒单如实反馈（缺货/停售/配置缺失等·不吞错）——唯一留在本页的路径·此处才解锁重试
      this.setData({ submitting: false })
      const errCode = String(r.error || '')
      const dropped = checkout.dropRejectedLine(errCode)
      if (dropped) {
        // 那一行已移出本单（及购物车）：点名告诉用户是哪件。还有别的商品就重渲染、可直接再提交；
        // 草稿空了（立即购买那一件/唯一勾选的那件）没东西可下，等用户看完弹窗再退回——不走 refresh 的空草稿
        // 提示+600ms 自动返回，否则 toast 和退页会跟弹窗抢。
        const left = checkout.getDraft().items.length > 0
        wx.showModal({
          title: checkout.mapCreateOrderError(errCode),
          content: `「${dropped}」现在买不了，已从本单移除` + (left ? '，其余商品可以继续下单。' : '。'),
          showCancel: false,
          success: () => {
            if (!left && !this.unloaded) wx.navigateBack()
          },
        })
        if (left) void this.refresh()
        return
      }
      wx.showToast({ title: checkout.mapCreateOrderError(errCode), icon: 'none' })
      return
    }
    // 建单成功后每条后续路径都会离开结算页（redirectTo 成功页 / startPay 内 requestPayment 成功→成功页、取消→redirectTo 订单详情、失败→弹窗后 redirectTo 订单详情（订单已关闭才回首页）），
    // submitting 保持锁定不复位——防「支付发起期间草稿已被 finishSubmitted 清空、第二次点击绕过守卫再 createOrder」（病根#1 双提交）。
    // 成功页金额用回包权威值（order.amount）：前端 summaryFen 是本地估算，缺货重试/搭配购变化等场景可能与云端现算分叉；
    // 回包缺失才回退前端自算值（防御，正常必有）——透传成功页展示用。
    const fallbackFen = checkout.summaryFen().amountFen // 捕获前端估算分（finishSubmitted 消费草稿前）·仅作回退兜底
    const amountFen = checkout.resolveOrderAmountFen(r.order, fallbackFen)
    checkout.finishSubmitted() // 购物车按实际提交数量精确扣
    const order = (r.order || {}) as Record<string, any>
    trackEvent('order_success', 'checkout', String(order.id || ''), { amountFen }) // 电商漏斗埋点（R41）
    if (order.status === 'paid') {
      this.toSuccess(order.id, amountFen) // mock 模式建单即付（开发环境）——直接进成功页
      return
    }
    // 按键先打勾「已提交」停一下再拉支付（设计稿）；只是展示延时，建单/幂等/支付各仍只发一次
    this.setData({ submitted: true })
    await new Promise((r) => setTimeout(r, SUBMITTED_MS))
    await this.startPay(String(order.id || ''), amountFen)
  },
  // 付款成功：小货车开走不回来（设计稿转场），出画面再换到成功页；车没动（组件未就绪/测试桩）就直接换
  toSuccess(orderId: string, amountFen: number) {
    const go = () => wx.redirectTo({ url: '/pages/paysuccess/paysuccess?id=' + orderId + '&amount=' + amountFen })
    const truck = typeof this.selectComponent === 'function' ? (this.selectComponent('#truck') as { go?: (o: { back: boolean }) => number } | null) : null
    const ms = truck && truck.go ? truck.go({ back: false }) : 0
    if (ms) setTimeout(go, ms)
    else go()
  },
  async startPay(orderId: string, amountFen: number) {
    this.setData({ submitted: false, paying: true }) // 「已提交」换成转圈「正在拉起支付」，等支付参数回来
    const outcome = mapPayResult(await pay(orderId))
    this.setData({ paying: false })
    // 拉起支付请求在途用户手动退出结算页：不再对无关页面 redirectTo/requestPayment（真实支付授权框）/showModal
    // （同 onSubmit 建单分支范式）——订单已建，轻提示即可，导航/授权框留给用户主动回到订单列表时发起。
    if (this.unloaded) {
      wx.showToast({ title: ORDER_KEPT_TIP, icon: 'none' })
      return
    }
    // 支付出错（拍板 A）：订单还在、可继续付——弹窗说明后换到这张订单的详情页（先弹窗再换页：弹窗期间本页还在，最稳）
    const toOrder = (reason: string) =>
      wx.showModal({
        title: '支付没成功',
        content: (reason ? reason + '。' : '') + '订单已保留，可在订单详情里继续支付。',
        showCancel: false,
        success: () => wx.redirectTo({ url: '/pages/order/order?id=' + orderId }),
      })
    if (outcome.kind === 'paid') {
      this.toSuccess(orderId, amountFen)
      return
    }
    if (outcome.kind === 'request') {
      wx.requestPayment({
        ...outcome.payment,
        success: () => this.toSuccess(orderId, amountFen),
        // 取消：订单保留待支付——提示时限并换到这张订单的详情页（老板拍板 4·设计稿 payClose），在那里可继续支付；
        // 换页后本页没了，用原生提示（跨页还在）。失败（非取消）：弹窗说明后同样换到订单详情（拍板 A）
        fail: (res) => {
          if (String(res.errMsg || '').includes('cancel')) {
            wx.showToast({ title: PAY_CANCEL_TIP, icon: 'none', duration: 2500 })
            wx.redirectTo({ url: '/pages/order/order?id=' + orderId })
            return
          }
          toOrder('')
        },
      })
      return
    }
    if (outcome.kind === 'closed') {
      // 订单已超时关闭（付不了了）：弹窗后回首页从头逛起（goHomeTab 防 tab 实例旧滚动位置残留）
      wx.showModal({ title: '订单已关闭', content: outcome.message, showCancel: false, success: () => goHomeTab() })
      return
    }
    toOrder(outcome.message)
  },
})
