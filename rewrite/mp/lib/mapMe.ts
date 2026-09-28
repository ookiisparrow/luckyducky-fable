// 「我」页 CMS 内容映射（独立于 lib/mapPages）：me 是 tab 首屏页，它的 ts import 闭包决定
// 品牌字体 tier1（首屏子集）的字符面——mapPages 里同住的协议/隐私 511 字法务长文只在二级页上屏，
// 分开放则 tab 闭包不拖进长文（守卫 rw-mp-font-tier-subset-covers 机器盯闭包⊆子集）。
// lib/mapPages 原名 re-export，pages-map.test.ts 钉行为。
// 内容纪律同 mapPages：整档 null / 逐块缺 / 逐字段空 都回退设计默认文案，页面永不空白。

// ── 小工具（同 mapPages 口径·本文件自持不跨 lib 复用私有 helper：宁可小重复）──
type Dict = Record<string, unknown>
/** 取纯对象；数组/原始值/空 → {}。 */
const obj = (v: unknown): Dict => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {})
/** 取字符串并去首尾空白；空 → 默认（空串也算缺·防半空）。 */
const str = (v: unknown, def: string): string => {
  const s = (v == null ? '' : String(v)).trim()
  return s || def
}

type MeEntryKey = 'courses' | 'orders' | 'aftersales' | 'address' | 'activate' | 'feedback' | 'kefu' | 'consent' | 'about'
interface MeEntryVM {
  label: string
  visible: boolean
}
export interface MeVM {
  defaultNickname: string
  entries: Record<MeEntryKey, MeEntryVM>
}

const ME_DEFAULT_NICKNAME = '钩织新手' // me.ts 登录零资料回灌兜底名
const ME_ENTRY_LABELS: Record<MeEntryKey, string> = {
  // 默认文字＝v5 设计稿 D1 原文（后台 CMS 配了则用后台）。activate/consent 两键保留给后台兼容，
  // activate 不再显示（老板拍板不做手动输码/扫码）；consent 设计稿未画但合规守卫要求「我」页可直达，保留在入口行末。
  courses: '我的课程',
  orders: '全部订单', // 订单格第四格
  aftersales: '售后',
  address: '收货地址',
  activate: '扫码激活课程',
  feedback: '反馈',
  kefu: '客服',
  consent: '数据共享授权',
  about: '关于',
}
const ME_KEYS = Object.keys(ME_ENTRY_LABELS) as MeEntryKey[]

/** me 内容映射：defaultNickname 空回退；entries 未知 key 忽略、缺失=全默认全可见、visible===false 才隐藏。 */
export function mapMe(content: unknown): MeVM {
  const c = obj(content)
  const entries = {} as Record<MeEntryKey, MeEntryVM>
  for (const k of ME_KEYS) entries[k] = { label: ME_ENTRY_LABELS[k], visible: true } // 先铺默认（全可见）
  const raw = Array.isArray(c.entries) ? c.entries : []
  for (const e of raw) {
    const x = obj(e)
    const key = String(x.key || '') as MeEntryKey
    if (!(key in entries)) continue // 未知 key 忽略
    entries[key] = {
      label: str(x.label, ME_ENTRY_LABELS[key]),
      visible: x.visible === false ? false : true, // 仅显式 false 隐藏；缺省/true 显示
    }
  }
  return { defaultNickname: str(c.defaultNickname, ME_DEFAULT_NICKNAME), entries }
}

/** 继续学习卡下行（设计稿 D1 contLesson）：整课每段都看完 →「全部学完 · 可以重看」；
 *  否则「章.节 课时名」（节号按课程目录里的位置数·同目录页 1.1 口径）；课程还没拉到/课时已不在目录 → 只写课时名。 */
export function contMainLine(cont: { lessonId: string; lessonName: string }, course: unknown, finished: boolean): string {
  if (finished) return '全部学完 · 可以重看'
  const chapters = Array.isArray(obj(course).chapters) ? (obj(course).chapters as unknown[]) : []
  for (let ci = 0; ci < chapters.length; ci++) {
    const lessons = obj(chapters[ci]).lessons
    const li = Array.isArray(lessons) ? lessons.findIndex((l) => String(obj(l).id || '') === cont.lessonId) : -1
    if (li >= 0) return `${ci + 1}.${li + 1} ${cont.lessonName}`
  }
  return cont.lessonName
}
