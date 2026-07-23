// 首页数据映射（纯函数·vitest 钉行为·守卫 rw-mp-home-golden）：云端契约 → 视图模型。
// 钱链纪律：price 云端存「元」（订单链的分整数在云函数内·展示层不做算术、原样标价）。
// 内容纪律（黄金 learning-content §九）：整档/逐字段/逐块缺失都回退「设计默认文案」，
//   空块（空字段/空数组/整组脏行）仍用默认——防线上误清空、防半空板块。默认文案 = 重设计首页原稿。

export interface ProductVM {
  id: string
  name: string
  tag: string
  priceLabel: string
  wasLabel: string
  cover: string
}

export interface HeroVM {
  title: string
  tagline: string
  search: string
  img: string
}
export interface BrandVM {
  name: string
  lead: string
}
export interface FeatureVM {
  title: string
  body: string
  img: string
}
export interface TrustVM {
  icon: string
  label: string
}
export interface ReassureItemVM {
  icon: string
  title: string
  body: string
  img: string
}
export interface ReassureVM {
  heading: string
  lead: string
  items: ReassureItemVM[]
}
export interface ReviewVM {
  quote: string
  user: string
  img: string
}
export interface ReviewsVM {
  heading: string
  items: ReviewVM[]
}
export interface FaqVM {
  title: string
  body: string
}
export interface ClosingVM {
  title: string
  cta: string
  img: string
}
export interface FooterVM {
  links: string[]
  copy: string
}
export interface HomeContentVM {
  hero: HeroVM
  brand: BrandVM
  feature: FeatureVM
  trust: TrustVM[]
  reassure: ReassureVM
  reviews: ReviewsVM
  faq: FaqVM[]
  closing: ClosingVM
  footer: FooterVM
}

// ── 设计默认文案（重设计首页原稿·Sections.jsx 逐字抄录）──
// hero 品牌门面缺→包内兜底鸭图（不留灰·README 图片矩阵）：区别商品 cover（缺→CSS 灰占位）——首屏门面不该露灰底。
const HERO_DEFAULT: HeroVM = { title: '创造幸运', tagline: 'Get ducky get lucky', search: '入门钩织的妙趣方式', img: '/static/hero-full.jpg' }
const BRAND_DEFAULT: BrandVM = { name: '小棉鸭', lead: '我们希望每个人都能亲手创造自己的随身幸运物。' }
const FEATURE_DEFAULT: FeatureVM = { title: '入门钩织的妙趣方案', body: '为了让钩织入门更轻松、更有趣，我们精心设计了这些小家伙。', img: '' }
const TRUST_DEFAULT: TrustVM[] = [
  { icon: 'truck', label: '包邮到家' },
  { icon: 'rotate-ccw', label: '七天无理由退货' },
  { icon: 'thumbs-up', label: '多数买家推荐' },
]
const REASSURE_DEFAULT: ReassureVM = {
  heading: '把门槛一一拆掉',
  lead: '新手学习钩织存在很多门槛，我们把这些门槛一一拆掉了。',
  items: [
    { icon: 'heart-handshake', title: '放心开始', body: '全材料包含初次尝试所需的一切，另含「开始练习」以及「分步交互」视频教程，助你轻松无忧创作。', img: '' },
    { icon: 'shield-check', title: '难以失败', body: '钩错了也不怕——分步教程可回看，社群里有耐心的老师傅随时答疑，失败也是创造的一部分。', img: '' },
    { icon: 'sparkles', title: '幸运随行', body: '每只小棉鸭都附赠一张幸运卡，做完带在身边，把这份手作的幸运一直带着走。', img: '' },
  ],
}
const REVIEWS_DEFAULT: ReviewsVM = {
  heading: '真实买家秀',
  items: [
    { quote: '第一次钩织就成功了，教程很细，小鸭子超级可爱，朋友都问在哪买的～', user: '小满', img: '' },
    { quote: '材料齐全，包邮很快，新手也能做出来，做完很有成就感。', user: '阿橙', img: '' },
    { quote: '送给闺蜜的生日礼物，她超喜欢，包装也很用心。', user: '柚子', img: '' },
  ],
}
const FAQ_DEFAULT: FaqVM[] = [
  { title: '完全没有基础可以做吗？', body: '可以。套装专为零基础设计，附带分步视频，跟着做就能完成第一只小棉鸭。' },
  { title: '材料包里都有什么？', body: '棉线、钩针、填充棉、安全眼、说明卡与幸运卡一应俱全，开盒即可开始。' },
  { title: '做坏了可以补料吗？', body: '可以。线材用尽或钩错都能在社群申请补料，七天内不满意还可无理由退货。' },
  { title: '大概需要多久完成？', body: '新手平均 3–4 小时即可完成一只，可分多次进行，随时暂停继续。' },
]
const CLOSING_DEFAULT: ClosingVM = { title: '创造幸运', cta: 'Get ducky get lucky', img: '' }
const FOOTER_DEFAULT: FooterVM = { links: ['关于我们', 'Lucky 鸭'], copy: 'Copyright © 2026 ZHUO DUCKI LUCKY · All Rights Reserved.' }

