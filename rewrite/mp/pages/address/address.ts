// 地址列表（v5「字重」稿 A6）：管理 + 选择两用（?pick=1 时选中即设默认回结算页——
// 结算页 onShow 读默认地址，无跨页传参耦合）。删除收进编辑页（按住删除）。
import { tapHaptic } from '../../lib/haptics'
import * as addr from '../../lib/address'
import { keyDown, keyUp } from '../../lib/keyFx'

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    list: [] as Array<ReturnType<typeof addr.getList>[number] & { phoneMasked: string }>,
    picking: false,
  },
  leaving: false, // 选中后等 140ms 才退回：期间连点不再退第二次（否则连退两页）
  backTimer: null as ReturnType<typeof setTimeout> | null,
  onUnload() {
    if (this.backTimer) clearTimeout(this.backTimer) // 140ms 内用户自己退了：别再替他多退一页
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ picking: query.pick === '1' })
  },
  onShow() {
    this.draw()
  },
  draw() {
    // 省市区 / 详细地址分行显示（UI 审查 15 问 1c·与结算页地址卡同结构）
    this.setData({ list: addr.getList().map((a) => ({ ...a, phoneMasked: addr.maskPhone(a.phone) })) })
  },
  // 主区点选：结算态选中即默认并返回；管理态进编辑页（原语义不变）。
  onTapRow(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    if (this.data.picking) {
      if (this.leaving) return
      this.leaving = true
      addr.setDefault(id) // 选中即默认·结算页 onShow 取默认
      this.draw() // 紫点先跳到这行
      this.backTimer = setTimeout(() => wx.navigateBack(), 140) // 设计稿 addrPick：停 140ms 让人看见选中再退回
      return
    }
    wx.navigateTo({ url: '/pages/address-edit/address-edit?id=' + id })
  },
  // 「编辑」键：进编辑页（结算态亦可编辑而不选中）。
  onEdit(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: '/pages/address-edit/address-edit?id=' + Number(e.currentTarget.dataset.id) })
  },
  // 选址态新增：pick=2＝存完自动设默认、连退两页（编辑页 + 本页）直接回结算页
  onAdd() {
    tapHaptic()
    wx.navigateTo({ url: '/pages/address-edit/address-edit' + (this.data.picking ? '?pick=2' : '') })
  },
})
