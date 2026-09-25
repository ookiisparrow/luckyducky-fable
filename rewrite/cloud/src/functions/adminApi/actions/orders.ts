import { COLLECTIONS, ORDER_STATUS, AFTERSALE_QUOTA_STATUSES, AFTERSALE_INFLIGHT_STATUSES, buildBadStatus } from '@ldrw/shared'
import type { OrderDoc, AfterSaleDoc, ErrCode } from '@ldrw/shared'
import { pageQuery, uploadShippingToWx, notifyAlert, applyStockMoves, isCollectionMissing, err } from '../../../kit'
import { reply, activationFor, type Ctx } from '../lib'

// 订单行 / 售后行的行键：新单 lineId，旧单回退 productId（与 applyRefund 建售后单同一口径）。
const lineKey = (x: any) => String((x && (x.lineId || x.productId)) || '')
const lineQty = (it: any) => Number(it && it.qty) || 1
const isInflight = (a: any) => AFTERSALE_INFLIGHT_STATUSES.includes(a.status)

// 每行已退件数（封顶到购买件数，只列 >0 的行）。退款按件退：applyRefund 只退「购买 − 已进课」件，进过课的
// 那几件照样要发；越规退款记整行件数，同行多条累加。缺 qty 的旧售后按整行算——那时的退款都是整行退。
function refundedQtyByLine(items: unknown, refunded: any[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const it of Array.isArray(items) ? items : []) {
    const key = lineKey(it)
    const n = refunded
      .filter((a) => lineKey(a) === key)
      .reduce((sum, a) => sum + (Number(a.qty) > 0 ? Number(a.qty) : lineQty(it)), 0)
    if (n > 0) out[key] = Math.min(lineQty(it), n)
  }
  return out
}
// 每一行都退够件数＝没东西可发（一行都没有的脏单不算，免得把它挡成退款）。
const allLinesRefunded = (items: unknown, refundedQty: Record<string, number>) =>
  Array.isArray(items) && items.length > 0 && items.every((it) => (refundedQty[lineKey(it)] || 0) >= lineQty(it))
// 发货人看到的已退件数须与现在逐行一致（缺的行按 0）：标签是那一刻印的，之后又退了件、或列表没读到退款，
// 照标签装箱就会把已退的件发出去。
function sameRefundedQty(now: Record<string, number>, ackRaw: unknown): boolean {
  const ack = ackRaw && typeof ackRaw === 'object' ? (ackRaw as Record<string, unknown>) : {}
  return [...new Set([...Object.keys(now), ...Object.keys(ack)])].every((k) => (now[k] || 0) === (Number(ack[k]) || 0))
}

// 订单详情补充（VMlhp·读类）：逐商品的激活码状态数据链（复用 activationFor·与退款判据同口径）。
// 时间线/交易单号/物流/合规上报等都在订单对象里、前端直接读；本 action 只补「需联查 activations」的激活态。
export async function getOrderDetail({ db, data }: Ctx) {
  const id = String((data && data.id) || '')
  if (!id) return reply(400, err('BAD_ARGS'))
  const got = await db.collection(COLLECTIONS.orders).doc(id).get().catch(() => null)
  if (!got || !got.data) return reply(400, err('NO_ORDER'))
  const o: OrderDoc = got.data
  const pids = [...new Set<string>((o.items || []).map((it) => String(it.productId || '')).filter(Boolean))]
  const acts = await Promise.all(pids.map((pid) => activationFor(db, o._openid, pid)))
  const activations = Object.fromEntries(pids.map((pid, i) => [pid, acts[i]]))
  return reply(200, { ok: true, activations })
}

