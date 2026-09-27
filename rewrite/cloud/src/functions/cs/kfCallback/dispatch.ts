/**
 * 客服分流引擎（避免幻觉第一·非生成式）：关键词识别 → 高亮 msgmenu 气泡分流；按回传 menu_id →
 * 下级菜单 / miniprogram 小程序卡片 / 文字答案 / 转人工。身份桥接（external_userid→openid）查「你的订单」。
 * 纯决策 + db 读：side effect（发消息/转人工）经注入的 send/transfer 回调，便于单测（根因#8）。
 *
 * ⚠️ 线上消息 wire 形状（msgmenu 点击回什么字段）以真机为准（根因#8）：normalize 同时兼容
 * text.menu_id（点击回传）与 text.content（自由打字），真机验证后按实际收口。
 *
 * 本文件只做编排（一条消息走哪条路、回什么）；各路的实现在同目录 batch / menus / csat / customer / session。
 * 闸开时自由文本的回话由三块配合，分工不同、不能互相替代：
 * - scriptReply：Jev 分类 → 流程节点 → 从 cs-scripts 话术池抽句，决定对客说什么；
 * - csAtomic：只管包装破损，按 atomic-v1 序列拼原文气泡，scriptReply 认出包装破损时改用它的气泡；
 * - csPack：只记会话/交接账（triage 规则 → 状态机 → 交接包），不产对客文字。
 * 三块之间只有包装破损识别逐字等价（csAtomic 复用 csPack.looksPackagingDamage）；其余形似的几处
 * （looksLogistics / persistableFlow / stepBubbles / finalizeBubbles）口径不同，各在函数旁写了差异，勿合并。
 */
import { COLLECTIONS } from '@ldrw/shared'
import { readEpochForHandoff } from '../../../kit'
import { JEV_FAIL_OPEN_TEXT, loadJevGate, logJevEvidence, tryJevClassify, type JevResult } from './jev'
import { composeScriptReply, looksGreeting, wantsHuman } from './scriptReply'
import { interceptTrialRefresh } from './trialRefresh'
import { loadAndAdvancePack, readPackSession, writeHandoffStub } from './csPack'
import { sendBubbles } from './bubbles'
import { recognize, rootMenu, welcomeMenu, menuFor, type Category, type MsgMenuContent } from './menus'
import { CSAT_REASONS, attachCsatNote, csatReasonMenu, parseRate, rateMenu, recordCsat } from './csat'
import { kfUserHasRecentOrder, resolveOpenid, summarizeOrders } from './customer'
import { enqueueSession, heldStatus } from './session'
import { docData, dropKfState } from './store'

/**
 * 从客服消息 wire 取 external_userid（根因#8 真机字段位置·桩测过≠真机字段对）：text 消息在**顶层**
 * external_userid；event 消息（进会话 enter_session 等）在 **event 子对象**里。只取顶层的话 event
 * 取到空 touser → send_msg 报 40058（不合法参数）。两处都经此函数取，杜绝再取错层。
 */
export function extUserId(msg: any): string {
  return String((msg && (msg.external_userid || (msg.event && msg.event.external_userid))) || '')
}

// ── menu_id 路由 ──
type Route =
  | { type: 'menu'; content: MsgMenuContent }
  // faqKey：FAQ 叶子答案的键（=kb 文档 _id·同菜单叶子 menu_id）；答案由 handleMessage 从 kb 单源读
  // （不在本文件写死 FAQ 文案）。
  | { type: 'faq'; faqKey: string }
  // fallbackText：小程序卡片需封面素材(thumb_media_id)+已发布小程序，未配齐时降级为这段文字（防 40058·见下）
  | { type: 'miniprogram'; page: string; title: string; fallbackText: string }
  | { type: 'order_query' }
  | { type: 'transfer' }
  // CSAT：score=点选的 1-5 分；note=可选备注文案（预设标签映射后）
  | { type: 'csat'; score: number }
  | { type: 'csat_note'; note: string }
  | { type: 'text'; content: string; bubbles?: boolean; pieces?: string[] }

