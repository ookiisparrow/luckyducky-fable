import {
  COLLECTIONS,
  toFen,
  asFen,
  fenToYuan,
  refundShareFen,
  AFTERSALE_STATUS,
  AFTERSALE_QUOTA_STATUSES,
  AFTERSALE_SCAN_CAP,
  buildBadStatus,
} from '@ldrw/shared'
import { callFlow, refundNoFor, pageQuery, notifyAlert, isDocMissing, isCollectionMissing, getDocOrNull, err } from '../../../kit'
import type { OrderDoc, AfterSaleDoc } from '@ldrw/shared'
import { reply, ensure, activationFor, type Ctx } from '../lib'

// 同单售后读齐（退款封顶 used / 补录分母锁都靠它）：裸 .get() 默认 100 条截断会少算 used，故显式取到
// AFTERSALE_SCAN_CAP，触顶＝记录数异常 → 告警并返回 null 由调用方拒退。读失败不接住（交网关回 500）：
// 当成「没有售后」就是 used=0 退超、REFUND_EXISTS 锁被绕过。集合未建＝真没有售后。
async function orderAfterSales(db: any, orderId: string, fn: string): Promise<AfterSaleDoc[] | null> {
  const r = await db
    .collection(COLLECTIONS.afterSales)
    .where({ orderId })
    .limit(AFTERSALE_SCAN_CAP)
    .get()
    .catch((e: unknown) => {
      if (isCollectionMissing(e)) return { data: [] }
      throw e
    })
  if (r.data.length < AFTERSALE_SCAN_CAP) return r.data
  await notifyAlert('money', fn, 'AFTERSALE_SCAN_CAP', { orderId })
  return null
}

// 退款流未受理后的 approved→applied 回滚。必须条件化：callFlow 超时返 null 时微信可能已真退款，回调会抢先置
// refunded，无条件回滚会把它打回 applied、可二次退款。未命中有两因：回调已抢先（正常），或回滚写本身失败
// （卡 approved：重试只得 NOTHING_LEFT/BAD_STATUS、钱没退）——读回辨别，后者告警。读回本身失败（多半与回滚写
// 同因的库故障）辨别不了，按可能卡 approved 告警；只有读成功且已不在 approved 才不报。
async function rollbackApproved(db: any, id: string, fn: string) {
  const rb = await db
    .collection(COLLECTIONS.afterSales)
    .where({ _id: id, status: 'approved' })
    .update({ data: { status: 'applied' } })
    .catch(() => null)
  if (rb && rb.stats && rb.stats.updated === 1) return
  const fresh = await db
    .collection(COLLECTIONS.afterSales)
    .doc(id)
    .get()
    .catch((e: unknown) => (isDocMissing(e) ? { data: null } : null))
  if (!fresh || (fresh.data && fresh.data.status === 'approved'))
    await notifyAlert('money', fn, 'REFUND_ROLLBACK_FAIL', { id })
}

// 退款工作流受理判据：回了 status / refund_id / out_refund_no 任一个才算受理，否则按未受理回滚。
const flowAccepted = (r: any): boolean => !!(r && (r.status || r.refund_id || r.out_refund_no))

// 并发窗口可观测（根因#14·与 shipOne 侧 REFUND_HOLD 闸对称）：shipOne 与退款批准各自读订单/售后当前
// 状态、中间没有互斥（重型锁/事务模拟不是本仓既有模式，收窄+可观测已是合理止损——见 shipOne 同款注释）。
// 若批准退款前订单还不是 shipped，批准落库后订单却已是 shipped——说明恰好在本次批准执行期间被并发
// 发货，构成钱货两空风险。钱已经该退，不能因为货发了就不退，但必须留一条高危信号让人工去核实是否需要
// 拦截物流/联系客户。shipOne 侧挡「先退款后发货」，这里补「先发货后退款」方向的兜底信号，两个方向对称。
async function alertIfShippedMeanwhile(db: any, orderId: string, statusAtStart: string, fn: string, ctx: Record<string, unknown>) {
  if (statusAtStart === 'shipped') return
  const fresh = await db.collection(COLLECTIONS.orders).doc(orderId).get().catch(() => null)
  if (fresh && fresh.data && fresh.data.status === 'shipped') {
    await notifyAlert('money', fn, 'SHIP_REFUND_RACE', ctx)
  }
}