// —— 订单发货（状态流转 paid → shipped；金额/条目/地址只读不动）——
// 列表游标分页（根因#7）：无参=首页 200（兼容旧控制台读 .list），控制台用 nextCursor 翻页。
// 服务端筛选/搜索（根因#7 计数/筛选/搜索失真）：status 在云端 where 过滤（不让前端从已加载页筛、
// 防分页后漏单）；q=单号精确命中（_id），无视状态标签搜全部。计数另走 orderCounts（.count() 精确）。
export async function listOrders({ db, data, caps }: Ctx) {
  const q = String((data && data.q) || '').trim()
  const status = String((data && data.status) || '')
  // 最小权限收窄（P2 评审·refund:manage 越权面）：listOrders 无过滤时逐单回全文（无 .field() 投影：
  // _openid/address 姓名·电话·详址/items/transactionId/amount），无 q 全表翻页＝翻遍全店客户 PII。
  // ACTION_CAPS 把 listOrders 放给 admin:write|refund:manage（C4），但 refund:manage（退款专员）只需
  // 核对「越规退款这一单」——仅持 refund:manage（无 admin:write/'*'）时强制精确单号 q、拒无过滤/状态浏览
  // （与 lib.ts ROLES 注释「刻意去掉裸 customer:view 防批量导出」同一类风险）。admin:write/'*' 行为完全不变。
  const capList: string[] = Array.isArray(caps) ? caps : []
  const canBrowseAll = capList.some((c) => c === '*' || c === 'admin:write')
  if (!canBrowseAll && !q) return reply(403, err('ORDER_NO_REQUIRED'))
  const filter: Record<string, any> = q
    ? { _id: q } // 搜索：单号精确，跨全部状态
    : status && status !== 'all'
      ? { status }
      : {}
  const paged = await pageQuery(db, COLLECTIONS.orders, filter, 'createdAt', data, 200)
  // 退款↔履约状态同步：批量 join 本页订单的售后行，给前端两个标记——refundHold（在途售后或每行都退够件数，
  // 与 shipOne 拦截同一判据）与 refundedQty（每行已退件数：拣货/标签扣掉它，发货时原样回传给 shipOne 核对）。
  // 有界批量 _.in 查，不逐单 doc.get。读失败整页报错：当成「没有退款」会把已退的件当成要发的货。
  const list: OrderDoc[] = Array.isArray(paged.list) ? paged.list : []
  const orderIds = [...new Set(list.map((o) => String(o.id || o._id || '')).filter(Boolean))]
  const inflight = new Set<string>()
  const refunded = new Map<string, AfterSaleDoc[]>()
  if (orderIds.length) {
    const _ = db.command
    const held = await db
      .collection(COLLECTIONS.afterSales)
      .where({ orderId: _.in(orderIds), status: _.in([...AFTERSALE_QUOTA_STATUSES]) })
      .field({ orderId: true, lineId: true, productId: true, status: true, qty: true })
      .limit(1000) // 钱链异常账本同款上限（getTxAlerts CAP）：本页订单最多几百单，一单多行售后仍远够
      .get()
      .catch((e: unknown) => (isCollectionMissing(e) ? { data: [] } : null))
    if (!held) return reply(500, err('REFUND_HOLD_READ_FAIL'))
    for (const a of held.data || []) {
      const oid = String(a.orderId || '')
      if (isInflight(a)) inflight.add(oid)
      else refunded.set(oid, [...(refunded.get(oid) || []), a])
    }
  }
  const enriched = list.map((o) => {
    const oid = String(o.id || o._id || '')
    const refundedQty = refundedQtyByLine(o.items, refunded.get(oid) || [])
    return { ...o, refundHold: inflight.has(oid) || allLinesRefunded(o.items, refundedQty), refundedQty }
  })
  return reply(200, { ok: true, ...paged, list: enriched })
}

