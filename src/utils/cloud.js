/**
 * 微信云开发初始化(集中配置:换环境只改这里的 ENV_ID)。
 * 仅小程序端有 wx.cloud;H5 / App 端 initCloud() 为空操作。
 * App.vue 的 onLaunch 调用一次。
 */
// 开通云开发环境后,把环境 ID 填到这里(形如 xxx-xxxxxx)
const ENV_ID = 'cloudbase-d4gcssqbv06865479'

export function initCloud() {
  // #ifdef MP-WEIXIN
  if (typeof wx !== 'undefined' && wx.cloud) {
    wx.cloud.init({ env: ENV_ID, traceUser: true })
  }
  // #endif
}