// —— 管理员越规退款（决策§26·客服端退货管理权限 refund:manage）——
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
  if (!orderId || !reqLine || !reason) return reply(400, err('BAD_ARGS'))

  // 两次纯读互不依赖，并行；判定顺序：退款流 → 订单
  const [cfg, got] = await Promise.all([
    db
      .collection(COLLECTIONS.config)
      .doc('pay')
      .get()
      .catch(() => null),
    db
      .collection(COLLECTIONS.orders)
      .doc(orderId)
      .get()
      .catch(() => null),
  ])
  const flowId = cfg && cfg.data && cfg.data.refundFlowId
  if (!flowId) return reply(400, err('REFUND_FLOW_NOT_CONFIGURED'))
  if (!got || !got.data) return reply(400, err('NO_ORDER'))
  const order: OrderDoc = got.data
  // 状态闸放行 refund_required（用户拍板）：该终态＝关单后晚到支付回调、库存已被
  // 别人买走（payCallback PAID_BUT_OOS 唯一产生点）——**钱已经收了、货永远发不出**，必须退，不放行就没有任何
  // 在库退款路径（只能人工登商户平台退，且巡检会把它永久报死信）。故这里放行，且**只放行 overrideRefund 这
  // 一个管理员越规通道**（cap refund:manage·决策§26），客户自助面 applyRefund 不扩。
  // payment_exception 同样放行，但分母与发给微信的 amount.total 都改用 paidFee——支付回调记下的微信原单总额
  // （amount.total，不是扣了立减的 payer_total）：微信要求退款 total 等于原单总额，订单标价与它不符正是
  // 这单异常的原因。补差转正常支付不在本入口内。
  // 为什么不放行 closed：closed 是「钱根本没收」的正常关单（超时未支付/主动取消），放行＝凭空退款给
  // 没付过钱的人，是纯资损洞。「已收钱」是本入口的前提，不是状态多寡的问题。
  // 钱守恒：refundShareFen 行/单双口径封顶照旧——payment_exception 用 paidFee 作为全单实付分母。
  if (!['paid', 'shipped', 'done', 'refund_required', 'payment_exception'].includes(order.status))
    return reply(400, err(buildBadStatus(order.status)))
  const orderStatusAtStart = order.status // 竞态可观测闸用（见 alertIfShippedMeanwhile）

  const line = (order.items || []).find((it) => (it.lineId || it.productId) === reqLine)
  if (!line) return reply(400, err('UNKNOWN_ITEM'))
  const lineId = line.lineId || line.productId

  // 越过资格：不看 refundable/enteredQty/既有售后（含 rejected），按整行件数算分摊上限。
  // 钱守恒保留（根因#1 行级封顶）：若 used 只算全单已退，同一行重复调用时「本行分摊份额」
  // 每次都按 itemFen 重新算出、只被「全单已退」减——只要兄弟行还有余量，同一行能被反复越规退到把
  // 整单余额退光。故按行/单双口径分别封顶再取小：usedLine=同 orderId+lineId 的已提交额度（该行自己已拿走
  // 多少）、usedOrder=全单已提交额度（既有口径，防超实付总额）；lineShare 用 used=0 算出「该行理论分摊上限
  // （不看用量）」，减去 usedLine 得该行剩余，再与 orderCap（usedOrder 封顶后的全单剩余）取小。
  const actualPaidFen = Number(order.paidFee)
  if (order.status === 'payment_exception' && (!Number.isInteger(actualPaidFen) || actualPaidFen <= 0)) {
    await notifyAlert('money', 'overrideRefund', 'PAYMENT_AMOUNT_MISSING', { orderId })
    return reply(400, err('PAYMENT_AMOUNT_MISSING'))
  }
  const amountFen = order.status === 'payment_exception' ? asFen(actualPaidFen) : toFen(Number(order.amount))
  const goodsFen = toFen(Number(order.goods))
  const itemFen = asFen(toFen(line.price) * (line.qty || 1))
  const exist = await orderAfterSales(db, orderId, 'overrideRefund')
  if (!exist) return reply(400, err('REFUND_SCAN_CAP'))
  const settled = (a: AfterSaleDoc) => AFTERSALE_QUOTA_STATUSES.includes(a.status)
  const usedOrder = asFen(
    exist.filter(settled).reduce((s, a) => s + toFen(Number(a.refundAmount)), 0)
  )
  const usedLine = asFen(
    exist
      .filter((a) => settled(a) && (a.lineId || a.productId) === lineId)
      .reduce((s, a) => s + toFen(Number(a.refundAmount)), 0)
  )
  const lineShare = refundShareFen(amountFen, goodsFen, itemFen, asFen(0))
  const orderCap = refundShareFen(amountFen, goodsFen, itemFen, usedOrder)
  const refundFen = asFen(Math.min(Math.max(0, lineShare - usedLine), orderCap))
  if (refundFen <= 0) return reply(400, err('NOTHING_LEFT'))

  // 确定性 _id（根因#1 幂等 + 跨函数 TOCTOU）：首个记录与客户 applyRefund
  // 共用同一 _id 命名空间 `orderId__lineId`（app/actions/orders.ts applyRefund 同款），不是各自另起一套——
  // 两条路径「读 exist（都读到空）→ 算金额 → 写」并发时会在同一个 _id 上物理相撞，输家 add() 必炸：
  // overrideRefund 侧走下方 catch 读回判 409 CONCURRENT，applyRefund 侧走它自己的撞键分支判 ALREADY_APPLIED
  // （两侧各自具备"撞键=对方已写、天然幂等"的收尾逻辑，但只有共用 _id 才会真相撞）。一旦该行
  // 曾经落过任何记录（无论是客户 applied 还是本函数写的，含 rejected——越规不看资格锁），基础位已占用，
  // 后续再越规只能退到编号位 `__ovrN`（N=该行既有 __ovr 前缀售后单数量，查 exist 时顺带数，不加查询）；
  // 编号位之间靠「并发双调算得同一 N → 撞键→输家中止」互斥。
  const bareId = orderId + '__' + lineId
  const ovrPrefix = bareId + '__ovr'
  const bareTaken = exist.some((a) => a._id === bareId)
  const ovrCount = exist.filter(
    (a) => typeof a._id === 'string' && a._id.startsWith(ovrPrefix)
  ).length
  const asId = bareTaken ? ovrPrefix + ovrCount : bareId
  const outRefundNo = refundNoFor(asId) // 微信合规退款单号（asId 含中文 SKU/spec·根因#12）
  await ensure(db, COLLECTIONS.afterSales)
  const now = Date.now()
  try {
    await db.collection(COLLECTIONS.afterSales).add({
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
    // add 失败必须中止、绝不接着触发真退款（根因#14：若 .catch(()=>{}) 写失败后仍 callFlow，
    // 退款回调按 outRefundNo 反查将无单）。撞键判定不靠错误类型嗅探（仓内惯例不区分 add 错误类型）：
    // 读回 doc(asId)——存在＝并发方已写（天然幂等，非故障）；不存在＝真写失败，留痕告警。
    const reread = await db
      .collection(COLLECTIONS.afterSales)
      .doc(asId)
      .get()
      .catch(() => null)
    if (reread && reread.data) return reply(409, err('CONCURRENT'))
    await notifyAlert('money', 'overrideRefund', 'AFTERSALE_WRITE_FAIL', { id: asId })
    return reply(500, err('WRITE_FAIL'))
  }

  const r = await callFlow(String(flowId), {
    out_trade_no: orderId,
    out_refund_no: outRefundNo,
    reason: reason.slice(0, 80),
    amount: { refund: refundFen, total: amountFen, currency: 'CNY' },
  })
  if (!flowAccepted(r)) {
    await notifyAlert('money', 'overrideRefund', 'REFUND_TRIGGER_FAIL', { id: asId })
    await rollbackApproved(db, asId, 'overrideRefund')
    return reply(500, err('REFUND_TRIGGER_FAIL'))
  }
  await alertIfShippedMeanwhile(db, orderId, orderStatusAtStart, 'overrideRefund', { id: asId, orderId })
  return reply(200, { ok: true, id: asId })
}

// —— 补录实际到账金额（支付异常单的运维闭环·死胡同出口）——
// payment_exception 单若支付回调缺金额字段（amount/totalFee 缺失→paidFee 落 null），overrideRefund 的
// PAYMENT_AMOUNT_MISSING 会把退款永久卡死（没有本动作就无任何在库入口能补，只能人工改库）。本动作＝管理员核对
// 微信商户流水后补录实际到账额（整数分），补录后该单即可正常走 overrideRefund 按实付退款。
// 资金安全：① 仅 payment_exception 态可补（其余状态实付额以支付回调为准，不允许人工篡改）；
// ② paidFee 须正整数分（asFen 同款校验·脏数据早暴露）；③ 条件更新防并发推进（仍是异常态才写）；
// ④ 覆盖旧值留痕（paidFeePrev/paidFeeRecordedAt/paidFeeRecordedBy·可对账可溯）。
export async function recordPaidFee({ db, data, agentId }: Ctx) {
  const id = String((data && data.id) || '')
  const paidFee = Number((data && data.paidFeeFen) ?? NaN)
  if (!id || !Number.isInteger(paidFee) || paidFee <= 0) return reply(400, err('BAD_ARGS'))
  const got = await db.collection(COLLECTIONS.orders).doc(id).get().catch(() => null)
  if (!got || !got.data) return reply(400, err('NO_ORDER'))
  const order: OrderDoc = got.data
  if (order.status !== 'payment_exception') return reply(400, err(buildBadStatus(order.status)))
  // 防手滑护栏：补录金额必须与订单应付同量级——
  // 真实少付/多付不会超出应付 20 倍，超限＝打错位数/恶意放大退款分母，直接拒。
  const expectedFen = toFen(Number(order.amount) || 0)
  if (!(expectedFen > 0) || paidFee > expectedFen * 20) {
    await notifyAlert('money', 'recordPaidFee', 'BAD_AMOUNT_RANGE', { id, paidFee, expectedFen })
    return reply(400, err('BAD_AMOUNT'))
  }
  // 已退/在退（任何售后单）绝不允许改实付额（先退款再改 paidFee→
  // overrideRefund 按新分母重算可退余额→同一笔钱累计退两次）。售后单是退款真相单一来源，
  // 有单即锁定分母，只能人工改库介入。
  const exist = await orderAfterSales(db, id, 'recordPaidFee')
  if (!exist) return reply(400, err('REFUND_SCAN_CAP'))
  if (exist.length) return reply(400, err('REFUND_EXISTS'))
  // 已有有效实付额：无售后单时允许覆盖修正（补录错了改对），留痕 paidFeePrev 可对账。
  const prev = Number(order.paidFee)
  const prevValid = Number.isInteger(prev) && prev > 0
  const upd = await db
    .collection(COLLECTIONS.orders)
    .where({ _id: id, status: 'payment_exception' })
    .update({
      data: {
        paidFee,
        paidFeePrev: prevValid ? prev : null,
        paidFeeRecordedAt: Date.now(),
        paidFeeRecordedBy: String(agentId || ''),
      },
    })
  if (!upd.stats || upd.stats.updated !== 1) {
    await notifyAlert('money', 'recordPaidFee', 'RECORD_FAIL', { id })
    return reply(409, err('CONCURRENT'))
  }
  return reply(200, { ok: true })
}

// —— 售后退款（链10：审核 + 触发退款工作流；金额在申请时已云端分摊算定）——
// 列表游标分页（根因#7）：无参=首页 200（兼容旧控制台读 .list）。
// 服务端筛选/搜索（根因#7 计数/筛选/搜索失真·与订单同治）：status 云端 where 过滤、q=订单号精确
// 命中（orderId·一单可多条售后行），无视状态标签搜全部。计数另走 refundCounts（.count() 精确）。
export async function listRefunds({ db, data }: Ctx) {
  await ensure(db, COLLECTIONS.afterSales)
  const q = String((data && data.q) || '').trim()
  const status = String((data && data.status) || '')
  const filter: Record<string, any> = q
    ? { orderId: q } // 搜索：订单号精确，跨全部状态
    : status && status !== 'all'
      ? { status }
      : {}
  const paged = await pageQuery(db, COLLECTIONS.afterSales, filter, 'appliedAt', data, 200)
  // 补买家收货人（审退款需识别申请人+联系寄回；afterSale 本身无地址→join 订单收货地址·
  // 有界批量一次 _.in 查·不逐单 doc.get）。前端列表掩码、抽屉给全号（PII·根因#3）。
  const list: AfterSaleDoc[] = Array.isArray(paged.list) ? paged.list : []
  const orderIds = [...new Set(list.map((a) => String(a.orderId || '')).filter(Boolean))]
  const addrByOrder: Record<string, { name: string; phone: string }> = {}
  if (orderIds.length) {
    const _ = db.command
    const or = await db
      .collection(COLLECTIONS.orders)
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
// partial（病根#14，同 orderCounts 治法）：某路 .count() 失败若静默兜成 0，前端分不清真 0——
// 故任一路失败即整体标 partial:true，前端待办卡据此别显绿色「无待办」。
export async function refundCounts({ db }: Ctx) {
  await ensure(db, COLLECTIONS.afterSales)
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
    cnt(db.collection(COLLECTIONS.afterSales)),
    ...statuses.map((s) => cnt(db.collection(COLLECTIONS.afterSales).where({ status: s }))),
  ])
  const counts: Record<string, number> = { all }
  statuses.forEach((s, i) => (counts[s] = nums[i]))
  return reply(200, { ok: true, counts, partial })
}

// 退款决策判据（激活码状态数据链·根因#8：不伪造徽章，用真数据）。读类·不写库。
// 按 afterSale._openid + 该商品对应课程（products.courseId·回退 course-<productId>·与 genQrcodes/StepBatch
// 同口径），查 activations 算「买家是否已激活/已进课该课程」——给审核员真判据（已激活=退货权失·谨慎）。
export async function getRefundDetail({ db, data }: Ctx) {
  const id = String((data && data.id) || '')
  if (!id) return reply(400, err('BAD_ARGS'))
  const got = await db
    .collection(COLLECTIONS.afterSales)
    .doc(id)
    .get()
    .catch(() => null)
  if (!got || !got.data) return reply(400, err('NO_RECORD'))
  const a: AfterSaleDoc = got.data
  // 本单此行真实可退性（根因#8 判据不失真·与 approveRefund 的 ENTERED_NOT_REFUNDABLE 同口径）：
  // 判据须绑「本单这一订单行」的 refundable/enteredQty，而非「买家这门课有没有进过」——买家可能经别单/别码
  // 进过这门课（activation.entered=true），但本单此行仍可退。审核员据 lineRefundable 判会不会被拦，不被课程级激活误导。
  const reqLine = a.lineId || a.productId
  // 订单读与激活态互不依赖：并行。订单读失败照抛（网关回 500）：当成「行缺失」会显示可退，误导审核
  const [order, activation] = await Promise.all([
    getDocOrNull<OrderDoc>(db.collection(COLLECTIONS.orders).doc(String(a.orderId || ''))),
    activationFor(db, a._openid, a.productId),
  ])
  const line = order && (order.items || []).find((it) => (it.lineId || it.productId) === reqLine)
  const refundableQty = line ? (Number(line.qty) || 1) - (Number(line.enteredQty) || 0) : 0
  // 行缺失＝approveRefund 的 if(line) 跳过、不因进课拦 → 视作不被 ENTERED 拦（lineRefundable:true）
  const lineRefundable = line ? line.refundable !== false && refundableQty > 0 : true
  return reply(200, {
    ok: true,
    activation,
    lineRefundable,
    refundableQty: line ? refundableQty : null,
    lineFound: !!line,
  })
}

export async function approveRefund({ db, data }: Ctx) {
  const id = String(data.id || '')
  if (!id) return reply(400, err('BAD_ARGS'))
  // 两次纯读互不依赖，并行；判定顺序：记录 → 状态 → 退款流；订单读依赖 orderId，串行
  const [got, cfg] = await Promise.all([
    db
      .collection(COLLECTIONS.afterSales)
      .doc(id)
      .get()
      .catch(() => null),
    db
      .collection(COLLECTIONS.config)
      .doc('pay')
      .get()
      .catch(() => null),
  ])
  if (!got || !got.data) return reply(400, err('NO_RECORD'))
  const rec: AfterSaleDoc = got.data
  if (rec.status !== 'applied')
    return reply(400, err(buildBadStatus(rec.status)))

  const flowId = cfg && cfg.data && cfg.data.refundFlowId
  if (!flowId) return reply(400, err('REFUND_FLOW_NOT_CONFIGURED'))
  const orderGot = await db
    .collection(COLLECTIONS.orders)
    .doc(rec.orderId)
    .get()
    .catch(() => null)
  if (!orderGot || !orderGot.data) return reply(400, err('NO_ORDER'))
  const order: OrderDoc = orderGot.data
  const orderStatusAtStart = order.status // 竞态可观测闸用（见 alertIfShippedMeanwhile）

  // 复核进课退货权（根因#1 副作用绑状态机）：用户先申请退款（applied）
  // 后再确认进课时，confirmEnter 按件递增 enteredQty（全进才翻 refundable=false）。同意退款前必须按**此刻**
  // 的订单行复核：① 全进课（refundable=false 或剩余可退 0 件）→ 拒，防「已交付课程 + 已退款」；② 部分又进课
  // （剩余可退 < 申请时件数）→ **按当下重算封顶**（用户拍板）：售后单件数/金额同步降级后再打款——只退真正
  // 剩余的钱，不按申请时刻的件数多退。按有效行键定位（新售后 lineId 精确、旧售后回退 productId）。
  const reqLine = rec.lineId || rec.productId
  const line = (order.items || []).find((it) => (it.lineId || it.productId) === reqLine)
  let requalify: Pick<AfterSaleDoc, 'qty' | 'itemTotal' | 'refundAmount' | 'requalifiedAt'> | null = null
  if (line) {
    const lineQty = line.qty || 1
    const refundableQtyNow = lineQty - (line.enteredQty || 0)
    if (line.refundable === false || refundableQtyNow <= 0) {
      return reply(400, err('ENTERED_NOT_REFUNDABLE'))
    }
    const recQty = Number(rec.qty) || refundableQtyNow // 旧售后单无 qty：视作当下值（不降级）
    if (refundableQtyNow < recQty) {
      // 申请后又进课：按当下剩余件数重算分摊（公式单源 shared refundShareFen·与 applyRefund 同一份）
      const amountFen = toFen(Number(order.amount))
      const goodsFen = toFen(Number(order.goods))
      const itemFen = asFen(toFen(line.price) * refundableQtyNow)
      const exist = await orderAfterSales(db, rec.orderId, 'approveRefund')
      if (!exist) return reply(400, err('REFUND_SCAN_CAP'))
      const used = asFen(
        exist
          .filter(
            (a) => a._id !== id && AFTERSALE_QUOTA_STATUSES.includes(a.status)
          )
          .reduce((s, a) => s + toFen(Number(a.refundAmount)), 0)
      )
      const refundFen = refundShareFen(amountFen, goodsFen, itemFen, used)
      if (refundFen <= 0) return reply(400, err('NOTHING_LEFT'))
      requalify = {
        qty: refundableQtyNow,
        itemTotal: fenToYuan(itemFen),
        refundAmount: fenToYuan(refundFen),
        requalifiedAt: Date.now(), // 留痕：这单在审批时按当下降过级（对账/客诉可溯）
      }
    }
  }

  // 微信合规退款单号（根因#12）：单上存了 outRefundNo 直接用；没有（早期建的单/纯 ASCII 老单）
  // 按 _id 现派生——含中文 SKU/spec 的 _id 会被规整成 ASCII 单号，免被微信 PARAM_ERROR 拒。落库供退款回调反查。
  const refundNo = rec.outRefundNo || refundNoFor(id)

  // 原子抢占：仍是 applied 才置 approved——并发只有一个抢到，杜绝重复触发退款；
  // 重算降级（requalify）与抢占同一次条件更新落库：打款金额与售后单永远一致（refundCallback 金额核验依赖它）。
  const grab = await db
    .collection(COLLECTIONS.afterSales)
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
    return reply(400, err(buildBadStatus('concurrent')))
  }

  // 触发退款工作流（kit.callFlow 单点，根因#12）：金额取售后单分摊额（重算降级后以新额为准）+ 订单实付，不收前端
  const refundYuan = requalify ? requalify.refundAmount : Number(rec.refundAmount)
  const r = await callFlow(String(flowId), {
    out_trade_no: rec.orderId,
    out_refund_no: refundNo,
    reason: String(rec.reason || '用户申请退款').slice(0, 80),
    amount: {
      refund: toFen(refundYuan),
      total: toFen(order.amount),
      currency: 'CNY',
    },
  })
  if (!flowAccepted(r)) {
    await notifyAlert('money', 'approveRefund', 'REFUND_TRIGGER_FAIL', { id })
    await rollbackApproved(db, id, 'approveRefund')
    return reply(500, err('REFUND_TRIGGER_FAIL'))
  }
  await alertIfShippedMeanwhile(db, rec.orderId, orderStatusAtStart, 'approveRefund', { id, orderId: rec.orderId })
  return reply(200, { ok: true })
}

export async function rejectRefund({ db, data }: Ctx) {
  const id = String(data.id || '')
  const reason = String(data.reason || '')
    .trim()
    .slice(0, 100)
  if (!id || !reason) return reply(400, err('BAD_ARGS'))
  const got = await db
    .collection(COLLECTIONS.afterSales)
    .doc(id)
    .get()
    .catch(() => null)
  if (!got || !got.data) return reply(400, err('NO_RECORD'))
  const rec: AfterSaleDoc = got.data
  if (rec.status !== 'applied') return reply(400, err(buildBadStatus(rec.status)))
  // 条件更新（原子化）：仍是 applied 才置 rejected——读检查到写入之间被同意抢先（approved·钱已进
  // 退款通道）时绝不 clobber 回 rejected（否则退款回调 from applied/approved 抢不到状态·钱退了单据却是已拒绝）。
  const grab = await db
    .collection(COLLECTIONS.afterSales)
    .where({ _id: id, status: 'applied' })
    .update({ data: { status: 'rejected', rejectedAt: Date.now(), rejectReason: reason } })
  if (!grab.stats || grab.stats.updated !== 1) {
    return reply(400, err(buildBadStatus('concurrent')))
  }
  return reply(200, { ok: true })
}
