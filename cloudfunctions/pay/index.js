// 发起支付（敏感业务：金额一律取库内订单 amount，不信任前端）。
// 接入方式：云开发「微信支付工作流」（2026-06-12 路线变更——实物交易类小程序
// 被微信限制使用旧云调用支付，须走工作流；见调试日志 J）。
// 工作流 ID 存 config.pay.flowId（控制台建好的「使用微信支付API发起支付」流），
// 凭证/商户号/回调地址都配在工作流侧连接器里；本函数负责三道闸 + 金额 + 触发。
// PAY_MODE=real 且 flowId 配置齐全才放行（缺省 mock 下本函数不可用，防误启用）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 待支付有效期，与 closeExpiredOrders 定时关单、前端倒计时同口径
const EXPIRE_MS = 15 * 60 * 1000

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }
  const id = String(event.id || '')
  if (!id) return { ok: false, error: 'NO_ID' }

  const got = await db.collection('orders').doc(id).get().catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return { ok: false, error: 'NOT_FOUND' }
  const order = got.data
  if (order.status !== 'pending') return { ok: false, error: 'BAD_STATUS:' + order.status }

  // 惰性超时：到点的 pending 当场关闭（定时器只是兜底，不依赖其节拍）
  if (Date.now() - order.createdAt > EXPIRE_MS) {
    await db.collection('orders').doc(id).update({ data: { status: 'closed', closedAt: Date.now() } })
    return { ok: false, error: 'ORDER_CLOSED' }
  }

  const cfg = await db.collection('config').doc('pay').get().catch(() => null)
  const pay = (cfg && cfg.data) || {}
  if (pay.mode !== 'real' || !pay.flowId) return { ok: false, error: 'PAY_NOT_ENABLED' }

  const totalFee = Math.round(order.amount * 100) // 微信支付单位是分
  if (totalFee <= 0) {
    // 0 元单（占位券抵扣到 0）：无费可付，直接置已支付（微信支付最低 1 分）
    const paidAt = Date.now()
    await db.collection('orders').doc(id).update({ data: { status: 'paid', paidAt } })
    return { ok: true, paid: true, paidAt }
  }

  // 触发支付工作流（JSAPI 下单）：openid 显式传入（不依赖工作流环境注入），
  // 金额/单号均来自库内订单。回调地址由工作流入参表达式固定注入（paynotify 工作流）。
  const firstName = order.items && order.items[0] ? String(order.items[0].name) : '钩织材料包'
  const res = await cloud
    .callFunction({
      name: 'cloudbase_module',
      data: {
        name: String(pay.flowId),
        data: {
          description: ('幸运小鸭 · ' + firstName).slice(0, 40),
          out_trade_no: order.id,
          amount: { total: totalFee, currency: 'CNY' },
          payer: { openid: OPENID },
        },
      },
    })
    .catch((e) => {
      console.error('[pay] 工作流调用异常', order.id, e && e.message)
      return null
    })

  const p = res && res.result && res.result.data
  if (!p || !p.paySign) {
    console.error('[pay] 工作流未返回预付单', order.id, res && JSON.stringify(res.result).slice(0, 300))
    return { ok: false, error: 'UNIFIED_ORDER_FAIL' }
  }
  // 对齐 wx.requestPayment 参数名（工作流回传 packageVal，前端要的是 package）
  return {
    ok: true,
    payment: {
      timeStamp: String(p.timeStamp),
      nonceStr: String(p.nonceStr),
      package: String(p.packageVal || p.package || ''),
      signType: String(p.signType || 'RSA'),
      paySign: String(p.paySign),
    },
  }
}
