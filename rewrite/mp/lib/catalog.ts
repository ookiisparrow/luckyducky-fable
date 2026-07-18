// 目录模块级缓存（跨页共享·承接旧线「store 收口、页面从 store 取」约定的原生极简版）：
// 首页拉过的列表直接复用；冷启动直进详情（分享链）缓存未热→兜底重拉一次。不持久化（会话内即可）。
import { getProducts, getProductDetail as apiGetProductDetail } from '../api/catalog'

let cache: Record<string, unknown>[] | null = null

// 单商品详情缓存（批1·列表瘦身后详情页专拉·镜像 lib/pageContent 缓存范式·根因#15）：列表 getProducts 不再
// 下发 images[]，详情页按 id 拉本档全字段补齐图册。命中缓存直接复用；在途去重（并发同 id 复用同一 promise）；
// 仅成功且拿到 product 才写缓存，失败/null 不缓存（下次可重试·前端保持列表项降级）。不持久化（会话内即可）。
const detailCache = new Map<string, Record<string, unknown>>()
const detailInflight = new Map<string, Promise<Record<string, unknown> | null>>()

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

// 单商品详情（含完整 images 图册）：命中缓存复用；在途去重（并发同 id 复用同一 promise）；仅成功且有档落缓存，
// 失败/无档返 null 且不缓存（下次可重试）。id 空直接 null 不发请求。镜像 lib/pageContent.getPageContent 形状。
export async function getProductDetail(id: string): Promise<Record<string, unknown> | null> {
  if (!id) return null
  if (detailCache.has(id)) return detailCache.get(id) ?? null
  const going = detailInflight.get(id)
  if (going) return going // 在途去重：并发同 id 复用同一 promise（同 lib/pageContent）
  const p = (async () => {
    try {
      const r = await apiGetProductDetail(id)
      const product = r.ok ? ((r.product as Record<string, unknown> | null) ?? null) : null
      if (r.ok && product) detailCache.set(id, product) // 仅成功且有档落缓存；失败/null 不缓存下次重试
      return product
    } finally {
      detailInflight.delete(id) // 结算即清在途键（同 lib/pageContent·此刻本 id 只此一 promise）
    }
  })()
  detailInflight.set(id, p)
  return p
}

/** 仅测试：重置内存态强制下次重新回灌。 */
export function __resetForTest(): void {
  cache = null
  detailCache.clear()
  detailInflight.clear()
}
