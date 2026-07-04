import { PAY_WINDOW_MS, COLLECTIONS } from '@ldrw/shared'
import { getDb, isServerCall, ok, notifyRecall } from '../../kit'
import { recallCandidates } from './recallRules'

// 主动召回扫描（黄金 cs-agent §八·纯决策与 I/O 分离）：读 bounded 近窗数据 → rules 算四类候选 →
// 经唯一接缝推运营群（运营据此触达·非自动发消息给顾客）。仅服务端/定时触发；只读不写库。
const SCAN = 500

export const main = async () => {
  if (!isServerCall()) return ok({ skipped: true })
  const db = getDb()
  const rd = (q: any) =>
    q
      .get()
      .then((r: any) => (r && r.data) || [])
      .catch(() => [])
  const [pendingOrders, shippedOrders, activations, progress] = await Promise.all([
    rd(db.collection(COLLECTIONS.orders).where({ status: 'pending' }).orderBy('createdAt', 'desc').limit(SCAN)),
    rd(db.collection(COLLECTIONS.orders).where({ status: 'shipped' }).orderBy('shippedAt', 'asc').limit(SCAN)),
    rd(db.collection(COLLECTIONS.activations).orderBy('createdAt', 'desc').limit(SCAN)),
    rd(db.collection(COLLECTIONS.progress).limit(SCAN)),
  ])
  const result = recallCandidates({ now: Date.now(), payWindowMs: PAY_WINDOW_MS, pendingOrders, shippedOrders, activations, progress })
  const summary = {
    unpaid: result.unpaid.length,
    logistics: result.logistics.length,
    unstarted: result.unstarted.length,
    unfinished: result.unfinished.length,
    total: result.total,
  }
  if (result.total > 0) await notifyRecall(summary)
  return ok(summary)
}
