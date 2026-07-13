import {
  toFen,
  asFen,
  fenToYuan,
  refundShareFen,
  AFTERSALE_STATUS,
  AFTERSALE_SCAN_CAP,
} from '@ldrw/shared'
import { callFlow, refundNoFor, pageQuery, notifyAlert } from '../../../kit'
import { reply, ensure, activationFor, type Ctx } from '../lib'

// —— 管理员越规退款（决策§26·客服端退货管理权限 refund:manage·净新增·超出旧线 92 parity）——
// 越过**资格规则**（一行一售后锁/拒后锁死/已进课不可退）主动发起退款；但**保留钱守恒不变量**：退款额仍
// ≤ 该行实付分摊 − 全单已退额度（refundShareFen 单源公式封顶·退超实付被 NOTHING_LEFT 挡）。越的是「能不能
// 退」的退货规则，不越「退多少」的钱红线——退超实付不是退货规则、是资损洞。直建 approved 售后单（越客户
// applied→approved 流转·管理员发起）+ 触发退款工作流；未受理条件回滚 approved→applied 可重试。写类自动审计。
export async function overrideRefund({ db, data }: Ctx) {
  const orderId = String((data && data.orderId) || '')
  const reqLine = String((data && data.lineId) || '')
  const reason = String((data && data.reason) || '')
    .trim()
    .slice(0, 100)
  if (!orderId || !reqLine || !reason) return reply(400, { ok: false, error: 'BAD_ARGS' })

  const cfg = await db
    .collection('config')
    .doc('pay')
    .get()
    .catch(() => null)
  const flowId = cfg && cfg.data && cfg.data.refundFlowId
  if (!flowId) return reply(400, { ok: false, error: 'REFUND_FLOW_NOT_CONFIGURED' })

  const got = await db
    .collection('orders')
    .doc(orderId)
    .get()
    .catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_ORDER' })
  const order = got.data
  if (!['paid', 'shipped', 'done'].includes(order.status))
    return reply(400, { ok: false, error: 'BAD_STATUS:' + order.status })
  const orderStatusAtStart = order.status // 竞态可观测闸用（见下方 SHIP_REFUND_RACE 注释）

  const line = (order.items || []).find((it: any) => (it.lineId || it.productId) === reqLine)
  if (!line) return reply(400, { ok: false, error: 'UNKNOWN_ITEM' })
  const lineId = line.lineId || line.productId

  // 越过资格：不看 refundable/enteredQty/既有售后（含 rejected），按整行件数算分摊上限。
  // 钱守恒保留（P1·根因#1 行级不封顶修复）：旧版 used 只算全单已退，同一行重复调用时「本行分摊份额」
  // 每次都按 itemFen 重新算出、只被「全单已退」减——只要兄弟行还有余量，同一行能被反复越规退到把
  // 整单余额退光。现按行/单双口径分别封顶再取小：usedLine=同 orderId+lineId 的已提交额度（该行自己已拿走
  // 多少）、usedOrder=全单已提交额度（既有口径，防超实付总额）；lineShare 用 used=0 算出「该行理论分摊上限
  // （不看用量）」，减去 usedLine 得该行剩余，再与 orderCap（usedOrder 封顶后的全单剩余）取小。
  const amountFen = toFen(Number(order.amount))
  const goodsFen = toFen(Number(order.goods))
  const itemFen = asFen(toFen(line.price) * (line.qty || 1))
  // 同单售后须读齐才能算准 usedOrder/usedLine 封顶（深审 P2·根因#7）：裸 .get() 默认 100 条截断会少算
  // used → 越规退超该行/该单实付分摊。显式取到 AFTERSALE_SCAN_CAP；命中上限＝异常，fail-closed 拒退 + 告警。
  const exist = await db
    .collection('afterSales')
    .where({ orderId })
    .limit(AFTERSALE_SCAN_CAP)
    .get()
    .catch(() => ({ data: [] }))
  if (exist.data.length >= AFTERSALE_SCAN_CAP) {
    await notifyAlert('money', 'overrideRefund', 'AFTERSALE_SCAN_CAP', { orderId })
    return reply(400, { ok: false, error: 'REFUND_SCAN_CAP' })
  }
  const settled = (a: any) => ['applied', 'approved', 'refunded'].includes(a.status)
  const usedOrder = asFen(
    exist.data.filter(settled).reduce((s: number, a: any) => s + toFen(Number(a.refundAmount)), 0)
  )
  const usedLine = asFen(
    exist.data
      .filter((a: any) => settled(a) && (a.lineId || a.productId) === lineId)
      .reduce((s: number, a: any) => s + toFen(Number(a.refundAmount)), 0)
  )
  const lineShare = refundShareFen(amountFen, goodsFen, itemFen, asFen(0))
  const orderCap = refundShareFen(amountFen, goodsFen, itemFen, usedOrder)
  const refundFen = asFen(Math.min(Math.max(0, lineShare - usedLine), orderCap))
  if (refundFen <= 0) return reply(400, { ok: false, error: 'NOTHING_LEFT' })

  // 确定性 _id（P1·根因#1 无幂等修复 + P0 复核·跨函数 TOCTOU 修复）：首个记录与客户 applyRefund
  // 共用同一 _id 命名空间 `orderId__lineId`（app/actions/orders.ts:348 单源同款），不是各自另起一套——
  // 两条路径「读 exist（都读到空）→ 算金额 → 写」并发时会在同一个 _id 上物理相撞，输家 add() 必炸：
  // overrideRefund 侧走下方 catch 读回判 409 CONCURRENT，applyRefund 侧走它自己的撞键分支判 ALREADY_APPLIED
  // （两侧早已各自具备"撞键=对方已写、天然幂等"的收尾逻辑，只是此前各占一个 _id、永不相撞）。一旦该行
  // 曾经落过任何记录（无论是客户 applied 还是本函数写的，含 rejected——越规不看资格锁），基础位已占用，
  // 后续再越规只能退到编号位 `__ovrN`（N=该行既有 __ovr 前缀售后单数量，查 exist 时顺带数，不加查询）；
  // 编号位之间仍靠原有「并发双调算得同一 N → 撞键→输家中止」互斥，逻辑不变。
  const bareId = orderId + '__' + lineId
  const ovrPrefix = bareId + '__ovr'
  const bareTaken = exist.data.some((a: any) => a._id === bareId)
  const ovrCount = exist.data.filter(
    (a: any) => typeof a._id === 'string' && a._id.startsWith(ovrPrefix)
  ).length
  const asId = bareTaken ? ovrPrefix + ovrCount : bareId
  const outRefundNo = refundNoFor(asId) // 微信合规退款单号（asId 含中文 SKU/spec·根因#12·案 A）
  await ensure(db, 'afterSales')
  const now = Date.now()
  try {
    await db.collection('afterSales').add({
      data: {
        _id: asId,
        orderId,
        _openid: order._openid,
        lineId,
        productId: line.productId,
        name: line.name,
        spec: line.spec || '',
        qty: line.qty || 1,
        itemTotal: fenToYuan(itemFen),
        refundAmount: fenToYuan(refundFen),
        reason,
        outRefundNo, // 落库供退款回调反查
        status: 'approved', // 越规直批（管理员发起·非客户 applied→approved）
        appliedAt: now,
        approvedAt: now,
        overridden: true, // 留痕：越规发起（对账/客诉可溯）
      },
    })
  } catch (_e) {
    // add 失败必须中止、绝不接着触发真退款（P1·根因#14 修复：旧版 .catch(()=>{}) 写失败后仍 callFlow，
    // 退款回调按 outRefundNo 反查将无单）。撞键判定不靠错误类型嗅探（仓内惯例不区分 add 错误类型）：
    // 读回 doc(asId)——存在＝并发方已写（天然幂等，非故障）；不存在＝真写失败，留痕告警。
    const reread = await db
      .collection('afterSales')
      .doc(asId)
      .get()
      .catch(() => null)
    if (reread && reread.data) return reply(409, { ok: false, error: 'CONCURRENT' })
    await notifyAlert('money', 'overrideRefund', 'AFTERSALE_WRITE_FAIL', { id: asId })
    return reply(500, { ok: false, error: 'WRITE_FAIL' })
  }

  const r = await callFlow(String(flowId), {
    out_trade_no: orderId,
    out_refund_no: outRefundNo,
    reason: reason.slice(0, 80),
    amount: { refund: refundFen, total: toFen(order.amount), currency: 'CNY' },
  })
  if (!r || !(r.status || r.refund_id || r.out_refund_no)) {
    await notifyAlert('money', 'overrideRefund', 'REFUND_TRIGGER_FAIL', { id: asId })
    // 条件回滚（同 approveRefund·仅 approved 才回 applied·防退款回调抢先 refunded 被打回二次退款）
    await db
      .collection('afterSales')
      .where({ _id: asId, status: 'approved' })
      .update({ data: { status: 'applied' } })
      .catch(() => {})
    return reply(500, { ok: false, error: 'REFUND_TRIGGER_FAIL' })
  }
  // 并发窗口可观测（P2·根因#14·与 shipOne 侧 REFUND_HOLD 闸对称）：shipOne 与本函数各自读订单/售后当前
  // 状态、中间没有互斥（重型锁/事务模拟不是本仓既有模式，收窄+可观测已是合理止损——见 shipOne 同款注释）。
  // 若批准退款前订单还不是 shipped，批准落库后订单却已是 shipped——说明恰好在本次批准执行期间被并发
  // 发货，构成钱货两空风险。钱已经该退，不能因为货发了就不退，但必须留一条高危信号让人工去核实是否需要
  // 拦截物流/联系客户。shipOne 侧挡「先退款后发货」，这里补「先发货后退款」方向的兜底信号，两个方向对称。
  if (orderStatusAtStart !== 'shipped') {
    const fresh = await db.collection('orders').doc(orderId).get().catch(() => null)
    if (fresh && fresh.data && fresh.data.status === 'shipped') {
      await notifyAlert('money', 'overrideRefund', 'SHIP_REFUND_RACE', { id: asId, orderId })
    }
  }
  return reply(200, { ok: true, id: asId })
}

