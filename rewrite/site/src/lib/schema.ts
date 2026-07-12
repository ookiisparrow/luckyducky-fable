// JSON-LD 结构化数据构造（纯函数·守卫 rw-site-schema-golden·GEO 核心）：
// 搜索引擎与 AI 引擎读的是这层——字段错了收录面就废，纯函数钉死。
export const SITE = 'https://www.luckyducky.cn'
export const BRAND_NAME = 'Lucky Ducky 小棉鸭'

const abs = (path: string): string => (path.startsWith('http') ? path : SITE + (path.startsWith('/') ? path : '/' + path))

/** JSON-LD 安全序列化单源（深审 2026-07-12 P3）：裸 JSON.stringify 进 set:html 时，内容含 `</script>`
 *  会提前截断脚本块（HTML 解析不认字符串语义）——统一把 `<` 转 <，全站注入点只走这一个出口。 */
export const jsonLd = (obj: Record<string, unknown> | null): string => (obj ? JSON.stringify(obj).replace(/</g, '\\u003c') : '')

/** 组织卡（全站页脚注入·品牌实体锚点）。 */
export function orgSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: BRAND_NAME,
    url: SITE,
    description: '专注钩织的材料包品牌：毛线、配件、工具与分步教学视频打包成材料包，零基础也能亲手钩出随身幸运物。',
  }
}

/** 站点卡（WebSite·站点实体锚点，与 Organization 配对全站注入——AI 引擎认站的第一信号）。 */
export function websiteSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: BRAND_NAME,
    alternateName: 'LuckyDucky小棉鸭',
    url: SITE,
    inLanguage: 'zh-CN',
    publisher: { '@type': 'Organization', name: BRAND_NAME, url: SITE },
  }
}

export interface ArticleInput {
  title: string
  description: string
  path: string
  datePublished: string // YYYY-MM-DD
  dateModified?: string
}

/** 教程文章卡（Article·AI 引擎摘要的主粮）。缺必填回 null（不产半空卡——半空卡比没有更伤收录）。 */
export function articleSchema(a: ArticleInput): Record<string, unknown> | null {
  if (!a || !a.title || !a.description || !a.path || !/^\d{4}-\d{2}-\d{2}$/.test(a.datePublished)) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.description,
    url: abs(a.path),
    datePublished: a.datePublished,
    dateModified: a.dateModified && /^\d{4}-\d{2}-\d{2}$/.test(a.dateModified) ? a.dateModified : a.datePublished,
    author: { '@type': 'Organization', name: BRAND_NAME },
    publisher: { '@type': 'Organization', name: BRAND_NAME, url: SITE },
    inLanguage: 'zh-CN',
  }
}

export interface HowToStep {
  name: string
  text: string
}

/** 教程步骤卡（HowTo·「怎么做」类查询的结构化答案）。空步骤/脏行剔除；全空回 null。 */
export function howToSchema(title: string, description: string, steps: unknown): Record<string, unknown> | null {
  const clean = (Array.isArray(steps) ? steps : [])
    .filter((s: unknown): s is HowToStep => !!s && typeof s === 'object' && !!(s as HowToStep).name && !!(s as HowToStep).text)
    .map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.name, text: s.text }))
  if (!title || !clean.length) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: title,
    description: description || '',
    step: clean,
    inLanguage: 'zh-CN',
  }
}

/** FAQ 卡（FAQPage·AI 引擎最爱的问答对）。 */
export function faqSchema(pairs: unknown): Record<string, unknown> | null {
  const clean = (Array.isArray(pairs) ? pairs : [])
    .filter((p: any) => p && p.q && p.a)
    .map((p: any) => ({ '@type': 'Question', name: String(p.q), acceptedAnswer: { '@type': 'Answer', text: String(p.a) } }))
  if (!clean.length) return null
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: clean }
}

/** 面包屑（层级归属·收录结构信号）。 */
export function breadcrumbSchema(trail: Array<{ name: string; path: string }>): Record<string, unknown> | null {
  const clean = (Array.isArray(trail) ? trail : []).filter((t) => t && t.name && t.path)
  if (clean.length < 2) return null // 单级无意义
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: clean.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: abs(t.path) })),
  }
}
