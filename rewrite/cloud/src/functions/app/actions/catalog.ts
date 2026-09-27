import { COLLECTIONS, ERR } from '@ldrw/shared'
import { getDb, ok, err, getTempUrls, IMAGE_URL_MAX_AGE, isDocMissing, str, withOpenId, withRateLimit } from '../../../kit'

// 图片换址策略（根因#15/#7/#12）：cover/图册等长命展示图统一带 maxAge（容器级签发缓存复用·省重签）
// + imageProc（默认关·数据万象未开通时 withImageProc 空返原址·见 kit/storage.ts）。视频/一次性址不带此策略。
const IMG_OPTS = { maxAge: IMAGE_URL_MAX_AGE, imageProc: true }

/** cloud:// 裸 fileID 判定（区分「需服务端换址」vs 已是 https / 空串——两者原样透传）。 */
const isCloudId = (v: unknown): v is string => typeof v === 'string' && v.startsWith('cloud://')

/**
 * 原地换址：obj[key] 为 cloud:// 的批量换 https 短时址（IMG_OPTS）。fail-soft：换不到（urlMap 值为 null/缺项）
 * 回退原 fileID，不炸也不空串——前端仍可兜底。只写回 cloud:// 项，缺字段不会多出键。
 */
async function swapImgs(targets: [any, string | number][]): Promise<void> {
  const hits = targets.filter(([o, k]) => isCloudId(o[k]))
  if (!hits.length) return
  const urlMap = await getTempUrls(hits.map(([o, k]) => o[k]), IMG_OPTS) // getTempUrls 内部去重
  for (const [o, k] of hits) o[k] = urlMap[o[k]] ?? o[k]
}

/**
 * 商品列表（公开只读：按排序升序下发；只下发在售——
 * listed:false 停售不露给顾客，旧无 listed 字段的商品仍命中＝可售，向后兼容免回灌）。
 *
 * 列表瘦身 + 签发缓存（根因#7 规模 + #15 加载链路冗余）：列表卡片只用
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
  const list = res.data as any[]
  for (const p of list) delete p.images // 列表瘦身：图册不下发（详情页 getProductDetail 专拉）
  await swapImgs(list.map((p): [any, string] => [p, 'cover']))
  return ok({ list })
}

/**
 * 单商品详情（公开只读·配合列表瘦身）：列表 getProducts 省流不下发 images[]，
 * 详情页按 id 拉本档全字段（含 images 图册）补齐画廊。id 口径＝products 文档 `_id`（admin publishProduct 以 draft
 * id set 到 products.doc(id)·mp 侧 p.id||p._id 双键读，二者对齐——已核 shared/seed/products.ts + adminApi/products.ts）。
 * id 空 → BAD_ARGS；无档/停售（listed:false）fail-soft 返回 { product: null }（同 getContent 口径·前端保持列表项降级
 * 不裂）。cover + images[] 同 getProducts 换址口径（IMG_OPTS·maxAge 缓存 + imageProc）。公开只读无闸（同 getProducts
 * 先例·products 无 _openid/隐私字段·下单价仍以 createOrder 云端现算为准，不信此下发价）。
 */
export const getProductDetail = async (data: any) => {
  const id = str(data && data.id, 200)
  if (!id) return err(ERR.BAD_ARGS, { id })
  const db = getDb()
  try {
    const got = await db.collection(COLLECTIONS.products).doc(id).get()
    const p: any = got.data || null
    if (!p || p.listed === false) return ok({ product: null }) // 无档/停售 fail-soft（同 getProducts listed 口径）
    const imgs: unknown[] = Array.isArray(p.images) ? p.images : []
    await swapImgs([[p, 'cover'], ...imgs.map((_, i): [any, number] => [imgs, i])])
    return ok({ product: p })
  } catch (e) {
    // 真无档才 null；库挂/权限/集合不在走 INTERNAL，不装成「商品不存在」（根因#14）
    if (isDocMissing(e)) return ok({ product: null })
    return err(ERR.INTERNAL)
  }
}

/**
 * 首页内容图字段收口（消费面见 rewrite/mp/lib/mapHome.ts）：hero.img / feature.img /
 * reassure.items[].img / reviews.items[].img / closing.img——同 getProducts 换址口径与权衡
 * （trust/brand/faq/footer 无图字段，不在此列）。原地改写 home（get() 每次新取，不共享缓存引用）。
 */
