// 目录模块级缓存（跨页共享·页面从这里取，不各自拉）：
// 首页拉过的列表直接复用；冷启动直进详情（分享链）缓存未热→兜底重拉一次。不持久化（会话内即可）。
import { getProducts, getProductDetail as apiGetProductDetail } from '../api/catalog'
import { createInflight } from './inflight'

let cache: Record<string, unknown>[] | null = null
// 全量列表在途去重：cache 未命中时的并发调用（如首页 reload 与详情页撞车）共享一次云调用。force 在途时
// 后到调用同样复用在途结果、不重复拉——与非 force 共用同一个键，无需区分。
const listFlight = createInflight<Record<string, unknown>[] | null>()

// 单商品详情缓存（根因#15）：列表 getProducts 不下发 images[]，详情页按 id 拉本档全字段补齐图册。
// 仅成功且拿到 product 才写缓存，失败/null 不缓存（下次可重试·前端保持列表项降级）。不持久化（会话内即可）。
const detailCache = new Map<string, Record<string, unknown>>()
const detailFlight = createInflight<Record<string, unknown> | null>()

// 全量商品列表：命中（有缓存且非强刷）直接返回；force 或缓存空则经 api 拉取并回填。
// 失败返回 null 且不覆盖已有缓存——保留旧数据，只是这次调用方拿不到新的（下次仍可命中旧缓存或重试）。
export async function getAllProducts(opts?: { force?: boolean }): Promise<Record<string, unknown>[] | null> {
  if (!opts?.force && cache) return cache
  return listFlight.run('all', async () => {
    const r = await getProducts()
    if (!r.ok || !Array.isArray(r.list)) return null
    return (cache = r.list as Record<string, unknown>[])
  })
}

export async function getProductById(id: string): Promise<Record<string, unknown> | null> {
  if (!id) return null
  const list = await getAllProducts()
  if (!list) return null
  return list.find((p) => String(p.id || p._id || '') === id) || null
}

// 单商品详情（含完整 images 图册）：命中缓存复用；并发同 id 只真取一次；id 空直接 null 不发请求。
export async function getProductDetail(id: string): Promise<Record<string, unknown> | null> {
  if (!id) return null
  if (detailCache.has(id)) return detailCache.get(id) ?? null
  return detailFlight.run(id, async () => {
    const r = await apiGetProductDetail(id)
    const product = r.ok ? ((r.product as Record<string, unknown> | null) ?? null) : null
    if (r.ok && product) detailCache.set(id, product) // 仅成功且有档落缓存；失败/null 不缓存下次重试
    return product
  })
}

/** 仅测试：重置内存态强制下次重新回灌。 */
export function __resetForTest(): void {
  cache = null
  listFlight.clear()
  detailCache.clear()
  detailFlight.clear()
}
