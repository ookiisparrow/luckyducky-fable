// 「我」页 CMS 内容映射（从 lib/mapPages 拆出·字体分层批）：me 是 tab 首屏页，它的 ts import 闭包决定
// 品牌字体 tier1（首屏子集）的字符面——mapPages 里同住的协议/隐私 511 字法务长文只在二级页上屏，
// 拆出 mapMe 后 tab 闭包不再拖进长文（守卫 rw-mp-font-tier-subset-covers 机器盯闭包⊆子集）。
// 行为与测试不变：lib/mapPages 原名 re-export，pages-map.test.ts / rw-mp-page-content-golden 黄金继续钉。
// 内容纪律同 mapPages（黄金 §九）：整档 null / 逐块缺 / 逐字段空 都回退设计默认文案，页面永不空白。

// ── 小工具（同 mapPages 口径·本文件自持不跨 lib 复用私有 helper·病根#5 判例：宁可小重复）──
type Dict = Record<string, unknown>
/** 取纯对象；数组/原始值/空 → {}。 */
const obj = (v: unknown): Dict => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {})
/** 取字符串并去首尾空白；空 → 默认（空串也算缺·防半空）。 */
const str = (v: unknown, def: string): string => {
  const s = (v == null ? '' : String(v)).trim()
  return s || def
}

export type MeEntryKey = 'courses' | 'orders' | 'aftersales' | 'address' | 'activate' | 'feedback' | 'kefu' | 'consent' | 'about'
export interface MeEntryVM {
  label: string
  visible: boolean
}
export interface MeVM {
  defaultNickname: string
  entries: Record<MeEntryKey, MeEntryVM>
}

const ME_DEFAULT_NICKNAME = '钩织新手' // me.ts 登录零资料回灌兜底名
const ME_ENTRY_LABELS: Record<MeEntryKey, string> = {
  courses: '全部教程', // 学习卡「全部教程」跳转链
  orders: '全部订单', // 我的订单卡「全部订单」跳转链
  aftersales: '售后', // 订单四格「售后」
  address: '收货地址', // 入口列各行
  activate: '输入激活码',
  feedback: '意见反馈',
  kefu: '联系客服',
  consent: '数据共享授权',
  about: '关于我们',
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