async function swapHomeImages(home: any): Promise<void> {
  const targets: [any, string][] = []
  const addTarget = (obj: unknown, key: string) => {
    if (obj && typeof obj === 'object') targets.push([obj, key])
  }
  addTarget(home.hero, 'img')
  addTarget(home.feature, 'img')
  for (const it of Array.isArray(home.reassure?.items) ? home.reassure.items : []) addTarget(it, 'img')
  for (const it of Array.isArray(home.reviews?.items) ? home.reviews.items : []) addTarget(it, 'img')
  addTarget(home.closing, 'img')
  await swapImgs(targets)
}

/**
 * 首页内容（公开只读：无记录返回空，前端回退默认文案）。
 * 图片换址提速（根因#15）：见 getProducts 头注释（同权衡/同 fail-soft 口径）。
 */
export const getContent = async () => {
  const db = getDb()
  try {
    const got = await db.collection(COLLECTIONS.content).doc('home').get()
    const home = got.data || null
    if (home) await swapHomeImages(home)
    return ok({ home })
  } catch (e) {
    if (isDocMissing(e)) return ok({ home: null }) // 真无档：前端回退默认文案
    return err(ERR.INTERNAL) // 库挂 ≠ 没有首页
  }
}

/**
 * 页面内容 CMS 公开只读（5 页可编辑内容·写侧样板 adminApi/content.savePageContent）：
 * content 集合每页一 doc（_id=page 键名），未知 page fail-closed 拒（同白名单·根因#3 不信前端）。catalogPlayer.catalog.heroImage 若为 cloud:// fileID，服务端换临时
 * URL 再下发（fileID 不出口·同 swapHomeImages/getProducts 换址口径与 fail-soft 权衡）；无文档返回 null。
 */
const PAGE_KEYS = ['welcome', 'catalogPlayer', 'mePage', 'about', 'agreement']
export const getPageContent = async (data: any) => {
  const page = str(data && data.page, 200)
  if (!PAGE_KEYS.includes(page)) return err(ERR.BAD_ARGS, { page }) // 未知 page fail-closed（同 adminApi 白名单·根因#3）
  const db = getDb()
  try {
    const got = await db.collection(COLLECTIONS.content).doc(page).get()
    const content: any = got.data || null
    // catalogPlayer.catalog.heroImage：cloud:// 换临时 URL（fileID 不出口·fail-soft 换不到回退原 fileID）
    if (page === 'catalogPlayer' && content?.catalog) await swapImgs([[content.catalog, 'heroImage']])
    return ok({ page, content })
  } catch (e) {
    if (isDocMissing(e)) return ok({ page, content: null }) // 真无档
    return err(ERR.INTERNAL, { page }) // 库挂 ≠ 该页没内容
  }
}

/**
 * 求助面板辅助视频：两级（主题→小段）白名单下发；fileID 留服务端，
 * 批量换短时 URL（≤50/批·映射不串位）；无视频/换不到 → null（前端占位）。
 */
// 频控（病根#13）：批量签发视频临时地址的读端点，按 openid 限速防无节流刷签名地址。
export const getHelpVideos = withOpenId(
  withRateLimit('getHelpVideos', { max: 30, windowMs: 60_000 }, async ({ db }) => {
    let got: any
    try {
      got = await db.collection(COLLECTIONS.content).doc('helpVideos').get()
    } catch (e) {
      if (isDocMissing(e)) got = null // 真无档：求助面板空列表
      else return err(ERR.INTERNAL) // 库挂 ≠ 没有求助视频（根因#14）
    }
    const items = (got?.data?.items || []) as any[]
    const allIds = items.flatMap((it) =>
      ((it.segments || []) as any[]).map((sg) => String(sg.videoFileId || '')).filter(Boolean)
    )
    const urlMap = await getTempUrls(allIds)
    const out = items.map((it) => ({
      id: String(it.id || ''),
      title: String(it.title || ''),
      sub: String(it.sub || ''),
      desc: String(it.desc || ''),
      segments: ((it.segments || []) as any[]).map((sg) => ({
        id: String(sg.id || ''),
        name: String(sg.name || ''),
        dur: String(sg.dur || ''),
        url: sg.videoFileId ? (urlMap[String(sg.videoFileId)] ?? null) : null,
      })),
    }))
    return ok({ items: out })
  })
)
