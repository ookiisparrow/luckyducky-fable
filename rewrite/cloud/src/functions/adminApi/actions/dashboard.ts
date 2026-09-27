import { getTxAlerts, type Ctx } from '../lib'
import { ok } from '../../../kit'
import { listOrders } from './orders'
import { COLLECTIONS, PAID_ORDER_STATUSES } from '@ldrw/shared'

// —— 数据看板（不做「≤1000 条/表内存聚合」，那样会静默少算）——
// 计数走 .count()（精确·不封顶）；GMV 走 DB aggregate 对 paid 订单求和（精确·不封顶）；
// 钱链异常走定向 where（稀少·小集合·精确不漏老单）；最近订单走 orderBy 取真·最新 5（createOrder
// 必写 createdAt → orderBy 不漏单）。仅 热度/卡点 仍「近 SAMPLE 条样本」近似（progress
// 超 SAMPLE 时 approx 标注、前端显「近 N 估算」）。
const SAMPLE = 1000

// 待发货＝shipOne 会放行的首发单：paid、无 feeMismatch、不被退款拦。退款从不改订单状态，全额退款的单
// 永远停在 paid，只数 status=paid 会越积越多。refundHold 借 listOrders 算（与 shipOne 同一判据，不另抄一份）；
// 调用方 caps 原样传：getDashboard 未登记 ACTION_CAPS、默认要 admin:write，listOrders 对它放行全店浏览。
// 订单上没有能直接筛掉「全额退款」的字段（refunded 是逐行金额表），查询条件排不掉它们：全额退款的单永不离开 paid，
// 全量翻会随历史线性变长、撞 adminApi 30s 超时，把整个看板连同 txAlerts 钱链告警一起拖成 500。
// ponytail: 只从最新往回翻 TO_SHIP_SCAN 张 paid 单，触顶在 approx.toShip 标出来（数是下限），更老的可发单会漏数。
// 升级：写侧维护待发货计数（付款/发货/退款落账处增减）。
const TO_SHIP_SCAN = 2000 // 10 页 × 每页约 3 次读，约 1~2 秒
async function countToShip(ctx: Ctx): Promise<{ n: number; capped: boolean }> {
  let n = 0
  let seen = 0
  let cursor: unknown = null
  for (;;) {
    const r = await listOrders({ ...ctx, data: { status: 'paid', cursor, limit: 200 } })
    if (!r.ok) throw new Error('TO_SHIP_READ_FAIL:' + r.error) // 查不到退款态≠都能发：同看板其余读失败，整体报错
    n += r.list.filter((o: any) => !o.feeMismatch && !o.refundHold).length
    seen += r.list.length
    if (!r.hasMore) return { n, capped: false }
    if (seen >= TO_SHIP_SCAN) return { n, capped: true }
    cursor = r.nextCursor
  }
}

