/**
 * 微信云开发初始化与调用入口（集中配置：换环境只改这里的 ENV_ID）。
 * 仅小程序端有 wx.cloud；H5 / App 端 initCloud() 为空操作、callCloud() 返回 null
 * （由调用方回退本地数据）。App.vue 的 onLaunch 调用 initCloud 一次。
 */
// 开通云开发环境后，把环境 ID 填到这里（形如 xxx-xxxxxx）
const ENV_ID = 'cloudbase-d4gcssqbv06865479'

export function initCloud() {
  // #ifdef MP-WEIXIN
  if (typeof wx !== 'undefined' && wx.cloud) {
    wx.cloud.init({ env: ENV_ID, traceUser: true })
  }
  // #endif
}

// 调用云函数。仅小程序端有 wx.cloud；其它端返回 null，由调用方回退本地数据。
// 用法：const result = await callCloud('getProducts', {})  // result 即云函数 return 的对象
export async function callCloud(name, data = {}) {
  // #ifdef MP-WEIXIN
  if (typeof wx !== 'undefined' && wx.cloud) {
    const res = await wx.cloud.callFunction({ name, data })
    return res.result
  }
  // #endif
  return null
}
