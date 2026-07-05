import {
  ERR,
  COLLECTIONS,
  MAX_QTY,
  MAX_ORDER_LINES,
  PAY_WINDOW_MS,
  toFen,
  asFen,
  fenToYuan,
  isValidPriceYuan,
  refundShareFen,
  CHECKOUT_ADDONS,
  COUPON,
  SHIP,
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
} from '../../../kit'

// 创建订单（黄金 orders-money·createOrder 节全量）：价格一律云端现算不信前端；服务端不变量
// （主商品必含/地址四要素/数量条数硬上限）；订单号库级唯一防碰撞；支付配置 fail-closed 只认环境级开关。

const ADDONS: Record<string, { name: string; price: number }> = Object.fromEntries(
  CHECKOUT_ADDONS.map((a) => [a.id, { name: a.name, price: a.price }])
)

// 订单行稳定身份：同商品多 SKU 同单需稳定行键（售后/评价按此定位）；旧单读路径回退 productId。
const lineIdOf = (productId: string, spec: string) => `${productId}__${spec || ''}`

// 订单号：yyyyMMddHHmm + 4 位随机（北京时间）
function orderNo(now: number): string {
  const d = new Date(now + 8 * 3600 * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const rand = String(Math.floor(Math.random() * 9000) + 1000)
  return (
    d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + rand
  )
}

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
    if (!address.name || !address.phone || !address.region || !address.detail) return err(ERR.BAD_ADDRESS)
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

    // 下单即预留（乐观 CAS 防超卖）：任一不足整单拒（已扣回滚在 reserveStock 内）
    const stockLines = items
      .filter((it) => !ADDONS[it.productId])
      .map((it) => ({ productId: it.productId, spec: it.spec, qty: it.qty }))
    const rsv = await reserveStock(stockLines)
    if (!rsv.ok) return err('OUT_OF_STOCK' + (rsv.short ? ':' + rsv.short.productId + ':' + rsv.short.spec : ''))

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
        return ok({ order: { ...order, _id: id, id } })
      } catch {
        /* 撞号换号重试 */
      }
    }
    await restoreStock(rsv.reserved) // 建单彻底失败：预留还回去（不锁死库存）
    return err(ERR.ORDER_ID_BUSY)
  })
)

/**
 * 发起支付（黄金 orders-money·pay 节）：金额一律取库内订单换分，不信前端；三道闸（身份/本人/待支付）
 * + 惰性超时关单（抢占成功才回补·幂等）+ 0 元单直付并发校验（没抢到不谎报成功）+ 工作流接缝单点。
 */
export const pay = withOpenId(async ({ db, OPENID, event }) => {
  const id = String((event as any).id || '')
  if (!id) return err(ERR.NO_ID)

  const got = await db
    .collection(COLLECTIONS.orders)
    .doc(id)
    .get()
    .catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return err(ERR.NOT_FOUND)
  const order = got.data
  if (order.status !== 'pending') return err('BAD_STATUS:' + order.status)

  // 惰性超时：到点的 pending 当场关闭（定时器只是兜底）；抢占成功才回补预留（幂等绑转移）
  if (Date.now() - order.createdAt > PAY_WINDOW_MS) {
    const { moved } = await transition(COLLECTIONS.orders, id, ['pending'], 'closed', { closedAt: Date.now() })
    if (moved && Array.isArray(order.reserved) && order.reserved.length) await restoreStock(order.reserved)
    return err(ERR.ORDER_CLOSED)
  }

  const cfg = await db
    .collection(COLLECTIONS.config)
    .doc('pay')
    .get()
    .catch(() => null)
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
    return err('BAD_STATUS:' + st)
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
  if (!['paid', 'shipped', 'done'].includes(order.status)) return err('BAD_STATUS:' + order.status)

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
  const exist = await db
    .collection(COLLECTIONS.afterSales)
    .where({ orderId })
    .get()
    .catch(() => ({ data: [] }))
  if (exist.data.some((a: any) => (a.lineId || a.productId) === lineId)) return err(ERR.ALREADY_APPLIED)
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
  if (got.data.status !== 'shipped') return err('BAD_STATUS:' + got.data.status)
  const doneAt = Date.now()
  const { moved } = await transition(COLLECTIONS.orders, id, ['shipped'], 'done', { doneAt })
  if (!moved) {
    const fresh = await db
      .collection(COLLECTIONS.orders)
      .doc(id)
      .get()
      .catch(() => null)
    return err('BAD_STATUS:' + ((fresh && fresh.data && fresh.data.status) || 'unknown'))
  }
  return ok({ doneAt })
})

/** 本人订单列表（游标分页·属主隔离）。 */
export const getMyOrders = withOpenId(async ({ db, OPENID, event }) => {
  const paged = await pageQuery(db, COLLECTIONS.orders, { _openid: OPENID }, 'createdAt', event as any, 100)
  return ok({ ...paged })
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
  return ok({ order: got.data })
})

/** 本人售后单（游标分页·按申请时间倒序）。 */
export const getMyAfterSales = withOpenId(async ({ db, OPENID, event }) => {
  const paged = await pageQuery(db, COLLECTIONS.afterSales, { _openid: OPENID }, 'appliedAt', event as any, 100)
  return ok({ ...paged })
})