export async function getDashboard(ctx: Ctx) {
  const { db } = ctx
  const _ = db.command
  const $ = db.command.aggregate
  // 读失败 fail-loud（同 getInventory）：.catch 装 0/[] 会让看板把「库挂了」画成空店。抛给 adminApi 网关 500。
  const cnt = (q: any) => q.count().then((r: any) => r.total || 0)
  const rows = (q: any) => q.get().then((r: any) => r.data)

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
    recentActs,
    recentRefs,
    toShip,
  ] = await Promise.all([
    cnt(db.collection(COLLECTIONS.users)),
    cnt(db.collection(COLLECTIONS.orders)),
    cnt(db.collection(COLLECTIONS.qrcodes)),
    cnt(db.collection(COLLECTIONS.qrcodes).where({ status: 'activated' })),
    cnt(db.collection(COLLECTIONS.progress)),
    db
      .collection(COLLECTIONS.orders)
      .aggregate()
      .match({ status: _.in(PAID_ORDER_STATUSES) })
      .group({ _id: null, gmv: $.sum('$amount') })
      .end()
      .then((r: any) => (r.list && r.list[0] ? Number(r.list[0].gmv) || 0 : 0)),
    rows(db.collection(COLLECTIONS.progress).field({ done: true, last: true }).limit(SAMPLE)),
    rows(db.collection(COLLECTIONS.courses).field({ id: true, title: true, chapters: true }).limit(SAMPLE)),
    // 钱链异常：单源 helper（dashboard 与对账页共用·防漂移）；内部定向 where 精确（不从样本 filter）
    getTxAlerts(db),
    rows(
      db
        .collection(COLLECTIONS.orders)
        .field({ id: true, amount: true, createdAt: true, items: true })
        .orderBy('createdAt', 'desc')
        .limit(5)
    ),
    // 转化速览：已支付订单数（口径同 GMV·PAID_ORDER_STATUSES）——下单→支付→激活 各环节量级（指示性·非同批追踪）
    cnt(db.collection(COLLECTIONS.orders).where({ status: _.in(PAID_ORDER_STATUSES) })),
    // 最近动态混合流：近期激活/进课 + 退款申请，与最近订单合并成一条时间轴（各 orderBy+limit 有界）
    rows(
      db
        .collection(COLLECTIONS.activations)
        .field({ code: true, courseId: true, createdAt: true, enteredAt: true })
        .orderBy('createdAt', 'desc')
        .limit(6)
    ),
    rows(
      db
        .collection(COLLECTIONS.afterSales)
        .field({ orderId: true, refundAmount: true, appliedAt: true })
        .orderBy('appliedAt', 'desc')
        .limit(6)
    ),
    countToShip(ctx),
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

  // 最近动态混合流：订单(createdAt) + 激活/进课(activations) + 退款申请(afterSales) 合并按事件时间倒序。
  // 指示性：激活按 createdAt 取近 6（已进课的取 enteredAt 作事件时刻）——非穷尽审计，与看板其余近似口径一致（根因#8）。
  const yuan = (n: any) => '￥' + Number(n || 0).toFixed(2)
  const ords = recent.map((o: any) => ({ type: 'order', at: o.createdAt || 0, text: `新订单 ${o.id} · ${yuan(o.amount)}` }))
  const acts = (recentActs || []).map((a: any) =>
    a.enteredAt
      ? { type: 'enter', at: a.enteredAt, text: `确认进课 ${a.courseId || ''}`.trim() }
      : { type: 'activate', at: a.createdAt || 0, text: `激活 ${a.code || a.courseId || ''}`.trim() }
  )
  const refs = (recentRefs || []).map((r: any) => ({
    type: 'refund',
    at: r.appliedAt || 0,
    text: `退款申请 ${r.orderId || ''} · ${yuan(r.refundAmount)}`,
  }))
  const recentActivity = [...ords, ...acts, ...refs].sort((a, b) => b.at - a.at).slice(0, 8)

  return ok({
    stats: {
      users: usersN,
      orders: ordersN,
      gmv,
      codesTotal: codesN,
      codesActivated: codesActN,
      learners: learnersN,
    },
    // 精确：计数/GMV(aggregate)/异常/最近单；近似：热度/卡点（progress 超 SAMPLE 时标 true，前端显「近 N 估算」），
    // 待发货扫描触顶时 toShip:true（数是下限，前端显「N+」）
    approx: {
      gmv: false,
      hot: learnersN > SAMPLE,
      stuck: learnersN > SAMPLE,
      sampleSize: SAMPLE,
      toShip: toShip.capped,
    },
    // 转化速览（指示性量级·非同批 cohort 追踪）：下单→支付→激活。访问/加购未采（前端无 page_view/add_cart
    // 埋点）、完课需逐课判定——均后续。各环节走 .count() 精确不封顶。
    funnel: { ordered: ordersN, paid: paidOrdersN, activated: codesActN },
    toShip: toShip.n,
    txAlerts,
    hot: top(doneCount),
    stuck: top(stuckCount),
    recentActivity,
  })
}
