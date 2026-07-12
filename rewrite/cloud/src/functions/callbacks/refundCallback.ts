import { toFen, COLLECTIONS } from '@ldrw/shared'
import { defineNotifyCallback, notifyAlert, restoreStock } from '../../kit'

// 退款结果回调（黄金 orders-money·refundCallback 节）。防伪/ACK/id 提取由框架强制。
// 核验 fail-closed：成功通知的订单号+金额须与售后单一致，否则不置已退款、留 refundMismatch 痕+告警；
// 幂等：applied/approved→refunded 抢占只一次；回补库存仅限未发货单（已发货实物已出库·回补=幻影超卖）。
// 部署命名：M5 切换日同名替换（回调点位绑定控制台工作流 refundnotify）。
const ACK = { errcode: 0, errmsg: 'OK' }

export const main = defineNotifyCallback<any>({
  ack: ACK,
  refId: (e) => String(e.out_refund_no || ''),
  onNotify: async ({ db, id, event: e }) => {
    // id = 微信回传 out_refund_no。本批解耦（根因#12·案 A）：退款单号不再等于内部 _id（含中文/超长者被规整），
    // 故先按售后单 outRefundNo 字段反查；回退 .doc(id) 兼容纯 ASCII 老单（out_refund_no===_id·无 outRefundNo 字段）。
    const byField = await db
      .collection(COLLECTIONS.afterSales)
      .where({ outRefundNo: id })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    let as = (byField.data && byField.data[0]) || null
    if (!as) {
      const got = await db
        .collection(COLLECTIONS.afterSales)
        .doc(id)
        .get()
        .catch(() => null)
      as = (got && got.data) || null
    }
    if (!as) {
      await notifyAlert('money', 'refundCallback', 'UNKNOWN_AFTERSALE', { id })
      return
    }
    const asId = as._id // 后续状态流转/留痕一律按真实 _id（非 out_refund_no）
    const status = String(e.refund_status || '')
    const claimFee = e.amount && e.amount.refund != null ? Number(e.amount.refund) : NaN

    // 核验 fail-closed：单号/金额不符 → 拒置已退款、留可对账痕+告警
    if (
      status === 'SUCCESS' &&
      (String(e.out_trade_no || '') !== String(as.orderId) || claimFee !== toFen(as.refundAmount))
    ) {
      await notifyAlert('money', 'refundCallback', 'MISMATCH', { id, outTradeNo: String(e.out_trade_no || ''), claimFee })
      await db
        .collection(COLLECTIONS.afterSales)
        .doc(asId)
        .update({ data: { refundMismatch: true } })
        .catch(() => {})
      return
    }
    if (status !== 'SUCCESS') {
      // 退款异常（CLOSED/ABNORMAL 等）：留痕不翻状态·告警人工
      await notifyAlert('money', 'refundCallback', 'NOT_SUCCESS', { id, status })
      await db
        .collection(COLLECTIONS.afterSales)
        .doc(asId)
        .update({ data: { refundStatus: status } })
        .catch(() => {})
      return
    }
    if (as.status === 'applied' || as.status === 'approved') {
      const _ = db.command
      const grab = await db
        .collection(COLLECTIONS.afterSales)
        .where({ _id: asId, status: _.in(['applied', 'approved']) })
        .update({
          data: {
            status: 'refunded',
            refundedAt: Date.now(),
            refundTransactionId: String(e.transaction_id || ''),
          },
        })
      if (grab.stats && grab.stats.updated === 1) {
        // 回补仅限未发货（paid）：已发货实物在客户手中，回补＝凭空多一件超卖
        const ord = await db
          .collection(COLLECTIONS.orders)
          .doc(as.orderId)
          .get()
          .catch(() => null)
        if (ord && ord.data && ord.data.status === 'paid') {
          await restoreStock([{ productId: as.productId, spec: as.spec || '', qty: as.qty }])
        }
        // 订单留对账痕（失败不阻塞 ACK：售后单是退款状态单一来源）。键用 lineId（深审 P3）：同商品多 SKU 行
        // （lineId 不同、productId 相同）分别退款时，旧版按 productId 键控会后写覆盖先写、订单侧只剩一行痕；
        // 改按 lineId（回退 productId 兼容旧售后单）各占一键。lineId 含 spec 里的 '.' 会被 TCB 当嵌套路径分层，
        // 洗成 '_' 保持扁平一键。
        const traceKey = String(as.lineId || as.productId).replace(/\./g, '_')
        await db
          .collection(COLLECTIONS.orders)
          .doc(as.orderId)
          .update({ data: { ['refunded.' + traceKey]: as.refundAmount } })
          .catch(() => {})
      }
    }
  },
})
