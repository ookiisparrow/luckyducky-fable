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
  CHECKOUT_ADDONS,
  COUPON,
  SHIP,
} from '@ldrw/shared'
import { withOpenId, withRateLimit, ok, err, reserveStock, restoreStock, transition, callFlow, alert } from '../../../kit'

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
