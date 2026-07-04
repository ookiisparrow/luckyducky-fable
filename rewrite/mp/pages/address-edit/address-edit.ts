// 地址编辑（M2 批5）：新增/编辑一体（?id= 编辑）。四要素必填（与云端 createOrder 地址闸同口径）。
import * as addr from '../../lib/address'

Page({
  data: {
    id: null as number | null,
    name: '',
    phone: '',
    region: '',
    detail: '',
    isDefault: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    const id = query.id ? Number(query.id) : null
    if (id != null) {
      const a = addr.getById(id)
      if (a) this.setData({ id, name: a.name, phone: a.phone, region: a.region, detail: a.detail, isDefault: a.isDefault })
    }
  },
  onInput(e: WechatMiniprogram.Input) {
    const field = String(e.currentTarget.dataset.field)
    this.setData({ [field]: e.detail.value })
  },
  onToggleDefault() {
    this.setData({ isDefault: !this.data.isDefault })
  },
  onSave() {
    const { id, name, phone, region, detail, isDefault } = this.data
    if (!name.trim() || !phone.trim() || !region.trim() || !detail.trim()) {
      wx.showToast({ title: '四项都要填哦', icon: 'none' })
      return
    }
    if (phone.replace(/\D/g, '').length < 7) {
      wx.showToast({ title: '电话号码不太对', icon: 'none' })
      return
    }
    addr.saveAddress({ id: id ?? undefined, name: name.trim(), phone: phone.trim(), region: region.trim(), detail: detail.trim(), isDefault })
    wx.navigateBack()
  },
})
