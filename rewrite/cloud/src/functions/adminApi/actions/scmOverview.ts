import { reply, type Ctx } from '../lib'
import { listMaterialDocs } from '../../../kit'
import { COLLECTIONS } from '@ldrw/shared'
import { OUTWORK_ORDER_STATUS, PURCHASE_ORDER_STATUS } from '@ldrw/shared'

// 进销存总览（蓝图 docs/进销存ERP/ §4·B2·门5 文件级隔离：本文件=总览车道，与 scmPlanner 同级只读聚合）。
// 批 B2：无聚合看板，低库存/应付/在途要跑 5 页各看各的——本 action 把「今天该干啥」一屏拼出来，
// 卡片直达对应页（跳转在前端）。**只读**，写路径零新增。RBAC：不登记 ACTION_CAPS → 默认拒
// admin:write＝仅超管（照抄 scmPlanner 同级鉴权）。
//
// 有界纪律（根因#7）：materials 经 listMaterialDocs()（门1 kit·内部已 .limit(500)）；本文件内直接发起
// 的每条查询链都显式 .limit()；计数一律走 db .count()（精确·不封顶·不受 limit 影响）——不编数（根因#8）。
// 守卫 rw-scm-overview-bounded-queries（本批新立·rewrite/cloud/tests/scm-overview-bounded.test.ts）
// 源码扫描本文件 getScmOverview 函数体：每条含 `.get()` 的查询链必须同链带 `.limit(`。

const KNOTTED_RE = /^yarn:([a-z][a-z0-9-]*):L:knotted$/ // 与 scmPlanner.ts 同契约：带结＝外协产物，不外购
const PAYABLE_SCAN_CAP = 200 // 未结外协单内存分组上限（超界不误报精确总额，改标 truncated）
const RECENT_LEDGER_N = 8

export async function getScmOverview({ db }: Ctx) {
  const [materials, payRes, payCountRes, orderedCountRes, issuedCountRes, ledgerRes, supRes] = await Promise.all([
    listMaterialDocs(), // 门1 只读出口·主档量小·内部已 bounded 500
    db.collection('outworkOrders').where({ status: OUTWORK_ORDER_STATUS.DELIVERED }).limit(PAYABLE_SCAN_CAP).get(),
    db.collection('outworkOrders').where({ status: OUTWORK_ORDER_STATUS.DELIVERED }).count(),
    db.collection('purchaseOrders').where({ status: PURCHASE_ORDER_STATUS.ORDERED }).count(),
    db.collection('outworkOrders').where({ status: OUTWORK_ORDER_STATUS.ISSUED }).count(),
    db.collection(COLLECTIONS.stockLedger).orderBy('at', 'desc').limit(RECENT_LEDGER_N).get(),
    db.collection(COLLECTIONS.suppliers).limit(PAYABLE_SCAN_CAP).get(),
  ])

  // ── 缺料预警：qty(stock) < threshold，gap 降序，limit 50 有界 ──
  const lowStock = (materials as any[])
    .filter((m) => Number.isInteger(m.stock) && Number.isInteger(m.threshold) && m.stock < m.threshold)
    .map((m) => ({
      materialId: String(m._id),
      name: String(m.name || m._id),
      uomLabel: m.uom === 'gram' ? '克' : '件',
      qty: m.stock as number,
      threshold: m.threshold as number,
      gap: (m.threshold as number) - (m.stock as number),
      suggest: (KNOTTED_RE.test(String(m._id)) ? 'outwork' : 'purchase') as 'outwork' | 'purchase',
    }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 50)

  // ── 应付未结：delivered 未 settled 外协单按织女（供应商）分组求和（分整数·有界扫描·超界标 truncated）──
  const supName = new Map(((supRes.data || []) as any[]).map((s) => [String(s._id), String(s.name || '')]))
  const payMap = new Map<string, { supplierId: string; name: string; payableFen: number; orderCount: number }>()
  for (const o of (payRes.data || []) as any[]) {
    const supplierId = String(o.workerId || '')
    const fen = Number.isInteger(o.payableFen) ? (o.payableFen as number) : 0
    const g = payMap.get(supplierId) || { supplierId, name: supName.get(supplierId) || supplierId, payableFen: 0, orderCount: 0 }
    g.payableFen += fen
    g.orderCount += 1
    payMap.set(supplierId, g)
  }
  const payables = [...payMap.values()].sort((a, b) => b.payableFen - a.payableFen)
  const payableTotalFen = payables.reduce((s, g) => s + g.payableFen, 0)
  const truncated = (payCountRes.total || 0) > PAYABLE_SCAN_CAP

  const recentLedger = ((ledgerRes.data || []) as any[]).map((l) => ({
    _id: String(l._id || ''),
    itemKey: String(l.itemKey || ''),
    delta: Number(l.delta) || 0,
    docType: String(l.docType || ''),
    operator: String(l.operator || ''),
    reason: String(l.reason || ''),
    at: Number(l.at) || 0,
  }))

  return reply(200, {
    ok: true,
    lowStock,
    payables,
    payableTotalFen,
    ...(truncated ? { truncated: true } : {}),
    inTransit: { purchaseCount: orderedCountRes.total || 0, outworkCount: issuedCountRes.total || 0 },
    recentLedger,
  })
}