// 按状态服务端精确计数（根因#7 计数失真）：每状态 + 全部走 .count()（精确·不封顶·不受分页影响），
// 状态枚举绑订单域单源 ORDER_STATUS（新增状态自动覆盖·根因#2）。前端标签计数只读此结果、不数已加载页。
// partial（P1·bug sweep Round1 item7·病根#14）：某路 .count() 失败原先静默兜成 0，混进精确计数里
// front 端无从分辨「真为 0」还是「没查到」——现在任一路失败即整体标 partial:true（不逐路置 null，
// 保持返回形状简单：前端已按「整体不可信」处理待办卡，无需精确到哪个状态失败）。
export async function orderCounts({ db }: Ctx) {
  let partial = false
  const cnt = (query: any) =>
    query
      .count()
      .then((r: any) => r.total || 0)
      .catch(() => {
        partial = true
        return 0
      })
  const statuses = Object.values(ORDER_STATUS) as string[]
  const [all, ...nums] = await Promise.all([
    cnt(db.collection(COLLECTIONS.orders)),
    ...statuses.map((s) => cnt(db.collection(COLLECTIONS.orders).where({ status: s }))),
  ])
  const counts: Record<string, number> = { all }
  statuses.forEach((s, i) => (counts[s] = nums[i]))
  return reply(200, { ok: true, counts, partial })
}

// 发货上传互斥闸陈旧判据（批Y·shipUploadLock 无解锁机制修复）：闸释放写在函数体最后一步（微信上传
// 完成之后）——若云函数在「写完 busy、写回 idle」这个窗口被平台强杀（超时/OOM/平台重启，非 JS 异常，
// try/catch 挡不住），busy 会永久卡住，且全仓没有其它 action 会重置它，该订单从此再也发不出货（含合法
// 改单号重试），只能人工进库改字段。微信发货上传云调用正常应秒级完成，给远超正常耗时的安全边际——
// 超过此阈值仍是 busy 就视为「持锁方已经不在了」，允许抢占继续。量级参考 PAY_WINDOW_MS（15 分钟）：
// 发货上传比支付回调窗口短得多，5 分钟已是远超正常耗时的宽松边际，不做成分布式锁/TTL 索引那类重型机制。
const SHIP_LOCK_STALE_MS = 5 * 60 * 1000

