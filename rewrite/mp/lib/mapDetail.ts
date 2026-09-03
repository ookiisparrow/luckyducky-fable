// 详情页数据映射（纯函数·vitest 钉行为·守卫 rw-mp-detail-golden）：云端商品档 → 详情视图模型。
// 展示面 fail-closed 同首页（脏行剔除·绝不渲染 undefined）；价格「元」原样标不做算术。

export interface SkuVM {
  name: string
  price: number // 元数字（加购用·展示用 priceLabel）
  priceLabel: string
}

export interface DetailVM {
  id: string
  name: string
  tag: string
  brief: string
  gallery: string[]
  price: number // 元数字（加购用）
  was?: number
  priceLabel: string
  wasLabel: string
  skus: SkuVM[]
  params: Array<{ k: string; v: string }>
  sections: Array<{ lead: string; body: string }>
  kit: Array<{ name: string; qty: string }>
  soldLabel: string // 后台手填销量；0/缺省空串，模板 wx:if 藏掉（少噪音）
}

const priceText = (v: unknown): string => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? '¥' + n.toFixed(2) : ''
}

/** 后台手填销量 → 「已售 N」；0/缺/脏值空串（详情页藏掉，不写「已售 0」）。 */
const soldText = (v: unknown): string => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n > 0 ? '已售 ' + String(n) : ''
}

/** 商品档 → 详情 VM；档缺身份/名/价 → null（页面落「商品不存在」态，不渲染半空详情）。 */
export function mapDetail(p: unknown): DetailVM | null {
  if (!p || typeof p !== 'object') return null
  const d = p as Record<string, any>
  const id = String(d.id || d._id || '')
  const name = String(d.name || '')
  const priceLabel = priceText(d.price)
  if (!id || !name || !priceLabel) return null

  // 图册：cover 领衔 + images 跟随；全空回退空数组（模板落占位块·不渲染裂图）
  const gallery: string[] = []
  if (d.cover) gallery.push(String(d.cover))
  if (Array.isArray(d.images)) for (const img of d.images) if (img) gallery.push(String(img))

  // SKU：无名/无价的脏行剔除（同首页 fail-closed）
  const skus: SkuVM[] = []
  if (Array.isArray(d.skus)) {
    for (const s of d.skus) {
      const sname = String((s && s.name) || '')
      const sprice = priceText(s && s.price)
      if (sname && sprice) skus.push({ name: sname, price: Number(s.price), priceLabel: sprice })
    }
  }

  // 参数表：[[k,v]] 双元组白名单；坏行剔除
  const params: Array<{ k: string; v: string }> = []
  if (Array.isArray(d.params)) {
    for (const row of d.params) {
      if (Array.isArray(row) && row.length >= 2 && row[0]) params.push({ k: String(row[0]), v: String(row[1] ?? '') }) // 缺值行=脏行剔除
    }
  }

  // 详情段落 / 材料清单：白名单字段
  const sections = (Array.isArray(d.detailSections) ? d.detailSections : [])
    .filter((s: any) => s && (s.lead || s.body))
    .map((s: any) => ({ lead: String(s.lead || ''), body: String(s.body || '') }))
  const kit = (Array.isArray(d.kit) ? d.kit : [])
    .filter((k: any) => k && k.name)
    .map((k: any) => ({ name: String(k.name), qty: String(k.qty || '') }))

  return {
    id,
    name,
    tag: String(d.tag || ''),
    brief: String(d.brief || ''),
    gallery,
    price: Number(d.price),
    was: typeof d.was === 'number' && Number.isFinite(d.was) && d.was > 0 ? d.was : undefined,
    priceLabel,
    wasLabel: priceText(d.was),
    skus,
    params,
    sections,
    kit,
    soldLabel: soldText(d.sold),
  }
}

