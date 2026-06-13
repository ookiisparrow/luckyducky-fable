import { withOpenId, ok, err, transition, callFlow } from '../../kit'

// 发起支付（敏感：金额一律取库内订单 amount，不信任前端）。通道=云开发微信支付工作流
//（调试日志 J：实物类小程序被微信限制，须走工作流，cloudbase_module 经 kit.callFlow 单点）。
// 三道闸（openid/本人/pending）+ 惰性超时关单 + PAY_MODE=real 且 flowId 齐全才放行。
const EXPIRE_MS = 15 * 60 * 1000

export const main = withOpenId(async ({ db, OPENID, event }) => {
  const id = String(event.id || '')
  if (!id) return err('NO_ID')

  const got = await db.collection('orders').doc(id).get().catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return err('NOT_FOUND')
  const order = got.data
  if (order.status !== 'pending') return err('BAD_STATUS:' + order.status)

  // 惰性超时：到点的 pending 当场关闭（定时器只是兜底）
  if (Date.now() - order.createdAt > EXPIRE_MS) {
    await transition('orders', id, ['pending'], 'closed', { closedAt: Date.now() })
    return err('ORDER_CLOSED')
  }

  const cfg = await db.collection('config').doc('pay').get().catch(() => null)
  const pay = (cfg && cfg.data) || {}
  if (pay.mode !== 'real' || !pay.flowId) return err('PAY_NOT_ENABLED')

  const totalFee = Math.round(order.amount * 100) // 微信支付单位是分
  if (totalFee <= 0) {
    // 0 元单（券抵扣到 0）：无费可付，直接置已支付（微信支付最低 1 分）
    const paidAt = Date.now()
    await transition('orders', id, ['pending'], 'paid', { paidAt })
    return ok({ paid: true, paidAt })
  }

  // 触发支付工作流（JSAPI 下单）：openid 显式传入，金额/单号均来自库内订单
  const firstName = order.items && order.items[0] ? String(order.items[0].name) : '钩织材料包'
  const p = await callFlow(String(pay.flowId), {
    description: ('幸运小鸭 · ' + firstName).slice(0, 40),
    out_trade_no: order.id,
    amount: { total: totalFee, currency: 'CNY' },
    payer: { openid: OPENID },
  })
  if (!p || !p.paySign) {
    console.error('[pay] 工作流未返回预付单', order.id)
    return err('UNIFIED_ORDER_FAIL')
  }
  // 对齐 wx.requestPayment 参数名（工作流回传 packageVal，前端要的是 package）
  return ok({
    payment: {
      timeStamp: String(p.timeStamp),
      nonceStr: String(p.nonceStr),
      package: String(p.packageVal || p.package || ''),
      signType: String(p.signType || 'RSA'),
      paySign: String(p.paySign),
    },
  })
})
