import { COLLECTIONS, ERR } from '@ldrw/shared'
import { getDb, ok, err, getTempUrls } from '../../../kit'

/** cloud:// 裸 fileID 判定（区分「需服务端换址」vs 已是 https / 空串——两者原样透传）。 */
const isCloudId = (v: unknown): v is string => typeof v === 'string' && v.startsWith('cloud://')

/** 换址（fail-soft）：换不到（urlMap 值为 null/缺项）回退原 fileID，不炸也不空串——前端仍可兜底。 */
const swapUrl = (v: unknown, urlMap: Record<string, string | null>): unknown =>
  isCloudId(v) ? urlMap[v] ?? v : v

/**
 * 商品列表（公开只读·黄金 admin-misc §二：按排序升序下发；只下发在售——
 * listed:false 停售不露给顾客，旧无 listed 字段的商品仍命中＝可售，向后兼容免回灌）。
 *
 * 批B·图片链加载提速（根因#15）：cover/images[] 库内存 cloud:// 裸 fileID，客户端 <image> 每张图都要
 * 多付一次 fileID→临时址解析（~100-300ms/文件）才开始下载；这里服务端一次批量换 https 短时址后下发
 * （同 reviews.ts:122 换址口径），把该成本从「每端每图各付一次」收敛到「服务端一批几十 ms」。换到的
 * 临时地址约 2h 有效——mp 端会话缓存住的旧址若超时会失效，下拉强刷即回填新址（会话极少超 2h，权衡
 * 已接受）。单项换不到（fail-soft）回退原 fileID，不吞整条商品/整个响应。
 */
export const getProducts = async () => {
  const db = getDb()
  const res = await db
    .collection(COLLECTIONS.products)
    .where({ listed: db.command.neq(false) })
    .orderBy('sort', 'asc')
    .get()
  const products = res.data as any[]

  const ids = new Set<string>()
  for (const p of products) {
    if (isCloudId(p.cover)) ids.add(p.cover)
    if (Array.isArray(p.images)) for (const im of p.images) if (isCloudId(im)) ids.add(im)
  }
  const urlMap = await getTempUrls([...ids])

  const list = products.map((p) => {
    const out = { ...p }
    if ('cover' in out) out.cover = swapUrl(out.cover, urlMap)
    if (Array.isArray(out.images)) out.images = out.images.map((im: unknown) => swapUrl(im, urlMap))
    return out
  })
  return ok({ list })
}

/**
 * 首页内容图字段收口（消费面见 rewrite/mp/lib/mapHome.ts）：hero.img / feature.img /
 * reassure.items[].img / reviews.items[].img / closing.img——同 getProducts 换址口径与权衡
 * （trust/brand/faq/footer 无图字段，不在此列）。原地改写 home（get() 每次新取，不共享缓存引用）。
 */
async function swapHomeImages(home: any): Promise<void> {
  const targets: { obj: any; key: string }[] = []
  const addTarget = (obj: unknown, key: string) => {
    if (obj && typeof obj === 'object') targets.push({ obj, key })
  }
  addTarget(home.hero, 'img')
  addTarget(home.feature, 'img')
  for (const it of Array.isArray(home.reassure?.items) ? home.reassure.items : []) addTarget(it, 'img')
  for (const it of Array.isArray(home.reviews?.items) ? home.reviews.items : []) addTarget(it, 'img')
  addTarget(home.closing, 'img')

  const ids = [...new Set(targets.map((t) => t.obj[t.key]).filter(isCloudId))]
  if (!ids.length) return
  const urlMap = await getTempUrls(ids)
  for (const t of targets) t.obj[t.key] = swapUrl(t.obj[t.key], urlMap)
}

/**
 * 首页内容（公开只读·黄金 learning-content §九：无记录返回空，前端回退默认文案）。
 * 批B·图片链加载提速（根因#15）：见 getProducts 头注释（同权衡/同 fail-soft 口径）。
 */
export const getContent = async () => {
  const db = getDb()
  try {
    const got = await db.collection(COLLECTIONS.content).doc('home').get()
    const home = got.data || null
    if (home) await swapHomeImages(home)
    return ok({ home })
  } catch {
    return ok({ home: null })
  }
}

/**
 * 页面内容 CMS 公开只读（批A·5 页可编辑内容·写侧样板 adminApi/content.savePageContent）：
 * content 集合每页一 doc（_id=page 键名），未知 page fail-closed 拒（同白名单·根因#3 不信前端·守卫
 * rw-cloud-page-content-sanitized）。catalogPlayer.catalog.heroImage 若为 cloud:// fileID，服务端换临时
 * URL 再下发（fileID 不出口·同 swapHomeImages/getProducts 换址口径与 fail-soft 权衡）；无文档返回 null。
 */
const PAGE_KEYS = ['welcome', 'catalogPlayer', 'mePage', 'about', 'agreement']
export const getPageContent = async (data: any) => {
  const page = String((data && data.page) || '')
  if (!PAGE_KEYS.includes(page)) return err(ERR.BAD_ARGS, { page }) // 未知 page fail-closed（同 adminApi 白名单·根因#3）
  const db = getDb()
  try {
    const got = await db.collection(COLLECTIONS.content).doc(page).get()
    const content: any = got.data || null
    // catalogPlayer.catalog.heroImage：cloud:// 换临时 URL（fileID 不出口·fail-soft 换不到回退原 fileID）
    if (content && page === 'catalogPlayer' && content.catalog && isCloudId(content.catalog.heroImage)) {
      const urlMap = await getTempUrls([content.catalog.heroImage])
      content.catalog.heroImage = swapUrl(content.catalog.heroImage, urlMap)
    }
    return ok({ page, content })
  } catch {
    return ok({ page, content: null })
  }
}