// 发货状态转移 + 抢上传互斥闸：抢到回 null，没抢到回错误码。
// 条件更新（审核批次A-6 + 批P 并发互斥闸续）：仍是 paid/shipped 才写——防与确认收货并发把 done 回滚；
// 同一次写里叠加抢占 shipUploadLock（CAS neq 'busy'，非「一次性 exists」范式——本闸是「进行中」busy/idle
// 二态、可反复抢占，不是只能成功一次的既有 exists(false) 惯用法，因为「改单号」场景要求同单可合法地
// 再次触发上传）。根因：两个几乎同时到达的并发 shipOne 调用可能都读到 cur=paid、都通过上方状态闸——
// 若只闸 status（'shipped'→'shipped' 对二次调用天然放行，不是能拦并发的 CAS），两次调用会各自独立
// 触发一次微信发货上传，后写入的 wxShipUploaded/wxShipError 无条件覆盖前一次结果（可能把合规上传成功
// 覆盖成误报失败，或反过来盖掉真实失败）。shipUploadLock 抢占失败不代表状态真的不合法，故失败后二次读判：
// 状态仍在 paid/shipped 内即认定「另一次调用正在处理本单上传」，回 SHIP_IN_PROGRESS 而非 BAD_STATUS
// （不是分布式锁：只挡同单同时进行中的窗口，上传结束即释放，不影响之后合法的改单号再次调用）。
async function grabShipLock(db: any, id: string, order: OrderDoc, company: string, trackingNo: string): Promise<ErrCode | null> {
  const _ = db.command
  const lockNow = Date.now()
  const upd = await db
    .collection(COLLECTIONS.orders)
    .where({ _id: id, status: _.in(['paid', 'shipped']), shipUploadLock: _.neq('busy') })
    .update({
      data: {
        status: 'shipped',
        shipping: { company, trackingNo },
        shippedAt: order.shippedAt || Date.now(),
        shipUploadLock: 'busy',
        shipUploadLockAt: lockNow,
      },
    })
  if (upd.stats && upd.stats.updated === 1) return null
  const fresh = await db.collection(COLLECTIONS.orders).doc(id).get().catch(() => null)
  const freshData: OrderDoc | null = fresh && fresh.data
  const freshStatus = (freshData && freshData.status) || 'unknown'
  if (freshStatus !== 'paid' && freshStatus !== 'shipped') return buildBadStatus(freshStatus)
  // 陈旧锁抢占（SHIP_LOCK_STALE_MS 见上方注释）：只有「仍是 busy」且「按时间戳判定已过期」才抢占；
  // 未过期＝真的在处理中，照旧拒绝 SHIP_IN_PROGRESS。CAS 精确带上读到的 shipUploadLockAt 值，
  // 防止本次重读之后、抢占写之前又有别的合法调用已经拿到了新的 busy（那种情况精确匹配天然落空，
  // 回落到「拒绝」而不会误抢一把并不陈旧的新锁——不用 _.and()/_.or() 组合子，桩未验证过、避免误用）。
  const lockAt = Number((freshData && freshData.shipUploadLockAt) || 0)
  const stale = freshData && freshData.shipUploadLock === 'busy' && lockNow - lockAt > SHIP_LOCK_STALE_MS
  if (!stale) return 'SHIP_IN_PROGRESS'
  const preempt = await db
    .collection(COLLECTIONS.orders)
    .where({ _id: id, status: _.in(['paid', 'shipped']), shipUploadLock: 'busy', shipUploadLockAt: lockAt })
    .update({
      data: {
        status: 'shipped',
        shipping: { company, trackingNo },
        shippedAt: freshData.shippedAt || Date.now(),
        shipUploadLock: 'busy',
        shipUploadLockAt: lockNow,
      },
    })
  if (!preempt.stats || preempt.stats.updated !== 1) return 'SHIP_IN_PROGRESS'
  await notifyAlert('anomaly', 'shipOne', 'SHIP_LOCK_STALE_PREEMPTED', { id, staleForMs: lockNow - lockAt })
  return null
}

// SCM-D 核销留痕（守卫 ship-verify-ledger·根因#2·「如实核销」蓝图定稿）：**首次** paid→shipped 逐行落
// ship 流水（fg 行只留痕不动账——成品扣账在下单预留 reserveStock；确定性 _id=ship:<orderId>:fg:<pid>__<spec>
// 并发/重试天然幂等）；改单号（shipped→shipped）不重复留痕，由调用方只在首次发货时调。fail-soft：留痕失败
// 不反噬发货（发货是主动作），但 fg 行无 CAS 面、除入参形状外无失败路径；旧单无 items 静默跳过（不落假流水·根因#8）。
async function recordShipLedger(id: string, order: OrderDoc, refundedQty: Record<string, number>, operator: string) {
  // 组合键校验在出生点、不在此消费点（战役3 批D·D1）：这里吃的是历史订单快照（items 下单时已定格），
  // fail-closed 会拒发既有订单（钱链反噬）——规则单源见 shared/scmKey.ts 头注，此处历史容忍。
  const moves = (order.items || [])
    .filter((it) => it && it.productId && Number.isInteger(it.qty) && it.qty > 0)
    .map((it) => ({ materialId: `fg:${it.productId}__${it.spec || ''}`, delta: -(it.qty - (refundedQty[lineKey(it)] || 0)) }))
    .filter((m) => m.delta < 0) // 已退的件没发出去，不核销
  if (!moves.length) return
  // operator＝认证账号身份（B5.4 同款·与 SCM 各线 agentId 口径一致）：多账号后流水可溯「谁发的货」
  const led = await applyStockMoves(moves, { docType: 'ship', docId: id, operator }).catch(() => ({ ok: false as const }))
  if (!led.ok) await notifyAlert('anomaly', 'shipOrder', 'SCM_LEDGER_FAIL', { id })
}

