import { reply, type Ctx } from '../lib'

// —— 数据看板（债#18：消除「≤1000 条/表内存聚合」静默少算）——
// 计数走 .count()（精确·不封顶）；钱链异常走定向 where（异常稀少·结果集小·精确，不漏老单）；
// 最近订单走 orderBy 取真·最新 5（不再从无序 1000 里捞、漏掉真最新）。
// GMV 与 热度/卡点 仍为「近 SAMPLE 单/条样本」近似——精确 GMV 需 DB 聚合/写路径计数器（债#18 续，
// 押后）；故 orders/progress 超 SAMPLE 时在 approx 标注，前端显「近 N 估算」（静默错 → 标注近似）。
const SAMPLE = 1000

export async function getDashboard({ db }: Ctx) {
  const _ = db.command
  const HOUR = 3600_000
  const cnt = (q: any) =>
    q
      .count()
      .then((r: any) => r.total || 0)
      .catch(() => 0)
  const rows = (q: any) =>
    q
      .get()
      .then((r: any) => r.data)
      .catch(() => [])

  const [
    usersN,
    ordersN,
    codesN,
    codesActN,
    learnersN,
    ordersSample,
    progressSample,
    courses,
    feeMismatch,
    refundMismatch,
    stuckRefunds,
    recent,
  ] = await Promise.all([
    cnt(db.collection('users')),
    cnt(db.collection('orders')),
    cnt(db.collection('qrcodes')),
    cnt(db.collection('qrcodes').where({ status: 'activated' })),
    cnt(db.collection('progress')),
    rows(db.collection('orders').field({ amount: true }).orderBy('createdAt', 'desc').limit(SAMPLE)),
    rows(db.collection('progress').field({ done: true, last: true }).limit(SAMPLE)),
    rows(db.collection('courses').field({ id: true, title: true, chapters: true }).limit(SAMPLE)),
    // 钱链异常：定向 where 精确（稀少·小集合），不再从样本 filter（防老单漏报）
    rows(db.collection('orders').where({ feeMismatch: true }).field({ id: true })),
    rows(db.collection('afterSales').where({ refundMismatch: true }).field({ _id: true })),
    rows(
      db
        .collection('afterSales')
        .where({ status: 'approved', approvedAt: _.lt(Date.now() - HOUR) })
        .field({ _id: true })
    ),
    rows(
      db
        .collection('orders')
        .field({ id: true, amount: true, createdAt: true, items: true })
        .orderBy('createdAt', 'desc')
        .limit(5)
    ),
  ])

  const txAlerts = {
    feeMismatch: feeMismatch.map((o: any) => o.id),
    refundMismatch: refundMismatch.map((a: any) => a._id),
    stuckRefunds: stuckRefunds.map((a: any) => a._id),
  }

  // 段名映射（课程数少·全量）
  const segName: Record<string, string> = {}
  for (const c of courses)
    for (const ch of c.chapters || [])
      for (const l of ch.lessons || [])
        for (const sg of l.segments || []) segName[sg.id] = `${l.name} · ${sg.name}`

  const doneCount: Record<string, number> = {}
  const stuckCount: Record<string, number> = {}
  for (const pr of progressSample) {
    for (const k of Object.keys(pr.done || {})) doneCount[k] = (doneCount[k] || 0) + 1
    if (pr.last?.segmentId) stuckCount[pr.last.segmentId] = (stuckCount[pr.last.segmentId] || 0) + 1
  }
  const top = (m: Record<string, number>) =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([segId, count]) => ({ segId, name: segName[segId] || segId, count }))

  const gmv = ordersSample.reduce((n: number, o: any) => n + (Number(o.amount) || 0), 0)
  const recentOrders = recent.map((o: any) => ({
    id: o.id,
    amount: o.amount,
    createdAt: o.createdAt,
    summary: (o.items || [])
      .map((it: any) => `${it.name}×${it.qty}`)
      .join('、')
      .slice(0, 40),
  }))

  return reply(200, {
    ok: true,
    stats: {
      users: usersN,
      orders: ordersN,
      gmv,
      codesTotal: codesN,
      codesActivated: codesActN,
      learners: learnersN,
    },
    // 精确：计数/异常/最近单；近似：GMV、热度/卡点（仅当超 SAMPLE 时标 true，前端显「近 N 估算」）
    approx: { gmv: ordersN > SAMPLE, hot: learnersN > SAMPLE, stuck: learnersN > SAMPLE, sampleSize: SAMPLE },
    txAlerts,
    hot: top(doneCount),
    stuck: top(stuckCount),
    recentOrders,
  })
}
