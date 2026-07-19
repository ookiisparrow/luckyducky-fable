// 页面内容 CMS 五页签映射（纯函数·批C）：welcome / catalogPlayer / mePage / about / agreement 各一对
// normalize（云→表单·缺块补形·超限截断）+ payload（表单→云·裁剪限长·不夹带未知字段）。
// 限长与云端白名单（adminApi/content.ts sanitize*）逐字对齐——两处同源、改一处必改另一处。
// history 由服务端权威追加（防伪造版本史），只读展示、**绝不进 payload**（回传即被云端忽略，此处更早拦住）。

const cut = (v: unknown, n: number): string => String(v ?? '').slice(0, n)
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' ? (v as Record<string, any>) : {})
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])

// ———————————————————————————— welcome（欢迎与激活）————————————————————————————
export interface WelcomeModel {
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
export function welcomePayload(m: WelcomeModel): Record<string, unknown> {
  return {
    w1: { title: cut(m.w1.title, 60), sub: cut(m.w1.sub, 120), warning: cut(m.w1.warning, 120) },
    w2: { items: m.w2.items.slice(0, 3).map((it) => ({ title: cut(it.title, 60), desc: cut(it.desc, 2000) })) },
  }
}

// ———————————————————————————— catalogPlayer（目录与播放）————————————————————————————
export interface CatalogPlayerModel {
  catalog: { heroImage: string; resumeCta: string; emptyLesson: string }
  help: { contactTitle: string; videosTitle: string; faqTitle: string; faq: Array<{ q: string; a: string }> }
}
export function normalizeCatalogPlayer(raw: unknown): CatalogPlayerModel {
  const d = obj(raw)
  const c = obj(d.catalog)
  const h = obj(d.help)
  return {
    catalog: { heroImage: cut(c.heroImage, 200), resumeCta: cut(c.resumeCta, 40), emptyLesson: cut(c.emptyLesson, 40) },
    help: {
      contactTitle: cut(h.contactTitle, 60),
      videosTitle: cut(h.videosTitle, 60),
      faqTitle: cut(h.faqTitle, 60),
      faq: arr(h.faq).slice(0, 20).map((f) => ({ q: cut(obj(f).q, 120), a: cut(obj(f).a, 1000) })),
    },
  }
}
export function catalogPlayerPayload(m: CatalogPlayerModel): Record<string, unknown> {
  return {
    catalog: { heroImage: cut(m.catalog.heroImage, 200), resumeCta: cut(m.catalog.resumeCta, 40), emptyLesson: cut(m.catalog.emptyLesson, 40) },
    help: {
      contactTitle: cut(m.help.contactTitle, 60),
      videosTitle: cut(m.help.videosTitle, 60),
      faqTitle: cut(m.help.faqTitle, 60),
      faq: m.help.faq.slice(0, 20).map((f) => ({ q: cut(f.q, 120), a: cut(f.a, 1000) })),
    },
  }
}

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
export interface MePageModel {
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
export function mePagePayload(m: MePageModel): Record<string, unknown> {
  // 只发固定 9 键（顺序稳定·key 只读）：label 裁 60、visible 布尔。防表单被脏 key 污染（云端亦二次过滤）。
  const byKey = new Map(m.entries.map((e) => [e.key, e]))
  return {
    defaultNickname: cut(m.defaultNickname, 20),
    entries: ME_ENTRIES.map((def) => {
      const e = byKey.get(def.key)
      return { key: def.key, label: cut(e?.label || def.label, 60), visible: e ? e.visible !== false : true }
    }),
  }
}

// ———————————————————————————— about（关于我们）————————————————————————————
export interface AboutModel {
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
export function aboutPayload(m: AboutModel): Record<string, unknown> {
  return {
    lead: cut(m.lead, 200),
    sections: m.sections.slice(0, 10).map((s) => ({ title: cut(s.title, 60), body: cut(s.body, 2000) })),
  }
}

// ———————————————————————————— 「我」+关于两档保存结果聚合（纯函数·批N P1 修复）————————————————————————————
// MeAboutTab 同页管两份独立 content 档（mePage/about），各自一条 usePageContent 生命周期、各自 save() 完成后
// 都会把自己的 message 设成非空（成功固定文案 / 失败带话术），点一次「保存」两档都存。原实现用
// `me.message || about.message` 短路合并展示：先完成、总是非空的一方（几乎总是 me）会把另一方的结果——哪怕
// 是失败——整个遮蔽掉，用户只看到成功提示、实际另一档保存失败且毫不知情（根因#14 失败必可观测）。
// 改成显式判断两者是否等于成功文案，都成功才显示成功；任一失败就把失败的那个/两个原样话术带上，不丢信息。
// 单源（债目·E4 顺手改批）：曾被 usePageContent.ts save() 与 HomeContentForm.vue save() 各手抄一份
// 「同源」字面量——三处三份、改一处漏两处即漂移。现两者都 import 本常量，全仓该文案字面量只此一处定义点。
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
export interface AgreementClause {
  version: string
  effectiveDate: string
  sections: Array<{ title: string; body: string }>
}
export interface AgreementModel {
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
function clausePayload(c: AgreementClause): AgreementClause {
  return {
    version: cut(c.version, 20),
    effectiveDate: cut(c.effectiveDate, 20),
    sections: c.sections.slice(0, 30).map((s) => ({ title: cut(s.title, 60), body: cut(s.body, 2000) })),
  }
}
export function agreementPayload(m: AgreementModel): Record<string, unknown> {
  // history 不进 payload（服务端权威追加·回传被忽略·此处更早拦）：只发 user + privacy 两份条款。
  return { user: clausePayload(m.user), privacy: clausePayload(m.privacy) }
}
