// 地址列表（M2 批5·重设计对齐 coam-*）：管理 + 选择两用（?pick=1 时选中即设默认回结算页——
// 结算页 onShow 读默认地址，无跨页传参耦合）。视觉重排见 wxml/wxss，数据流与 lib/address 逻辑不变。
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
  // 选中圈点选：设为默认；结算态设默认后返回（与主区一致）。
  onRadioTap(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    addr.setDefault(id)
    if (this.data.picking) {
      wx.navigateBack()
      return
    }
    this.setData({ list: addr.getList() })
  },
  // 编辑笔：进编辑页（结算态亦可编辑而不选中）。
  onEdit(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: '/pages/address-edit/address-edit?id=' + Number(e.currentTarget.dataset.id) })
  },
  // 长按删除：确认后移除（设计列表无删除位，删除入口收敛到长按二次确认，防误删）。
  onLongPressRow(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    wx.showModal({
      title: '删除地址',
      content: '确定删除这个收货地址吗？',
      confirmText: '删除',
      confirmColor: '#e5484d',
      success: (res) => {
        if (res.confirm) {
          addr.removeAddress(id)
          this.setData({ list: addr.getList() })
        }
      },
    })
  },
  onAdd() {
    wx.navigateTo({ url: '/pages/address-edit/address-edit' })
  },
})
