// 地址列表（M2 批5）：管理 + 选择两用（?pick=1 时点行即选回结算页——结算页 onShow 读默认地址，
// 这里选中即设默认，返回自然生效·无跨页传参耦合）。
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
  onTapRow(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    if (this.data.picking) {
      addr.setDefault(id) // 选中即默认·结算页 onShow 取默认
      wx.navigateBack()
      return
    }
    wx.navigateTo({ url: '/pages/address-edit/address-edit?id=' + id })
  },
  onSetDefault(e: WechatMiniprogram.TouchEvent) {
    addr.setDefault(Number(e.currentTarget.dataset.id))
    this.setData({ list: addr.getList() })
  },
  onRemove(e: WechatMiniprogram.TouchEvent) {
    addr.removeAddress(Number(e.currentTarget.dataset.id))
    this.setData({ list: addr.getList() })
  },
  onAdd() {
    wx.navigateTo({ url: '/pages/address-edit/address-edit' })
  },
})
