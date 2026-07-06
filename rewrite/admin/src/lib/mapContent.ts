// 内容组映射（纯函数·守卫 rw-admin-content-ui-golden）：首页内容表单模型往返/帮助视频两级归一/
// 课程视频统计/**直传表单字段构造**（调试日志 G 固化：凭证只认 POST 表单·key 从 fileId 截取·字段名精确——
// 错一个字段云存储 403，这类坑必须钉在测试里）。
export interface HomeModel {
  heroTitle: string
  heroTagline: string
  heroSearch: string
  heroImg: string
  brandName: string
  brandLead: string
  featureTitle: string
  featureBody: string
  featureImg: string
  reassureHeading: string
  reassureLead: string
  reassureItems: Array<{ icon: string; title: string; body: string; img: string }>
  reviewsHeading: string
  reviewsItems: Array<{ quote: string; user: string; img: string }>
  closingTitle: string
  closingCta: string
  closingImg: string
  footerLinks: string[]
  footerCopy: string
  activationBg: string
  loadingBg: string
  byCourse: Array<{ courseId: string; welcome: string; welcomeBack: string; taken: string }>
  trust: Array<{ icon: string; label: string }>
  faq: Array<{ title: string; body: string }>
}

/** 云端 home 档 → 编辑模型（缺档全默认空串·byCourse 映射转行·旧单串值归一 welcome）。
 *  新板块（品牌/特写/放心/买家秀/收尾/页脚）缺失→空串/空数组：编辑器显占位提示，小程序读侧回退设计文案。 */
export function normalizeHome(raw: unknown): HomeModel {
  const h = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const o = (v: any) => (v && typeof v === 'object' ? v : {})
  const hero = o(h.hero)
  const brand = o(h.brand)
  const feature = o(h.feature)
  const reassure = o(h.reassure)
  const reviews = o(h.reviews)
  const closing = o(h.closing)
  const footer = o(h.footer)
  const byCourseRaw = h.activationBgByCourse && typeof h.activationBgByCourse === 'object' ? h.activationBgByCourse : {}
  const byCourse: HomeModel['byCourse'] = []
  for (const k of Object.keys(byCourseRaw)) {
    const v = byCourseRaw[k]
    if (typeof v === 'string') byCourse.push({ courseId: k, welcome: v, welcomeBack: '', taken: '' })
    else if (v && typeof v === 'object') byCourse.push({ courseId: k, welcome: String(v.welcome || ''), welcomeBack: String(v.welcomeBack || ''), taken: String(v.taken || '') })
  }
  return {
    heroTitle: String(hero.title || ''),
    heroTagline: String(hero.tagline || ''),
    heroSearch: String(hero.search || ''),
    heroImg: String(hero.img || ''),
    brandName: String(brand.name || ''),
    brandLead: String(brand.lead || ''),
    featureTitle: String(feature.title || ''),
    featureBody: String(feature.body || ''),
    featureImg: String(feature.img || ''),
    reassureHeading: String(reassure.heading || ''),
    reassureLead: String(reassure.lead || ''),
    reassureItems: (Array.isArray(reassure.items) ? reassure.items : []).map((it: any) => ({ icon: String(it?.icon || ''), title: String(it?.title || ''), body: String(it?.body || ''), img: String(it?.img || '') })),
    reviewsHeading: String(reviews.heading || ''),
    reviewsItems: (Array.isArray(reviews.items) ? reviews.items : []).map((it: any) => ({ quote: String(it?.quote || ''), user: String(it?.user || ''), img: String(it?.img || '') })),
    closingTitle: String(closing.title || ''),
    closingCta: String(closing.cta || ''),
    closingImg: String(closing.img || ''),
    footerLinks: (Array.isArray(footer.links) ? footer.links : []).map((s: any) => String(s || '')),
    footerCopy: String(footer.copy || ''),
    activationBg: String(h.activationBg || ''),
    loadingBg: String(h.loadingBg || ''),
    byCourse,
    trust: (Array.isArray(h.trust) ? h.trust : []).map((t: any) => ({ icon: String(t?.icon || ''), label: String(t?.label || '') })),
    faq: (Array.isArray(h.faq) ? h.faq : []).map((f: any) => ({ title: String(f?.title || ''), body: String(f?.body || '') })),
  }
}