// —— 售后退款（链10：审核 + 触发退款工作流；金额在申请时已云端分摊算定）——
// 列表游标分页（根因#7）：无参=首页 200（兼容旧控制台读 .list）。
// 服务端筛选/搜索（根因#7 计数/筛选/搜索失真·与订单同治）：status 云端 where 过滤、q=订单号精确
// 命中（orderId·一单可多条售后行），无视状态标签搜全部。计数另走 refundCounts（.count() 精确）。
export async function listRefunds({ db, data }: Ctx) {
  await ensure(db, 'afterSales')
  const q = String((data && data.q) || '').trim()
  const status = String((data && data.status) || '')
  const filter: Record<string, any> = q
    ? { orderId: q } // 搜索：订单号精确，跨全部状态
    : status && status !== 'all'
      ? { status }
      : {}
  const paged = await pageQuery(db, 'afterSales', filter, 'appliedAt', data, 200)
  // 补买家收货人（换皮丢·审退款需识别申请人+联系寄回；afterSale 本身无地址→join 订单收货地址·
  // 有界批量一次 _.in 查·不逐单 doc.get·capacity-reads-bounded）。前端列表掩码、抽屉给全号（PII·根因#3）。
  const list: any[] = Array.isArray(paged.list) ? paged.list : []
  const orderIds = [...new Set(list.map((a) => String(a.orderId || '')).filter(Boolean))]
  const addrByOrder: Record<string, { name: string; phone: string }> = {}
  if (orderIds.length) {
    const _ = db.command
    const or = await db
      .collection('orders')
      .where({ _id: _.in(orderIds) })
      .limit(orderIds.length)
      .get()
      .catch(() => ({ data: [] }))
    for (const o of (or && or.data) || []) {
      const ad = o.address && typeof o.address === 'object' ? o.address : {}
      addrByOrder[String(o._id || o.id || '')] = {
        name: String(ad.name || ''),
        phone: String(ad.phone || ''),
      }
    }
  }
  const enriched = list.map((a) => {
    const b = addrByOrder[String(a.orderId || '')] || { name: '', phone: '' }
    return { ...a, buyerName: b.name, buyerPhone: b.phone }
  })
  return reply(200, { ok: true, ...paged, list: enriched })
}

