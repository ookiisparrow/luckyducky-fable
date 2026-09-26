import { PAY_WINDOW_MS, COLLECTIONS, ERR } from '@ldrw/shared'
import { getDb, ok, err, isServerCall, restoreStock, notifyAlert } from '../../kit'

// 超时关单（定时触发器·黄金 orders-money 关单节）：pending 超支付窗 → closed，抢占成功那次才回补
// 预留库存（绑状态转移＝天然幂等，已 closed 不在查询内）。bounded ≤200/次。
// 先 closed 后回补（此序错向安全：宁可晚到回调误判售罄[可退款]，不冒先回补被并发买走的超卖）。
// M5 已于 2026-07-09 切换完毕：本 timer 是当前唯一版本（rewrite/ 15 云函数）部署的一部分，
// 旧线 timer 已随切换清退，不再并行服役。

// 每批并发关几单：串行 200 单逼近函数超时，全并发又会一下子把库打满
const CONCURRENCY = 5

export const main = async () => {
  if (!isServerCall()) return ok({ closed: 0 }) // 仅定时器/服务端；客户端带身份调用一律拒
  const db = getDb()
  const _ = db.command
  const cutoff = Date.now() - PAY_WINDOW_MS
  // 读失败≠没有过期单：当空关 0 单，过期单的库存会一直锁着，只告警不猜
  const expired = await db
    .collection(COLLECTIONS.orders)
    .where({ status: 'pending', createdAt: _.lt(cutoff) })
    .limit(200)
    .get()
    .catch(() => null)
  if (!expired) {
    await notifyAlert('money', 'closeExpiredOrders', 'EXPIRED_ORDERS_READ_FAIL', {})
    return err(ERR.INTERNAL)
  }
  const closeOne = async (o: any): Promise<boolean> => {
    const r = await db
      .collection(COLLECTIONS.orders)
      .where({ _id: o._id, status: 'pending' })
      .update({ data: { status: 'closed', closedAt: Date.now() } })
      .catch(() => ({ stats: { updated: 0 } }))
    if (!(r.stats && r.stats.updated === 1)) return false
    if (Array.isArray(o.reserved) && o.reserved.length) await restoreStock(o.reserved)
    return true
  }
  const list: any[] = expired.data || []
  let closed = 0
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const done = await Promise.all(list.slice(i, i + CONCURRENCY).map(closeOne))
    closed += done.filter(Boolean).length
  }
  return ok({ closed })
}
