import {
  MAX_QTY,
  MAX_ORDER_LINES,
  toFen,
  asFen,
  fenToYuan,
  isValidPriceYuan,
  CHECKOUT_ADDONS,
  COUPON,
  SHIP,
} from '@luckyducky/shared'
import { withOpenId, withRateLimit, ok, err, reserveStock, restoreStock } from '../../kit'

// 创建订单（敏感：前端禁写 orders）。openid 闸 + 前端只传 {items:[{id,qty,sku?}],address}，
// 价格/金额一律按云端 products 现算（不信任前端价）+ 服务端不变量（主商品必含 + 地址四要素）+
// 订单号防碰撞（add 库级唯一 + 重试，绝不覆盖旧单）。PAY_MODE：mock 直接 paid / real 写 pending。

// 搭配购小件服务端权威定价 + 占位券/运费：单源 shared/seed/checkout（根因#5/#6，与 miniapp
// data/checkout 同源、esbuild 内联）。占位券 COUPON 开发期无条件抵扣，P4 接真实券系统一并替换。
const ADDONS: Record<string, { name: string; price: number }> = Object.fromEntries(
  CHECKOUT_ADDONS.map((a) => [a.id, { name: a.name, price: a.price }])
)

// 订单行稳定身份（外审 R1-R4·P1.1·根因#1 唯一标识粒度不足）：同商品多 SKU 同单需稳定行键，售后/评价/退款按此
// 定位、不靠 productId（多 SKU 撞）。取 productId__spec（与 inventory idOf 同款·单内唯一·可读）；旧订单无此字段，
// 读路径回退 productId（applyRefund/submitReview 用 `it.lineId || it.productId` 作有效键，两端一致）。
const lineIdOf = (productId: string, spec: string) => `${productId}__${spec || ''}`

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

