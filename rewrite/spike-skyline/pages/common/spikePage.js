// 双页共用页面逻辑（sky/web 各建一份实例）——spike 用完即弃。
function createSpikePage(label) {
  return {
    data: {
      label,
      renderer: '',
      statusBarH: 20,
      maskOpen: false,
      injStyle: '--inj: #ff7a00;',
      items: [],
    },
    onLoad() {
      const sys = wx.getSystemInfoSync()
      const items = []
      for (let i = 1; i <= 40; i++) items.push({ id: i, text: '滚动内容 ' + i })
      this.setData({
        renderer: this.renderer || '(this.renderer 为空)',
        statusBarH: sys.statusBarHeight || 20,
        items,
      })
    },
    openMask() {
      this.setData({ maskOpen: true })
    },
    closeMask() {
      this.setData({ maskOpen: false })
    },
    noop() {},
    goBack() {
      wx.navigateBack()
    },
  }
}
module.exports = { createSpikePage }
