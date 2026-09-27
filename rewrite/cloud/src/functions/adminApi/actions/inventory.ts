import type { Ctx } from '../lib'
import { getInventory, setStock, str, err, ok } from '../../../kit'

// 管理端库存（库存管理屏）：读全量 / 设单 SKU 库存（绝对值·上新或补货）。
// 写库存收口 kit/inventory；本 action 只做入参校验 + 转调。
export async function listInventory({ data }: Ctx) {
  // productIds 入参封顶（防超长 in() 查询）；全量路径在 kit 内分页取齐 + 封顶如实报 truncated（根因#7）
  const ids = Array.isArray(data.productIds) ? data.productIds.slice(0, 200).map((x: any) => str(x, 200)) : undefined
  const { list, truncated } = await getInventory(ids)
  return ok({ list, truncated })
}

export async function saveStock({ data }: Ctx) {
  const productId = str(data.productId, 200)
  const spec = str(data.spec, 200)
  if (!productId) return err('NO_PRODUCT')
  // stock：number≥0 或 null(不限量)；负数/非整非 null 一律拒（fail-closed）
  let stock: number | null = null
  if (data.stock !== null && data.stock !== undefined) {
    const n = parseInt(data.stock, 10)
    if (!Number.isInteger(n) || n < 0) return err('BAD_STOCK')
    stock = n
  }
  const threshold = data.threshold != null ? Math.max(0, parseInt(data.threshold, 10) || 0) : undefined
  // CAS 防覆盖并发预留：前端把加载时的 updatedAt 回传（老档没有戳传 0），库存自加载已变动则冲突、
  // 提示刷新（不覆盖预留）；没传也按当前档条件写，见 kit setStock
  const expectedUpdatedAt =
    data.expectedUpdatedAt != null && Number.isFinite(Number(data.expectedUpdatedAt)) ? Number(data.expectedUpdatedAt) : undefined
  const res = await setStock(productId, spec, stock, threshold, expectedUpdatedAt)
  if (!res.ok && res.conflict) return err('STOCK_CONFLICT')
  return ok()
}
