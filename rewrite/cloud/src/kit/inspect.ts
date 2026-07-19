import { getDb } from './db'
import { recordAnomaly } from './anomaly'
import { notifyHeartbeat } from './observe'
import {
  COLLECTIONS,
  type CheckResult,
  type CheckLayer,
  type AnomalyKind,
  type InspectRunRecord,
  refundShareFen,
  toFen,
  asFen,
} from '@ldrw/shared'

// 巡检机（运行期主动核对·不依赖 AI·守卫 rw-inspect-golden）：定时/手动跑一遍检查目录——
// A 基建存活（探得动）+ B 业务不变量（数据自洽）。北极星＝把没抛异常/没人投诉的静默失败主动探出：
// 每条红 → recordAnomaly 落 bug 账本（违反→闭环）+ 高危经 recordAnomaly 内部推告警。**只读铁律**：
// 只读业务集合、只写 inspectRuns/anomalies，绝不改业务数据（「现在只读看护线上」的安全前提）。

const SCAN_CAP = 500 // 单类单次扫描上限（有界·防容量炸弹）；触顶显式标 capped、不假装扫全了（no silent caps）
const IN_CHUNK = 100 // _.in 每批键数（照 recallScan 先例·≤500 键 ≤5 次查询·每轮巡检可担）
const STUCK_PAID_MS = 72 * 3600 * 1000 // 付款超 72h 仍未发货＝卡单（付了钱没发货·典型静默伤客）

type Partial = Omit<CheckResult, 'id' | 'title' | 'layer'>

/**
 * 该单**实际退得出来的上限**（整数分）——死信「已退清」判据的分母（批K 评审 P1）。
 *
 * 为什么不能直接用 order.amount：退款按行走 refundShareFen 比例分摊，每行各自 Math.round 且行与行之间
 * **不共享余数预算**（overrideRefund 只接受单行 lineId，没有「退整单剩余」的路径，行级封顶用尽即
 * NOTHING_LEFT）。而 amount≠goods 是本系统常态（COUPON 是固定额券、非按比例），故 2 行以上订单的
 * 「各行分摊之和」常比实付额少几分，且这几分**没有任何入口能追回**。若分母还用 amount，管理员把每一行
 * 都退到各自上限后订单依旧「差几分」→ 永久红/high、还挤占 samples 前 10 位，正是本批要消灭的假死信
 * 换个形状复发。故分母改为「逐行理论分摊上限之和」（与 overrideRefund 的 lineShare 同一份公式，used=0）。
 *
 * 钱守恒不受影响：这里只改**巡检报不报**的判据，不放宽任何退款金额闸（refundShareFen 封顶原样）。
 * fail-closed：items/goods 快照缺失或脏数据算不出 → 退回 amount 口径（更严），让该单继续被报死信。
 */
function refundableCapFen(o: any): number {
  const amountFen = toFen(Number(o.amount || 0))
  if (!(amountFen > 0)) return 0
  try {
    const items: any[] = Array.isArray(o.items) ? o.items : []
    const goodsFen = toFen(Number(o.goods || 0))
    if (!items.length || !(goodsFen > 0)) return amountFen // 缺行/缺货款快照 → 保守用 amount
    let sum = 0
    for (const it of items) {
      const itemFen = asFen(Math.round(toFen(Number(it.price || 0)) * (Number(it.qty) || 1)))
      sum += refundShareFen(amountFen, goodsFen, itemFen, asFen(0)) as number
    }
    return Math.min(amountFen, sum) // 分摊和不该超实付，越界即按 amount 收口
  } catch {
    return amountFen // 脏数据（NaN 价/非整分）→ 保守用 amount，宁可多报一次
  }
}

interface Check {
  id: string
  title: string
  layer: CheckLayer
  kind: AnomalyKind // 红时落 anomaly 的来源分类
  run(db: any): Promise<Partial>
}

