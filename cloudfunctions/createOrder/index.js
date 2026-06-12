// 创建订单（敏感业务：前端禁写 orders，一律走这里）。
// 安全底座（见 CLAUDE.md §14 / 规格 §三）：
//   - openid 取自 getWXContext，不信任前端传入；写库显式写 _openid。
//   - 前端只传 { items:[{ id, qty }], address }；价格与金额按云端 products 现算。
//   - 商品名/规格快照进条目（历史快照惯例）；地址快照只收白名单字段。
//   - PAY_MODE 开关（config 集合 pay 文档，规格 §三）：缺省 mock=直接 paid（开发期）；
//     real=写 pending，由 pay 发起支付、payCallback 回调置 paid。
//   - 时间戳存 epoch 毫秒（避免 serverDate 跨 callFunction 序列化问题）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ⚠️ 与 src/data/checkout.js 保持一致：搭配购小件（暂不入 products 集合，
// 避免污染店面推荐位；P4 接真实支付时再统一归入商品体系）+ 金额常量。
const ADDONS = {
  hook: { name: '替换钩针组 · 2.5 / 3.0mm', price: 39 },
  yarn: { name: '补充棉线包 · 暖色 5 色', price: 29 },
}
const COUPON = 20
const SHIP = 0

// 订单号：yyyyMMddHHmm + 4 位随机（与既有样例风格一致）
function orderNo(now) {
  const d = new Date(now + 8 * 3600 * 1000) // 北京时间
  const p = (n, w = 2) => String(n).padStart(w, '0')
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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }

  // 条目契约：id 非空、qty 正整数；sku 可选（规格名，云端按 products.skus 校验定价）
  const lines = (Array.isArray(event.items) ? event.items : [])
    .filter((l) => l && l.id && Number.isInteger(l.qty) && l.qty > 0)
    .map((l) => ({ ...l, sku: typeof l.sku === 'string' ? l.sku.slice(0, 30) : '' }))
  if (!lines.length) return { ok: false, error: 'EMPTY_ITEMS' }
  // 服务端不变量（审核批次A-4）：搭配购不可单买，订单必须含至少一个主商品（前端守卫的云端对等物）
  if (!lines.some((l) => !ADDONS[l.id])) return { ok: false, error: 'NO_MAIN_ITEM' }

  // 云端定价：商品查 products 集合，搭配购查 ADDONS 表；未知条目整单拒绝
  const prodIds = [...new Set(lines.map((l) => l.id).filter((id) => !ADDONS[id]))]
  const res = prodIds.length
    ? await db.collection('products').where({ id: _.in(prodIds) }).get()
    : { data: [] }
  const byId = {}
  res.data.forEach((p) => {
    byId[p.id] = p
  })

  const items = []
  for (const l of lines) {
    if (ADDONS[l.id]) {
      const a = ADDONS[l.id]
      items.push({ productId: l.id, name: a.name, spec: '', price: a.price, qty: l.qty, refundable: true })
    } else if (byId[l.id]) {
      const p = byId[l.id]
      // SKU 感知定价：传了规格名则必须能在云端 skus 里找到（价格以云端为准），否则拒单
      let price = p.price
      let spec = p.tag || ''
      if (l.sku) {
        const sk = (Array.isArray(p.skus) ? p.skus : []).find((x) => x && x.name === l.sku)
        if (!sk) return { ok: false, error: 'UNKNOWN_SKU:' + l.id + ':' + l.sku }
        price = Number(sk.price) || p.price
        spec = l.sku
      }
      items.push({ productId: p.id, name: p.name, spec, price, qty: l.qty, refundable: true })
    } else {
      return { ok: false, error: 'UNKNOWN_ITEM:' + l.id }
    }
  }

  const goods = items.reduce((s, it) => s + it.price * it.qty, 0)
  const amount = Math.max(0, goods + SHIP - COUPON)

  // 地址快照：白名单字段，全部转字符串；四要素必填 + 手机号基本格式（审核批次A-4，不信任前端守卫）
  const a = event.address || {}
  const address = {
    name: String(a.name || '').trim(),
    phone: String(a.phone || '').trim(),
    region: String(a.region || '').trim(),
    detail: String(a.detail || '').trim(),
  }
  if (!address.name || !address.phone || !address.region || !address.detail) {
    return { ok: false, error: 'BAD_ADDRESS' }
  }
  if (address.phone.replace(/\D/g, '').length < 7) return { ok: false, error: 'BAD_ADDRESS' }

  // PAY_MODE：config 集合缺文档/缺集合一律回落 mock（保持旧行为，零回归）
  const cfg = await db.collection('config').doc('pay').get().catch(() => null)
  const payMode = cfg && cfg.data && cfg.data.mode === 'real' ? 'real' : 'mock'

  const now = Date.now()
  const order = {
    _openid: OPENID,
    items,
    goods,
    coupon: COUPON,
    ship: SHIP,
    amount,
    address,
    status: payMode === 'real' ? 'pending' : 'paid',
    createdAt: now,
  }
  if (payMode !== 'real') order.paidAt = now // mock：模拟支付直接已付

  // 订单号防碰撞（审核批次A-4）：同分钟随机空间仅 9000，原 doc(id).set 碰撞会覆盖旧单。
  // 改用 add（_id 库级唯一，撞号抛错）+ 重新摇号重试，绝不覆盖既有交易单据。
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = orderNo(now)
    try {
      await db.collection('orders').add({ data: { ...order, _id: id, id } })
      return { ok: true, order: { ...order, _id: id, id } }
    } catch {
      /* 撞号，换号重试 */
    }
  }
  return { ok: false, error: 'ORDER_ID_BUSY' }
}
