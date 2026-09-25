import { getDb, isCollectionMissing } from './db'
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
  AFTERSALE_INFLIGHT_STATUSES,
  AFTERSALE_QUOTA_STATUSES,
  PAY_WINDOW_MS,
} from '@ldrw/shared'

// 巡检机（运行期主动核对·不依赖 AI）：定时/手动跑一遍检查目录——
// A 基建存活（探得动）+ B 业务不变量（数据自洽）。北极星＝把没抛异常/没人投诉的静默失败主动探出：
// 每条红 → recordAnomaly 落 bug 账本（违反→闭环）+ 高危经 recordAnomaly 内部推告警。**只读铁律**：
// 只读业务集合、只写 inspectRuns/anomalies，绝不改业务数据（「现在只读看护线上」的安全前提）。

const SCAN_CAP = 500 // 单类单次扫描上限（有界·防容量炸弹）；触顶显式标 capped、不假装扫全了（no silent caps）
const IN_CHUNK = 100 // _.in 每批键数（照 recallScan 先例·≤500 键 ≤5 次查询·每轮巡检可担）
const STUCK_PAID_MS = 72 * 3600 * 1000 // 付款超 72h 仍未发货＝卡单（付了钱没发货·典型静默伤客）
// 关单定时任务每 5 分钟跑一轮：超窗再过 1 小时还是 pending，说明它连着十来轮没关掉，不是还没轮到。
const PENDING_OVERDUE_MS = PAY_WINDOW_MS + 3600 * 1000

// 金额字段合法性（全文件共用一把尺子）：必须是有限非负 number——全部写入方都走 fenToYuan 落 number，
// 故此判据不误伤正常行；脏/缺则 fail-closed 报给人看（算不准就别假装守恒/已退清成立）。
const okMoney = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

// 主扫描读失败一律抛给 runInspection 标红（失败≠空态：读不到就报绿＝真钱漏了却说没事）；
// 只有「集合还没建」才等于真没有数据。

const scan = (db: any, coll: string, where: Record<string, unknown>): Promise<any[]> =>
  db.collection(coll).where(where).limit(SCAN_CAP).get().then((r: any) => r.data || [])

type Partial = Omit<CheckResult, 'id' | 'title' | 'layer'>

