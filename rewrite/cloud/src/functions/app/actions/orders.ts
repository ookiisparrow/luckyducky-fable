import {
  ERR,
  COLLECTIONS,
  MAX_QTY,
  MAX_ORDER_LINES,
  AFTERSALE_SCAN_CAP,
  PAY_WINDOW_MS,
  toFen,
  asFen,
  fenToYuan,
  isValidPriceYuan,
  refundShareFen,
  CHECKOUT_ADDONS,
  COUPON,
  SHIP,
  ORDER_STATUS,
  buildBadStatus,
} from '@ldrw/shared'
import {
  withOpenId,
  withRateLimit,
  ok,
  err,
  reserveStock,
  restoreStock,
  transition,
  callFlow,
  refundNoFor,
  alert,
  pageQuery,
  getTempUrls,
  IMAGE_URL_MAX_AGE,
  hash53,
} from '../../../kit'

// 创建订单（黄金 orders-money·createOrder 节全量）：价格一律云端现算不信前端；服务端不变量
// （主商品必含/地址四要素/数量条数硬上限）；订单号库级唯一防碰撞；支付配置 fail-closed 只认环境级开关。

const ADDONS: Record<string, { name: string; price: number }> = Object.fromEntries(
  CHECKOUT_ADDONS.map((a) => [a.id, { name: a.name, price: a.price }])
)

// 订单行稳定身份：同商品多 SKU 同单需稳定行键（售后/评价按此定位）；旧单读路径回退 productId。
const lineIdOf = (productId: string, spec: string) => `${productId}__${spec || ''}`

// 批C·订单读时换址（根因#15 图片面·同 catalog.ts getProducts/getContent 换址口径的订单面延伸）：
// 订单行 items[].cover 下单时从 products.cover 快照进订单（见 createOrder 注释），库内快照本身
// 不改写（订单=历史快照单源·T3，不回读/不改写 catalog）；只在 getMyOrders/getOrderById 下发响应前
// 批量换 https 短时址，换不到（fail-soft）回退原 fileID，不吞整单/整个响应。getMyAfterSales 无
// cover 字段（已核消费面 mapAftersales.ts），不在此列。
const isCloudCover = (v: unknown): v is string => typeof v === 'string' && v.startsWith('cloud://')
const swapCover = (v: unknown, urlMap: Record<string, string | null>): unknown =>
  isCloudCover(v) ? (urlMap[v] ?? v) : v
async function swapOrdersCover(orders: any[]): Promise<any[]> {
  const ids = new Set<string>()
  for (const o of orders)
    for (const it of o.items || []) if (isCloudCover(it.cover)) ids.add(it.cover)
  if (!ids.size) return orders
  // 批1·带 maxAge（容器级签发缓存·封面跨会话复用不重签）+ imageProc（图像处理·默认关）·同 catalog IMG_OPTS 口径
  const urlMap = await getTempUrls([...ids], { maxAge: IMAGE_URL_MAX_AGE, imageProc: true })
  return orders.map((o) => ({
    ...o,
    items: (o.items || []).map((it: any) =>
      'cover' in it ? { ...it, cover: swapCover(it.cover, urlMap) } : it
    ),
  }))
}

// 订单号：yyyyMMddHHmm + 4 位随机（北京时间）
function orderNo(now: number): string {
  const d = new Date(now + 8 * 3600 * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const rand = String(Math.floor(Math.random() * 9000) + 1000)
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    rand
  )
}

// 每 openid 在途未支付单上限（收尾硬化批 2026-07-13·防滥用面）：real 模式下单即 reserveStock 持库存至支付窗
// 过后才回补，无此上限时单账号可零成本建单把热销 SKU 库存全额预留 15min 锁死真买家。5 单给正常用户（弃单重下）
// 留足余量，又把单账号可同时锁的 SKU 数封顶——绕过需大量真微信号，成本陡增（用户拍板取此低风险方案·非改钱链热路径）。
const MAX_PENDING_ORDERS = 5