// 单单发货核心（shipOrder 与 shipOrders 批量共用·DRY 单源）：状态闸 paid/shipped + feeMismatch 挡单
// + 条件转移防并发回滚 done + 微信 upload_shipping_info 合规上报（fail-soft·债#26·根因#12）。
// 返回纯结果对象（不含 HTTP 包装），调用方各自 reply / 汇总。
async function shipOne(db: any, idRaw: any, companyRaw: any, trackingRaw: any, operator: string, ackRefundedQty: unknown) {
  const id = String(idRaw || '')
  const company = String(companyRaw || '').trim().slice(0, 30)
  const trackingNo = String(trackingRaw || '').trim().slice(0, 40)
  if (!id || !company || !trackingNo) return err('BAD_ARGS')
  const got = await db.collection(COLLECTIONS.orders).doc(id).get().catch(() => null)
  if (!got || !got.data) return err('NO_ORDER')
  const order: OrderDoc = got.data
  const cur = order.status
  // paid = 首次发货；shipped = 改单号。其余状态不允许动。
  if (cur !== 'paid' && cur !== 'shipped') return err(buildBadStatus(cur))
  // 金额异常单（feeMismatch 留痕）须先「解除」后才能发货（审核批次A 折中）
  if (order.feeMismatch) return err('FEE_MISMATCH_HOLD')
  // 退款↔履约状态同步闸：afterSales 与 orders 是两套状态机，退款从不改订单状态，所以发货前现场直读
  // afterSales（钱链闸子不走派生字段）。在途售后（申请中/已批，钱可能正在退）整单拦，返回命中行供前端定位；
  // 已退款只把退掉的件排除出发货——refunded 是终态，按它拦会让其余件永远发不出去；每行都退够件数才拦。
  // 首次发货还要核对发货人看到的已退件数（sameRefundedQty），对不上就拒、回当前件数让前端重印。
  // rejected（未受理、无钱路径）不挡。
  // 残余竞态窗口（已收窄+对称可观测，非重型锁）：这段读到下方条件更新之间，若 approveRefund/overrideRefund
  // 恰好把售后抢占成 approved，本次读不到、会照常发货。分布式锁/事务模拟不是本仓既有模式；对称收口在
  // refunds.ts：退款批准落库后回读订单，发现期间已变 shipped 即 notifyAlert SHIP_REFUND_RACE 供人工介入。
  const afterSales = await db
    .collection(COLLECTIONS.afterSales)
    .where({ orderId: id, status: db.command.in([...AFTERSALE_QUOTA_STATUSES]) })
    .field({ lineId: true, productId: true, status: true, qty: true })
    .get()
    .catch((e: unknown) => (isCollectionMissing(e) ? { data: [] } : null))
  // 查不到退款态 ≠ 没有退款：读失败拒发。回结果对象不抛——shipOrders 批量里一单失败不拖垮其余单。
  if (!afterSales) return err('REFUND_HOLD_READ_FAIL')
  const rows: AfterSaleDoc[] = afterSales.data || []
  const inflightLines = rows.filter(isInflight).map(lineKey)
  const refundedQty = refundedQtyByLine(order.items, rows.filter((a) => !isInflight(a)))
  if (inflightLines.length) return err('REFUND_HOLD', { lines: inflightLines })
  if (allLinesRefunded(order.items, refundedQty)) return err('REFUND_HOLD', { lines: Object.keys(refundedQty) })
  // 改单号（shipped）不重新装箱，不核对
  if (cur === 'paid' && !sameRefundedQty(refundedQty, ackRefundedQty)) return err('REFUND_LINES_CHANGED', { refundedQty })
  const lockErr = await grabShipLock(db, id, order, company, trackingNo)
  if (lockErr) return err(lockErr)
  if (cur === 'paid') await recordShipLedger(id, order, refundedQty, operator)
  // 合规债#26（根因#12）：本地发货成功后向微信上传发货信息——实物+微信支付不上传则订单资金冻结/无法结算。
  // fail-soft：上传失败绝不回滚本地发货（已 shipped），只留痕 + [LD_ALERT] sev=money 告警，靠人去 mp 后台手动录入兜底。
  const ship = await uploadShippingToWx({
    orderId: id,
    openid: String(order._openid || ''),
    transactionId: String(order.transactionId || ''),
    company,
    trackingNo,
  })
  // 释放互斥闸（shipUploadLock: busy → idle）随结果同一次写落地——无论上传成败都要释放，否则该单
  // 之后任何合法再调用（含改单号）会被永久误判 SHIP_IN_PROGRESS。uploadShippingToWx 自身「绝不抛错」
  // （见 kit/shipping.ts 契约），故本次写与上方状态转移写一样不需要 try/finally 兜底异常路径。
  await db
    .collection(COLLECTIONS.orders)
    .doc(id)
    .update({
      data: ship.ok
        ? { wxShipUploaded: true, wxShipError: '', wxShipAt: Date.now(), shipUploadLock: 'idle' }
        : { wxShipUploaded: false, wxShipError: ship.error || 'WX_SHIP_FAIL', shipUploadLock: 'idle' },
    })
    .catch(() => null)
  if (!ship.ok) await notifyAlert('money', 'shipOrder', 'WX_SHIP_UPLOAD_FAIL', { orderId: id, error: ship.error })
  return { ok: true, wxShip: ship.ok, refundedQty }
}