export function route(menuId: string): Route {
  if (menuId === 'human') return { type: 'transfer' }
  if (menuId === 'order:query') return { type: 'order_query' }
  if (menuId === 'aftersale:apply')
    return {
      type: 'miniprogram',
      // mp app.json 注册的路由（守卫 kf-card-page-registered 锁此处）：原生小程序注册的是 目录/同名文件
      page: 'pages/aftersales/aftersales',
      title: '申请售后',
      fallbackText: '申请售后请在小程序「我的 → 订单 → 申请售后」操作。需要我协助可点「转人工」。',
    }
  if (menuId === 'course:open')
    return {
      type: 'miniprogram',
      // mp 无分包、课程列表页为 my-courses（守卫锁同上）
      page: 'pages/my-courses/my-courses',
      title: '我的课程',
      fallbackText:
        '在小程序「我的 → 课程」即可观看已激活的课程。激活码相关点上方菜单，或点「转人工」。',
    }
  if (menuId.startsWith('cat:')) {
    const cat = menuId.slice(4) as Category
    return { type: 'menu', content: menuFor(cat, '该分类') }
  }
  // CSAT：评价入口 → 评分菜单；rate:N → 记分；csatnote:tag → 记可选备注（预设标签）
  if (menuId === 'csat') return { type: 'menu', content: rateMenu() }
  const score = parseRate(menuId)
  if (score) return { type: 'csat', score }
  if (menuId.startsWith('csatnote:')) {
    const tag = menuId.slice('csatnote:'.length)
    return { type: 'csat_note', note: CSAT_REASONS[tag] ?? '' }
  }
  // FAQ 叶子答案：键含「:」且非上述结构路由（人工/查单/卡片/分类/评分）→ 当作 kb FAQ 键，答案由 handleMessage
  // 从 kb 单源读；未含「:」的未知 id → 兜底回根菜单。
  if (menuId.includes(':')) return { type: 'faq', faqKey: menuId }
  return { type: 'menu', content: rootMenu() }
}

// ── 知识库 FAQ 答案（单源）──
/**
 * 从 kb 集合读 FAQ 答案（_id=faqKey·同菜单叶子 menu_id）。未命中 / 未启用（enabled:false）/ 无答案 → 返 null，
 * 调用方兜底回根菜单。**答案只在 kb、admin 经 adminApi listKb/saveKb 维护**——本文件不写死 FAQ 文案（根因#5 防漂移）。
 */
async function faqAnswer(db: any, faqKey: string): Promise<string | null> {
  if (!faqKey) return null
  const d = await docData(db, COLLECTIONS.kb, faqKey)
  if (!d || d.enabled === false) return null
  return d.answer ? String(d.answer) : null
}

// ── 发送负载构造（touser + open_kfid + msgtype） ──
const base = (touser: string, openKfId: string) => ({ touser, open_kfid: openKfId })
const buildText = (touser: string, openKfId: string, content: string) => ({
  ...base(touser, openKfId),
  msgtype: 'text',
  text: { content },
})
export const buildMsgMenu = (touser: string, openKfId: string, content: MsgMenuContent) => ({
  ...base(touser, openKfId),
  msgtype: 'msgmenu',
  msgmenu: content,
})
const buildMiniprogram = (
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
  /** 本条消息已读到的顾客 openid（'' = 已知未绑定）；不传则分流里按需读 kfIdentity。 */
  openid?: string
}

// 关单评分标记（CSAT 闭环）：closeConversation 发「回复 1-5 分」提示时立 `csatask:<euid>` 标记，
// 本文件收到纯数字 1-5 且标记在 48h 窗口内才记分——防顾客随口发的数字被误当评分（副作用绑提示·不裸吃数字）。
const CSAT_ASK_TTL_MS = 48 * 3600_000

// 关单评分闭环（CSAT_PROMPT「回复 1-5 分」的兑现）：自由文本纯数字 1-5 + 48h 内有 csatask 标记
// → 记分 + 消费标记 + 回可选原因菜单（与菜单评分路径同款收尾）。无标记/过期 → 返 false 落回正常分流（不误记）。
async function handleCsatScoreText(
  ctx: DispatchCtx,
  incoming: Incoming,
  openidOf: () => Promise<string | null>
): Promise<boolean> {
  if (incoming.menuId) return false
  const m = /^\s*([1-5])\s*$/.exec(incoming.text)
  if (!m) return false
  const { db, openKfId, send } = ctx
  const to = incoming.externalUserId
  const ask = await docData(db, COLLECTIONS.kfState, 'csatask:' + to)
  const askAt = ask && Number(ask.at)
  if (!(askAt && Date.now() - askAt < CSAT_ASK_TTL_MS)) return false
  await dropKfState(db, 'csatask:' + to)
  const openid = await openidOf()
  const csatId = await recordCsat(db, { externalUserId: to, openid, score: Number(m[1]) })
  if (!csatId) {
    await send(buildText(to, openKfId, '评分没记上，请稍后再评一次 🙏'))
    return true
  }
  await send(buildMsgMenu(to, openKfId, csatReasonMenu()))
  return true
}