const CHECKS: Check[] = [
  {
    id: 'db-reachable',
    title: '数据库可达',
    layer: 'infra',
    kind: 'flow-failure',
    async run(db) {
      try {
        await db.collection(COLLECTIONS.config).limit(1).get()
        return { status: 'green', detail: 'DB 读通', severity: 'low' }
      } catch (e) {
        return { status: 'red', detail: 'DB 读失败：' + String(e).slice(0, 80), severity: 'high' }
      }
    },
  },
  {
    id: 'money-conserved',
    title: '钱守恒（退款不超实付）',
    layer: 'invariant',
    kind: 'invariant-violation',
    async run(db) {
      // 扫已退款售后（有界），按 orderId 归集退款额，比对该单实付 order.amount——超了＝静默多退钱。
      const as = await db
        .collection(COLLECTIONS.afterSales)
        .where({ status: 'refunded' })
        .limit(SCAN_CAP)
        .get()
        .catch(() => ({ data: [] }))
      const rows: any[] = as.data || []
      const _ = db.command
      const byOrder = new Map<string, number>()
      for (const a of rows) byOrder.set(String(a.orderId), (byOrder.get(String(a.orderId)) || 0) + Number(a.refundAmount || 0))
      // 批量读订单实付（_.in 分块·照 recallScan IN_CHUNK=100·杜绝 ≤500 键逐条串行 doc.get 的 N+1）；
      // 内存比对，判定语义与逐条 get 版一致（订单缺失=amountById 无键→跳过·不误报超退）。
      const orderIds = [...byOrder.keys()]
      const amountById = new Map<string, number>()
      for (let i = 0; i < orderIds.length; i += IN_CHUNK) {
        const chunk = orderIds.slice(i, i + IN_CHUNK)
        const got = await db.collection(COLLECTIONS.orders).where({ _id: _.in(chunk) }).limit(IN_CHUNK).get().catch(() => ({ data: [] }))
        for (const o of got.data || []) amountById.set(String(o._id), Number(o.amount || 0))
      }
      const bad: string[] = []
      for (const [orderId, refunded] of byOrder) {
        if (!amountById.has(orderId)) continue // 订单缺失（逐条 get 落空即跳过·语义不变）
        if (refunded > (amountById.get(orderId) || 0) + 1e-6) bad.push(orderId)
      }
      const capped = rows.length >= SCAN_CAP
      return bad.length
        ? { status: 'red', detail: `${bad.length} 单退款超实付（静默多退钱）`, count: bad.length, samples: bad.slice(0, 10), severity: 'high', scanned: rows.length, capped }
        : { status: 'green', detail: '退款均未超实付', severity: 'low', scanned: rows.length, capped }
    },
  },
  {
    id: 'stuck-order',
    title: '卡单（付了钱没发货 / 待人工退款死信）',
    layer: 'invariant',
    kind: 'invariant-violation',
    async run(db) {
      const now = Date.now()
      const _ = db.command
      // 排除：有活跃售后（申请中/已同意/已退）的订单＝正在退款·非发货义务（不误报卡单）
      const asRows: any[] =
        (
          await db
            .collection(COLLECTIONS.afterSales)
            .where({ status: _.in(['applied', 'approved', 'refunded']) })
            .limit(SCAN_CAP)
            .get()
            .catch(() => ({ data: [] }))
        ).data || []
      const refunding = new Set(asRows.map((a) => String(a.orderId)))
      // ① paid 超 72h 未发货——只算**真付款**（有微信 transactionId·mock/演示单非真钱不算）且**未在退款**：只报真金白银该发没发的单。
      const paid = await db
        .collection(COLLECTIONS.orders)
        .where({ status: 'paid' })
        .limit(SCAN_CAP)
        .get()
        .catch(() => ({ data: [] }))
      const paidRows: any[] = paid.data || []
      const stuck = paidRows
        .filter(
          (o) =>
            !o.shippedAt && o.transactionId && Number(o.paidAt || 0) > 0 && now - Number(o.paidAt) > STUCK_PAID_MS && !refunding.has(String(o._id)),
        )
        .map((o) => String(o._id))
      // ② refund_required 死信（钱已收待人工退款·没人管＝高危静默）
      const dead = await db
        .collection(COLLECTIONS.orders)
        .where({ status: 'refund_required' })
        .limit(SCAN_CAP)
        .get()
        .catch(() => ({ data: [] }))
      const deadRows: any[] = dead.data || []
      // 死信判据＝「refund_required **且钱还没退清**」（批K K2·与放行越规退款同批落地）：退款成功后**订单
      // 状态不变**（refundCallback 只回补库存 + 写 refunded.<lineId> 对账痕，从不改 order.status——退款真相
      // 单一来源是售后单），若判据停在「状态即死信」，退清的单会被永远报死信、淹没真死信。
      // 批量读该单已到账退款额（_.in 分块·照 money-conserved/recallScan 先例·杜绝逐单 doc.get 的 N+1）；
      // 只认 status==='refunded'（真到买家手里），applied/approved 在途不算退清。单位：afterSales.refundAmount
      // 与 order.amount 同为「元」number，本处一律先 toFen 换成整数分再比较（整数域无需容差）。
      // 分母＝**该单实际可退上限** refundableCapFen(o)，不是 order.amount（批K 评审 P1）。
      // fail-closed：查询失败 → catch 兜空 → 该单已退额算 0 → 仍计死信（宁可多报一次，不可漏报真死信）；
      // amount 缺失/为 0 同理按未退清计（不让脏数据把死信静默洗白）。
      const refundedByOrder = new Map<string, number>()
      const deadOrderIds = deadRows.map((o) => String(o._id))
      for (let i = 0; i < deadOrderIds.length; i += IN_CHUNK) {
        const chunk = deadOrderIds.slice(i, i + IN_CHUNK)
        const got = await db
          .collection(COLLECTIONS.afterSales)
          .where({ orderId: _.in(chunk), status: 'refunded' })
          .limit(SCAN_CAP) // 一单可多行售后 → 按行数封顶（非键数）·有界
          .get()
          .catch(() => ({ data: [] }))
        for (const a of got.data || [])
          // 逐行先换算成整数分再累加（不累加元浮点后一次性取整）：整数域比较无需容差，杜绝浮点噪声。
          refundedByOrder.set(String(a.orderId), (refundedByOrder.get(String(a.orderId)) || 0) + toFen(Number(a.refundAmount || 0)))
      }
      const deadIds = deadRows
        .filter((o) => {
          const capFen = refundableCapFen(o)
          if (!(capFen > 0)) return true // 实付额/可退上限读不到 → 保守计死信
          return (refundedByOrder.get(String(o._id)) || 0) < capFen // 没退清才是死信（整数分比较）
        })
        .map((o) => String(o._id))
      const all = [...stuck, ...deadIds]
      const scanned = paidRows.length + deadRows.length + asRows.length
      const capped = paidRows.length >= SCAN_CAP || deadRows.length >= SCAN_CAP || asRows.length >= SCAN_CAP
      return all.length
        ? {
            status: 'red',
            detail: `${stuck.length} 单真付款超 72h 未发货·${deadIds.length} 单待人工退款死信`,
            count: all.length,
            samples: all.slice(0, 10),
            severity: deadIds.length ? 'high' : 'low', // 死信＝钱已收没人管·高危；纯超时未发＝低危提醒
            scanned,
            capped,
          }
        : { status: 'green', detail: '无卡单/死信', severity: 'low', scanned, capped }
    },
  },
]

