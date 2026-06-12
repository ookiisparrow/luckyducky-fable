// 取当前用户的订单列表（按创建时间倒序）。openid 取自 getWXContext，
// 用户只能看到自己的订单；前端 api/order.js 调用。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }
  const res = await db
    .collection('orders')
    .where({ _openid: OPENID })
    .orderBy('createdAt', 'desc')
    .limit(100) // 审核批次B：20 太小易把老单挤出列表；分页体系记技术债 #12，详情另有 getOrderById 兜底
    .get()
  return { ok: true, list: res.data }
}
