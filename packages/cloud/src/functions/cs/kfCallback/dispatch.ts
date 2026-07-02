import { COLLECTIONS, alert, transition, sendAgentCard, AGENT_DESK_URL } from '../../../kit'

/**
 * 客服分流引擎（避免幻觉第一·非生成式）：关键词识别 → 高亮 msgmenu 气泡分流；按回传 menu_id →
 * 下级菜单 / miniprogram 小程序卡片 / 文字答案 / 转人工。身份桥接（external_userid→openid）查「你的订单」。
 * 纯决策 + db 读：side effect（发消息/转人工）经注入的 send/transfer 回调，便于单测（根因#8）。
 *
 * ⚠️ 线上消息 wire 形状（msgmenu 点击回什么字段）以真机为准（根因#8）：normalize 同时兼容
 * text.menu_id（点击回传）与 text.content（自由打字），真机验证后按实际收口。
 */

// ── 一批消息处理：去重认领 + 防吞单（审计 P2） ──

/**
 * 原子认领去重（确定性 _id 撞号即已处理过·根因#1 幂等）。三态（外审 R1-R4·P1.4·根因#8）：
 * - `first`：本次认领成功（首见）→ 处理；
 * - `duplicate`：撞号·真重复（已认领过）→ 跳过安全；
 * - `error`：add 因基建失败（DB 权限/集合缺/瞬时）→ **绝不可当重复静默跳过**（会无回复、无告警、不重试＝永久吞消息）。
 *
 * 旧实现把 add 的任何异常都返 false（=已处理·跳过），基建错也被当重复 → 真实客服消息静默丢失。改为 add 失败后
 * **回查该 seen 文档是否真存在**：存在＝真撞号（duplicate）；不存在＝add 没写进去（基建错·error），消息未认领须重试。
 */
export type ClaimResult = 'first' | 'duplicate' | 'error'
export async function firstSeen(db: any, msgid: string): Promise<ClaimResult> {
  try {
    await db.collection(COLLECTIONS.kfState).add({ data: { _id: 'seen:' + msgid, at: Date.now() } })
    return 'first'
  } catch {
    const got = await db.collection(COLLECTIONS.kfState).doc('seen:' + msgid).get().catch(() => null)
    return got && got.data ? 'duplicate' : 'error'
  }
}

/**
 * 逐条处理一批客服消息（防吞单·审计 P2）：① 原子认领去重（撞号跳过）② 每条包 try/catch——
 * 单条失败**不再中断整批**（原来 handleMessage 抛错会 unwind 整个 sync 循环：游标不推进 +
 * 已认领的消息永久跳过 = 静默吞掉顾客消息）；失败时 **撤回认领 + alert HANDLE_FAILED**，并返回
 * anyFailed。调用方据 anyFailed **保留旧游标**下次重拉：成功项 seen 去重、失败项重试——顾客消息
 * 至少处理一次，不再因一次崩溃/超时永久丢。（抛错路径均为瞬时：DB/网络；send errcode 不抛·已自 alert。）
 */
export async function processKfBatch(
  db: any,
  msgs: any[],
  handleOne: (msg: any) => Promise<void>
): Promise<boolean> {
  let anyFailed = false
  for (const msg of msgs || []) {
    const msgid = String((msg && msg.msgid) || '')
    if (msgid) {
      const claim = await firstSeen(db, msgid)
      if (claim === 'duplicate') continue // 真重复·已处理过·跳过安全
      if (claim === 'error') {
        // 认领基础设施错误（DB 权限/集合缺/瞬时）：告警 + 本批失败 → 调用方保留旧游标重试，绝不静默跳过吞消息（外审 P1.4）
        console.error('[kf] claim failed (infra)', { msgid })
        alert('security', 'kfCallback', 'CLAIM_FAILED', {})
        anyFailed = true
        continue // 未认领成功就不处理，留待下次重拉重认领（避免无认领下重复副作用）
      }
    }
    try {
      await handleOne(msg)
    } catch (e) {
      console.error('[kf] handle threw', { msgid }, String(e))
      alert('security', 'kfCallback', 'HANDLE_FAILED', {})
      // 撤回认领 → 不永久吞单（配合调用方保留旧游标重试）
      if (msgid) await db.collection(COLLECTIONS.kfState).doc('seen:' + msgid).remove().catch(() => {})
      anyFailed = true
    }
  }
  return anyFailed
}

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

