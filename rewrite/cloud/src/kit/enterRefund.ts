/**
 * Issue #114 Option A：退款侧联查 activations.enteredAt。
 * 已 confirmEnter 但没有任何订单行记下 enteredQty（撤权 CAS 裂口 / 回滚失败）→ 兜底拒退。
 * 写路径已对齐时（进课次数 ≤ 已记账件数）不改既有按件 / 按单规则。
 */

async function courseIdOf(db: any, productId: string): Promise<string> {
  const prod = await db.collection('products').doc(productId).get().catch(() => null)
  return (prod && prod.data && prod.data.courseId) || 'course-' + productId
}

/** 买家此课已进课次数是否多于订单行已记账件数。查失败 fail-closed 当「该拒」。 */
export async function enteredAtBlocksRefund(
  db: any,
  openid: string,
  productId: string
): Promise<boolean> {
  const pid = String(productId || '')
  const oid = String(openid || '')
  if (!pid || !oid) return false

  const courseId = await courseIdOf(db, pid)

  let acts: any[]
  try {
    const r = await db.collection('activations').where({ _openid: oid, courseId }).limit(100).get()
    acts = (r && r.data) || []
  } catch {
    return true
  }
  const enteredN = acts.filter((a) => a && a.enteredAt).length
  if (enteredN === 0) return false

  const prodIds = new Set<string>([pid])
  const prods = await db.collection('products').where({ courseId }).limit(500).get().catch(() => ({ data: [] }))
  for (const p of prods.data || []) {
    if (p.id) prodIds.add(String(p.id))
    if (p._id) prodIds.add(String(p._id))
  }

  const _ = db.command
  let orders: any[]
  try {
    const r = await db
      .collection('orders')
      .where({ _openid: oid, status: _.in(['paid', 'shipped', 'done']) })
      .limit(200)
      .get()
    orders = (r && r.data) || []
  } catch {
    return true
  }

  let recorded = 0
  for (const o of orders) {
    for (const it of o.items || []) {
      if (prodIds.has(String(it.productId || ''))) recorded += Number(it.enteredQty) || 0
    }
  }
  return enteredN > recorded
}
