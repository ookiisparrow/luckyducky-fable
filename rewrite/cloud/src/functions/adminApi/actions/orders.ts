import { ORDER_STATUS, buildBadStatus } from '@ldrw/shared'
import { pageQuery, uploadShippingToWx, notifyAlert, applyStockMoves } from '../../../kit'
import { reply, activationFor, type Ctx } from '../lib'

// 订单详情补充（VMlhp·读类）：逐商品的激活码状态数据链（复用 activationFor·与退款判据同口径）。
// 时间线/交易单号/物流/合规上报等都在订单对象里、前端直接读；本 action 只补「需联查 activations」的激活态。
export async function getOrderDetail({ db, data }: Ctx) {
  const id = String((data && data.id) || '')
  if (!id) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const got = await db.collection('orders').doc(id).get().catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_ORDER' })
  const o = got.data
  const seen = new Set<string>()
  const activations: Record<string, any> = {}
  for (const it of o.items || []) {
    const pid = String(it.productId || '')
    if (!pid || seen.has(pid)) continue
    seen.add(pid)
    activations[pid] = await activationFor(db, o._openid, pid)
  }
  return reply(200, { ok: true, activations })
}

// —— 订单发货（状态流转 paid → shipped；金额/条目/地址只读不动）——
// 列表游标分页（根因#7）：无参=首页 200（兼容旧控制台读 .list），控制台用 nextCursor 翻页。
// 服务端筛选/搜索（根因#7 计数/筛选/搜索失真）：status 在云端 where 过滤（不让前端从已加载页筛、
// 防分页后漏单）；q=单号精确命中（_id），无视状态标签搜全部。计数另走 orderCounts（.count() 精确）。
export async function listOrders({ db, data }: Ctx) {
  const q = String((data && data.q) || '').trim()
  const status = String((data && data.status) || '')
  const filter: Record<string, any> = q
    ? { _id: q } // 搜索：单号精确，跨全部状态
    : status && status !== 'all'
      ? { status }
      : {}
  const paged = await pageQuery(db, 'orders', filter, 'createdAt', data, 200)
  return reply(200, { ok: true, ...paged })
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
    cnt(db.collection('orders')),
    ...statuses.map((s) => cnt(db.collection('orders').where({ status: s }))),
  ])
  const counts: Record<string, number> = { all }
  statuses.forEach((s, i) => (counts[s] = nums[i]))
  return reply(200, { ok: true, counts, partial })
}

