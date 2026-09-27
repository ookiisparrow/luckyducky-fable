import { PAY_WINDOW_MS, COLLECTIONS, ERR } from '@ldrw/shared'
import { getDb, ok, err, isServerCall, notifyAlert, closePendingOrder } from '../../kit'

// 超时关单（定时触发器）：pending 超支付窗 → closed，抢占成功那次才回补
// 预留库存（绑状态转移＝天然幂等，已 closed 不在查询内）。bounded ≤200/次。关单与回补见 closePendingOrder。

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
  // 一单写失败不拖垮整批：没关上的留在 pending，下次扫描重关（自愈）
  const closeOne = (o: any): Promise<boolean> => closePendingOrder(o._id, o.reserved).catch(() => false)
  const list: any[] = expired.data || []
  let closed = 0
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const done = await Promise.all(list.slice(i, i + CONCURRENCY).map(closeOne))
    closed += done.filter(Boolean).length
  }
  return ok({ closed })
}
