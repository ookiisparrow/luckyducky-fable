// 内容组映射（纯函数·守卫 rw-admin-content-ui-golden）：首页内容表单模型往返/帮助视频两级归一/
// 课程视频统计/**直传表单字段构造**（调试日志 G 固化：凭证只认 POST 表单·key 从 fileId 截取·字段名精确——
// 错一个字段云存储 403，这类坑必须钉在测试里）。
export interface HomeModel {
  heroTitle: string
  heroTagline: string
  activationBg: string
  loadingBg: string
  byCourse: Array<{ courseId: string; welcome: string; welcomeBack: string; taken: string }>
  trust: Array<{ icon: string; label: string }>
  faq: Array<{ title: string; body: string }>
}

/** 云端 home 档 → 编辑模型（缺档全默认·byCourse 映射转行·旧单串值归一 welcome）。 */
export function normalizeHome(raw: unknown): HomeModel {
  const h = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const hero = h.hero && typeof h.hero === 'object' ? h.hero : {}
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
    activationBg: String(h.activationBg || ''),
    loadingBg: String(h.loadingBg || ''),
    byCourse,
    trust: (Array.isArray(h.trust) ? h.trust : []).map((t: any) => ({ icon: String(t?.icon || ''), label: String(t?.label || '') })),
    faq: (Array.isArray(h.faq) ? h.faq : []).map((f: any) => ({ title: String(f?.title || ''), body: String(f?.body || '') })),
  }
}

/** 编辑模型 → saveHomeContent 载荷（空课行剔除·行转映射·与云端白名单同构）。 */
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
    hero: { title: m.heroTitle, tagline: m.heroTagline },
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
