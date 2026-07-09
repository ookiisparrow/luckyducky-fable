// 目录模块级缓存（跨页共享·承接旧线「store 收口、页面从 store 取」约定的原生极简版）：
// 首页拉过的列表直接复用；冷启动直进详情（分享链）缓存未热→兜底重拉一次。不持久化（会话内即可）。
import { getProducts } from '../api/catalog'

let cache: Record<string, unknown>[] | null = null

// 全量商品列表：命中（有缓存且非强刷）直接返回；force 或缓存空则经 api 拉取并回填。
// 失败返回 null 且不覆盖已有缓存——保留旧数据，只是这次调用方拿不到新的（下次仍可命中旧缓存或重试）。
export async function getAllProducts(opts?: { force?: boolean }): Promise<Record<string, unknown>[] | null> {
  if (!opts?.force && cache) return cache
  const r = await getProducts()
  if (!r.ok || !Array.isArray(r.list)) return null
  cache = r.list as Record<string, unknown>[]
  return cache
}

export async function getProductById(id: string): Promise<Record<string, unknown> | null> {
  if (!id) return null
  const list = await getAllProducts()
  if (!list) return null
  return list.find((p) => String(p.id || p._id || '') === id) || null
}

/** 仅测试：重置内存态强制下次重新回灌。 */
export function __resetForTest(): void {
  cache = null
}
