// 首页冷启动首屏快照（SWR·丝滑战役批2·根因#15 冷启动首屏必等一次云往返 + #8 弱网只见兜底文案）：
// 上次冷启动成功渲染的首页数据裁白名单存 storage，下次冷启动 onLoad 先读它即刻渲染真实内容（stale），
// 随后 reload 拉最新覆盖（revalidate）——二次冷启动首帧不再空等云回包。
//
// 纪律（铁律·勿破）：
//  ① 快照**只喂 home 渲染层**（home.ts onLoad 读、reload 回写），**禁回填 lib/catalog 会话缓存**——
//     隔夜价若进了 catalog 缓存会流到 quickAdd/cart 的展示价（价格最终由云端 createOrder 现算校验兜底，
//     但用户会先看见错价·体验事故）。快照里的 price 只用于首页卡片标价展示，不作任何交易依据。
//  ② 本文件**不 import api/***、**不出现 callApp 字面量**——目录数据的云调用单源仍在 lib/catalog.ts /
//     lib/courses.ts（守卫 rw-mp-catalog-cache-single-source 扫本文件·别在这儿绕过缓存直取）。
//  ③ 快照是**加分项**：任何一步失败（storage 超限/脏档/序列化炸）一律静默回退到「无快照」路径，
//     绝不影响主渲染（reload 照常拉云端）。

const KEY = 'ld:home-snap'
const SNAP_VERSION = 1
// 超龄阈值 90min（< 批1 服务端 IMAGE_URL_MAX_AGE=7200s=2h·联动：临时址签发有效期 2h，快照存的是当时换好的
// https 临时址，超 90min 即离过期只剩 30min 余量、判定超龄剥掉临时址回退兜底——防隔夜冷启动首帧一堆裂图）。
const IMG_TTL_MS = 90 * 60 * 1000

// 商品白名单字段（只落首页卡片渲染要的·不落 images 等长字段·省 storage 且不把详情图册塞进首屏快照）
export interface SnapProduct {
  id: string
  name: string
  tag: string
  price: unknown // 展示标价用（mapProducts 内 Number 化）·非交易依据（纪律①）
  was: unknown
  cover: string
}
export interface HomeSnapshot {
  v: number
  savedAt: number
  products: SnapProduct[]
  home: unknown // 首页 CMS 原始返回（喂 mapHomeContent 逐块回退·超龄时其内 http 临时址已被剥空）
}

/** 取纯对象（数组/原始值/空 → null）——脏档地基。 */
const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/** 单商品裁白名单（id 走 p.id||p._id 双键·对齐 mapProducts 口径）；脏元素落空档、由 readSnapshot/mapProducts 再净化。 */
function pickProduct(raw: unknown): SnapProduct {
  const p = asObj(raw) ?? {}
  return {
    id: String(p.id ?? p._id ?? ''),
    name: String(p.name ?? ''),
    tag: String(p.tag ?? ''),
    price: p.price,
    was: p.was,
    cover: String(p.cover ?? ''),
  }
}

/** 深剥临时址：任何以 http 开头的字符串（图片临时址）置 ''；本地 /static 路径与其余文本原样保留。
 *  超龄快照走此清洗——mapHero 见空 img 自动落包内兜底鸭图、商品 cover 空由模板落灰底（既有兜底链）。 */
function stripHttp(v: unknown): unknown {
  if (typeof v === 'string') return v.startsWith('http') ? '' : v
  if (Array.isArray(v)) return v.map(stripHttp)
  const o = asObj(v)
  if (o) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(o)) out[k] = stripHttp(o[k])
    return out
  }
  return v
}

/** 内部裸读（不做 TTL 剥址·供 writeSnapshot 合并保留另半边用）。 */
function readRaw(): Record<string, unknown> | null {
  try {
    return asObj(wx.getStorageSync(KEY))
  } catch {
    return null
  }
}

/** 回写快照：products 逐条裁白名单；products 为 null（本趟只拿到 home）则保留上次的 products 半边，反之亦然。
 *  静默 fail-soft（storage 超限/序列化失败等一律吞·纪律③）。 */
export function writeSnapshot(products: unknown, home: unknown): void {
  try {
    const prev = readRaw()
    const snap: HomeSnapshot = {
      v: SNAP_VERSION,
      savedAt: Date.now(),
      products: Array.isArray(products) ? products.map(pickProduct) : ((prev?.products as SnapProduct[] | undefined) ?? []),
      home: home != null ? home : (prev?.home ?? null),
    }
    wx.setStorageSync(KEY, snap)
  } catch {
    /* 快照写失败静默（纪律③·首屏快照是加分项·不影响 reload 主渲染） */
  }
}

/** 读快照：版本不符/products 非数组/savedAt 非有限数 → 弃（返 null 走无快照路径）；
 *  超龄（now-savedAt > IMG_TTL_MS）则剥掉 products[].cover 与 home 内所有 http 临时址（回退兜底·防裂图）。 */
export function readSnapshot(): HomeSnapshot | null {
  const r = readRaw()
  if (!r) return null
  if (r.v !== SNAP_VERSION) return null // 版本不符弃（结构升级后旧档不复用）
  if (!Array.isArray(r.products)) return null // products 非数组弃（脏形状）
  const savedAt = r.savedAt
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null // savedAt 非有限数弃
  const stale = Date.now() - savedAt > IMG_TTL_MS
  const products = (r.products as unknown[]).map((p) => {
    const sp = pickProduct(p)
    if (stale && sp.cover.startsWith('http')) sp.cover = '' // 超龄剥临时址（本地 /static 保留）
    return sp
  })
  return { v: SNAP_VERSION, savedAt, products, home: stale ? stripHttp(r.home) : r.home }
}

/** 仅测试：抹掉持久化的快照档（本模块无内存态·纯清 storage 键）。 */
export function __resetForTest(): void {
  try {
    wx.removeStorageSync(KEY)
  } catch {
    /* 无痕清理·失败无妨 */
  }
}
