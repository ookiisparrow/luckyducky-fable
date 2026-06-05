/**
 * 网络请求基础封装（预留）。
 * 所有对后端 / CMS / ERP / 客服 的请求都走这里，统一加 baseURL、token、错误处理。
 * 现在首页用本地 data/，还用不到；接后端时把各 api 模块基于此函数实现。
 */

// 以后改成你的后端地址；可按环境区分（开发/生产）。
const BASE_URL = ''

export function request(options = {}) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: BASE_URL + options.url,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'Content-Type': 'application/json',
        // Authorization: useUserStore().token,  // 以后带上登录令牌
        ...(options.header || {}),
      },
      success: (res) => {
        // TODO: 按后端约定统一处理状态码
        resolve(res.data)
      },
      fail: reject,
    })
  })
}
