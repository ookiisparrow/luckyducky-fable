/**
 * 微信云开发初始化与调用入口（集中配置：换环境只改这里的 ENV_ID）。
 * 仅小程序端有 wx.cloud；H5 / App 端 initCloud() 为空操作、callCloud() 返回 null
 * （由调用方回退本地数据）。App.vue 的 onLaunch 调用 initCloud 一次。
 *
 * dev:h5 演示路（仅开发期·见下方 callCloud 内 #ifdef H5 块）：T1 下 H5 本无云数据，视频板块在 H5
 * 跑不起来；开发期喂样本数据让播放器可在浏览器测，免微信开发者工具繁琐。生产红线由 dev-mock-h5-only
 * 守卫机器保证（mp-weixin 编译期删除 + H5 正式包 DEV 门控不启用），详见同目录的 dev mock 模块。
 */
// 开通云开发环境后，把环境 ID 填到这里（形如 xxx-xxxxxx）
const ENV_ID = 'cloudbase-d4gcssqbv06865479'

// #ifdef H5
import { devMockCloud } from './devCloudMock.js'
// #endif

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
  // #ifdef H5
  // dev:h5 演示路（仅开发期）：喂样本数据让视频板块可在浏览器测；H5 正式包 DEV=false 不启用、返回 null。
  if (import.meta.env.DEV) return devMockCloud(name, data)
  // #endif
  return null
}

// 上传本地（临时）文件到云存储，返回 fileID。仅小程序端；其它端返回 null。
// 用法：const fileID = await uploadCloudFile('avatars/xxx.png', tempFilePath)
export async function uploadCloudFile(cloudPath, filePath) {
  // #ifdef MP-WEIXIN
  if (typeof wx !== 'undefined' && wx.cloud) {
    const res = await wx.cloud.uploadFile({ cloudPath, filePath })
    return res.fileID || null
  }
  // #endif
  return null
}
