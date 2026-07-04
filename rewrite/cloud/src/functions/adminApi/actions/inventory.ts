import { reply, type Ctx } from '../lib'
import { getInventory, setStock } from '../../../kit'

// 管理端库存（库存#1·S14 库存管理屏）：读全量 / 设单 SKU 库存（绝对值·上新或补货）。
// 写库存收口 kit/inventory（守卫 stock-atomic-conditional）；本 action 只做入参校验 + 转调。
export async function listInventory({ data }: Ctx) {
  // productIds 入参封顶（防超长 in() 查询）；全量路径在 kit 内分页取齐 + 封顶如实报 truncated（深审 P2·根因#7）
  const ids = Array.isArray(data.productIds) ? data.productIds.slice(0, 200).map((x: any) => String(x)) : undefined
  const { list, truncated } = await getInventory(ids)
  return reply(200, { ok: true, list, truncated })
}

export async function saveStock({ data }: Ctx) {
  const productId = String(data.productId || '')
  const spec = String(data.spec || '')
  if (!productId) return reply(400, { ok: false, error: 'NO_PRODUCT' })
  // stock：number≥0 或 null(不限量)；负数/非整非 null 一律拒（fail-closed）
  let stock: number | null = null
  if (data.stock !== null && data.stock !== undefined) {
    const n = parseInt(data.stock, 10)
    if (!Number.isInteger(n) || n < 0) return reply(400, { ok: false, error: 'BAD_STOCK' })
    stock = n
  }
  const threshold = data.threshold != null ? Math.max(0, parseInt(data.threshold, 10) || 0) : undefined
  // CAS 防覆盖并发预留（外审 P1.8）：前端把加载时的 updatedAt 回传，库存自加载已变动则冲突、提示刷新（不覆盖预留）
  const expectedUpdatedAt =
    data.expectedUpdatedAt != null && Number.isFinite(Number(data.expectedUpdatedAt)) ? Number(data.expectedUpdatedAt) : undefined
  const res = await setStock(productId, spec, stock, threshold, expectedUpdatedAt)
  if (!res.ok && res.conflict) return reply(409, { ok: false, error: 'STOCK_CONFLICT' })
  return reply(200, { ok: true })
}