/** 首张菜单（无关键词命中 / 进会话）：四大入口 + 评价服务（B4.3）+ 找人工。 */
export function rootMenu(): MsgMenuContent {
  return menu('想咨询什么？点一下快速定位 👇', [
    { id: 'cat:logistics', content: '📦 我的订单 / 物流' },
    { id: 'cat:activation', content: '🎬 激活码 / 课程 / 视频' },
    { id: 'cat:aftersale', content: '🔄 退换货 / 售后' },
    { id: 'cat:tutorial', content: '🧶 钩织教程' },
    { id: 'csat', content: '⭐ 评价服务' },
    { id: 'human', content: '🙋 其它 / 找人工' },
  ])
}

// ── 满意度评分（CSAT·B4.3·会话后评分 1-5 + 可选备注·确定性菜单不靠生成）──
/** 评分气泡：5 档星级（点一下即评分·rate:1..5）。 */
export function rateMenu(): MsgMenuContent {
  return menu(
    '给本次服务打个分吧（点一下）👇',
    [
      { id: 'rate:5', content: '⭐⭐⭐⭐⭐ 非常满意' },
      { id: 'rate:4', content: '⭐⭐⭐⭐ 满意' },
      { id: 'rate:3', content: '⭐⭐⭐ 一般' },
      { id: 'rate:2', content: '⭐⭐ 不太满意' },
      { id: 'rate:1', content: '⭐ 很不满意' },
    ],
    '点星星即可，感谢你的反馈～'
  )
}

// 备注预设标签（可选·deterministic·避免自由文本进热路径）：值＝入库备注文案，'none'＝不补充（空备注）。
const CSAT_REASONS: Record<string, string> = {
  resolved: '问题已解决',
  unresolved: '问题没解决',
  slow: '回复有点慢',
  attitude: '态度很好',
  none: '',
}

/** 评分后的「补充原因」气泡（可选备注·点一下即记·不补充也行）。 */
function csatReasonMenu(): MsgMenuContent {
  return menu(
    '想补充点什么吗？（可选）',
    [
      { id: 'csatnote:resolved', content: '问题已解决' },
      { id: 'csatnote:unresolved', content: '问题没解决' },
      { id: 'csatnote:slow', content: '回复有点慢' },
      { id: 'csatnote:attitude', content: '态度很好' },
      { id: 'csatnote:none', content: '不补充了' },
    ],
    '点一下就好，不补充也没关系～'
  )
}

