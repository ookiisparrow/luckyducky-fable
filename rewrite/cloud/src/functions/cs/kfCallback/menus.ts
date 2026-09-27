import { loadTrialRefreshGate } from '../../../kit'
import { REFRESH_BTN_LABEL, REFRESH_MENU_ASK } from './trialRefresh'

// ── 关键词识别（确定性·低幻觉）：命中类别 + 被识别词 ──
const KEYWORDS: { cat: Category; words: string[] }[] = [
  { cat: 'logistics', words: ['物流', '快递', '发货', '没到', '到货', '运单', '单号', '收货'] },
  { cat: 'activation', words: ['激活码', '激活', '课程', '视频', '兑换', '观看', '看不了'] },
  {
    cat: 'aftersale',
    words: ['退款', '退货', '换货', '售后', '漏发', '坏了', '少了', '质量', '退', '换'],
  },
  { cat: 'tutorial', words: ['教程', '钩织', '针法', '图解', '怎么钩', '教学'] },
]
export type Category = 'logistics' | 'activation' | 'aftersale' | 'tutorial'

/** 识别自由文本命中的类别 + 命中词（无命中返 null）。 */
export function recognize(text: string): { cat: Category; word: string } | null {
  const t = String(text || '')
  for (const g of KEYWORDS) {
    const hit = g.words.find((w) => t.includes(w))
    if (hit) return { cat: g.cat, word: hit }
  }
  return null
}

// ── msgmenu 内容（head 高亮识别词 + list 高亮可点选项 + tail「或直接打字」） ──
interface MenuItem {
  id: string
  content: string
}
export interface MsgMenuContent {
  head_content: string
  list: { type: 'click'; click: { id: string; content: string } }[]
  tail_content: string
}

export function menu(head: string, items: MenuItem[], tail = '或直接打字告诉我～'): MsgMenuContent {
  return {
    head_content: head,
    list: items.map((it) => ({
      type: 'click' as const,
      click: { id: it.id, content: it.content },
    })),
    tail_content: tail,
  }
}

/** 首张菜单（无关键词命中 / 进会话）：四大入口 + 评价服务 + 找人工。测版可多一颗刷新按钮。 */
export function rootMenu(opts?: { trialRefresh?: boolean }): MsgMenuContent {
  const items: MenuItem[] = [
    { id: 'cat:logistics', content: '📦 我的订单 / 物流' },
    { id: 'cat:activation', content: '🎬 激活码 / 课程 / 视频' },
    { id: 'cat:aftersale', content: '🔄 退换货 / 售后' },
    { id: 'cat:tutorial', content: '🧶 钩织教程' },
    { id: 'csat', content: '⭐ 评价服务' },
    { id: 'human', content: '🙋 其它 / 找人工' },
  ]
  if (opts && opts.trialRefresh) items.push({ id: REFRESH_MENU_ASK, content: REFRESH_BTN_LABEL })
  return menu('想咨询什么？点一下快速定位 👇', items)
}

export async function welcomeMenu(db: any): Promise<MsgMenuContent> {
  const gate = await loadTrialRefreshGate(db)
  return rootMenu({ trialRefresh: gate.on })
}

/** 命中关键词后的高亮气泡：head 点出识别词，list 是贴问题的下级选项。 */
export function menuFor(cat: Category, word: string): MsgMenuContent {
  if (cat === 'logistics')
    return menu(`看你在问「${word}」相关 👇`, [
      { id: 'order:query', content: '查我的订单 / 物流' },
      { id: 'logistics:eta', content: '多久发货' },
      { id: 'addr:change', content: '改收货地址' },
      { id: 'human', content: '转人工' },
    ])
  if (cat === 'activation')
    return menu(`看你在问「${word}」相关 👇`, [
      { id: 'activation:howto', content: '激活码怎么用' },
      { id: 'course:open', content: '去看我的课程' },
      { id: 'human', content: '转人工' },
    ])
  if (cat === 'aftersale')
    return menu(`看你在问「${word}」相关 👇`, [
      { id: 'aftersale:policy', content: '退换政策' },
      { id: 'aftersale:apply', content: '去申请售后' },
      { id: 'human', content: '转人工（承诺/纠纷）' },
    ])
  // tutorial（探索线）：先给课程入口 + 人工
  return menu(`看你在问「${word}」相关 👇`, [
    { id: 'course:open', content: '去看教程 / 课程' },
    { id: 'human', content: '转人工' },
  ])
}
