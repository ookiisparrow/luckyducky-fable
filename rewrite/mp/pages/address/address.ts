// 地址列表（v5「字重」稿 A6）：管理 + 选择两用（?pick=1 时选中即设默认回结算页——
// 结算页 onShow 读默认地址，无跨页传参耦合）。删除收进编辑页（按住删除）。
import { tapHaptic } from '../../lib/haptics'
import * as addr from '../../lib/address'

Page({
  data: {
    list: [] as ReturnType<typeof addr.getList>,
    picking: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ picking: query.pick === '1' })
  },
  onShow() {
    this.setData({ list: addr.getList() })
  },
  // 主区点选：结算态选中即默认并返回；管理态进编辑页（原语义不变）。
  onTapRow(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    if (this.data.picking) {
      addr.setDefault(id) // 选中即默认·结算页 onShow 取默认
      wx.navigateBack()
      return
    }
    wx.navigateTo({ url: '/pages/address-edit/address-edit?id=' + id })
  },
  // 「编辑」键：进编辑页（结算态亦可编辑而不选中）。
  onEdit(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: '/pages/address-edit/address-edit?id=' + Number(e.currentTarget.dataset.id) })
  },
  onAdd() {
    tapHaptic()
    wx.navigateTo({ url: '/pages/address-edit/address-edit' })
  },
})