/** 解析评分 menu_id（rate:1..5）→ 分数；非法返 null（route 据此分流·入库再 fail-closed 校验一次）。 */
export function parseRate(menuId: string): number | null {
  const m = /^rate:([1-5])$/.exec(String(menuId || ''))
  return m ? Number(m[1]) : null
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
  // faqKey：FAQ 叶子答案的键（=kb 文档 _id·同菜单叶子 menu_id）；答案由 handleMessage 从 kb 单源读
  // （B4.1·守卫 faq-via-kb-single-source·不再在本文件写死 FAQ 文案）。
  | { type: 'faq'; faqKey: string }
  // fallbackText：小程序卡片需封面素材(thumb_media_id)+已发布小程序，未配齐时降级为这段文字（防 40058·见下）
  | { type: 'miniprogram'; page: string; title: string; fallbackText: string }
  | { type: 'order_query' }
  | { type: 'transfer' }
  // CSAT（B4.3）：score=点选的 1-5 分；note=可选备注文案（预设标签映射后）
  | { type: 'csat'; score: number }
  | { type: 'csat_note'; note: string }

export function route(menuId: string): Route {
  if (menuId === 'human') return { type: 'transfer' }
  if (menuId === 'order:query') return { type: 'order_query' }
  if (menuId === 'aftersale:apply')
    return {
      type: 'miniprogram',
      page: 'pages/aftersales/index', // pages.json 注册名带 s（外审 P2.11·kf-card-page-registered 守卫锁）
      title: '申请售后',
      fallbackText: '申请售后请在小程序「我的 → 订单 → 申请售后」操作。需要我协助可点「转人工」。',
    }
  if (menuId === 'course:open')
    return {
      type: 'miniprogram',
      page: 'pkg-video/courses/index', // 课程页在 pkg-video 分包（外审 P2.11·守卫锁须为已注册路由）
      title: '我的课程',
      fallbackText: '在小程序「我的 → 课程」即可观看已激活的课程。激活码相关点上方菜单，或点「转人工」。',
    }
  if (menuId.startsWith('cat:')) {
    const cat = menuId.slice(4) as Category
    return { type: 'menu', content: menuFor(cat, '该分类') }
  }
  // CSAT（B4.3）：评价入口 → 评分菜单；rate:N → 记分；csatnote:tag → 记可选备注（预设标签）
  if (menuId === 'csat') return { type: 'menu', content: rateMenu() }
  const score = parseRate(menuId)
  if (score) return { type: 'csat', score }
  if (menuId.startsWith('csatnote:')) {
    const tag = menuId.slice('csatnote:'.length)
    return { type: 'csat_note', note: CSAT_REASONS[tag] ?? '' }
  }
  // FAQ 叶子答案：键含「:」且非上述结构路由（人工/查单/卡片/分类/评分）→ 当作 kb FAQ 键，答案由 handleMessage
  // 从 kb 单源读（B4.1）；未含「:」的未知 id → 兜底回根菜单（与原行为一致）。
  if (menuId.includes(':')) return { type: 'faq', faqKey: menuId }
  return { type: 'menu', content: rootMenu() }
}

// ── 知识库 FAQ 答案（单源·B4.1·守卫 faq-via-kb-single-source）──
/**
 * 从 kb 集合读 FAQ 答案（_id=faqKey·同菜单叶子 menu_id）。未命中 / 未启用（enabled:false）/ 无答案 → 返 null，
 * 调用方兜底回根菜单。**答案只在 kb、admin 经 adminApi listKb/saveKb 维护**——本文件不再写死 FAQ 文案（根因#5 防漂移）。
 */
export async function faqAnswer(db: any, faqKey: string): Promise<string | null> {
  if (!faqKey) return null
  const got = await db.collection(COLLECTIONS.kb).doc(faqKey).get().catch(() => null)
  const d = got && got.data
  if (!d || d.enabled === false) return null
  return d.answer ? String(d.answer) : null
}

// ── 满意度评分入库（CSAT·B4.3·守卫 csat-score-bounded）──
export interface CsatInput {
  externalUserId: string
  openid: string | null
  score: number
  note?: string
}
/**
 * 记一条满意度评分（B4.3）。**不信前端·根因#3**：score 越界（非 1..5）一律 fail-closed 不入库——防伪造/脏分
 * 污染满意度均分（守卫 csat-score-bounded）。确定性 _id=`csat:<euid>:<createdAt>`；并在 kfState 记最近一条
 * （`csatlast:<euid>`）供「补充备注」菜单回写——只在 CSAT 交互时读写、不进每条消息热路径。返回 csat 文档 id。
 */
export async function recordCsat(db: any, input: CsatInput): Promise<string | null> {
  const score = Number(input.score)
  if (!(score >= 1 && score <= 5)) return null // 越界分不入库（fail-closed）
  const euid = String(input.externalUserId || '')
  if (!euid) return null
  const createdAt = Date.now()
  const id = 'csat:' + euid + ':' + createdAt
  await db
    .collection(COLLECTIONS.csat)
    .doc(id)
    .set({
      data: {
        externalUserId: euid,
        openid: input.openid || null,
        score,
        note: String(input.note || '').slice(0, 200),
        createdAt,
      },
    })
    .catch(() => {})
  await db
    .collection(COLLECTIONS.kfState)
    .doc('csatlast:' + euid)
    .set({ data: { csatId: id, at: createdAt } })
    .catch(() => {})
  return id
}

/** 回写最近一条满意度的备注（B4.3·点「补充原因」预设标签时·非热路径）。无最近记录则静默跳过。 */
export async function attachCsatNote(db: any, externalUserId: string, note: string): Promise<void> {
  const euid = String(externalUserId || '')
  if (!euid || !note) return
  const got = await db.collection(COLLECTIONS.kfState).doc('csatlast:' + euid).get().catch(() => null)
  const csatId = got && got.data && got.data.csatId
  if (!csatId) return
  await db.collection(COLLECTIONS.csat).doc(csatId).update({ data: { note: String(note).slice(0, 200) } }).catch(() => {})
  await db.collection(COLLECTIONS.kfState).doc('csatlast:' + euid).remove().catch(() => {})
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
  // 运单号在 shipping 子对象（发货时 adminApi 写 shipping:{company,trackingNo}）——曾错取顶层 o.trackingNo→永远显示不出（外审 P2.19·根因#8）
  const lines = list.map((o: any) => {
    const tracking = o.shipping && o.shipping.trackingNo
    return `· 订单 ${o.id || o._id}：${STAT[o.status] || o.status}${tracking ? '（运单 ' + tracking + '）' : ''}`
  })
  return '你最近的订单：\n' + lines.join('\n') + '\n需要更多帮助点「转人工」。'
}

// ── 承面 C 会话入队（M0.c·让 csSession 有真实 writer·会话进自建工作台待接队列）──
/**
 * 转人工时把这通会话写入 csSession 待接队列（承面 C 坐席台 `listQueue` 读它·阶段0地基）。
 * 确定性 _id=`wxkf:<openKfId>:<externalUserId>`（一顾客一活会话）：用 `add`——撞 id 即会话已在队列
 * （pending/active/…）→ 抛错被吞 → **不 clobber**（坐席已认领的 active 不被顾客再点转人工重置回 pending·根因#1 幂等）。
 * 创建于**初始态 pending**（cs.spec.ts `initial`）——非 `transition()`（状态流转 claim/close/escalate 是坐席台 action·车道 A）。
 * best-effort：入队失败不反噬顾客回复/平台转接（同 ensureKfIdentity）。closed 会话重开为新 pending 属会话生命周期（车道 A）。
 */
export async function enqueueSession(db: any, openKfId: string, externalUserId: string): Promise<void> {
  const euid = String(externalUserId || '')
  if (!euid || !openKfId) return // 不造无主会话
  const now = Date.now()
  const id = 'wxkf:' + openKfId + ':' + euid
  let queued = false // 真正新入队（首建 or closed 重开）才推送——已在 pending/active 的不重复骚扰坐席
  try {
    await db.collection(COLLECTIONS.csSession).add({
      data: { _id: id, status: 'pending', externalUserId: euid, openKfId, createdAt: now, updatedAt: now },
    })
    queued = true
  } catch {
    // 撞确定性 _id＝该顾客已有会话 doc：pending/active/escalated 不动（不 clobber·坐席已认领的不被重置·根因#1）；
    // **closed 则重开**（closed→pending·声明流转 cs.spec.ts·原子：非 closed 时 moved=false 天然不 clobber）——
    // 老客二次点「找人工」曾被此撞 id 静默吞、永进不了队列（2026-07-02 真机逼出·调试日志 AD）。
    // createdAt 刷新＝重新排队（FIFO 队尾）+ getThread 消息流从重开起算（不翻旧会话历史）。
    const r = await transition('csSession', id, ['closed'], 'pending', {
      agentId: null,
      claimedAt: null,
      createdAt: now,
      updatedAt: now,
    }).catch(() => ({ moved: false })) /* best-effort：不反噬顾客回复 */
    queued = !!(r && (r as any).moved)
  }
  if (queued) await notifyOnlineAgents(db, id) // M⑦ 推送线·fail-soft（sendAgentCard 内吞错·不反噬入队）
}

// 新会话入队 → 推「新会话待接」到在线坐席手机（M⑦ 承面C 增强·推送线·fail-soft）。
// 在线坐席＝agentState.status='online'；其 wecomUserId 从 adminConfig 同 _id doc 取（坐席账号加的字段·M⑦ 地基）。
// 全程 fail-soft（sendAgentCard 内吞错·此处 try/catch 兜查询）：推送失败绝不反噬顾客转人工入队（守卫 enqueue-push-fail-soft）。
async function notifyOnlineAgents(db: any, sessionId: string): Promise<void> {
  try {
    const st = await db.collection(COLLECTIONS.agentState).where({ status: 'online' }).get().catch(() => ({ data: [] }))
    const ids = (st.data || []).map((a: any) => a._id).filter(Boolean)
    if (!ids.length) return
    const touser: string[] = []
    for (const id of ids) {
      const g = await db.collection('adminConfig').doc(id).get().catch(() => null)
      const uid = g && g.data && g.data.wecomUserId
      if (uid) touser.push(String(uid))
    }
    await sendAgentCard(db, touser, {
      title: '新会话待接',
      description: '有顾客转入人工客服，请及时到工作台接待。',
      url: AGENT_DESK_URL + '?session=' + sessionId,
    })
  } catch {
    /* fail-soft：推送不反噬转人工入队 */
  }
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
}

/** 处理单条入站消息：menu_id 优先按路由走，否则自由文本走关键词识别→高亮气泡。 */
export async function handleMessage(ctx: DispatchCtx, incoming: Incoming): Promise<void> {
  const { db, openKfId, cfg, send } = ctx
  const to = incoming.externalUserId

  // 人工接管时 bot 不抢话（平台态恒 1 后「谁在接待」由**我方** csSession 状态机判·非平台 service_state·调试日志 AC）：
  // pending/active/escalated＝排队中/坐席接待中/待商户——bot 静默（消息仍归档+身份桥接在 index 侧不受影响·坐席经
  // getThread 看到顾客新消息）；closed/无会话＝bot 正常应答。曾靠平台 state 3 让 bot 让位（AB），随转 3 退役改此判。
  // **例外：顾客明确再点「找人工」不许装死**（调试日志 AD·闸太宽把求人工也吞了）——回一句当前状态、不重复入队。
  const held = await db.collection(COLLECTIONS.csSession).doc('wxkf:' + openKfId + ':' + to).get().catch(() => null)
  const hs = held && held.data && held.data.status
  if (hs === 'pending' || hs === 'active' || hs === 'escalated') {
    if (incoming.menuId && route(incoming.menuId).type === 'transfer') {
      await send(
        buildText(
          to,
          openKfId,
          hs === 'active'
            ? '人工客服正在为你服务中～直接留言即可，客服都能看到 🙌'
            : '你已在人工队列中，客服会尽快接入～有补充可以直接留言，接入后都能看到 🙌'
        )
      )
    }
    return
  }

  const r: Route = incoming.menuId
    ? route(incoming.menuId)
    : (() => {
        const hit = recognize(incoming.text)
        return hit ? ({ type: 'menu', content: menuFor(hit.cat, hit.word) } as Route) : ({ type: 'menu', content: rootMenu() } as Route)
      })()

  switch (r.type) {
    case 'transfer':
      // 承面 C：转人工 = 会话进**自建工作台**待接队列（pending·幂等·坐席台 listQueue 读它）+ 给顾客文字确认。
      // **不动平台 service_state**（守卫 agent-channel-stays-assistant·根因#12·调试日志 AC）：坐席回复走
      // send_msg API、仅智能助手态(1)可发——曾在此调 transferToServicer 转 3（原生接待台模式）致坐席发送
      // 全被 95018 拒（2026-07-02 真机逼出）。人工排队/认领/结束由 csSession 状态机管，平台侧全程留 1。
      await enqueueSession(db, openKfId, to)
      await send(
        buildText(to, openKfId, '已为你转接人工客服～工作人员会尽快在这里回复你。你也可以先把问题描述清楚，方便更快处理 🙇')
      )
      return
    case 'faq': {
      // FAQ 答案从 kb 单源读（B4.1·守卫 faq-via-kb-single-source）；kb 无此条/未启用 → 兜底回根菜单（不写死答案）
      const ans = await faqAnswer(db, r.faqKey)
      if (ans) await send(buildText(to, openKfId, ans))
      else await send(buildMsgMenu(to, openKfId, rootMenu()))
      return
    }
    case 'menu':
      await send(buildMsgMenu(to, openKfId, r.content))
      return
    case 'miniprogram':
      // 卡片需 appid + 封面素材都齐才发；缺任一即降级文字（防 thumb 空致 send_msg 40058）
      if (cfg.appid && cfg.thumbMediaId) await send(buildMiniprogram(to, openKfId, cfg, r.page, r.title))
      else await send(buildText(to, openKfId, r.fallbackText))
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
    case 'csat': {
      // 记分（fail-closed 校验 1..5·绑 openid 若可解析）→ 再问可选备注（B4.3）
      const openid = await resolveOpenid(db, to)
      await recordCsat(db, { externalUserId: to, openid, score: r.score })
      await send(buildMsgMenu(to, openKfId, csatReasonMenu()))
      return
    }
    case 'csat_note': {
      // 备注预设标签回写最近一条；选「不补充」则清最近标记。一律谢一句收尾。
      if (r.note) await attachCsatNote(db, to, r.note)
      else await db.collection(COLLECTIONS.kfState).doc('csatlast:' + to).remove().catch(() => {})
      await send(buildText(to, openKfId, '谢谢你的反馈，我们会继续改进 🙏'))
      return
    }
  }
}