export const createOrder = withOpenId(
  withRateLimit('createOrder', { max: 20, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const _ = db.command
    const e: any = event

    const lines = (Array.isArray(e.items) ? e.items : [])
      .filter((l: any) => l && l.id && Number.isInteger(l.qty) && l.qty > 0)
      .map((l: any) => ({ ...l, sku: typeof l.sku === 'string' ? l.sku.slice(0, 30) : '' }))
    if (!lines.length) return err(ERR.EMPTY_ITEMS)
    if (lines.length > MAX_ORDER_LINES) return err(ERR.TOO_MANY_ITEMS)
    if (lines.some((l: any) => l.qty > MAX_QTY)) return err(ERR.BAD_QTY)
    if (!lines.some((l: any) => !ADDONS[l.id])) return err(ERR.NO_MAIN_ITEM)

    // 云端定价：商品查 products、搭配购查单源表；未知条目整单拒
    const prodIds = [...new Set(lines.map((l: any) => l.id).filter((id: string) => !ADDONS[id]))]
    const res = prodIds.length
      ? await db
          .collection(COLLECTIONS.products)
          .where({ id: _.in(prodIds) })
          .get()
      : { data: [] }
    const byId: Record<string, any> = {}
    res.data.forEach((p: any) => {
      byId[p.id] = p
    })

    const items: any[] = []
    for (const l of lines) {
      if (ADDONS[l.id]) {
        const a = ADDONS[l.id]
        items.push({
          productId: l.id,
          lineId: lineIdOf(l.id, ''),
          name: a.name,
          spec: '',
          price: a.price,
          qty: l.qty,
          enteredQty: 0,
          refundable: true,
          cover: '', // 搭配购无封面·形状一致（订单行封面单源=下单快照·不留 undefined）
        })
      } else if (byId[l.id]) {
        const p = byId[l.id]
        // 停售挡交易入口 fail-closed：定价/预留之前整单拒（不建单不扣库存）
        if (p.listed === false) return err('UNLISTED_ITEM:' + l.id)
        let price = p.price
        let spec = p.tag || ''
        if (l.sku) {
          const sk = (Array.isArray(p.skus) ? p.skus : []).find((x: any) => x && x.name === l.sku)
          if (!sk) return err('UNKNOWN_SKU:' + l.id + ':' + l.sku)
          if (!isValidPriceYuan(sk.price)) return err('BAD_SKU_PRICE:' + l.id + ':' + l.sku)
          price = Number(sk.price)
          spec = l.sku
        } else if (!isValidPriceYuan(p.price)) {
          return err('BAD_PRICE:' + l.id) // 交易最终关口：库内脏价不放行
        }
        items.push({
          productId: p.id,
          lineId: lineIdOf(p.id, spec),
          name: p.name,
          spec,
          price,
          qty: l.qty,
          enteredQty: 0,
          refundable: true,
          // 封面快照（订单=历史快照·不回读 catalog·T3/§6）：下单那一刻商品封面永久留存，
          // 商品删/停售/换图都不影响历史订单展示；products 已在 byId 手上·零额外查询。
          cover: String(p.cover || ''),
        })
      } else {
        return err('UNKNOWN_ITEM:' + l.id)
      }
    }

    // 金额全程「分」整数运算（设计约束#4）；存库记元（与现网数据兼容），由分精确换算
    const goodsFen = asFen(items.reduce((s, it) => s + toFen(it.price) * it.qty, 0))
    const amountFen = asFen(Math.max(0, goodsFen + toFen(SHIP) - toFen(COUPON)))
    // 占位券 fail-closed（深审 2026-07-05）：货款被券抵到 0 即拒——mp 结算页展示的抵扣与实收永远一致，
    // 不给「上架低价 SKU 即白送」留面；0 元直付路径只服务将来显式免费场景。真券系统落地时随新规则重写。
    if (goodsFen > 0 && amountFen === 0) return err(ERR.COUPON_EXCEEDS_GOODS)
    const goods = fenToYuan(goodsFen)
    const amount = fenToYuan(amountFen)

    // 地址快照：白名单 + 四要素必填 + 截断（不信前端长度）
    const a = e.address || {}
    const address = {
      name: String(a.name || '')
        .trim()
        .slice(0, 40),
      phone: String(a.phone || '')
        .trim()
        .slice(0, 20),
      region: String(a.region || '')
        .trim()
        .slice(0, 60),
      detail: String(a.detail || '')
        .trim()
        .slice(0, 120),
    }
    if (!address.name || !address.phone || !address.region || !address.detail)
      return err(ERR.BAD_ADDRESS)
    if (address.phone.replace(/\D/g, '').length < 7) return err(ERR.BAD_ADDRESS)

    // 支付配置 fail-closed：只认环境级开关——mock 仅显式 ALLOW_MOCK_PAY=1 放行（生产永不设），
    // 库内 config 声称 mock 不作数（可篡改数据不当安全闸），缺/错配置绝不伪造已付单。
    const cfg = await db
      .collection(COLLECTIONS.config)
      .doc('pay')
      .get()
      .catch(() => null)
    const payMode = cfg && cfg.data && cfg.data.mode === 'real' ? 'real' : 'mock'
    if (payMode === 'mock' && process.env.ALLOW_MOCK_PAY !== '1') return err(ERR.PAY_CONFIG_MISSING)

    // 在途未支付单上限闸（防滥用·见 MAX_PENDING_ORDERS 注释）：real 模式建 pending 单会持库存锁，
    // 预留前先数本人未过支付窗的 pending 单，超上限即拒——不占库存不建单。mock 单即 paid、不占锁，不查。
    // 查询口径同 closeExpiredOrders（status:'pending' + createdAt 在支付窗内）。
    if (payMode === 'real') {
      const pendingCutoff = Date.now() - PAY_WINDOW_MS
      const mine = await db
        .collection(COLLECTIONS.orders)
        .where({ _openid: OPENID, status: 'pending', createdAt: _.gt(pendingCutoff) })
        .count()
        .catch(() => ({ total: 0 }))
      if ((mine.total || 0) >= MAX_PENDING_ORDERS) return err(ERR.TOO_MANY_PENDING)
    }

    // 幂等键（批E·P1 防网络超时重试双建单）：前端结算草稿创建时生成一次、失败重试复用同一个键；
    // claim _id=(openid+键) 确定性哈希——撞号＝同一次提交的重试/并发，绝不建二单、不重复扣库存
    // （范式抄 scmAssembly runAssembly 的「确定性 _id claim + 失败回滚」）。订单自身 _id/id 仍走
    // orderNo() 可读格式不变——发货扫码（admin/src/lib/fulfill.ts ORDER_ID_RE）与微信支付 out_trade_no
    // 都认这个形状，故幂等 claim 落独立小集合，只记 claim→orderId 指针，不改订单主键形状。
    const idemKey = (typeof e.idempotencyKey === 'string' ? e.idempotencyKey.trim() : '').slice(0, 200)
    const claimId = idemKey ? 'oi_' + hash53(OPENID + '|' + idemKey) : ''
    if (claimId) {
      await db.createCollection(COLLECTIONS.orderIdempotency).catch(() => {})
      try {
        await db
          .collection(COLLECTIONS.orderIdempotency)
          .add({ data: { _id: claimId, openid: OPENID, orderId: null, createdAt: Date.now() } })
      } catch {
        // 撞号：同一幂等键已提交过（重试/并发）——短轮询等原请求把订单号落定，落定即原样返回同一笔
        // （不重复扣库存/不建二单）；轮询超时仍未落定极罕见（原请求同一时刻仍在处理中）才报 PENDING。
        for (let i = 0; i < 5; i++) {
          const c = await db.collection(COLLECTIONS.orderIdempotency).doc(claimId).get().catch(() => null)
          const existingId = c && c.data && c.data.orderId
          if (existingId) {
            const got = await db.collection(COLLECTIONS.orders).doc(String(existingId)).get().catch(() => null)
            if (got && got.data) return ok({ order: got.data })
            break // 登记了订单号却读不到订单——不应发生，跳出按未落定处理（下方报 PENDING）
          }
          await new Promise((r) => setTimeout(r, 150))
        }
        return err(ERR.ORDER_CLAIM_PENDING)
      }
    }

    // 下单即预留（乐观 CAS 防超卖）：任一不足整单拒（已扣回滚在 reserveStock 内）
    const stockLines = items
      .filter((it) => !ADDONS[it.productId])
      .map((it) => ({ productId: it.productId, spec: it.spec, qty: it.qty }))
    const rsv = await reserveStock(stockLines)
    if (!rsv.ok) {
      if (claimId) await db.collection(COLLECTIONS.orderIdempotency).doc(claimId).remove().catch(() => {}) // 拒单不占幂等键·放行同键重试
      return err(ERR.OUT_OF_STOCK + (rsv.short ? ':' + rsv.short.productId + ':' + rsv.short.spec : ''))
    }

    const now = Date.now()
    const order: any = {
      _openid: OPENID,
      items,
      goods,
      coupon: COUPON,
      ship: SHIP,
      amount,
      address,
      reserved: rsv.reserved,
      status: payMode === 'real' ? 'pending' : 'paid',
      createdAt: now,
    }
    if (payMode !== 'real') order.paidAt = now

    // 订单号防碰撞：库级唯一 + 换号重试，绝不覆盖既有交易单据
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = orderNo(now)
      try {
        await db.collection(COLLECTIONS.orders).add({ data: { ...order, _id: id, id } })
        if (claimId) {
          // 幂等键回填订单号（fail-soft 但不静默·病根14）：订单已真实建成，这一步只是让「同键重试」
          // 未来能查到它；写失败不影响本次返回，但会让本键的下一次重试落进轮询超时→误判 PENDING，
          // 必须留痕供人工核（同 scmAssembly ASSEMBLY_LEDGER_FAIL 口径）。
          await db
            .collection(COLLECTIONS.orderIdempotency)
            .doc(claimId)
            .update({ data: { orderId: id } })
            .catch(() => alert('money', 'createOrder', 'CLAIM_UPDATE_FAIL', { orderId: id, claimId }))
        }
        return ok({ order: { ...order, _id: id, id } })
      } catch {
        // 写失败区分（深审 P2·根因#3 幂等）：add 抛错既可能是 _id 撞号（换号重试），也可能是「写已持久化但
        // SDK 返回超时/网络错」——后者若换号重试会落两张共享同一 reserved 的单（各自关单/取消时 restoreStock
        // 双记＝库存虚增/超卖）。先读回本次 _id：存在且属本人＝本次写其实成功，直接返回该单（幂等）；确不存在
        // 才是真撞号/真失败，换号重试（同 overrideRefund refunds.ts 的读回判定范式，不靠错误类型嗅探）。
        const back = await db
          .collection(COLLECTIONS.orders)
          .doc(id)
          .get()
          .catch(() => null)
        if (back && back.data && back.data._openid === OPENID)
          return ok({ order: { ...order, _id: id, id } })
      }
    }
    await restoreStock(rsv.reserved) // 建单彻底失败：预留还回去（不锁死库存）
    if (claimId) await db.collection(COLLECTIONS.orderIdempotency).doc(claimId).remove().catch(() => {}) // 拒单不占幂等键·放行同键重试
    return err(ERR.ORDER_ID_BUSY)
  })
)