/**
 * 跑一轮巡检：逐条检查（单条异常→本条红、不炸整轮·fail-soft）→ 写 inspectRuns 体检报告 →
 * 每条红落 recordAnomaly（违反→bug 账本闭环·指纹=检查 id·同类反复只累加不刷屏·高危内部推告警）。
 * 返回本轮报告。**只读**：只读业务集合、只写 inspectRuns/anomalies。
 */
export async function runInspection(trigger: 'timer' | 'manual'): Promise<InspectRunRecord> {
  const db = getDb()
  const startedAt = Date.now()
  const results: CheckResult[] = []
  for (const c of CHECKS) {
    let partial: Partial
    try {
      partial = await c.run(db)
    } catch (e) {
      partial = { status: 'red', detail: '检查自身异常：' + String(e).slice(0, 80), severity: 'high' }
    }
    const r: CheckResult = { id: c.id, title: c.title, layer: c.layer, ...partial }
    results.push(r)
    if (r.status === 'red') {
      const code = 'INSPECT_' + c.id.toUpperCase().replace(/-/g, '_')
      await recordAnomaly(c.kind, code, { fp: c.id, count: r.count, samples: (r.samples || []).join(','), detail: r.detail }, r.severity)
    }
  }
  const finishedAt = Date.now()
  const summary = {
    green: results.filter((r) => r.status === 'green').length,
    yellow: results.filter((r) => r.status === 'yellow').length,
    red: results.filter((r) => r.status === 'red').length,
  }
  const run: InspectRunRecord = { _id: `inspect_${trigger}_${startedAt}`, startedAt, finishedAt, trigger, results, summary }
  // 写巡检史（fail-soft·写失败不炸巡检结论）
  try {
    await db.collection(COLLECTIONS.inspectRuns).add({ data: run })
  } catch {
    try {
      await db.createCollection(COLLECTIONS.inspectRuns)
      await db.collection(COLLECTIONS.inspectRuns).add({ data: run })
    } catch {
      /* fail-soft */
    }
  }
  return run
}

/**
 * A5 每日心跳（观测批②「全绿也报平安」·终结「告警的告警」递归）：inspect 全绿时零输出，「该来的消息没来」
 * 本身无从发现——每日经既有 bot 接缝主动发一条「巡检机存活」。**去重**：确定性 _id `hb:<YYYYMMDD>`
 * （Asia/Shanghai·UTC+8 显式换算）写 inspectRuns，add-first 撞 id=今日已发→跳过（病根#2 房式幂等·
 * timers/inspect 每 2h 跑·触发相位随部署漂移故用确定性日 id 不用固定小时窗）。心跳档带 `startedAt:0`
 * + 形状兜底（`summary/results`·防体检面板解构空集合炸），**不污染体检读路径**（getInspectStatus 过滤
 * startedAt>0）。心跳非异常——**绝不落 recordAnomaly**（不污染 anomalies 账本）。fail-soft：绝不反噬主流程。
 */
export async function sendDailyHeartbeat(summary: { green: number; red: number }): Promise<void> {
  try {
    const db = getDb()
    // Asia/Shanghai（UTC+8）当日：+8h 后取 UTC 日期部分——相对本地时区无关、确定性可撞键去重。
    const day = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '')
    // summary 落当日真实计数（评审 P3：只写占位 0/0 会让直查 tcb db 的人被「全绿」误导；读路径已按 startedAt>0 过滤、此字段仅供直查审计）
    const rec = { _id: `hb:${day}`, startedAt: 0, finishedAt: 0, trigger: 'timer', summary: { green: summary.green, red: summary.red }, results: [] }
    try {
      await db.collection(COLLECTIONS.inspectRuns).add({ data: rec })
    } catch {
      return // 撞 id（今日已发）或写失败——不重复推（幂等·fail-soft）；集合缺失时 runInspection 已先建
    }
    await notifyHeartbeat(summary)
  } catch {
    /* fail-soft：可观测性绝不反噬主流程 */
  }
}
