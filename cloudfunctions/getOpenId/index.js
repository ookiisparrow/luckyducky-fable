// 云开发接入验证函数:返回调用者的可信 openid / appid。
// 小程序端 wx.cloud.callFunction({ name: 'getOpenId' }) 能拿到 → 证明云开发已打通。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  const { OPENID, APPID } = cloud.getWXContext()
  return { ok: true, openid: OPENID, appid: APPID }
}