/**
 * 发起支付（黄金 orders-money·pay 节）：金额一律取库内订单换分，不信前端；三道闸（身份/本人/待支付）
 * + 惰性超时关单（抢占成功才回补·幂等）+ 0 元单直付并发校验（没抢到不谎报成功）+ 工作流接缝单点。
 */
// 频控（深审 P2·病根#13）：pay 触发外部微信支付下单 API（callFlow 接缝）——无频控可被任意频率触发外呼。
// 按 openid 限速（同 createOrder 口径·正常下单支付远低于此）。金额安全另有云端换分兜底，此为成本/外呼防刷。
export const pay = withOpenId(
  withRateLimit('pay', { max: 20, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const id = String((event as any).id || '')
    if (!id) return err(ERR.NO_ID)

    // 批C·并行取回（零依赖只读·各自 .catch(()=>null) 已核）：订单读与支付配置读互不依赖对方结果，
    // 并行发起省一次网关往返；校验顺序与错误分支原样不变——订单校验（NOT_FOUND/BAD_STATUS/超时关单）
    // 失败时 cfg 结果原样丢弃（纯读零副作用，等价原「先订单后 config」串行语义）。
    const [got, cfg] = await Promise.all([
      db
        .collection(COLLECTIONS.orders)
        .doc(id)
        .get()
        .catch(() => null),
      db
        .collection(COLLECTIONS.config)
        .doc('pay')
        .get()
        .catch(() => null),
    ])
    if (!got || !got.data || got.data._openid !== OPENID) return err(ERR.NOT_FOUND)
    const order = got.data
    if (order.status !== 'pending') return err(buildBadStatus(order.status))

    // 惰性超时：到点的 pending 当场关闭（定时器只是兜底）；抢占成功才回补预留（幂等绑转移）
    if (Date.now() - order.createdAt > PAY_WINDOW_MS) {
      const { moved } = await transition(COLLECTIONS.orders, id, ['pending'], 'closed', {
        closedAt: Date.now(),
      })
      if (moved && Array.isArray(order.reserved) && order.reserved.length)
        await restoreStock(order.reserved)
      return err(ERR.ORDER_CLOSED)
    }

    const payCfg = (cfg && cfg.data) || {}
    if (payCfg.mode !== 'real' || !payCfg.flowId) return err(ERR.PAY_NOT_ENABLED)

    const totalFee = toFen(order.amount)
    if (totalFee <= 0) {
      // 0 元单（券抵扣到 0）：直接置已付；没抢到（并发关单/并发支付）绝不谎报成功
      const paidAt = Date.now()
      const { moved } = await transition(COLLECTIONS.orders, id, ['pending'], 'paid', { paidAt })
      if (moved) return ok({ paid: true, paidAt })
      const fresh = await db
        .collection(COLLECTIONS.orders)
        .doc(id)
        .get()
        .catch(() => null)
      const st = (fresh && fresh.data && fresh.data.status) || 'unknown'
      if (st === 'paid') return ok({ paid: true, paidAt: fresh!.data.paidAt || paidAt }) // 并发已付：幂等成功
      return err(buildBadStatus(st))
    }

    // 触发支付工作流（JSAPI 下单）：openid 显式传入，金额/单号均来自库内订单
    const firstName = order.items && order.items[0] ? String(order.items[0].name) : '钩织材料包'
    const p = await callFlow(String(payCfg.flowId), {
      description: ('小棉鸭 · ' + firstName).slice(0, 40),
      out_trade_no: order.id,
      amount: { total: totalFee, currency: 'CNY' },
      payer: { openid: OPENID },
    })
    if (!p || !p.paySign) {
      alert('money', 'pay', 'NO_PREPAY', { orderId: order.id }) // 用户付不了款＝漏单，必须可告警
      return err(ERR.UNIFIED_ORDER_FAIL)
    }
    // 对齐 wx.requestPayment 参数名（工作流回传 packageVal）
    return ok({
      payment: {
        timeStamp: String(p.timeStamp),
        nonceStr: String(p.nonceStr),
        package: String(p.packageVal || p.package || ''),
        signType: String(p.signType || 'RSA'),
        paySign: String(p.paySign),
      },
    })
  })
)