// ── 小工具 ──
type Dict = Record<string, unknown>
/** 取纯对象；数组/原始值/空 → {}（脏档安全·逐块回退默认的地基）。 */
const obj = (v: unknown): Dict => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {})
/** 取字符串并去首尾空白；空 → 默认（空串也算缺·防半空）。 */
const str = (v: unknown, def: string): string => {
  const s = (v == null ? '' : String(v)).trim()
  return s || def
}
/** 数组块：非空数组 → 逐项净化（脏项剔除）；空/缺/整组全脏 → 默认整组（黄金 §九·防误清空）。
 *  mapItem 拿原始元素（取对象与否的职责下沉给各 mapper 自己决定——footerLink 就要拒收对象，不能被 arr 先 obj() 成 {}）。 */
function arr<T>(raw: unknown, mapItem: (x: unknown) => T | null, def: T[]): T[] {
  if (!Array.isArray(raw) || raw.length === 0) return def
  const out: T[] = []
  for (const it of raw) {
    const m = mapItem(it)
    if (m) out.push(m)
  }
  return out.length ? out : def
}

const priceText = (v: unknown): string => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? '¥' + String(n) : ''
}

/** 商品列表 → 网格视图模型：无名/无价的脏行不进首页（fail-closed 展示面）；cover 空串由模板落占位块。 */
export function mapProducts(list: unknown): ProductVM[] {
  if (!Array.isArray(list)) return []
  const out: ProductVM[] = []
  for (const p of list as Dict[]) {
    if (!p || typeof p !== 'object') continue
    const id = String(p.id || p._id || '')
    const name = String(p.name || '')
    const priceLabel = priceText(p.price)
    if (!id || !name || !priceLabel) continue // 脏行不上首页（防「¥undefined」类真机事故）
    out.push({
      id,
      name,
      tag: String(p.tag || ''),
      priceLabel,
      wasLabel: priceText(p.was),
      cover: String(p.cover || ''),
    })
  }
  return out
}

/** 首页内容 → hero：缺档/缺字段逐字段回退默认文案（不空屏·不半空）。 */
export function mapHero(home: unknown): HeroVM {
  const h = obj(obj(home).hero)
  return {
    title: str(h.title, HERO_DEFAULT.title),
    tagline: str(h.tagline, HERO_DEFAULT.tagline),
    search: str(h.search, HERO_DEFAULT.search),
    img: str(h.img, HERO_DEFAULT.img), // 缺→包内兜底鸭图（不留灰·README 图片矩阵「hero 品牌门面·不留灰」）；后台配了则用后台图
  }
}

const trustItem = (raw: unknown): TrustVM | null => {
  const x = obj(raw)
  const label = str(x.label, '')
  return label ? { icon: str(x.icon, ''), label } : null // 无标签整条剔除
}
const reassureItem = (raw: unknown): ReassureItemVM | null => {
  const x = obj(raw)
  const title = str(x.title, '')
  return title ? { icon: str(x.icon, ''), title, body: str(x.body, ''), img: str(x.img, '') } : null
}
const reviewItem = (raw: unknown): ReviewVM | null => {
  const x = obj(raw)
  const quote = str(x.quote, '')
  return quote ? { quote, user: str(x.user, ''), img: str(x.img, '') } : null
}
const faqItem = (raw: unknown): FaqVM | null => {
  const x = obj(raw)
  const title = str(x.title, '')
  return title ? { title, body: str(x.body, '') } : null
}
/** footer.links 是纯字符串数组（admin 存法·cloud content.ts）——只收 string/number，
 *  其余类型（对象/数组/null/undefined/boolean）一律剔除，防 String({})='[object Object]' 塌缩值混入。 */
const footerLink = (x: unknown): string | null => {
  if (typeof x !== 'string' && typeof x !== 'number') return null
  const s = String(x).trim()
  return s || null
}

/** 首页全板块内容 → 视图模型：整档 / 逐块 / 逐字段缺失都回退设计默认；脏项 fail-closed 剔除。 */
export function mapHomeContent(home: unknown): HomeContentVM {
  const h = obj(home)
  const brand = obj(h.brand)
  const feature = obj(h.feature)
  const reassure = obj(h.reassure)
  const reviews = obj(h.reviews)
  const closing = obj(h.closing)
  const footer = obj(h.footer)
  return {
    hero: mapHero(home),
    brand: {
      name: str(brand.name, BRAND_DEFAULT.name),
      lead: str(brand.lead, BRAND_DEFAULT.lead),
    },
    feature: {
      title: str(feature.title, FEATURE_DEFAULT.title),
      body: str(feature.body, FEATURE_DEFAULT.body),
      img: str(feature.img, ''),
    },
    trust: arr(h.trust, trustItem, TRUST_DEFAULT),
    reassure: {
      heading: str(reassure.heading, REASSURE_DEFAULT.heading),
      lead: str(reassure.lead, REASSURE_DEFAULT.lead),
      items: arr(reassure.items, reassureItem, REASSURE_DEFAULT.items),
    },
    reviews: {
      heading: str(reviews.heading, REVIEWS_DEFAULT.heading),
      items: arr(reviews.items, reviewItem, REVIEWS_DEFAULT.items),
    },
    faq: arr(h.faq, faqItem, FAQ_DEFAULT),
    closing: {
      title: str(closing.title, CLOSING_DEFAULT.title),
      cta: str(closing.cta, CLOSING_DEFAULT.cta),
      img: str(closing.img, ''),
    },
    footer: {
      links: arr(footer.links, footerLink, FOOTER_DEFAULT.links),
      copy: str(footer.copy, FOOTER_DEFAULT.copy),
    },
  }
}
