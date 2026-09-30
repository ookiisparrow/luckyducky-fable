// 地址编辑（v5「字重」稿 A7）：新增/编辑一体（?id= 编辑）。四要素必填（与云端 createOrder 地址闸同口径）。
// valid 派生态驱动保存键亮/暗（手机号正好 11 位才亮·老板拍板 6）；点灰键：手机号不够 → 框下「手机号少了 N 位」+ 黄框，
// 否则提示缺项；编辑态「删除」按住 0.7s 才删（设计稿：危险操作＝红字+长按）。
// 有改动（dirty）时 <leave-sheet> 拦返回/侧滑先问「放弃修改地址？」。
import { tapHaptic } from '../../lib/haptics'
import * as addr from '../../lib/address'
import { fxHint, fxToast } from '../../lib/pxFx'
import { createHold, type Hold } from '../../lib/hold'
import { keyDown, keyPress, keyUp } from '../../lib/keyFx'

const DEL_HOLD_MS = 700 // 设计稿 data-ms=700
type Form = { name: string; phone: string; region: string; detail: string; isDefault: boolean }

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    id: null as number | null,
    name: '',
    phone: '',
    region: '', // 真相源：空格拼接「省 市 区」（与下游 {{region}} {{detail}} 展示同分隔·后端 60 字上限内）
    regionArr: [] as string[], // 仅供 picker 打开时高亮初值（非真相源）
    detail: '',
    isDefault: false,
    valid: false, // 派生：四要素齐且手机号正好 11 位 → 保存按钮亮
    saving: false, // 提交锁·防双击（新增态不回写 id·navigateBack 异步·连点会 push 两条重复地址）
    title: '编辑收货地址', // 顶栏页名（v5-nav）
    phoneWarn: false, // 点过灰色保存键且手机号不够位 → 之后边打边提示（设计稿 aeErr）
    phoneLack: 0, // 手机号还差几位（>0 时框下「手机号少了 N 位」+ 黄框·派生；文案在 wxml 的黑体里）
    focus: '', // 正在输入的框（驱动 .well-focus 紫描边）
    focusNext: '', // 键盘「下一项」要跳去的框（驱动该框 focus 属性·失焦即清，免得下次同值不触发）
    dirty: false, // 与进页时相比有改动（驱动 <leave-sheet> 拦返回/侧滑）
    deleting: false, // 正在按住删除（驱动红色填充进度）
    pick: 0, // 从结算页选址来新增（?pick=N）：存完自动设默认、退 N 页直接回结算页；0＝管理态
  },
  orig: { name: '', phone: '', region: '', detail: '', isDefault: false } as Form, // 进页时的原值（判 dirty）
  onLoad(query: Record<string, string | undefined>) {
    const id = query.id ? Number(query.id) : null
    if (id != null) {
      const a = addr.getById(id)
      if (a) {
        this.orig = { name: a.name, phone: a.phone, region: a.region, detail: a.detail, isDefault: a.isDefault }
        this.setData({
          id,
          ...this.orig,
          regionArr: a.region ? a.region.split(' ') : [], // 回填 picker 初值（旧自由文本无空格→单元素·不重选不覆盖）
        })
      }
    } else {
      // 新增态页名不误显「编辑」；pick 只认新增（结算页空簿直进=1，选址列表进=2）
      this.setData({ title: '新增收货地址', pick: Math.max(0, Math.floor(Number(query.pick) || 0)) })
    }
    this._sync()
  },
  onInput(e: WechatMiniprogram.Input) {
    this.setData({ [String(e.currentTarget.dataset.field)]: e.detail.value }, () => this._sync())
  },
  onFocus(e: WechatMiniprogram.InputFocus) {
    this.setData({ focus: String(e.currentTarget.dataset.field) })
  },
  onBlur() {
    this.setData({ focus: '', focusNext: '' })
  },
  // 收货人填完按键盘「下一项」→ 跳到手机号（省市区是选择器、详细地址是多行框，不再往下串）
  onNameNext() {
    this.setData({ focusNext: 'phone' })
  },
  // 省市区级联选择（微信内置 region picker·全国省市区数据运行时自带·无需数据/API/密钥）
  onRegionChange(e: WechatMiniprogram.PickerChange) {
    const arr = (e.detail.value as string[]) || []
    this.setData({ region: arr.join(' '), regionArr: arr }, () => this._sync())
  },
  onToggleDefault() {
    this.setData({ isDefault: !this.data.isDefault }, () => this._sync())
  },
  // 派生：保存键亮暗、手机号提示、有没有改动（设计稿 dirty('addressEdit')：四项 trim 后比原值 + 默认开关）
  _sync() {
    const { name, phone, region, detail, isDefault, phoneWarn } = this.data
    const o = this.orig
    this.setData({
      valid: !!(name.trim() && addr.phoneOk(phone) && region.trim() && detail.trim()),
      dirty: name.trim() !== o.name.trim() || phone.trim() !== o.phone.trim() || region.trim() !== o.region.trim() || detail.trim() !== o.detail.trim() || isDefault !== o.isDefault,
      phoneLack: phoneWarn ? addr.phoneShort(phone) : 0,
    })
  },
  // 自绘返回键（v5-nav guard）：交给放弃确认半屏，它自己判有没有改动
  onBack() {
    ;(this.selectComponent('#leave') as unknown as { ask(): void } | null)?.ask()
  },
  // 先撤掉「放弃修改」拦截再退回（拦截武装时退回会被 page-container 拦下弹确认）
  _leave(delta = 1) {
    this.setData({ dirty: false }, () => wx.navigateBack({ delta }))
  },
  onSave() {
    if (this.data.saving) return // 提交在途·丢弃二次点击（navigateBack 前页面未销毁·新增态双击会落两条重复地址）
    const { id, name, phone, region, detail, isDefault } = this.data
    if (!this.data.valid) {
      // 点灰键（设计稿 aeHint）：手机号不够位 → 框下提示 + 黄框；否则提示缺项 / 号码不对
      if (addr.phoneShort(phone)) return this.setData({ phoneWarn: true }, () => this._sync())
      fxHint(this, name.trim() && region.trim() && detail.trim() && phone ? '手机号不太对' : '四项都要填哦')
      return
    }
    tapHaptic()
    this.setData({ saving: true }) // 校验过关·锁定后再落库+返回（锁贯穿到页面销毁）
    const pick = this.data.pick
    // 从结算页来新增：选址＝设默认（拍板 5），结算页 onShow 取默认，存完直接回去
    addr.saveAddress({ id: id ?? undefined, name: name.trim(), phone, region: region.trim(), detail: detail.trim(), isDefault: pick ? true : isDefault })
    fxToast(this, '已保存') // 马上退回：上一页接着显示（px-fx 跨页接力）
    this._leave(pick || 1)
  },
  // 删除既有地址（仅编辑态·复用簿逻辑 removeAddress）：按住 0.7s 才删，松手太快提示按住——替代原二次确认弹窗（lib/hold）
  _delHold: null as Hold | null,
  delHold(): Hold {
    if (!this._delHold)
      this._delHold = createHold(
        DEL_HOLD_MS,
        () => {
          const { id } = this.data
          if (id == null) return
          tapHaptic()
          addr.removeAddress(id)
          fxHint(this, '已删除') // 同保存：马上退回，上一页接着显示
          this._leave()
        },
        {
          onQuick: () => fxHint(this, '按住删除这个地址'),
          onChange: (v) => this.setData({ deleting: v }),
        }
      )
    return this._delHold
  },
  onDelHoldStart(e?: WechatMiniprogram.TouchEvent) {
    if (this.data.id == null) return
    keyPress('light') // 按住类键自己 catch 了 touchstart，手感在这里补
    const t = e && e.touches && e.touches[0]
    this.delHold().start(t ? t.clientX : undefined, t ? t.clientY : undefined)
  },
  // 按住时手指滑开超过 10px 作废（lib/hold）
  onDelHoldMove(e: WechatMiniprogram.TouchEvent) {
    const t = e.touches[0]
    if (t) this._delHold?.move(t.clientX, t.clientY)
  },
  onDelHoldEnd() {
    this.delHold().end()
  },
  onDelHoldCancel() {
    this.delHold().cancel()
  },
  onUnload() {
    this._delHold?.cancel()
  },
})
