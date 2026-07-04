// 首页数据映射（纯函数·vitest 钉行为·守卫 rw-mp-home-golden）：云端契约 → 视图模型。
// 钱链纪律：price 云端存「元」（订单链的分整数在云函数内·展示层不做算术、原样标价）。

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
}

// 默认文案（黄金 learning-content §九：无记录回退默认文案，不空屏）
const HERO_DEFAULT: HeroVM = { title: '一针一线，钩出一只小暖鸭', tagline: '材料包 + 视频陪学 · 新手也能钩完' }

const priceText = (v: unknown): string => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? '¥' + String(n) : ''
}

/** 商品列表 → 网格视图模型：无名/无价的脏行不进首页（fail-closed 展示面）；cover 空串由模板落占位块。 */
export function mapProducts(list: unknown): ProductVM[] {
  if (!Array.isArray(list)) return []
  const out: ProductVM[] = []
  for (const p of list as Record<string, unknown>[]) {
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
  const h = (home && typeof home === 'object' ? (home as Record<string, any>).hero : null) || {}
  return {
    title: String(h.title || '') || HERO_DEFAULT.title,
    tagline: String(h.tagline || '') || HERO_DEFAULT.tagline,
  }
}
