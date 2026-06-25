import { reply, getTxAlerts, PAID_STATUSES, type Ctx } from '../lib'

// —— 数据看板（债#18 + #18续：消除「≤1000 条/表内存聚合」静默少算）——
// 计数走 .count()（精确·不封顶）；GMV 走 DB aggregate 对 paid 订单求和（精确·不封顶·#18续/债#32）；
// 钱链异常走定向 where（稀少·小集合·精确不漏老单）；最近订单走 orderBy 取真·最新 5（createOrder
// 必写 createdAt → orderBy 不漏单·债#31 不变量）。仅 热度/卡点 仍「近 SAMPLE 条样本」近似（progress
// 超 SAMPLE 时 approx 标注、前端显「近 N 估算」）。
const SAMPLE = 1000

export async function getDashboard({ db }: Ctx) {
  const _ = db.command
  const $ = db.command.aggregate
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
    gmv,
    progressSample,
    courses,
    txAlerts,
    recent,
    paidOrdersN,
  ] = await Promise.all([
    cnt(db.collection('users')),
    cnt(db.collection('orders')),
    cnt(db.collection('qrcodes')),
    cnt(db.collection('qrcodes').where({ status: 'activated' })),
    cnt(db.collection('progress')),
    db
      .collection('orders')
      .aggregate()
      .match({ status: _.in(PAID_STATUSES) })
      .group({ _id: null, gmv: $.sum('$amount') })
      .end()
      .then((r: any) => (r.list && r.list[0] ? Number(r.list[0].gmv) || 0 : 0))
      .catch(() => 0),
    rows(db.collection('progress').field({ done: true, last: true }).limit(SAMPLE)),
    rows(db.collection('courses').field({ id: true, title: true, chapters: true }).limit(SAMPLE)),
    // 钱链异常：单源 helper（dashboard 与 S16 对账共用·防漂移）；内部定向 where 精确（不从样本 filter）
    getTxAlerts(db),
    rows(
      db
        .collection('orders')
        .field({ id: true, amount: true, createdAt: true, items: true })
        .orderBy('createdAt', 'desc')
        .limit(5)
    ),
    // 转化速览：已支付订单数（口径同 GMV·PAID_STATUSES）——下单→支付→激活 各环节量级（指示性·非同批追踪）
    cnt(db.collection('orders').where({ status: _.in(PAID_STATUSES) })),
  ])

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
    // 精确：计数/GMV(aggregate)/异常/最近单；近似：仅 热度/卡点（progress 超 SAMPLE 时标 true，前端显「近 N 估算」）
    approx: { gmv: false, hot: learnersN > SAMPLE, stuck: learnersN > SAMPLE, sampleSize: SAMPLE },
    // 转化速览（指示性量级·非同批 cohort 追踪）：下单→支付→激活。访问/加购未采（前端无 page_view/add_cart
    // 埋点）、完课需逐课判定——均后续。各环节走 .count() 精确不封顶。
    funnel: { ordered: ordersN, paid: paidOrdersN, activated: codesActN },
    txAlerts,
    hot: top(doneCount),
    stuck: top(stuckCount),
    recentOrders,
  })
}
