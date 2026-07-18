import { COLLECTIONS, ERR } from '@ldrw/shared'
import { getDb, ok, err, getTempUrls, IMAGE_URL_MAX_AGE } from '../../../kit'

// 图片换址策略（批1·根因#15/#7/#12）：cover/图册等长命展示图统一带 maxAge（容器级签发缓存复用·省重签）
// + imageProc（默认关·数据万象未开通时 withImageProc 空返原址·见 kit/storage.ts）。视频/一次性址不带此策略。
const IMG_OPTS = { maxAge: IMAGE_URL_MAX_AGE, imageProc: true }

/** cloud:// 裸 fileID 判定（区分「需服务端换址」vs 已是 https / 空串——两者原样透传）。 */
const isCloudId = (v: unknown): v is string => typeof v === 'string' && v.startsWith('cloud://')

/** 换址（fail-soft）：换不到（urlMap 值为 null/缺项）回退原 fileID，不炸也不空串——前端仍可兜底。 */
const swapUrl = (v: unknown, urlMap: Record<string, string | null>): unknown =>
  isCloudId(v) ? urlMap[v] ?? v : v

/**
 * 商品列表（公开只读·黄金 admin-misc §二：按排序升序下发；只下发在售——
 * listed:false 停售不露给顾客，旧无 listed 字段的商品仍命中＝可售，向后兼容免回灌）。
 *
 * 批1·列表瘦身 + 签发缓存（根因#7 规模 + #15 加载链路冗余·守卫 rw-catalog-list-cover-only）：列表卡片只用
 * cover，图册 images[] 是详情页才需要的——列表若连图册一起签，是 N 商品 × M 图的临时址签发（规模杀手）+ 白下
 * 发一大坨列表用不到的字段。故此**列表只签 cover、不下发 images**（图册收窄进 getProductDetail 详情页专拉）。
 * cover 库内存 cloud:// 裸 fileID，客户端 <image> 每张图都要多付一次 fileID→临时址解析（~100-300ms/文件）才开始
 * 下载；服务端批量换 https 短时址后下发（同 reviews.ts 换址口径），带 maxAge（容器级签发缓存·热点封面跨会话
 * 复用不重签·约 2h 有效）+ imageProc（图像处理·默认关）。单项换不到（fail-soft）回退原 fileID，不吞整条商品。
 */
export const getProducts = async () => {
  const db = getDb()
  const res = await db
    .collection(COLLECTIONS.products)
    .where({ listed: db.command.neq(false) })
    .orderBy('sort', 'asc')
    .limit(1000) // 显式上界（病根#7·守卫 rw-app-catalog-reads-bounded）：裸 .get() 服务端默认 100 条静默截断，目录破百无声丢货
    .get()
  const products = res.data as any[]

  const ids = new Set<string>()
  for (const p of products) if (isCloudId(p.cover)) ids.add(p.cover)
  const urlMap = await getTempUrls([...ids], IMG_OPTS)

  const list = products.map((p) => {
    const out = { ...p }
    if ('cover' in out) out.cover = swapUrl(out.cover, urlMap)
    delete out.images // 列表瘦身：图册不下发（详情页 getProductDetail 专拉·守卫 rw-catalog-list-cover-only）
    return out
  })
  return ok({ list })
}

/**
 * 单商品详情（公开只读·批1 列表瘦身配套·守卫 rw-catalog-list-cover-only）：列表 getProducts 省流不下发 images[]，
 * 详情页按 id 拉本档全字段（含 images 图册）补齐画廊。id 口径＝products 文档 `_id`（admin publishProduct 以 draft
 * id set 到 products.doc(id)·mp 侧 p.id||p._id 双键读，二者对齐——已核 shared/seed/products.ts + adminApi/products.ts）。
 * id 空 → BAD_ARGS；无档/停售（listed:false）fail-soft 返回 { product: null }（同 getContent 口径·前端保持列表项降级
 * 不裂）。cover + images[] 同 getProducts 换址口径（IMG_OPTS·maxAge 缓存 + imageProc）。公开只读无闸（同 getProducts
 * 先例·products 无 _openid/隐私字段·下单价仍以 createOrder 云端现算为准，不信此下发价）。
 */
export const getProductDetail = async (data: any) => {
  const id = String((data && data.id) || '')
  if (!id) return err(ERR.BAD_ARGS, { id })
  const db = getDb()
  try {
    const got = await db.collection(COLLECTIONS.products).doc(id).get()
    const p: any = got.data || null
    if (!p || p.listed === false) return ok({ product: null }) // 无档/停售 fail-soft（同 getProducts listed 口径）
    const ids = new Set<string>()
    if (isCloudId(p.cover)) ids.add(p.cover)
    if (Array.isArray(p.images)) for (const im of p.images) if (isCloudId(im)) ids.add(im)
    const urlMap = await getTempUrls([...ids], IMG_OPTS)
    const out = { ...p }
    if ('cover' in out) out.cover = swapUrl(out.cover, urlMap)
    if (Array.isArray(out.images)) out.images = out.images.map((im: unknown) => swapUrl(im, urlMap))
    return ok({ product: out })
  } catch {
    return ok({ product: null }) // 无档（doc 不存在抛错）/瞬时抖动 fail-soft（前端保持列表项降级·不裂不崩）
  }
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
  const urlMap = await getTempUrls(ids, IMG_OPTS)
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
      const urlMap = await getTempUrls([content.catalog.heroImage], IMG_OPTS)
      content.catalog.heroImage = swapUrl(content.catalog.heroImage, urlMap)
    }
    return ok({ page, content })
  } catch {
    return ok({ page, content: null })
  }
}
