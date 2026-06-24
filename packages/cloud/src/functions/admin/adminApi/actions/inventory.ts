import { reply, type Ctx } from '../lib'
import { getInventory, setStock } from '../../../../kit'

// 管理端库存（库存#1·S14 库存管理屏）：读全量 / 设单 SKU 库存（绝对值·上新或补货）。
// 写库存收口 kit/inventory（守卫 stock-atomic-conditional）；本 action 只做入参校验 + 转调。
export async function listInventory({ data }: Ctx) {
  const ids = Array.isArray(data.productIds) ? data.productIds.map((x: any) => String(x)) : undefined
  return reply(200, { ok: true, list: await getInventory(ids) })
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
  await setStock(productId, spec, stock, threshold)
  return reply(200, { ok: true })
}
