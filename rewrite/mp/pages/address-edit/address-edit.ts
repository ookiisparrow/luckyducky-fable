// 地址编辑（M2 批5）：新增/编辑一体（?id= 编辑）。四要素必填（与云端 createOrder 地址闸同口径）。
// 重设计对齐 checkout.css coaddr-* 版式：结构/视觉重排在 wxml/wxss，本文件仅补 valid 派生态（保存按钮亮/暗）
// 与 onDelete（编辑既有地址时删除·复用 lib/address.removeAddress），既有 handler 名与 data 字段一字未改。
import * as addr from '../../lib/address'

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
      wx.setNavigationBarTitle({ title: '新增收货地址' }) // 新增态标题不误显「编辑」（P3·bug sweep R1 #12）
    }
    this._syncValid()
  },
  onInput(e: WechatMiniprogram.Input) {
    const field = String(e.currentTarget.dataset.field)
    this.setData({ [field]: e.detail.value }, () => this._syncValid())
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
      wx.showToast({ title: '电话号码不太对', icon: 'none' })
      return
    }
    this.setData({ saving: true }) // 校验过关·锁定后再落库+返回（锁贯穿到页面销毁）
    addr.saveAddress({ id: id ?? undefined, name: name.trim(), phone: phone.trim(), region: region.trim(), detail: detail.trim(), isDefault })
    wx.navigateBack()
  },
  // 删除既有地址（仅编辑态·复用簿逻辑 removeAddress·二次确认防误删）
  onDelete() {
    const { id } = this.data
    if (id == null) return
    wx.showModal({
      title: '删除地址',
      content: '确定删除这个收货地址吗？',
      success: (r) => {
        if (r.confirm) {
          addr.removeAddress(id)
          wx.navigateBack()
        }
      },
    })
  },
})
