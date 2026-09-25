import { PAY_WINDOW_MS, COLLECTIONS } from '@ldrw/shared'
import { getDb, isServerCall, ok, notifyRecall, alert } from '../../kit'
import { recallCandidates } from './recallRules'

// 主动召回扫描（黄金 cs-agent §八·纯决策与 I/O 分离）：读 bounded 定向数据 → rules 算四类候选 →
// 经唯一接缝推运营群（运营据此触达·非自动发消息给顾客）。仅服务端/定时触发；只读不写库。
//
// 定向查询（课程链路审计 2026-07-17·根因#7）：原先 activations 按 createdAt 倒序滑窗取 500——激活总量
// 破 500 后，老的未进课客户被新激活永久挤出窗口，本该挽回的长尾恰恰再也进不了召回名单；progress 更是
// 无序全局抽 500，破 500 后活跃学员的进度文档抽不进来就被误判「开了没学」误打扰。改为：
//   unstarted 直接 where({enteredAt:null})（未进课者本身就是候选集，进课即离开该集合，不再被挤出）；
//   unfinished 取最近进课的一批（enteredAt 倒序·久远未学的超出运营挽回时效），progress 按这批 openid
//   定向查（分块 _.in），不再指望全局抽样恰好抽中。
const SCAN = 500
const IN_CHUNK = 100 // _.in 每批 openid 数（稳妥上界·500/批 ≤5 次查询，每日一轮可担）

export const main = async () => {
  if (!isServerCall()) return ok({ skipped: true })
  const db = getDb()
  const _ = db.command
  const rd = (q: any) =>
    q
      .get()
      .then((r: any) => (r && r.data) || [])
      .catch(() => [])
  const [pendingOrders, shippedOrders, actsUnstarted, actsEntered] = await Promise.all([
    rd(db.collection(COLLECTIONS.orders).where({ status: 'pending' }).orderBy('createdAt', 'desc').limit(SCAN)),
    rd(db.collection(COLLECTIONS.orders).where({ status: 'shipped' }).orderBy('shippedAt', 'asc').limit(SCAN)),
    rd(db.collection(COLLECTIONS.activations).where({ enteredAt: null }).limit(SCAN)),
    rd(db.collection(COLLECTIONS.activations).where({ enteredAt: _.neq(null) }).orderBy('enteredAt', 'desc').limit(SCAN)),
  ])
  // progress 定向读：只查已进课这批人的进度（unfinished 判据只消费这批·unstarted 不需要 progress）
  const openids = [...new Set<string>(actsEntered.map((a: any) => String(a._openid || '')).filter(Boolean))]
  const chunks: string[][] = []
  for (let i = 0; i < openids.length; i += IN_CHUNK) chunks.push(openids.slice(i, i + IN_CHUNK))
  const pages = await Promise.all(
    chunks.map((c) => db.collection(COLLECTIONS.progress).where({ _openid: _.in(c) }).limit(1000).get().then((r: any) => (r && r.data) || [], () => null)),
  )
  // 进度读失败≠没进度：当空会把这批已进课学员全判「开了没学」误推运营群，故这轮不判 unfinished
  const progressOk = pages.every(Boolean)
  if (!progressOk) alert('anomaly', 'recallScan', 'PROGRESS_READ_FAILED')
  const progress = progressOk ? pages.flat() : []
  const activations = progressOk ? [...actsUnstarted, ...actsEntered] : actsUnstarted
  const result = recallCandidates({ now: Date.now(), payWindowMs: PAY_WINDOW_MS, pendingOrders, shippedOrders, activations, progress })
  const summary: Record<string, number> = {
    unpaid: result.unpaid.length,
    logistics: result.logistics.length,
    unstarted: result.unstarted.length,
    // 跳过时不写 unfinished：写 0 与「真没人开了没学」分不开，运营会以为这轮没有
    ...(progressOk ? { unfinished: result.unfinished.length } : { unfinishedSkipped: 1 }),
    total: result.total,
  }
  if (result.total > 0 || !progressOk) await notifyRecall(summary)
  // capped：任一切片打满 SCAN＝候选可能超窗（近似值·同 dashboard approx 口径），返回值如实标注不装全量
  return ok({ ...summary, capped: actsUnstarted.length >= SCAN || actsEntered.length >= SCAN })
}