/**
 * 申请售后退款（黄金 orders-money·applyRefund 节）：退款额一律云端分摊算定（refundShareFen 单源）；
 * 一单一行一售后（确定性 _id 库级唯一）；数量级退剩余可退件；同单累计封顶实付。
 */
export const applyRefund = withOpenId(async ({ db, OPENID, event }) => {
  const e: any = event
  const orderId = String(e.orderId || '')
  const reqLine = String(e.lineId || e.productId || '') // 新单行键/旧单回退 productId
  if (!orderId || !reqLine) return err(ERR.BAD_ARGS)
  const reason = String(e.reason || '').slice(0, 200)

  const got = await db
    .collection(COLLECTIONS.orders)
    .doc(orderId)
    .get()
    .catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return err(ERR.NOT_FOUND)
  const order = got.data
  if (!['paid', 'shipped', 'done'].includes(order.status)) return err(buildBadStatus(order.status))

  const item = (order.items || []).find((it: any) => (it.lineId || it.productId) === reqLine)
  if (!item) return err('UNKNOWN_ITEM:' + reqLine)
  // 剩余可退件 = 购买件数 − 已进课件数；全进则无可退（旧单无 enteredQty 视 0＝整行可退）
  const qty = item.qty || 1
  const enteredQty = item.enteredQty || 0
  const refundableQty = qty - enteredQty
  if (item.refundable === false || refundableQty <= 0) return err(ERR.NOT_REFUNDABLE)
  const lineId = item.lineId || item.productId
  const productId = item.productId

  // 分摊全程分整数；同单已占额度（申请中/已同意/已退）不可重复退
  const amountFen = toFen(Number(order.amount))
  const goodsFen = toFen(Number(order.goods))
  const itemFen = asFen(toFen(item.price) * refundableQty)

  await db.createCollection(COLLECTIONS.afterSales).catch(() => {})
  // 同单售后须读齐才能算准 used 封顶（深审 P2·根因#7）：裸 .get() 服务端默认 100 条静默截断会少算 used、
  // 令行/单级退款封顶失效。显式取到 AFTERSALE_SCAN_CAP；命中上限＝记录数异常，fail-closed 拒退 + 告警，
  // 绝不按截断值算钱（钱守恒 > 可用性）。
  const exist = await db
    .collection(COLLECTIONS.afterSales)
    .where({ orderId })
    .limit(AFTERSALE_SCAN_CAP)
    .get()
    .catch(() => ({ data: [] }))
  if (exist.data.length >= AFTERSALE_SCAN_CAP) {
    alert('money', 'applyRefund', 'AFTERSALE_SCAN_CAP', { orderId })
    return err('REFUND_SCAN_CAP')
  }
  if (exist.data.some((a: any) => (a.lineId || a.productId) === lineId))
    return err(ERR.ALREADY_APPLIED)
  const used = asFen(
    exist.data
      .filter((a: any) => ['applied', 'approved', 'refunded'].includes(a.status))
      .reduce((s: number, a: any) => s + toFen(Number(a.refundAmount)), 0)
  )
  const refundFen = refundShareFen(amountFen, goodsFen, itemFen, used)
  if (refundFen <= 0) return err(ERR.NOTHING_LEFT)

  const now = Date.now()
  const asId = orderId + '__' + lineId
  const rec = {
    _id: asId,
    orderId,
    _openid: OPENID,
    lineId,
    productId,
    name: item.name,
    spec: item.spec || '',
    qty: refundableQty, // 退款件数=剩余可退件·回补库存按此
    itemTotal: fenToYuan(itemFen),
    refundAmount: fenToYuan(refundFen),
    reason,
    addressName: (order.address && order.address.name) || '',
    phone: (order.address && order.address.phone) || '',
    // 微信退款单号（根因#12·案 A）：_id 可含中文 SKU/spec，派生成合规单号存库供退款回调反查
    outRefundNo: refundNoFor(asId),
    status: 'applied',
    appliedAt: now,
  }
  try {
    await db.collection(COLLECTIONS.afterSales).add({ data: rec })
  } catch {
    return err(ERR.ALREADY_APPLIED) // 库级唯一：一单一行一售后（并发双发只落一条）
  }
  return ok({ afterSale: rec })
})