export async function shipOrder({ db, data, agentId }: Ctx) {
  const r = await shipOne(db, data.id, data.company, data.trackingNo, agentId || 'admin', data.ackRefundedQty)
  return reply(r.ok ? 200 : 400, r)
}

// 批量发货（P1·上量瓶颈）：多选订单一次发，逐单走 shipOne（串行·各自独立·一单失败不拖累其余），
// per-order 回报。company 可整批共用或逐单覆盖。电子面单取号/打印需快递 API 账号·诚实延后（不在此造·根因#8）。
export async function shipOrders({ db, data, agentId }: Ctx) {
  const items = Array.isArray(data && data.items) ? data.items : []
  if (!items.length) return reply(400, err('BAD_ARGS'))
  if (items.length > 100) return reply(400, err('TOO_MANY')) // 单批上限·防滥用/超时
  const batchCompany = String((data && data.company) || '')
  const results: any[] = []
  for (const it of items) {
    const id = String((it && it.id) || '')
    const r = await shipOne(db, id, (it && it.company) || batchCompany, it && it.trackingNo, agentId || 'admin', it && it.ackRefundedQty)
    results.push({ id, ...r })
  }
  const okCount = results.filter((r) => r.ok).length
  return reply(200, { ok: true, okCount, failCount: results.length - okCount, results })
}

// 金额异常单人工复核解除（feeMismatch 单禁发货，核实流水后在此解除）
export async function clearFeeMismatch({ db, data }: Ctx) {
  const id = String(data.id || '')
  if (!id) return reply(400, err('BAD_ARGS'))
  const got = await db.collection(COLLECTIONS.orders).doc(id).get().catch(() => null)
  if (!got || !got.data) return reply(400, err('NO_ORDER'))
  const order: OrderDoc = got.data
  // payment_exception 是金额不符后的待处理终态，不能被旧的「解除 feeMismatch」按钮
  // 误清成看似正常；它必须走人工退款/补差后的明确处理流程。
  if (order.status === 'payment_exception') return reply(400, err(buildBadStatus(order.status)))
  await db.collection(COLLECTIONS.orders).doc(id).update({ data: { feeMismatch: false, feeMismatchClearedAt: Date.now() } })
  return reply(200, { ok: true })
}