// 单单发货核心（shipOrder 与 shipOrders 批量共用·DRY 单源）：状态闸 paid/shipped + feeMismatch 挡单
// + 条件转移防并发回滚 done + 微信 upload_shipping_info 合规上报（fail-soft·债#26·根因#12）。
// 返回纯结果对象（不含 HTTP 包装），调用方各自 reply / 汇总。
async function shipOne(db: any, idRaw: any, companyRaw: any, trackingRaw: any, operator: string) {
  const id = String(idRaw || '')
  const company = String(companyRaw || '').trim().slice(0, 30)
  const trackingNo = String(trackingRaw || '').trim().slice(0, 40)
  if (!id || !company || !trackingNo) return { ok: false, error: 'BAD_ARGS' }
  const got = await db.collection('orders').doc(id).get().catch(() => null)
  if (!got || !got.data) return { ok: false, error: 'NO_ORDER' }
  const cur = got.data.status
  // paid = 首次发货；shipped = 改单号。其余状态不允许动。
  if (cur !== 'paid' && cur !== 'shipped') return { ok: false, error: buildBadStatus(cur) }
  // 金额异常单（feeMismatch 留痕）须先「解除」后才能发货（审核批次A 折中）
  if (got.data.feeMismatch) return { ok: false, error: 'FEE_MISMATCH_HOLD' }
  // 条件更新（审核批次A-6）：仍是 paid/shipped 才写——防与确认收货并发把 done 回滚
  const upd = await db
    .collection('orders')
    .where({ _id: id, status: db.command.in(['paid', 'shipped']) })
    .update({
      data: { status: 'shipped', shipping: { company, trackingNo }, shippedAt: got.data.shippedAt || Date.now() },
    })
  if (!upd.stats || upd.stats.updated !== 1) {
    const fresh = await db.collection('orders').doc(id).get().catch(() => null)
    return { ok: false, error: buildBadStatus((fresh && fresh.data && fresh.data.status) || 'unknown') }
  }
  // SCM-D 核销留痕（守卫 ship-verify-ledger·根因#2·「如实核销」蓝图定稿）：**首次** paid→shipped 逐行落
  // ship 流水（fg 行只留痕不动账——成品扣账在下单预留 reserveStock；确定性 _id=ship:<orderId>:fg:<pid>__<spec>
  // 并发/重试天然幂等）；改单号（shipped→shipped）不重复留痕。fail-soft：留痕失败不反噬发货（发货是主动作），
  // 但 fg 行无 CAS 面、除入参形状外无失败路径；旧单无 items 静默跳过（不落假流水·根因#8）。
  if (cur === 'paid') {
    const moves = ((got.data.items as any[]) || [])
      .filter((it) => it && it.productId && Number.isInteger(it.qty) && it.qty > 0)
      .map((it) => ({ materialId: `fg:${it.productId}__${it.spec || ''}`, delta: -it.qty }))
    if (moves.length) {
      // operator＝认证账号身份（B5.4 同款·与 SCM 各线 agentId 口径一致）：多账号后流水可溯「谁发的货」
      const led = await applyStockMoves(moves, { docType: 'ship', docId: id, operator }).catch(() => ({ ok: false as const }))
      if (!led.ok) await notifyAlert('anomaly', 'shipOrder', 'SCM_LEDGER_FAIL', { id })
    }
  }
  // 合规债#26（根因#12）：本地发货成功后向微信上传发货信息——实物+微信支付不上传则订单资金冻结/无法结算。
  // fail-soft：上传失败绝不回滚本地发货（已 shipped），只留痕 + [LD_ALERT] sev=money 告警，靠人去 mp 后台手动录入兜底。
  const ship = await uploadShippingToWx({
    orderId: id,
    openid: String(got.data._openid || ''),
    transactionId: String(got.data.transactionId || ''),
    company,
    trackingNo,
  })
  await db
    .collection('orders')
    .doc(id)
    .update({
      data: ship.ok
        ? { wxShipUploaded: true, wxShipError: '', wxShipAt: Date.now() }
        : { wxShipUploaded: false, wxShipError: ship.error || 'WX_SHIP_FAIL' },
    })
    .catch(() => null)
  if (!ship.ok) await notifyAlert('money', 'shipOrder', 'WX_SHIP_UPLOAD_FAIL', { orderId: id, error: ship.error })
  return { ok: true, wxShip: ship.ok }
}

export async function shipOrder({ db, data, agentId }: Ctx) {
  const r = await shipOne(db, data.id, data.company, data.trackingNo, agentId || 'admin')
  return reply(r.ok ? 200 : 400, r)
}

// 批量发货（P1·上量瓶颈）：多选订单一次发，逐单走 shipOne（串行·各自独立·一单失败不拖累其余），
// per-order 回报。company 可整批共用或逐单覆盖。电子面单取号/打印需快递 API 账号·诚实延后（不在此造·根因#8）。
export async function shipOrders({ db, data, agentId }: Ctx) {
  const items = Array.isArray(data && data.items) ? data.items : []
  if (!items.length) return reply(400, { ok: false, error: 'BAD_ARGS' })
  if (items.length > 100) return reply(400, { ok: false, error: 'TOO_MANY' }) // 单批上限·防滥用/超时
  const batchCompany = String((data && data.company) || '')
  const results: any[] = []
  for (const it of items) {
    const id = String((it && it.id) || '')
    const r = await shipOne(db, id, (it && it.company) || batchCompany, it && it.trackingNo, agentId || 'admin')
    results.push({ id, ...r })
  }
  const okCount = results.filter((r) => r.ok).length
  return reply(200, { ok: true, okCount, failCount: results.length - okCount, results })
}

// 金额异常单人工复核解除（feeMismatch 单禁发货，核实流水后在此解除）
export async function clearFeeMismatch({ db, data }: Ctx) {
  const id = String(data.id || '')
  if (!id) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const got = await db.collection('orders').doc(id).get().catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_ORDER' })
  await db.collection('orders').doc(id).update({ data: { feeMismatch: false, feeMismatchClearedAt: Date.now() } })
  return reply(200, { ok: true })
}