export const main = withOpenId(
  // 频控（根因#13）：下单造数/成本敏感，单用户 20 单/分已远超正常，超即拒——挡刷单洪水
  withRateLimit('createOrder', { max: 20, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const _ = db.command
    const e: any = event

    // 条目契约：id 非空、qty 正整数；sku 可选（云端按 products.skus 校验定价）
    const lines = (Array.isArray(e.items) ? e.items : [])
      .filter((l: any) => l && l.id && Number.isInteger(l.qty) && l.qty > 0)
      .map((l: any) => ({ ...l, sku: typeof l.sku === 'string' ? l.sku.slice(0, 30) : '' }))
    if (!lines.length) return err('EMPTY_ITEMS')
    // 数量 / 条数硬上限：拦超大单穿透（外部体检 P1，金额边界）
    if (lines.length > MAX_ORDER_LINES) return err('TOO_MANY_ITEMS')
    if (lines.some((l: any) => l.qty > MAX_QTY)) return err('BAD_QTY')
    // 服务端不变量：搭配购不可单买，订单必须含至少一个主商品
    if (!lines.some((l: any) => !ADDONS[l.id])) return err('NO_MAIN_ITEM')

    // 云端定价：商品查 products，搭配购查 ADDONS；未知条目整单拒
    const prodIds = [...new Set(lines.map((l: any) => l.id).filter((id: string) => !ADDONS[id]))]
    const res = prodIds.length
      ? await db
          .collection('products')
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
          enteredQty: 0, // 件级进课账（外审 P1.3）：进课按件递增·退款退 qty-enteredQty 剩余件
          refundable: true,
        })
      } else if (byId[l.id]) {
        const p = byId[l.id]
        // 停售挡交易入口 fail-closed（审核 P1·债#12·根因#3）：软下架商品（listed:false）此前只挡 getProducts
        // 列表，旧购物车/缓存/直调仍能下单——这里整单拒，且在定价/预留库存之前返回（不建单·不扣库存）。
        if (p.listed === false) return err('UNLISTED_ITEM:' + l.id)
        let price = p.price
        let spec = p.tag || ''
        if (l.sku) {
          const sk = (Array.isArray(p.skus) ? p.skus : []).find((x: any) => x && x.name === l.sku)
          if (!sk) return err('UNKNOWN_SKU:' + l.id + ':' + l.sku)
          // 交易最终关口 fail-closed（审计 P1）：库内 SKU 价须有效，杜绝脏数据/手工写库穿透
          if (!isValidPriceYuan(sk.price)) return err('BAD_SKU_PRICE:' + l.id + ':' + l.sku)
          price = Number(sk.price)
          spec = l.sku
        } else if (!isValidPriceYuan(p.price)) {
          // 库内主商品价须有效（发布侧已挡新发布，此处再挡历史脏数据/迁移污染）
          return err('BAD_PRICE:' + l.id)
        }
        items.push({ productId: p.id, lineId: lineIdOf(p.id, spec), name: p.name, spec, price, qty: l.qty, enteredQty: 0, refundable: true })
      } else {
        return err('UNKNOWN_ITEM:' + l.id)
      }
    }

    // 金额用「分」整数运算（根因#4：杜绝元浮点累加漂移）；存库仍记元（与现网兼容），由分精确换算
    const goodsFen = asFen(items.reduce((s, it) => s + toFen(it.price) * it.qty, 0))
    const amountFen = asFen(Math.max(0, goodsFen + toFen(SHIP) - toFen(COUPON)))
    const goods = fenToYuan(goodsFen)
    const amount = fenToYuan(amountFen)

    // 地址快照：白名单字段，四要素必填 + 手机号基本格式（不信任前端守卫）
    const a = e.address || {}
    const address = {
      name: String(a.name || '').trim(),
      phone: String(a.phone || '').trim(),
      region: String(a.region || '').trim(),
      detail: String(a.detail || '').trim(),
    }
    if (!address.name || !address.phone || !address.region || !address.detail)
      return err('BAD_ADDRESS')
    if (address.phone.replace(/\D/g, '').length < 7) return err('BAD_ADDRESS')

    // PAY_MODE：config/pay.mode==='real' 才走真支付（写 pending 等回调）；否则 mock。
    const cfg = await db
      .collection('config')
      .doc('pay')
      .get()
      .catch(() => null)
    const payMode = cfg && cfg.data && cfg.data.mode === 'real' ? 'real' : 'mock'
    // fail-closed（根因#3 信任边界默认拒）：生产缺/错支付配置绝不伪造已付单——mock 仅在显式
    // ALLOW_MOCK_PAY=1（开发/测试 env，生产永不设）放行，否则拒单。杜绝 config 漂移/误删→未付变已付。
    if (payMode === 'mock' && process.env.ALLOW_MOCK_PAY !== '1') return err('PAY_CONFIG_MISSING')

    // 下单即预留库存（库存#1·乐观 CAS 防超卖）：实物主商品逐 SKU 原子扣减；不限量（无 inventory 文档）放行；
    // 任一不足→整单拒 OUT_OF_STOCK（已扣回滚在 reserveStock 内）。reserved 记进订单供超时/退款回补。
    const stockLines = items
      .filter((it) => !ADDONS[it.productId])
      .map((it) => ({ productId: it.productId, spec: it.spec, qty: it.qty }))
    const rsv = await reserveStock(stockLines)
    if (!rsv.ok)
      return err('OUT_OF_STOCK' + (rsv.short ? ':' + rsv.short.productId + ':' + rsv.short.spec : ''))

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
    if (payMode !== 'real') order.paidAt = now // mock：模拟支付直接已付

    // 订单号防碰撞：add（_id 库级唯一，撞号抛错）+ 重新摇号重试，绝不覆盖既有交易单据
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = orderNo(now)
      try {
        await db.collection('orders').add({ data: { ...order, _id: id, id } })
        return ok({ order: { ...order, _id: id, id } })
      } catch {
        /* 撞号，换号重试 */
      }
    }
    await restoreStock(rsv.reserved) // 建单彻底失败：把已预留库存还回去（不锁死库存）
    return err('ORDER_ID_BUSY')
  })
)