/** 编辑模型 → saveHomeContent 载荷（空课行/空块/空评价/空链剔除·与云端白名单同构）。
 *  空串字段照发（云端存空、小程序读侧回退设计默认＝防误清空半空板块·黄金 §九）。 */
export function homePayload(m: HomeModel): Record<string, unknown> {
  const activationBgByCourse: Record<string, Record<string, string>> = {}
  for (const row of m.byCourse) {
    const cid = row.courseId.trim()
    if (!cid) continue // 空课行剔除
    const entry: Record<string, string> = {}
    if (row.welcome) entry.welcome = row.welcome
    if (row.welcomeBack) entry.welcomeBack = row.welcomeBack
    if (row.taken) entry.taken = row.taken
    if (Object.keys(entry).length) activationBgByCourse[cid] = entry
  }
  return {
    hero: { title: m.heroTitle, tagline: m.heroTagline, search: m.heroSearch, img: m.heroImg },
    brand: { name: m.brandName, lead: m.brandLead },
    feature: { title: m.featureTitle, body: m.featureBody, img: m.featureImg },
    reassure: {
      heading: m.reassureHeading,
      lead: m.reassureLead,
      items: m.reassureItems.filter((it) => it.title.trim() || it.body.trim()).map((it) => ({ icon: it.icon, title: it.title, body: it.body, img: it.img })), // 空块剔除
    },
    reviews: {
      heading: m.reviewsHeading,
      items: m.reviewsItems.filter((it) => it.quote.trim()).map((it) => ({ quote: it.quote, user: it.user, img: it.img })), // 空评价剔除
    },
    closing: { title: m.closingTitle, cta: m.closingCta, img: m.closingImg },
    footer: { links: m.footerLinks.map((s) => s.trim()).filter(Boolean), copy: m.footerCopy }, // 空链剔除
    activationBg: m.activationBg,
    loadingBg: m.loadingBg,
    activationBgByCourse,
    trust: m.trust.filter((t) => t.label),
    faq: m.faq.filter((f) => f.title || f.body),
  }
}

export interface HelpItem {
  id: string
  title: string
  sub: string
  desc: string
  segments: Array<{ id: string; name: string; dur: string; videoFileId: string }>
}

export function normalizeHelpItems(raw: unknown): HelpItem[] {
  if (!Array.isArray(raw)) return []
  return (raw as Record<string, any>[]).filter(Boolean).map((it) => ({
    id: String(it.id || ''),
    title: String(it.title || ''),
    sub: String(it.sub || ''),
    desc: String(it.desc || ''),
    segments: (Array.isArray(it.segments) ? it.segments : []).filter(Boolean).map((sg: any) => ({
      id: String(sg.id || ''),
      name: String(sg.name || ''),
      dur: String(sg.dur || ''),
      videoFileId: String(sg.videoFileId || ''),
    })),
  }))
}

/** 课程视频统计（列表「已传 x/y」·发布前一眼看齐没齐）。脏档安全。 */
export function courseVideoStats(course: unknown): { total: number; done: number } {
  const c = (course && typeof course === 'object' ? course : {}) as Record<string, any>
  let total = 0
  let done = 0
  for (const ch of Array.isArray(c.chapters) ? c.chapters : []) {
    for (const l of ch && Array.isArray(ch.lessons) ? ch.lessons : []) {
      for (const sg of l && Array.isArray(l.segments) ? l.segments : []) {
        if (!sg) continue
        total++
        if (sg.videoFileId) done++
      }
    }
  }
  return { total, done }
}

/** 直传表单字段（调试日志 G 固化）：key=对象路径（从 fileId 的 cloud://<env>.<bucket>/ 后截取）；
 *  Signature/x-cos-security-token/x-cos-meta-fileid 名字一个不能错；凭证只认 POST 表单（PUT 403）。 */
export function uploadFormFields(meta: { fileId?: unknown; authorization?: unknown; token?: unknown; cosFileId?: unknown }): Record<string, string> | null {
  const fileId = String(meta.fileId || '')
  const auth = String(meta.authorization || '')
  const token = String(meta.token || '')
  const cos = String(meta.cosFileId || '')
  if (!fileId || !auth || !token || !cos) return null // 凭证不齐不发（fail-closed）
  return {
    key: fileId.replace(/^cloud:\/\/[^/]+\//, ''),
    Signature: auth,
    'x-cos-security-token': token,
    'x-cos-meta-fileid': cos,
  }
}