/** 确认收货（黄金）：本人 + 仅已发货可确认；条件流转防越状态/重复确认。 */
export const confirmReceive = withOpenId(async ({ db, OPENID, event }) => {
  const id = String((event as any).id || '')
  if (!id) return err(ERR.NO_ID)
  const got = await db
    .collection(COLLECTIONS.orders)
    .doc(id)
    .get()
    .catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return err(ERR.NOT_FOUND)
  if (got.data.status !== 'shipped') return err(buildBadStatus(got.data.status))
  const doneAt = Date.now()
  const { moved } = await transition(COLLECTIONS.orders, id, ['shipped'], 'done', { doneAt })
  if (!moved) {
    const fresh = await db
      .collection(COLLECTIONS.orders)
      .doc(id)
      .get()
      .catch(() => null)
    return err(buildBadStatus((fresh && fresh.data && fresh.data.status) || 'unknown'))
  }
  return ok({ doneAt })
})

/**
 * 用户主动取消待支付单（黄金 orders-money·确认收货/关单节）：仅本人 + 仅 pending 可取消；
 * 复用已声明的 pending→closed 边（状态机零改动）；关单回补预留幂等绑 CAS——与超时关单/并发取消
 * 天然互斥，只回补一次（照抄 pay 惰性关单/closeExpiredOrders 的错向安全：transition 先、回补后）。
 */
