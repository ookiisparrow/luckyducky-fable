// 目录模块级缓存（跨页共享·承接旧线「store 收口、页面从 store 取」约定的原生极简版）：
// 首页拉过的列表直接复用；冷启动直进详情（分享链）缓存未热→兜底重拉一次。不持久化（会话内即可）。
import { getProducts } from '../api/catalog'

let cache: Record<string, unknown>[] | null = null

export function primeProducts(list: Record<string, unknown>[]): void {
  cache = list
}

export async function getProductById(id: string): Promise<Record<string, unknown> | null> {
  if (!id) return null
  const hit = (l: Record<string, unknown>[]) => l.find((p) => String(p.id || p._id || '') === id) || null
  if (cache) return hit(cache)
  const r = await getProducts()
  if (!r.ok || !Array.isArray(r.list)) return null
  cache = r.list as Record<string, unknown>[]
  return hit(cache)
}