const HUMAN_LADDER_EV: JevResult = { model: 'local-human', urgency: 0, department: 'sales' }
const GREET_EV: JevResult = { model: 'local-hello', urgency: 0, department: 'sales', needStatus: 'greeting' }

// 自由打字（无 menu_id）的分流。
// 闸开：自由文本一律 Jev + 话术库，旧关键词气泡不参与。挂了发短句，不回菜单。
// 闸关：今天的关键词/根菜单兜底，不打话术路径。
async function textRoute(ctx: DispatchCtx, incoming: Incoming): Promise<Route> {
  const { db } = ctx
  const gate = await loadJevGate(db)
  if (gate.on) {
    const textLen = String(incoming.text || '').length
    const human = wantsHuman(incoming.text)
    const hello = looksGreeting(incoming.text)
    // Jev 并行只为取证；人工/招呼选句不靠它。
    const evP = tryJevClassify(gate.key, incoming.text)
    const hasRecentOrder = await kfUserHasRecentOrder(db, incoming.externalUserId, ctx.openid)
    const useEv = human ? HUMAN_LADDER_EV : hello ? GREET_EV : await evP
    const got = useEv
      ? await composeScriptReply(db, incoming.externalUserId, incoming.text, useEv, { hasRecentOrder })
      : null
    const ev = await evP
    console.log('[kf] humanLadder', {
      matched: human,
      humanAsks: got ? got.humanAsks : null,
      node: got ? got.node : null,
      needStatus: ev && ev.needStatus ? ev.needStatus : null,
      ...(human && !got ? { compose: 'null' } : {}),
      stateLen: textLen,
    })
    if (human) {
      if (got && got.node === 'human') return { type: 'transfer' as const }
      if (got && got.text && (got.node === 'humanAsk' || got.node === 'humanAsk2'))
        return { type: 'text' as const, content: got.text, pieces: got.pieces }
      return { type: 'text' as const, content: '怎么了？😳' }
    }
    if (hello) {
      if (got && got.text && got.node !== 'askNext' && got.node !== 'askMore')
        return { type: 'text' as const, content: got.text, bubbles: true, pieces: got.pieces }
      return { type: 'text' as const, content: '在的在的，请说。' }
    }
    if (got && (got.node === 'human' || got.text)) {
      if (ev)
        logJevEvidence(ev, got.topic, {
          stateLen: textLen,
          node: got.node,
          topic: got.topic,
          acting: got.acting,
          checkpoint: got.checkpoint,
        })
      return got.node === 'human'
        ? { type: 'transfer' as const }
        : { type: 'text' as const, content: got.text, bubbles: true, pieces: got.pieces }
    }
    if (ev) logJevEvidence(ev, null, { stateLen: textLen })
    return { type: 'text' as const, content: JEV_FAIL_OPEN_TEXT }
  }
  const hit = recognize(incoming.text)
  return hit
    ? ({ type: 'menu', content: menuFor(hit.cat, hit.word) } as Route)
    : ({ type: 'menu', content: await welcomeMenu(db) } as Route)
}

