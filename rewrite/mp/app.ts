// 重写线小程序（M2·原生 TS + glass-easel·默认 WebView·关键页按页开 Skyline——M0 spike 已真机验证）。
// 云环境与旧线同一个（数据零迁移·ADR §23）；M2 期间壳只初始化不调用，业务调用随页面批接 app 网关。
App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ env: 'cloudbase-d4gcssqbv06865479', traceUser: true })
    }
  },
})
