import { reply, type Ctx } from '../lib'

// —— 数据看板（小规模内存聚合，≤1000 条/表）——
export async function getDashboard({ db }: Ctx) {
  const take = (coll: string, field: any) =>
    db.collection(coll).field(field).limit(1000).get().then((r: any) => r.data).catch(() => [])
  const [users, orders, codes, progress, courses, sales] = await Promise.all([
    take('users', { _id: true }),
    take('orders', { amount: true, status: true, createdAt: true, id: true, items: true, feeMismatch: true }),
    take('qrcodes', { status: true, courseId: true }),
    take('progress', { done: true, last: true, courseId: true }),
    take('courses', { id: true, title: true, chapters: true }),
    take('afterSales', { _id: true, orderId: true, status: true, refundMismatch: true, approvedAt: true, refundAmount: true }),
  ])

  // 交易异常（审核批次B「查询即对账」）：①支付金额异常 ②退款通知不符 ③退款触发超 1h 未回调
  const HOUR = 3600_000
  const txAlerts = {
    feeMismatch: orders.filter((o: any) => o.feeMismatch).map((o: any) => o.id),
    refundMismatch: sales.filter((a: any) => a.refundMismatch).map((a: any) => a._id),
    stuckRefunds: sales
      .filter((a: any) => a.status === 'approved' && a.approvedAt && Date.now() - a.approvedAt > HOUR)
      .map((a: any) => a._id),
  }

  const segName: Record<string, string> = {}
  for (const c of courses)
    for (const ch of c.chapters || [])
      for (const l of ch.lessons || [])
        for (const sg of l.segments || []) segName[sg.id] = `${l.name} · ${sg.name}`

  const doneCount: Record<string, number> = {}
  const stuckCount: Record<string, number> = {}
  let learners = 0
  for (const pr of progress) {
    learners++
    for (const k of Object.keys(pr.done || {})) doneCount[k] = (doneCount[k] || 0) + 1
    if (pr.last?.segmentId) stuckCount[pr.last.segmentId] = (stuckCount[pr.last.segmentId] || 0) + 1
  }
  const top = (m: Record<string, number>) =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([segId, count]) => ({ segId, name: segName[segId] || segId, count }))

  const gmv = orders.reduce((n: number, o: any) => n + (Number(o.amount) || 0), 0)
  const activated = codes.filter((q: any) => q.status === 'activated').length
  const recentOrders = orders
    .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 5)
    .map((o: any) => ({
      id: o.id,
      amount: o.amount,
      createdAt: o.createdAt,
      summary: (o.items || []).map((it: any) => `${it.name}×${it.qty}`).join('、').slice(0, 40),
    }))

  return reply(200, {
    ok: true,
    stats: { users: users.length, orders: orders.length, gmv, codesTotal: codes.length, codesActivated: activated, learners },
    txAlerts,
    hot: top(doneCount),
    stuck: top(stuckCount),
    recentOrders,
  })
}