// 按状态服务端精确计数（根因#7 计数失真）：每状态 + 全部走 .count()（精确·不封顶·不受分页影响），
// 状态枚举绑售后域单源 AFTERSALE_STATUS（新增状态自动覆盖·根因#2）。前端标签计数只读此结果。
// partial（P1·bug sweep Round1 item7·病根#14，同 orderCounts 治法）：某路 .count() 失败原先静默兜
// 成 0——现在任一路失败即整体标 partial:true，前端待办卡据此别显绿色「无待办」。
export async function refundCounts({ db }: Ctx) {
  await ensure(db, 'afterSales')
  let partial = false
  const cnt = (query: any) =>
    query
      .count()
      .then((r: any) => r.total || 0)
      .catch(() => {
        partial = true
        return 0
      })
  const statuses = Object.values(AFTERSALE_STATUS) as string[]
  const [all, ...nums] = await Promise.all([
    cnt(db.collection('afterSales')),
    ...statuses.map((s) => cnt(db.collection('afterSales').where({ status: s }))),
  ])
  const counts: Record<string, number> = { all }
  statuses.forEach((s, i) => (counts[s] = nums[i]))
  return reply(200, { ok: true, counts, partial })
}

// 退款决策判据（激活码状态数据链·闭 S10「自动判据」洞·根因#8：不伪造徽章→补真数据）。读类·不写库。
// 按 afterSale._openid + 该商品对应课程（products.courseId·回退 course-<productId>·与 genQrcodes/StepBatch
// 同口径），查 activations 算「买家是否已激活/已进课该课程」——给审核员真判据（已激活=退货权失·谨慎）。
export async function getRefundDetail({ db, data }: Ctx) {
  const id = String((data && data.id) || '')
  if (!id) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const got = await db
    .collection('afterSales')
    .doc(id)
    .get()
    .catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_RECORD' })
  const a = got.data
  // 本单此行真实可退性（P2·根因#8 判据不失真·与 approveRefund 的 ENTERED_NOT_REFUNDABLE 同口径）：
  // 判据须绑「本单这一订单行」的 refundable/enteredQty，而非「买家这门课有没有进过」——买家可能经别单/别码
  // 进过这门课（activation.entered=true），但本单此行仍可退。审核员据 lineRefundable 判会不会被拦，不被课程级激活误导。
  const reqLine = a.lineId || a.productId
  const order = await db
    .collection('orders')
    .doc(String(a.orderId || ''))
    .get()
    .catch(() => null)
  const line =
    order &&
    order.data &&
    (order.data.items || []).find((it: any) => (it.lineId || it.productId) === reqLine)
  const refundableQty = line ? (Number(line.qty) || 1) - (Number(line.enteredQty) || 0) : 0
  // 行缺失＝approveRefund 的 if(line) 跳过、不因进课拦 → 视作不被 ENTERED 拦（lineRefundable:true）
  const lineRefundable = line ? line.refundable !== false && refundableQty > 0 : true
  return reply(200, {
    ok: true,
    activation: await activationFor(db, a._openid, a.productId),
    lineRefundable,
    refundableQty: line ? refundableQty : null,
    lineFound: !!line,
  })
}