// 按 orderId 批量读售后（_.in 分块·每批按行数封顶 SCAN_CAP，一单可多行售后）。读失败当空集：
// 调用方拿到空集都往多报走（不豁免卡单 / 不算已退清），宁可多报一次，不可漏报。
async function afterSalesOf(db: any, orderIds: string[], status: unknown): Promise<{ rows: any[]; capped: boolean }> {
  const _ = db.command
  const rows: any[] = []
  let capped = false
  for (let i = 0; i < orderIds.length; i += IN_CHUNK) {
    const got = await db
      .collection(COLLECTIONS.afterSales)
      .where({ orderId: _.in(orderIds.slice(i, i + IN_CHUNK)), status })
      .limit(SCAN_CAP)
      .get()
      .catch(() => ({ data: [] }))
    const data = got.data || []
    if (data.length >= SCAN_CAP) capped = true
    rows.push(...data)
  }
  return { rows, capped }
}

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
function refundableCapFen(o: any, amountFenOverride?: number): number {
  // amountFenOverride：payment_exception 单按实际到账 paidFee 退款（overrideRefund 分母），
  // 巡检判「已退清」也必须用同一分母；缺省走订单 amount（refund_required/普通单）。
  const amountFen = amountFenOverride !== undefined ? asFen(amountFenOverride) : toFen(Number(o.amount || 0))
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
      // 口径（R1 统一·与同文件 refundableCapFen / stuck-order 死信判据同源）：afterSales.refundAmount 与
      // order.amount 同为「元」number，**逐行先 toFen 换整数分再累加**（不累加元浮点后一次性取整），
      // 整数域比较精确，故不需要也不该有 `1e-6` 容差——那是元浮点域的产物，且 1e-6 远小于 1 分，
      // 留着既挡不住真差额、又让人误以为「亚分差额可以容忍」。边界用 `>` 不是 `>=`：退＝实付是**全额退**，
      // 合法，不该报；只有严格多退才是钱漏。
      //
      // fail-closed（本检测器最危险的错法是漏报——真钱漏了却报绿）：金额字段不再走 `Number(x || 0)`。
      // 那个写法把**脏字段变 NaN、缺字段变 0**，两者都让已退总额变小或变 NaN，而 `NaN > amount` 恒 false
      // ⇒ 真超退单被静默报绿。改为：字段必须是有限非负 number（全部写入方都走 fenToYuan(...) 落 number，
      // 故此判据不误伤正常行），否则记 suspect 直接报出来给人看——算不准就别假装守恒成立。
      const rows = await scan(db, COLLECTIONS.afterSales, { status: 'refunded' }).catch((e: unknown) => {
        if (isCollectionMissing(e)) return [] // afterSales 首次申请售后才建：集合未建＝确实没有退款
        throw e
      })
      const _ = db.command
      const refundedFen = new Map<string, number>()
      const suspect = new Set<string>() // 金额字段脏/缺 → 无从证明守恒 → 一律报（宁可多报一次）
      for (const a of rows) {
        const orderId = String(a.orderId)
        if (!okMoney(a.refundAmount)) {
          suspect.add(orderId)
          continue
        }
        refundedFen.set(orderId, (refundedFen.get(orderId) || 0) + toFen(a.refundAmount))
      }
      // 批量读订单实付（_.in 分块·照 recallScan IN_CHUNK=100·杜绝 ≤500 键逐条串行 doc.get 的 N+1）；
      // payment_exception 的退款入口按实际到账 paidFee 退款，所以钱守恒也必须用 paidFee 做分母；
      // 其他订单仍用订单实付 amount。分母脏/缺记 null，与售后金额脏一样 fail-closed 报出来。
      // 订单缺失（不在 capFenById）跳过，不误报超退（既有用例锁此语义）。
      const orderIds = [...new Set([...refundedFen.keys(), ...suspect])]
      const capFenById = new Map<string, number | null>()
      for (let i = 0; i < orderIds.length; i += IN_CHUNK) {
        const chunk = orderIds.slice(i, i + IN_CHUNK)
        const got = await db.collection(COLLECTIONS.orders).where({ _id: _.in(chunk) }).limit(IN_CHUNK).get()
        for (const o of got.data || []) {
          let cap: number | null = null
          if (o.status === 'payment_exception') {
            // 异常单实付额必须是可信的整数分才可作分母；脏/缺不回退 amount：回退会把
            // 「退款按实付退、分母却是应付」的不一致掩盖成守恒成立。
            if (Number.isInteger(o.paidFee) && o.paidFee > 0) cap = o.paidFee
          } else if (okMoney(o.amount)) cap = toFen(o.amount)
          capFenById.set(String(o._id), cap)
        }
      }
      const bad: string[] = []
      let dirty = 0
      for (const orderId of orderIds) {
        if (!capFenById.has(orderId)) continue
        const cap = capFenById.get(orderId)
        if (cap == null || suspect.has(orderId)) {
          bad.push(orderId)
          dirty++
        } else if ((refundedFen.get(orderId) || 0) > cap) bad.push(orderId)
      }
      const capped = rows.length >= SCAN_CAP
      const over = bad.length - dirty
      return bad.length
        ? {
            status: 'red',
            detail: `${over} 单退款超实付（静默多退钱）${dirty ? `·${dirty} 单金额字段脏/缺算不准（fail-closed 计入）` : ''}`,
            count: bad.length,
            samples: bad.slice(0, 10),
            severity: 'high',
            scanned: rows.length,
            capped,
          }
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
      const [paidRows, deadRows, exceptionRows] = await Promise.all([
        scan(db, COLLECTIONS.orders, { status: 'paid' }),
        // ② refund_required 死信（钱已收待人工退款·没人管＝高危静默）
        scan(db, COLLECTIONS.orders, { status: 'refund_required' }),
        // 金额不符单不属于退款死信，但同样是「钱已到、不能履约、待人工处理」；单独扫，避免
        // 被 refund_required 的退款金额算法误判为已处理或漏报。
        scan(db, COLLECTIONS.orders, { status: 'payment_exception' }),
      ])
      // ① paid 超 72h 未发货——只算**真付款**（有微信 transactionId·mock/演示单非真钱不算）：只报真金白银该发没发的单。
      const overdue = paidRows.filter(
        (o) => !o.shippedAt && o.transactionId && Number(o.paidAt || 0) > 0 && now - Number(o.paidAt) > STUCK_PAID_MS,
      )
      // 豁免只给在途售后（正在退款·先别发）。已退掉的件不再是发货义务，但同单其余件仍是：退了一行、
      // 剩下的没发照样要报；每一行都退够件数才算没东西可发。按件数比、不按「这行有退款」比：
      // 退款只退「购买件 − 已进课件」，进过课的那几件照样要发。售后缺 qty 按 0 计（证明不了已退清就报）。
      const held = await afterSalesOf(db, overdue.map((o) => String(o._id)), _.in([...AFTERSALE_QUOTA_STATUSES]))
      const inflight = new Set<string>()
      const refundedQty = new Map<string, number>() // orderId + 行键 → 已退件数
      for (const a of held.rows) {
        const orderId = String(a.orderId)
        if ((AFTERSALE_INFLIGHT_STATUSES as readonly string[]).includes(a.status)) inflight.add(orderId)
        else if (a.status === 'refunded') {
          const key = orderId + '__' + String(a.lineId || a.productId)
          refundedQty.set(key, (refundedQty.get(key) || 0) + (Number(a.qty) || 0))
        }
      }
      const stuck = overdue
        .filter((o) => {
          const id = String(o._id)
          if (inflight.has(id)) return false
          const items: any[] = Array.isArray(o.items) ? o.items : []
          const allRefunded =
            items.length > 0 &&
            items.every((it) => (refundedQty.get(id + '__' + String(it?.lineId || it?.productId)) || 0) >= (Number(it?.qty) || 1))
          return !allRefunded
        })
        .map((o) => String(o._id))
      // payment_exception 退款完成后仍保留原订单状态（退款真相在 afterSales），所以像
      // refund_required 一样按「已退清」过滤；查询失败时空集兜底，宁可多报不能漏报。
      const exceptionRefunded = new Map<string, number>()
      const exceptionDirty = new Set<string>() // refundAmount 脏/缺 → 无从证明已退清 → 报异常（fail-closed·与 money-conserved 同口径）
      const exceptionAs = await afterSalesOf(db, exceptionRows.map((o) => String(o._id)), 'refunded')
      for (const a of exceptionAs.rows) {
        if (!okMoney(a.refundAmount)) {
          // 脏值绝不能参与累加：Number('abc')→NaN 会把整单已退额污染成 NaN，而 NaN<cap 恒 false
          // → 该异常单被当成「已退清」漏报。与 money-conserved 同口径，脏即报（宁可多报）。
          exceptionDirty.add(String(a.orderId))
          continue
        }
        exceptionRefunded.set(String(a.orderId), (exceptionRefunded.get(String(a.orderId)) || 0) + toFen(a.refundAmount))
      }
      const exceptionIds = exceptionRows
        .filter((o) => {
          if (exceptionDirty.has(String(o._id))) return true // 退款额脏 → 无从证明已退清 → 报（fail-closed）
          const paidFen = Number(o.paidFee)
          if (!Number.isInteger(paidFen) || paidFen <= 0) return true // paidFee 脏/缺 → 保守计异常
          // 与 deadIds 同源判据（批K P1·同文件 refundableCapFen）：退款按行走 refundShareFen 分摊、
          // 逐行 Math.round，多行单「各行分摊之和」可能比实付少几分且无任何入口追回——分母须用
          // 「以 paidFee 为实付的逐行分摊上限和」，不能拿裸 paidFen，否则已退清的多行异常单会被
          // 永久误报假死信（正是批K 为 refund_required 消灭的问题在此复发）。
          const capFen = refundableCapFen(o, paidFen)
          if (!(capFen > 0)) return true // 可退上限算不出 → 保守计异常
          return (exceptionRefunded.get(String(o._id)) || 0) < capFen
        })
        .map((o) => String(o._id))
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
      const deadDirty = new Set<string>() // refundAmount 脏/缺 → 无从证明退清 → 计死信（fail-closed·与 exception 分支同口径）
      const deadAs = await afterSalesOf(db, deadRows.map((o) => String(o._id)), 'refunded')
      for (const a of deadAs.rows) {
        if (!okMoney(a.refundAmount)) {
          // 脏值绝不参与累加：NaN 污染整单已退额→NaN<cap 恒 false→真实未退死信被洗绿漏报（多代理审核 codex#4）
          deadDirty.add(String(a.orderId))
          continue
        }
        // 逐行先换算成整数分再累加（不累加元浮点后一次性取整）：整数域比较无需容差，杜绝浮点噪声。
        refundedByOrder.set(String(a.orderId), (refundedByOrder.get(String(a.orderId)) || 0) + toFen(a.refundAmount))
      }
      const deadIds = deadRows
        .filter((o) => {
          if (deadDirty.has(String(o._id))) return true // 退款额脏 → 无从证明退清 → 保守计死信
          const capFen = refundableCapFen(o)
          if (!(capFen > 0)) return true // 实付额/可退上限读不到 → 保守计死信
          return (refundedByOrder.get(String(o._id)) || 0) < capFen // 没退清才是死信（整数分比较）
        })
        .map((o) => String(o._id))
      const all = [...stuck, ...deadIds, ...exceptionIds]
      const scanned = paidRows.length + deadRows.length + exceptionRows.length + held.rows.length
      const capped =
        paidRows.length >= SCAN_CAP ||
        deadRows.length >= SCAN_CAP ||
        exceptionRows.length >= SCAN_CAP ||
        held.capped ||
        exceptionAs.capped ||
        deadAs.capped
      return all.length
        ? {
            status: 'red',
            detail: `${stuck.length} 单真付款超 72h 未发货·${deadIds.length} 单待人工退款死信·${exceptionIds.length} 单支付异常待处理`,
            count: all.length,
            samples: all.slice(0, 10),
            severity: deadIds.length || exceptionIds.length ? 'high' : 'low', // 死信/支付异常＝钱已收没人管·高危（异常单同样钱已到、待人工退款）；纯超时未发＝低危提醒
            scanned,
            capped,
          }
        : { status: 'green', detail: '无卡单/死信', severity: 'low', scanned, capped }
    },
  },
  {
    id: 'pending-overdue',
    title: '超窗未关单（关单定时任务兜底）',
    layer: 'invariant',
    kind: 'flow-failure',
    async run(db) {
      // 关单定时触发器没挂上或没在跑、单条关单更新失败被静默跳过时，过期 pending 单会一直锁着预留库存（只会少卖）；
      // 本项独立兜底（关单任务读失败那一路它自己已告警）。
      const rows = await scan(db, COLLECTIONS.orders, { status: 'pending', createdAt: db.command.lt(Date.now() - PENDING_OVERDUE_MS) })
      const ids = rows.map((o) => String(o._id))
      const capped = rows.length >= SCAN_CAP
      return ids.length
        ? {
            status: 'red',
            detail: `${ids.length} 单超支付窗 1 小时仍未关（关单定时任务可能没在跑·预留库存被锁）`,
            count: ids.length,
            samples: ids.slice(0, 10),
            severity: 'low',
            scanned: rows.length,
            capped,
          }
        : { status: 'green', detail: '无超窗未关单', severity: 'low', scanned: rows.length, capped }
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
