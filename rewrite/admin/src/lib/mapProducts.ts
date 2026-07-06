// 商品与橱窗映射（纯函数·守卫 rw-admin-products-ui-golden）：三态口径与云端 listDrafts 一致；
// 上架四道门错误转人话（原文兜底不吞）；编辑走整档 round-trip（saveDraft 全量覆盖——表单只绑核心字段·
// 未编辑字段原样随档提交，防高级字段被抹）。
export type ProductState = 'onsale' | 'unlisted' | 'preparing'

const STATE_LABELS: Record<ProductState, string> = {
  onsale: '在售',
  unlisted: '已下架',
  preparing: '筹备中',
}

/** 三态：listed 表有值 true=在售/false=已下架；无档=筹备中（未上架）。 */
export function productState(id: string, listedMap: unknown): ProductState {
  const m = (listedMap && typeof listedMap === 'object' ? listedMap : {}) as Record<string, boolean>
  if (!(id in m)) return 'preparing'
  return m[id] === false ? 'unlisted' : 'onsale'
}

export interface StepDot {
  key: string
  label: string
  done: boolean
}
// listDrafts 后端派生的分步态（换皮误判「无源」·实则 cards/courses/qrcodes 可 join）
export interface StepExtras {
  hasVideo?: Record<string, boolean> // courseId → 有教学视频
  cardFinal?: Record<string, boolean> // productId → 卡片已定稿
  hasBatch?: Record<string, boolean> // courseId → 有码批次
}

/** 6 步上新进度（S11·换皮误判「无源·略」）：图片/信息/SKU 前端算·视频/卡片/批次取后端 listDrafts extras。 */
export function productSteps(p: Record<string, any>, extras?: StepExtras): StepDot[] {
  const id = String((p && (p.id || p._id)) || '')
  const courseId = String((p && p.courseId) || '') || 'course-' + id
  const e = extras || {}
  return [
    { key: 'image', label: '产品图片', done: !!(p && p.cover) },
    { key: 'info', label: '商品信息', done: !!String((p && p.name) || '').trim() && !!(p && p.price != null && String(p.price) !== '') },
    { key: 'sku', label: 'SKU', done: Array.isArray(p && p.skus) && p.skus.length > 0 },
    { key: 'video', label: '教学视频', done: !!(e.hasVideo && e.hasVideo[courseId]) },
    { key: 'card', label: '二维码卡片', done: !!(e.cardFinal && e.cardFinal[id]) },
    { key: 'batch', label: '码批次', done: !!(e.hasBatch && e.hasBatch[courseId]) },
  ]
}

export interface DraftRowVM {
  id: string
  name: string
  priceLabel: string
  state: ProductState
  stateLabel: string
  coverUrl: string
  skuCount: number
  steps: StepDot[] // 6 步上新进度圆点（换皮删了这列·「无源」说法误·后端 extras 就绪即真）
  doneCount: number
  raw: Record<string, unknown> // 整档（编辑 round-trip 用·防覆盖式保存抹字段）
}

/** 价格标签：多规格显最低 SKU 价 +「起」（换皮丢了起价语义·平铺 product.price）；无 SKU 退商品价。 */
export function skuPriceLabel(p: Record<string, any>): string {
  const skus = Array.isArray(p.skus) ? p.skus : []
  const prices = skus.map((s: any) => Number(s && s.price)).filter((n: number) => n > 0)
  if (prices.length) return `¥${Math.min(...prices)}${skus.length > 1 ? ' 起' : ''}`
  return p.price != null && String(p.price) !== '' ? '¥' + String(p.price) : '未定价'
}

export function mapDraftRows(list: unknown, urls: unknown, listedMap: unknown, extras?: StepExtras): DraftRowVM[] {
  if (!Array.isArray(list)) return []
  const u = (urls && typeof urls === 'object' ? urls : {}) as Record<string, string>
  const out: DraftRowVM[] = []
  for (const p of list as Record<string, any>[]) {
    if (!p || typeof p !== 'object') continue
    const id = String(p.id || p._id || '')
    if (!id) continue
    const state = productState(id, listedMap)
    const steps = productSteps(p, extras)
    out.push({
      id,
      name: String(p.name || '（未命名）'),
      priceLabel: skuPriceLabel(p),
      state,
      stateLabel: STATE_LABELS[state],
      coverUrl: p.cover ? u[String(p.cover)] || '' : '',
      skuCount: Array.isArray(p.skus) ? p.skus.length : 0,
      steps,
      doneCount: steps.filter((s) => s.done).length,
      raw: p,
    })
  }
  return out
}

/** 上新向导上架闸：前三步（封面/信息/SKU）缺什么——事前预检（换皮退成事后报错）·与云端 publishProduct 四道门同口径。
 *  步 4-6（教学视频/二维码卡片/码批次）非上架硬门槛（可先上架、之后补课程），故不进此清单。 */
export function basicsMissing(p: unknown): string[] {
  const d = (p && typeof p === 'object' ? p : {}) as Record<string, any>
  const m: string[] = []
  if (!d.cover) m.push('封面图')
  if (!String(d.name || '').trim()) m.push('商品名称')
  if (d.price == null || String(d.price).trim() === '') m.push('价格')
  const skus = Array.isArray(d.skus) ? d.skus : []
  const skusOk = skus.length > 0 && skus.every((s: any) => String(s?.name || '').trim() !== '' && String(s?.price ?? '').trim() !== '')
  if (!skusOk) m.push('至少一个有效规格')
  return m
}

/** 前三步齐 = 可上架（basicsMissing 空）。上新向导上架按钮的闸。 */
export function wizardCanPublish(p: unknown): boolean {
  return basicsMissing(p).length === 0
}

/** 上架四道门 → 人话（原文兜底不吞·守卫反向测试面）。 */
export function publishErrorText(e: unknown): string {
  const code = String(e || '')
  if (code === 'NO_DRAFT') return '草稿不存在（可能已被删除）'
  if (code === 'NEED_COVER') return '先上传封面图才能上架'
  if (code === 'NEED_INFO') return '名称或价格没填好（价格须是有效金额）'
  if (code === 'NEED_SKUS') return '规格行不完整（每行都要有名称和有效价格）'
  return '上架没成功（' + code + '）' // 原文兜底
}

export interface ShowcaseRowVM {
  id: string
  name: string
  sort: number
  featured: boolean
  listed: boolean
  coverUrl: string
  price: string // iPhone WYSIWYG 预览用（换皮丢了手机预览）
  tag: string
}

export function mapShowcaseRows(list: unknown, urls: unknown): ShowcaseRowVM[] {
  if (!Array.isArray(list)) return []
  const u = (urls && typeof urls === 'object' ? urls : {}) as Record<string, string>
  const out: ShowcaseRowVM[] = []
  for (const p of list as Record<string, any>[]) {
    if (!p || typeof p !== 'object') continue
    const id = String(p.id || p._id || '')
    if (!id) continue
    out.push({
      id,
      name: String(p.name || ''),
      sort: Number(p.sort) || 0,
      featured: p.featured === true,
      listed: p.listed !== false,
      coverUrl: p.cover ? u[String(p.cover)] || '' : '',
      price: String(p.price || ''),
      tag: String(p.tag || ''),
    })
  }
  return out.sort((a, b) => a.sort - b.sort)
}

/** 图片 base64 尺寸闸（云端 ≤90K 字符·前端 80K 提前拦——超限提示压缩而不是白发一次失败请求）。 */
export const b64SizeOk = (b64: string): boolean => !!b64 && b64.length <= 80_000
