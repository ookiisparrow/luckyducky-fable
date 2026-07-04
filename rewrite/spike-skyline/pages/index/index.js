Page({
  data: { sdkVersion: '', wxVersion: '', platform: '' },
  onLoad() {
    const sys = wx.getSystemInfoSync()
    this.setData({
      sdkVersion: sys.SDKVersion || '?',
      wxVersion: sys.version || '?',
      platform: sys.platform || '?',
    })
  },
  goSky() {
    wx.navigateTo({ url: '/pages/sky/sky' })
  },
  goWeb() {
    wx.navigateTo({ url: '/pages/web/web' })
  },
})
