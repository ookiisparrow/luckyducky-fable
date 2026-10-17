// 页面内容 CMS 五页签映射（纯函数）：welcome / catalogPlayer / mePage / about / agreement 各一对
// normalize（云→表单·缺块补形·超限截断）+ payload（表单→云·裁剪限长·不夹带未知字段）。
// payload 直接复用 normalize：normalize 对已成形的 Model 幂等，每个页签只维护一张限长表。
// 限长与云端白名单（adminApi/content.ts sanitize*）逐字对齐——两处同源、改一处必改另一处。
// history 由服务端权威追加（防伪造版本史），只读展示、**绝不进 payload**（回传即被云端忽略，此处更早拦住）。

const cut = (v: unknown, n: number): string => String(v ?? '').slice(0, n)
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' ? (v as Record<string, any>) : {})
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])

// ———————————————————————————— welcome（欢迎与激活）————————————————————————————
interface WelcomeModel {
  w1: { title: string; sub: string; warning: string }
  w2: { items: Array<{ title: string; desc: string }> }
}
export function normalizeWelcome(raw: unknown): WelcomeModel {
  const d = obj(raw)
  const w1 = obj(d.w1)
  const w2 = obj(d.w2)
  return {
    w1: { title: cut(w1.title, 60), sub: cut(w1.sub, 120), warning: cut(w1.warning, 120) },
    w2: { items: arr(w2.items).slice(0, 3).map((it) => ({ title: cut(obj(it).title, 60), desc: cut(obj(it).desc, 2000) })) },
  }
}
export const welcomePayload = (m: WelcomeModel): Record<string, unknown> => ({ ...normalizeWelcome(m) })

// ———————————————————————————— catalogPlayer（目录与播放）————————————————————————————
interface CatalogPlayerModel {
  catalog: { heroImage: string; emptyLesson: string }
  help: { contactTitle: string; videosTitle: string; faqTitle: string; faq: Array<{ q: string; a: string }> }
}
export function normalizeCatalogPlayer(raw: unknown): CatalogPlayerModel {
  const d = obj(raw)
  const c = obj(d.catalog)
  const h = obj(d.help)
  return {
    catalog: { heroImage: cut(c.heroImage, 200), emptyLesson: cut(c.emptyLesson, 40) },
    help: {
      contactTitle: cut(h.contactTitle, 60),
      videosTitle: cut(h.videosTitle, 60),
      faqTitle: cut(h.faqTitle, 60),
      faq: arr(h.faq).slice(0, 20).map((f) => ({ q: cut(obj(f).q, 120), a: cut(obj(f).a, 1000) })),
    },
  }
}
export const catalogPlayerPayload = (m: CatalogPlayerModel): Record<string, unknown> => ({ ...normalizeCatalogPlayer(m) })

// ———————————————————————————— mePage（我的与关于）————————————————————————————
// 九入口固定键集与顺序（以 rewrite/mp/pages/me 实况为准·与云端 ME_ENTRY_KEYS 同源）；label 可改名、visible 可开关，key 只读。
export const ME_ENTRIES: Array<{ key: string; label: string }> = [
  { key: 'courses', label: '全部教程' },
  { key: 'orders', label: '我的订单' },
  { key: 'aftersales', label: '售后' },
  { key: 'address', label: '收货地址' },
  { key: 'activate', label: '输入激活码' },
  { key: 'feedback', label: '意见反馈' },
  { key: 'kefu', label: '联系客服' },
  { key: 'consent', label: '数据共享授权' },
  { key: 'about', label: '关于我们' },
]
interface MePageModel {
  defaultNickname: string
  entries: Array<{ key: string; label: string; visible: boolean }>
}
export function normalizeMePage(raw: unknown): MePageModel {
  const d = obj(raw)
  const saved = arr(d.entries)
  // 固定 9 键顺序展示：有存档取其 label/visible，否则用默认 label + 可见。集外 key 不出现（云端已丢弃）。
  const entries = ME_ENTRIES.map((def) => {
    const found = saved.map(obj).find((e) => e.key === def.key)
    return { key: def.key, label: found ? cut(found.label || def.label, 60) : def.label, visible: found ? found.visible !== false : true }
  })
  return { defaultNickname: cut(d.defaultNickname, 20), entries }
}
// 只发固定 9 键（顺序稳定·key 只读）：防表单被脏 key 污染（云端亦二次过滤）。
export const mePagePayload = (m: MePageModel): Record<string, unknown> => ({ ...normalizeMePage(m) })

// ———————————————————————————— about（关于我们）————————————————————————————
interface AboutModel {
  lead: string
  sections: Array<{ title: string; body: string }>
}
export function normalizeAbout(raw: unknown): AboutModel {
  const d = obj(raw)
  return {
    lead: cut(d.lead, 200),
    sections: arr(d.sections).slice(0, 10).map((s) => ({ title: cut(obj(s).title, 60), body: cut(obj(s).body, 2000) })),
  }
}
export const aboutPayload = (m: AboutModel): Record<string, unknown> => ({ ...normalizeAbout(m) })

// 「我」+关于两档保存结果聚合：任一失败必须看得见，禁止短路吞掉另一档。成功文案只在此一处定义。
export const SAVE_OK_MESSAGE = '已保存，小程序立即生效'
export function combineSaveMessages(meMessage: string, aboutMessage: string): { error: boolean; message: string } {
  const meFailed = meMessage !== '' && meMessage !== SAVE_OK_MESSAGE
  const aboutFailed = aboutMessage !== '' && aboutMessage !== SAVE_OK_MESSAGE
  if (!meFailed && !aboutFailed) return { error: false, message: SAVE_OK_MESSAGE }
  const parts: string[] = []
  if (meFailed) parts.push('「我」页：' + meMessage)
  if (aboutFailed) parts.push('「关于我们」：' + aboutMessage)
  return { error: true, message: parts.join('；') }
}

// ———————————————————————————— agreement（协议文案）————————————————————————————
// 用户协议 user + 隐私政策 privacy 两份（各至多 30 段）；history 服务端维护、只读展示、不进 payload。
interface AgreementClause {
  version: string
  effectiveDate: string
  sections: Array<{ title: string; body: string }>
}
interface AgreementModel {
  user: AgreementClause
  privacy: AgreementClause
  history: Array<{ part: string; version: string; at: string }> // 只读
}
function normalizeClause(raw: unknown): AgreementClause {
  const c = obj(raw)
  return {
    version: cut(c.version, 20),
    effectiveDate: cut(c.effectiveDate, 20),
    sections: arr(c.sections).slice(0, 30).map((s) => ({ title: cut(obj(s).title, 60), body: cut(obj(s).body, 2000) })),
  }
}
export function normalizeAgreement(raw: unknown): AgreementModel {
  const d = obj(raw)
  return {
    user: normalizeClause(d.user),
    privacy: normalizeClause(d.privacy),
    history: arr(d.history).map((h) => ({ part: cut(obj(h).part, 20), version: cut(obj(h).version, 20), at: cut(obj(h).at, 40) })),
  }
}
export function agreementPayload(m: AgreementModel): Record<string, unknown> {
  // history 不进 payload（服务端权威追加·回传被忽略·此处更早拦）：只发 user + privacy 两份条款。
  return { user: normalizeClause(m.user), privacy: normalizeClause(m.privacy) }
}
