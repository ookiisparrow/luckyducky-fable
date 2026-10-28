import { COLLECTIONS } from '@ldrw/shared'

/**
 * 客服会话归档（外包管控底座）。一会话消息一文档落 conversations 集合，
 * 供坐席检索（adminApi.searchConversations）+ 质检取证。挂点在 kfCallback/index.ts
 *（入站/出站都落档·不悄悄摘）。
 *
 * 设计：
 *  - **入站**（客户消息）确定性 `_id='wxkf:in:<msgid>'`——同 seen 去重幂等：重拉/重投同 msgid 不重复入库（add 撞号即 no-op）。
 *  - **出站**（机器人自动回复·经 index.ts send 收口）`_id` 自动；批失败重拉时入站已 seen 去重→handleOne 不重跑→不重发→不重档。
 *  - **fail-soft 铁律**：归档绝不抛错（try/catch 吞）——归档失败不得反噬消息处理（不致 anyFailed→不致吞单·根因#3 旁路）。
 *  - **解耦**（架构规范铁律二）：不 import dispatch.ts；external_userid 取法与 openid 解析各自内联
 *    （都是 1 行读·非投机抽象·避免跨板块伸手）。
 *  - **PII**：会话全文含个人信息·协议页已声明；检索侧能力闸 + 留痕（根因#3）。
 *  - 坐席人工回复由 adminApi agentDesk 按同一口径落档；channel 字段区分渠道。
 */

const CHANNEL_WXKF = 'wxkf'

// external_userid 取法（与 dispatch.extUserId 同口径·此处内联避免跨板块 import·根因#8 真机字段位置）：
// text 消息在顶层，event 消息在 event 子对象。
function msgEuid(msg: any): string {
  return String((msg && (msg.external_userid || (msg.event && msg.event.external_userid))) || '')
}

// 身份桥接（external_userid→openid·kfBind 建的映射·不信前端·根因#3）。best-effort：未绑定/读失败返 ''
// （仍按 externalUserId 可检索）。内联 1 行读·不依赖 dispatch.resolveOpenid（解耦·铁律二）。
async function resolveOpenidBestEffort(db: any, euid: string): Promise<string> {
  if (!euid) return ''
  const got = await db.collection(COLLECTIONS.kfIdentity).doc('ext:' + euid).get().catch(() => null)
  return got && got.data && got.data.openid ? String(got.data.openid) : ''
}

/** 入站客户文本消息的可检索文本（非文本类回退占位·检索按关键词命中 text）。 */
function incomingText(msg: any): string {
  if (msg && msg.msgtype === 'text') return String((msg.text && msg.text.content) || '')
  return '[' + String((msg && msg.msgtype) || 'unknown') + ']'
}

/**
 * 图片消息的 media_id（企业微信客服 image 消息体：`image.media_id`）。回调不下载媒体（回调要快、
 * fail-soft）——只落 mediaId，下载延迟到坐席台首次请求（adminApi getMediaUrl 经 kit/wecom.ts kfFetchMedia
 * 直连拉取）。
 * 非 image 消息返 ''（无媒体·getThread hasMedia 据此判定）。
 */
function msgMediaId(msg: any): string {
  return String((msg && msg.msgtype === 'image' && msg.image && msg.image.media_id) || '')
}

/** 出站回复负载的可检索文本（text/msgmenu/miniprogram 各取人话·供质检与关键词检索）。 */
export function payloadText(payload: any): string {
  if (!payload) return ''
  if (payload.msgtype === 'text') return String((payload.text && payload.text.content) || '')
  if (payload.msgtype === 'msgmenu') {
    const m = payload.msgmenu || {}
    const items = (Array.isArray(m.list) ? m.list : []).map((it: any) => (it && it.click && it.click.content) || '').filter(Boolean)
    return [String(m.head_content || ''), ...items].filter(Boolean).join(' / ')
  }
  if (payload.msgtype === 'miniprogram')
    return '[小程序卡片] ' + String((payload.miniprogram && payload.miniprogram.title) || '')
  return '[' + String(payload.msgtype || 'unknown') + ']'
}

/**
 * 归档一条入站客户消息（fail-soft·绝不抛错）。确定性 _id 幂等：同 msgid 重投不重档。
 * 平台事件不归档。图片会归档（正文 incomingText 只留占位，mediaId 供坐席台拉图）。只归档有 msgid 的真消息。
 * knownOpenid：调用方已读过该顾客映射时传入（'' = 已知未绑定），不再重读；undefined 才在此读。
 */
export async function archiveInbound(db: any, msg: any, openKfId: string, knownOpenid?: string): Promise<void> {
  try {
    const msgid = String((msg && msg.msgid) || '')
    if (!msgid) return // 无 msgid（部分事件）不归档——无幂等键
    if (String((msg && msg.msgtype) || '') === 'event') return // 平台事件（进会话/状态变更）非会话内容——不归档（会话流/质检统计免噪声）
    const euid = msgEuid(msg)
    const openid = knownOpenid ?? (await resolveOpenidBestEffort(db, euid))
    await db.collection(COLLECTIONS.conversations).add({
      data: {
        _id: 'wxkf:in:' + msgid,
        channel: CHANNEL_WXKF,
        direction: 'in',
        openKfId: String(openKfId || ''),
        externalUserId: euid,
        openid,
        msgtype: String((msg && msg.msgtype) || ''),
        text: incomingText(msg),
        mediaId: msgMediaId(msg), // image 消息落 media_id（非 image 为''）·getMediaUrl 据此下载
        // at＝统一「入库时刻」（毫秒·与出站 archiveOutbound/sendAgentMessage 同轴），游标按单调递增不丢晚到消息。
        at: Date.now(),
      },
    })
  } catch {
    /* fail-soft：归档不反噬消息处理（撞号幂等/基建错均吞·不致吞单） */
  }
}

/**
 * 归档一条出站回复（fail-soft·绝不抛错）。出站由 index.ts send 收口处调——机器人自动回复（菜单/文字/卡片/转接通知）
 * 全捕获（坐席人工回复由 adminApi agentDesk 自行落档）。
 * knownOpenid：同 archiveInbound（'' = 已知未绑定，undefined = 在此读 touser 的映射）。
 */
export async function archiveOutbound(db: any, payload: any, openKfId: string, knownOpenid?: string): Promise<void> {
  try {
    const euid = String((payload && payload.touser) || '')
    const openid = knownOpenid ?? (await resolveOpenidBestEffort(db, euid))
    await db.collection(COLLECTIONS.conversations).add({
      data: {
        channel: CHANNEL_WXKF,
        direction: 'out',
        openKfId: String(openKfId || ''),
        externalUserId: euid,
        openid,
        msgtype: String((payload && payload.msgtype) || ''),
        text: payloadText(payload),
        at: Date.now(),
      },
    })
  } catch {
    /* fail-soft：归档不反噬消息发送 */
  }
}
