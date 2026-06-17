import { COLLECTIONS } from '../../../kit'

/**
 * 客服分流引擎（避免幻觉第一·非生成式）：关键词识别 → 高亮 msgmenu 气泡分流；按回传 menu_id →
 * 下级菜单 / miniprogram 小程序卡片 / 文字答案 / 转人工。身份桥接（external_userid→openid）查「你的订单」。
 * 纯决策 + db 读：side effect（发消息/转人工）经注入的 send/transfer 回调，便于单测（根因#8）。
 *
 * ⚠️ 线上消息 wire 形状（msgmenu 点击回什么字段）以真机为准（根因#8）：normalize 同时兼容
 * text.menu_id（点击回传）与 text.content（自由打字），真机验证后按实际收口。
 */

// ── 关键词识别（确定性·低幻觉）：命中类别 + 被识别词 ──
const KEYWORDS: { cat: Category; words: string[] }[] = [
  { cat: 'logistics', words: ['物流', '快递', '发货', '没到', '到货', '运单', '单号', '收货'] },
  { cat: 'activation', words: ['激活码', '激活', '课程', '视频', '兑换', '观看', '看不了'] },
  { cat: 'aftersale', words: ['退款', '退货', '换货', '售后', '漏发', '坏了', '少了', '质量', '退', '换'] },
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

/**
 * 从客服消息 wire 取 external_userid（根因#8 真机字段位置·桩测过≠真机字段对）：text 消息在**顶层**
 * external_userid；event 消息（进会话 enter_session 等）在 **event 子对象**里。曾只取顶层 → event
 * 取到空 touser → send_msg 报 40058（不合法参数）。两处都经此函数取，杜绝再取错层。
 */
export function extUserId(msg: any): string {
  return String((msg && (msg.external_userid || (msg.event && msg.event.external_userid))) || '')
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

function menu(head: string, items: MenuItem[], tail = '或直接打字告诉我～'): MsgMenuContent {
  return {
    head_content: head,
    list: items.map((it) => ({ type: 'click' as const, click: { id: it.id, content: it.content } })),
    tail_content: tail,
  }
}

/** 首张菜单（无关键词命中 / 进会话）：五大入口。 */
export function rootMenu(): MsgMenuContent {
  return menu('想咨询什么？点一下快速定位 👇', [
    { id: 'cat:logistics', content: '📦 我的订单 / 物流' },
    { id: 'cat:activation', content: '🎬 激活码 / 课程 / 视频' },
    { id: 'cat:aftersale', content: '🔄 退换货 / 售后' },
    { id: 'cat:tutorial', content: '🧶 钩织教程' },
    { id: 'human', content: '🙋 其它 / 找人工' },
  ])
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
  // tutorial（探索线·P6 待研究）：先给课程入口 + 人工
  return menu(`看你在问「${word}」相关 👇`, [
    { id: 'course:open', content: '去看教程 / 课程' },
    { id: 'human', content: '转人工' },
  ])
}

// ── menu_id 路由 ──
export type Route =
  | { type: 'menu'; content: MsgMenuContent }
  | { type: 'text'; text: string }
  | { type: 'miniprogram'; page: string; title: string }
  | { type: 'order_query' }
  | { type: 'transfer' }

const TEXT_ANSWERS: Record<string, string> = {
  'logistics:eta': '现货商品付款后 48 小时内发货；预售商品以商品页标注为准。发出后可在「查我的订单 / 物流」看单号。',
  'addr:change': '未发货前可在小程序「我的订单 → 订单详情」修改收货地址；已发货请点「转人工」协助拦截。',
  'activation:howto': '收到的激活码在小程序「我的 → 课程 / 激活」页输入即可解锁；一码一用，激活后绑定本账号。',
  'aftersale:policy': '未使用且不影响二次销售可 7 天无理由退换；材料包拆封后如有质量问题（缺件/损坏）凭照片走售后。具体以商品页与售后页为准。',
}

export function route(menuId: string): Route {
  if (menuId === 'human') return { type: 'transfer' }
  if (menuId === 'order:query') return { type: 'order_query' }
  if (menuId === 'aftersale:apply') return { type: 'miniprogram', page: 'pages/aftersale/index', title: '申请售后' }
  if (menuId === 'course:open') return { type: 'miniprogram', page: 'pages/course/index', title: '我的课程' }
  if (menuId.startsWith('cat:')) {
    const cat = menuId.slice(4) as Category
    return { type: 'menu', content: menuFor(cat, '该分类') }
  }
  if (TEXT_ANSWERS[menuId]) return { type: 'text', text: TEXT_ANSWERS[menuId] }
  return { type: 'menu', content: rootMenu() }
}

// ── 身份桥接（external_userid → openid）+ 订单摘要 ──
/** 查映射表得 openid（不信前端·根因#3：映射由 kfBind 在小程序侧建）。未绑定返 null。 */
export async function resolveOpenid(db: any, externalUserId: string): Promise<string | null> {
  if (!externalUserId) return null
  const got = await db.collection(COLLECTIONS.kfIdentity).doc('ext:' + externalUserId).get().catch(() => null)
  return got && got.data && got.data.openid ? String(got.data.openid) : null
}

/** 会话内回「你的订单」摘要（实时查·零幻觉）：取最近 3 单状态。 */
export async function summarizeOrders(db: any, openid: string): Promise<string> {
  const r = await db
    .collection(COLLECTIONS.orders)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(3)
    .get()
    .catch(() => ({ data: [] }))
  const list = (r && r.data) || []
  if (!list.length) return '没查到你名下的订单。如果刚下单可稍后再试，或点「转人工」。'
  const STAT: Record<string, string> = { pending: '待支付', paid: '已支付/待发货', shipped: '已发货', done: '已完成', closed: '已关闭' }
  const lines = list.map((o: any) => `· 订单 ${o.id || o._id}：${STAT[o.status] || o.status}${o.trackingNo ? '（运单 ' + o.trackingNo + '）' : ''}`)
  return '你最近的订单：\n' + lines.join('\n') + '\n需要更多帮助点「转人工」。'
}

// ── 发送负载构造（touser + open_kfid + msgtype） ──
const base = (touser: string, openKfId: string) => ({ touser, open_kfid: openKfId })
export const buildText = (touser: string, openKfId: string, content: string) => ({
  ...base(touser, openKfId),
  msgtype: 'text',
  text: { content },
})
export const buildMsgMenu = (touser: string, openKfId: string, content: MsgMenuContent) => ({
  ...base(touser, openKfId),
  msgtype: 'msgmenu',
  msgmenu: content,
})
export const buildMiniprogram = (
  touser: string,
  openKfId: string,
  cfg: { appid: string; thumbMediaId: string },
  page: string,
  title: string
) => ({
  ...base(touser, openKfId),
  msgtype: 'miniprogram',
  miniprogram: { appid: cfg.appid, title, thumb_media_id: cfg.thumbMediaId, pagepath: page },
})

// ── 编排一条入站消息 ──
export interface Incoming {
  externalUserId: string
  menuId: string
  text: string
}
export interface DispatchCtx {
  db: any
  openKfId: string
  cfg: { appid: string; thumbMediaId: string }
  send: (payload: any) => Promise<any>
  transfer: (externalUserId: string) => Promise<any>
}

/** 处理单条入站消息：menu_id 优先按路由走，否则自由文本走关键词识别→高亮气泡。 */
export async function handleMessage(ctx: DispatchCtx, incoming: Incoming): Promise<void> {
  const { db, openKfId, cfg, send, transfer } = ctx
  const to = incoming.externalUserId

  const r: Route = incoming.menuId
    ? route(incoming.menuId)
    : (() => {
        const hit = recognize(incoming.text)
        return hit ? ({ type: 'menu', content: menuFor(hit.cat, hit.word) } as Route) : ({ type: 'menu', content: rootMenu() } as Route)
      })()

  switch (r.type) {
    case 'transfer':
      await transfer(to)
      return
    case 'text':
      await send(buildText(to, openKfId, r.text))
      return
    case 'menu':
      await send(buildMsgMenu(to, openKfId, r.content))
      return
    case 'miniprogram':
      await send(buildMiniprogram(to, openKfId, cfg, r.page, r.title))
      return
    case 'order_query': {
      const openid = await resolveOpenid(db, to)
      if (!openid) {
        await send(buildText(to, openKfId, '还没识别到你的小程序账号～请先在小程序里登录一次，之后我就能在这里帮你查订单。也可点「转人工」。'))
        return
      }
      await send(buildText(to, openKfId, await summarizeOrders(db, openid)))
      return
    }
  }
}
