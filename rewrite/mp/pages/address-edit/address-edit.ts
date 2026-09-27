// 地址编辑（v5「字重」稿 A7）：新增/编辑一体（?id= 编辑）。四要素必填（与云端 createOrder 地址闸同口径）。
// valid 派生态驱动保存键亮/暗；电话不对在输入框下方提示；编辑态「删除」按住 0.7s 才删（设计稿：危险操作＝红字+长按）。
import { tapHaptic } from '../../lib/haptics'
import * as addr from '../../lib/address'

let delTimer: ReturnType<typeof setTimeout> | null = null
let delAt = 0
const DEL_HOLD_MS = 700 // 设计稿 data-ms=700

Page({
  data: {
    id: null as number | null,
    name: '',
    phone: '',
    region: '', // 真相源：空格拼接「省 市 区」（与下游 {{region}} {{detail}} 展示同分隔·后端 60 字上限内）
    regionArr: [] as string[], // 仅供 picker 打开时高亮初值（非真相源）
    detail: '',
    isDefault: false,
    valid: false, // 派生：四要素齐→保存按钮亮（弱校验·onSave 内仍做强校验含电话位数）
    saving: false, // 提交锁·防双击（新增态不回写 id·navigateBack 异步·连点会 push 两条重复地址）
    title: '编辑收货地址', // 顶栏页名（v5-nav）
    phoneErr: '', // 电话校验提示（输入框下方·改电话即清）
    deleting: false, // 正在按住删除（驱动红色填充进度）
  },
  onLoad(query: Record<string, string | undefined>) {
    const id = query.id ? Number(query.id) : null
    if (id != null) {
      const a = addr.getById(id)
      if (a)
        this.setData({
          id,
          name: a.name,
          phone: a.phone,
          region: a.region,
          regionArr: a.region ? a.region.split(' ') : [], // 回填 picker 初值（旧自由文本无空格→单元素·不重选不覆盖）
          detail: a.detail,
          isDefault: a.isDefault,
        })
    } else {
      this.setData({ title: '新增收货地址' }) // 新增态页名不误显「编辑」
    }
    this._syncValid()
  },
  onInput(e: WechatMiniprogram.Input) {
    const field = String(e.currentTarget.dataset.field)
    this.setData({ [field]: e.detail.value, ...(field === 'phone' ? { phoneErr: '' } : {}) }, () => this._syncValid())
  },
  // 省市区级联选择（微信内置 region picker·全国省市区数据运行时自带·无需数据/API/密钥）
  onRegionChange(e: WechatMiniprogram.PickerChange) {
    const arr = (e.detail.value as string[]) || []
    this.setData({ region: arr.join(' '), regionArr: arr }, () => this._syncValid())
  },
  onToggleDefault() {
    this.setData({ isDefault: !this.data.isDefault })
  },
  // 派生保存态：四项非空即亮（展示用弱校验，不改 onSave 的强校验语义）
  _syncValid() {
    const { name, phone, region, detail } = this.data
    const valid = !!(name.trim() && phone.trim() && region.trim() && detail.trim())
    if (valid !== this.data.valid) this.setData({ valid })
  },
  onSave() {
    if (this.data.saving) return // 提交在途·丢弃二次点击（navigateBack 前页面未销毁·新增态双击会落两条重复地址）
    const { id, name, phone, region, detail, isDefault } = this.data
    if (!name.trim() || !phone.trim() || !region.trim() || !detail.trim()) {
      wx.showToast({ title: '四项都要填哦', icon: 'none' })
      return
    }
    if (phone.replace(/\D/g, '').length < 7) {
      this.setData({ phoneErr: '电话号码不太对' })
      return
    }
    tapHaptic()
    this.setData({ saving: true }) // 校验过关·锁定后再落库+返回（锁贯穿到页面销毁）
    addr.saveAddress({ id: id ?? undefined, name: name.trim(), phone: phone.trim(), region: region.trim(), detail: detail.trim(), isDefault })
    wx.navigateBack()
  },
  // 删除既有地址（仅编辑态·复用簿逻辑 removeAddress）：按住 0.7s 才删，松手太快提示按住——替代原二次确认弹窗
  onDelHoldStart() {
    if (this.data.id == null) return
    this.onDelHoldCancel()
    delAt = Date.now()
    this.setData({ deleting: true })
    delTimer = setTimeout(() => {
      delTimer = null
      const { id } = this.data
      if (id == null) return
      tapHaptic()
      addr.removeAddress(id)
      wx.navigateBack()
    }, DEL_HOLD_MS)
  },
  onDelHoldEnd() {
    if (!delTimer) return
    const quick = Date.now() - delAt < 400
    this.onDelHoldCancel()
    if (quick) wx.showToast({ title: '按住删除这个地址', icon: 'none' })
  },
  onDelHoldCancel() {
    if (delTimer) clearTimeout(delTimer)
    delTimer = null
    if (this.data.deleting) this.setData({ deleting: false })
  },
  onUnload() {
    this.onDelHoldCancel()
  },
})