/** 处理单条入站消息：menu_id 优先按路由走，否则自由文本走关键词识别→高亮气泡。 */
export async function handleMessage(ctx: DispatchCtx, incoming: Incoming): Promise<void> {
  const { db, openKfId, cfg, send } = ctx
  const to = incoming.externalUserId
  const openidOf = async () => ctx.openid ?? (await resolveOpenid(db, to))

  // 测版刷新：闸开时口令/按钮拦在 Jev、关键词、人工让位之前（人工接待中默认拒刷）。
  if (await interceptTrialRefresh(db, incoming, openKfId, send)) return

  // 人工接管时 bot 不抢话（平台态恒 1 后「谁在接待」由**我方** csSession 状态机判·非平台 service_state）：
  // pending/active/escalated＝排队中/坐席接待中/待商户——bot 静默（消息仍归档+身份桥接在 index 侧不受影响·坐席经
  // getThread 看到顾客新消息）；closed/无会话＝bot 正常应答。
  // **例外：顾客明确再点「找人工」不许装死**（闸太宽会把求人工也吞了）——回一句当前状态、不重复入队。
  const hs = await heldStatus(db, openKfId, to)
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

  if (await handleCsatScoreText(ctx, incoming, openidOf)) return

  const r: Route = incoming.menuId ? route(incoming.menuId) : await textRoute(ctx, incoming)

  switch (r.type) {
    case 'transfer': {
      // 转人工 = 会话进**自建工作台**待接队列（pending·幂等·坐席台 listQueue 读它）+ 给顾客文字确认。
      // **不动平台 service_state**（根因#12）：坐席回复走
      // send_msg API、仅智能助手态(1)可发——调 transferToServicer 转 3（原生接待台模式）会让坐席发送
      // 全被 95018 拒。人工排队/认领/结束由 csSession 状态机管，平台侧全程留 1。
      let pack = await readPackSession(db, to)
      if (pack.state !== 'human') {
        pack = (await loadAndAdvancePack(db, to, null, incoming.text, { toHuman: true, userAsksHuman: true })).session
      }
      const epoch = await readEpochForHandoff(db, to)
      await writeHandoffStub(db, to, {
        intent: pack.intent || 'unknown',
        filledSlots: pack.slots,
        summary: String(incoming.text || incoming.menuId || 'human').slice(0, 160),
        failReason: 'user_asks_human',
        epoch,
      })
      const q = await enqueueSession(db, openKfId, to)
      // 基建错入队失败＝如实提示重试，不发假「已转接」（会话没进队列·无人会接）
      await send(
        buildText(
          to,
          openKfId,
          q === 'failed'
            ? '转接人工时遇到点问题，请稍后再点一次「找人工」🙏 也可以先把问题描述在这里。'
            : '已为你转接人工客服～工作人员会尽快在这里回复你。你也可以先把问题描述清楚，方便更快处理 🙇'
        )
      )
      return
    }
    case 'faq': {
      // FAQ 答案从 kb 单源读；kb 无此条/未启用 → 兜底回根菜单（不写死答案）
      const ans = await faqAnswer(db, r.faqKey)
      if (ans) await send(buildText(to, openKfId, ans))
      else await send(buildMsgMenu(to, openKfId, await welcomeMenu(db)))
      return
    }
    case 'menu':
      await send(buildMsgMenu(to, openKfId, r.content))
      return
    case 'text':
      if (r.pieces && r.pieces.length)
        await sendBubbles(send, (content) => buildText(to, openKfId, content), r.pieces, { raw: true })
      else if (r.bubbles)
        await sendBubbles(send, (content) => buildText(to, openKfId, content), r.content)
      else await send(buildText(to, openKfId, r.content))
      return
    case 'miniprogram':
      // 卡片需 appid + 封面素材都齐才发；缺任一即降级文字（防 thumb 空致 send_msg 40058）
      if (cfg.appid && cfg.thumbMediaId)
        await send(buildMiniprogram(to, openKfId, cfg, r.page, r.title))
      else await send(buildText(to, openKfId, r.fallbackText))
      return
    case 'order_query': {
      const openid = await openidOf()
      if (!openid) {
        await send(
          buildText(
            to,
            openKfId,
            '还没识别到你的小程序账号～请先在小程序里登录一次，之后我就能在这里帮你查订单。也可点「转人工」。'
          )
        )
        return
      }
      await send(buildText(to, openKfId, await summarizeOrders(db, openid)))
      return
    }
    case 'csat': {
      // 记分（fail-closed 校验 1..5·绑 openid 若可解析）→ 再问可选备注；写失败如实告知不发菜单
      const openid = await openidOf()
      const csatId = await recordCsat(db, { externalUserId: to, openid, score: r.score })
      if (!csatId) {
        await send(buildText(to, openKfId, '评分没记上，请稍后再评一次 🙏'))
        return
      }
      await send(buildMsgMenu(to, openKfId, csatReasonMenu()))
      return
    }
    case 'csat_note': {
      // 备注预设标签回写最近一条；选「不补充」则清最近标记。一律谢一句收尾。
      if (r.note) await attachCsatNote(db, to, r.note)
      else await dropKfState(db, 'csatlast:' + to)
      await send(buildText(to, openKfId, '谢谢你的反馈，我们会继续改进 🙏'))
      return
    }
  }
}