export const cancelOrder = withOpenId(async ({ db, OPENID, event }) => {
  const id = String((event as any).id || '')
  if (!id) return err(ERR.NO_ID)
  const got = await db
    .collection(COLLECTIONS.orders)
    .doc(id)
    .get()
    .catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return err(ERR.NOT_FOUND) // 属主隔离·不泄存在性
  const order = got.data
  if (order.status !== 'pending') return err(buildBadStatus(order.status))
  const { moved } = await transition(COLLECTIONS.orders, id, ['pending'], 'closed', {
    closedAt: Date.now(),
    cancelledBy: 'user', // 台账区分手动取消 vs 超时关单
  })
  if (!moved) {
    const fresh = await db
      .collection(COLLECTIONS.orders)
      .doc(id)
      .get()
      .catch(() => null)
    return err(buildBadStatus((fresh && fresh.data && fresh.data.status) || 'unknown')) // 并发已被关/已付
  }
  if (Array.isArray(order.reserved) && order.reserved.length) await restoreStock(order.reserved) // 回补绑 moved·只一次
  return ok({ closedAt: Date.now() })
})

/** 本人订单列表（游标分页·属主隔离）。 */
export const getMyOrders = withOpenId(async ({ db, OPENID, event }) => {
  // 状态筛选下推服务端（与游标分页同源·修 order-list 短过滤 tab 内容短于视口拉不动、深页匹配单看不到）：
  // status 须是合法订单状态（ORDER_STATUS 全集·不信前端）·空/非法忽略回全部。
  const raw = String((event as any)?.status || '')
  const status = (Object.values(ORDER_STATUS) as string[]).includes(raw) ? raw : ''
  const where = status ? { _openid: OPENID, status } : { _openid: OPENID }
  const paged = await pageQuery(db, COLLECTIONS.orders, where, 'createdAt', event as any, 100)
  return ok({ ...paged, list: await swapOrdersCover(paged.list) })
})

/** 按单号取本人订单（他人/不存在一律 NOT_FOUND·不泄露存在性）。 */
export const getOrderById = withOpenId(async ({ db, OPENID, event }) => {
  const id = String((event as any).id || '')
  if (!id) return err(ERR.NO_ID)
  const got = await db
    .collection(COLLECTIONS.orders)
    .doc(id)
    .get()
    .catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return err(ERR.NOT_FOUND)
  const [order] = await swapOrdersCover([got.data])
  return ok({ order })
})

/** 本人售后单（游标分页·按申请时间倒序）。 */
export const getMyAfterSales = withOpenId(async ({ db, OPENID, event }) => {
  const paged = await pageQuery(
    db,
    COLLECTIONS.afterSales,
    { _openid: OPENID },
    'appliedAt',
    event as any,
    100
  )
  return ok({ ...paged })
})
