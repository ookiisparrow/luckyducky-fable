import { getDb, isServerCall, ok, notifyRecall, COLLECTIONS } from '../../../kit'
import { PAY_WINDOW_MS } from '@luckyducky/shared'
import { recallCandidates } from './rules'

// 主动召回扫描（后台360工作站 B4.4·定时触发器·见 cloudbaserc recallTimer 每日一次）：读 bounded 近窗数据 →
// 纯决策 rules 算出「该主动联系的人」四类 → 经唯一 botpush 接缝（kit/observe notifyRecall）推运营群机器人，
// 运营据此触达（非自动给顾客发消息）。仅定时/服务端触发（isServerCall·无 openid·根因#3 防滥调）；只读 + 推送、
// 不写库。各读 bounded（capacity-reads-bounded·防大表全扫）。fail-soft：推送失败不反噬（notifyRecall 内吞）。
const SCAN = 500

export const main = async () => {
  if (!isServerCall()) return ok({ skipped: true }) // 客户端带身份调用一律拒（根因#3）
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
  if (result.total > 0) await notifyRecall(summary) // 复用 botpush 唯一接缝（根因#12）·有候选才推
  return ok(summary)
}