export async function approveRefund({ db, data }: Ctx) {
  const id = String(data.id || '')
  if (!id) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const got = await db
    .collection('afterSales')
    .doc(id)
    .get()
    .catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_RECORD' })
  if (got.data.status !== 'applied')
    return reply(400, { ok: false, error: 'BAD_STATUS:' + got.data.status })

  const cfg = await db
    .collection('config')
    .doc('pay')
    .get()
    .catch(() => null)
  const flowId = cfg && cfg.data && cfg.data.refundFlowId
  if (!flowId) return reply(400, { ok: false, error: 'REFUND_FLOW_NOT_CONFIGURED' })
  const order = await db
    .collection('orders')
    .doc(got.data.orderId)
    .get()
    .catch(() => null)
  if (!order || !order.data) return reply(400, { ok: false, error: 'NO_ORDER' })
  const orderStatusAtStart = order.data.status // 竞态可观测闸用（见下方 SHIP_REFUND_RACE 注释）

  // 复核进课退货权（外审 R1-R4·P1.2 + 深审① 2026-07-02·根因#1 副作用绑状态机）：用户先申请退款（applied）
  // 后再确认进课时，confirmEnter 按件递增 enteredQty（全进才翻 refundable=false）。同意退款前必须按**此刻**
  // 的订单行复核：① 全进课（refundable=false 或剩余可退 0 件）→ 拒，防「已交付课程 + 已退款」；② 部分又进课
  // （剩余可退 < 申请时件数）→ **按当下重算封顶**（用户拍板）：售后单件数/金额同步降级后再打款——只退真正
  // 剩余的钱，不再按申请时刻的件数多退。按有效行键定位（外审 P1.1：新售后 lineId 精确、旧售后回退 productId）。
  const reqLine = got.data.lineId || got.data.productId
  const line = (order.data.items || []).find((it: any) => (it.lineId || it.productId) === reqLine)
  let requalify: Record<string, unknown> | null = null
  if (line) {
    const lineQty = line.qty || 1
    const refundableQtyNow = lineQty - (line.enteredQty || 0)
    if (line.refundable === false || refundableQtyNow <= 0) {
      return reply(400, { ok: false, error: 'ENTERED_NOT_REFUNDABLE' })
    }
    const recQty = Number(got.data.qty) || refundableQtyNow // 旧售后单无 qty：视作当下值（不降级）
    if (refundableQtyNow < recQty) {
      // 申请后又进课：按当下剩余件数重算分摊（公式单源 shared refundShareFen·与 applyRefund 同一份）
      const amountFen = toFen(Number(order.data.amount))
      const goodsFen = toFen(Number(order.data.goods))
      const itemFen = asFen(toFen(line.price) * refundableQtyNow)
      // 读齐同单售后算 used 封顶（深审 P2·根因#7）：显式取到上限，命中即 fail-closed 拒退 + 告警。
      const exist = await db
        .collection('afterSales')
        .where({ orderId: got.data.orderId })
        .limit(AFTERSALE_SCAN_CAP)
        .get()
        .catch(() => ({ data: [] }))
      if (exist.data.length >= AFTERSALE_SCAN_CAP) {
        await notifyAlert('money', 'approveRefund', 'AFTERSALE_SCAN_CAP', {
          orderId: got.data.orderId,
        })
        return reply(400, { ok: false, error: 'REFUND_SCAN_CAP' })
      }
      const used = asFen(
        exist.data
          .filter(
            (a: any) => a._id !== id && ['applied', 'approved', 'refunded'].includes(a.status)
          )
          .reduce((s: number, a: any) => s + toFen(Number(a.refundAmount)), 0)
      )
      const refundFen = refundShareFen(amountFen, goodsFen, itemFen, used)
      if (refundFen <= 0) return reply(400, { ok: false, error: 'NOTHING_LEFT' })
      requalify = {
        qty: refundableQtyNow,
        itemTotal: fenToYuan(itemFen),
        refundAmount: fenToYuan(refundFen),
        requalifiedAt: Date.now(), // 留痕：这单在审批时按当下降过级（对账/客诉可溯）
      }
    }
  }

  // 微信合规退款单号（根因#12·案 A 卡单真因）：老单存了 outRefundNo 直接用；没有（本批前建的单/纯 ASCII 老单）
  // 按 _id 现派生——含中文 SKU/spec 的 _id 会被规整成 ASCII 单号，不再被微信 PARAM_ERROR 拒。落库供退款回调反查。
  const refundNo = got.data.outRefundNo || refundNoFor(id)

  // 原子抢占（审核批次A-2）：仍是 applied 才置 approved——并发只有一个抢到，杜绝重复触发退款；
  // 重算降级（requalify）与抢占同一次条件更新落库：打款金额与售后单永远一致（refundCallback 金额核验依赖它）。
  const grab = await db
    .collection('afterSales')
    .where({ _id: id, status: 'applied' })
    .update({
      data: {
        status: 'approved',
        approvedAt: Date.now(),
        outRefundNo: refundNo,
        ...(requalify || {}),
      },
    })
  if (!grab.stats || grab.stats.updated !== 1) {
    return reply(400, { ok: false, error: 'BAD_STATUS:concurrent' })
  }

  // 触发退款工作流（kit.callFlow 单点，根因#12）：金额取售后单分摊额（重算降级后以新额为准）+ 订单实付，不收前端
  const refundYuan = requalify ? (requalify.refundAmount as number) : Number(got.data.refundAmount)
  const r = await callFlow(String(flowId), {
    out_trade_no: got.data.orderId,
    out_refund_no: refundNo,
    reason: String(got.data.reason || '用户申请退款').slice(0, 80),
    amount: {
      refund: toFen(refundYuan),
      total: toFen(order.data.amount),
      currency: 'CNY',
    },
  })
  if (!r || !(r.status || r.refund_id || r.out_refund_no)) {
    await notifyAlert('money', 'approveRefund', 'REFUND_TRIGGER_FAIL', { id })
    // 条件回滚（审计 P1·防二次退款）：仅当仍是 approved 才退回 applied。callFlow 超时返 null 时微信可能已真退款，
    // 退款回调会抢先 approved→refunded；无条件 .doc().update 会把 refunded 打回 applied→可二次审批重复退款。
    // where(status:approved) 保证只回滚未被回调推进的那一笔。
    const rb = await db
      .collection('afterSales')
      .where({ _id: id, status: 'approved' })
      .update({ data: { status: 'applied' } })
      .catch(() => null)
    // 回滚未成功辨别（深审 P1·病根#14 不静默吞）：updated!==1 有两因——① 回调已抢先 approved→refunded
    // （微信真退了款·正常幂等·无需回滚）；② 回滚 update 本身失败（售后单卡死 approved·approveRefund 要
    // applied 才能重试→管理员无法重试·钱没退）。后者必须告警人工，不能像旧版 .catch(()=>{}) 静默吞。读回辨别。
    if (!rb || !rb.stats || rb.stats.updated !== 1) {
      const fresh = await db
        .collection('afterSales')
        .doc(id)
        .get()
        .catch(() => null)
      if (fresh && fresh.data && fresh.data.status === 'approved') {
        await notifyAlert('money', 'approveRefund', 'REFUND_ROLLBACK_FAIL', { id })
      }
    }
    return reply(500, { ok: false, error: 'REFUND_TRIGGER_FAIL' })
  }
  // 并发窗口可观测（P2·根因#14·与 overrideRefund 侧同款、与 shipOne 侧 REFUND_HOLD 闸对称）：见
  // overrideRefund 内 SHIP_REFUND_RACE 注释——批准前订单不是 shipped、批准落库后却已是 shipped，说明
  // 恰好在本次批准执行期间被并发发货。钱照退，只留高危信号供人工核实是否需要拦截物流。
  if (orderStatusAtStart !== 'shipped') {
    const fresh = await db.collection('orders').doc(got.data.orderId).get().catch(() => null)
    if (fresh && fresh.data && fresh.data.status === 'shipped') {
      await notifyAlert('money', 'approveRefund', 'SHIP_REFUND_RACE', { id, orderId: got.data.orderId })
    }
  }
  return reply(200, { ok: true })
}

export async function rejectRefund({ db, data }: Ctx) {
  const id = String(data.id || '')
  const reason = String(data.reason || '')
    .trim()
    .slice(0, 100)
  if (!id || !reason) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const got = await db
    .collection('afterSales')
    .doc(id)
    .get()
    .catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_RECORD' })
  if (got.data.status !== 'applied')
    return reply(400, { ok: false, error: 'BAD_STATUS:' + got.data.status })
  // 条件更新（深审②·原子化）：仍是 applied 才置 rejected——读检查到写入之间被同意抢先（approved·钱已进
  // 退款通道）时绝不 clobber 回 rejected（否则退款回调 from applied/approved 抢不到状态·钱退了单据却是已拒绝）。
  const grab = await db
    .collection('afterSales')
    .where({ _id: id, status: 'applied' })
    .update({ data: { status: 'rejected', rejectedAt: Date.now(), rejectReason: reason } })
  if (!grab.stats || grab.stats.updated !== 1) {
    return reply(400, { ok: false, error: 'BAD_STATUS:concurrent' })
  }
  return reply(200, { ok: true })
}
