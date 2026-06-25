import {
  COLLECTIONS,
  defineKfCallback,
  getAccessToken,
  syncMsg,
  sendMsg,
  transferToServicer,
  getDb,
  alert,
} from '../../../kit'
import { handleMessage, rootMenu, buildMsgMenu, extUserId, type Incoming } from './dispatch'

// 微信客服 in-chat 智能客服回调（HTTP 访问服务·类比 adminApi 的 /adminapi）。
// 验签 + AES 解密 + fail-closed 由 kit.defineKfCallback 强制（根因#3）；本函数只做「收到事件 → 拉消息
// → 分流回消息」。密钥全走云环境变量（前置由用户在微信客服「开发配置」与企业微信认证后配齐）。
const env = (k: string) => process.env[k] || ''
const cfg = () => ({ corpid: env('WXKF_CORPID'), secret: env('WXKF_SECRET') })
const cardCfg = () => ({ appid: env('WXKF_MINIAPP_APPID'), thumbMediaId: env('WXKF_THUMB_MEDIA_ID') })
const SERVICER = () => env('WXKF_SERVICER')

const SEEN_TTL_NOTE = 'seen:<msgid> 去重痕只增（量级=客服消息数·远低于 events）；如需回收随 cleanupEvents 扩展'

// 一条消息 → 规范化入站（wire 形状以真机为准·根因#8：兼容点击回传 menu_id 与自由打字 content）
function normalize(msg: any): Incoming | null {
  const externalUserId = extUserId(msg)
  if (!externalUserId) return null
  if (msg.msgtype === 'text') {
    return { externalUserId, menuId: String(msg.text?.menu_id || ''), text: String(msg.text?.content || '') }
  }
  return null // 非文本（图片/语音/事件）本期不进分流，由 onEvent 的进会话欢迎兜
}

// 去重：确定性 _id 撞号即已处理过（根因#1 幂等）——撞号吞掉、跳过。
async function firstSeen(db: any, msgid: string): Promise<boolean> {
  try {
    await db.collection(COLLECTIONS.kfState).add({ data: { _id: 'seen:' + msgid, at: Date.now() } })
    return true
  } catch {
    return false // DUPLICATE_ID = 重复推送，已处理
  }
}

export const main = defineKfCallback({
  token: () => env('WXKF_TOKEN'),
  aesKey: () => env('WXKF_AESKEY'),
  corpid: () => env('WXKF_CORPID'), // 企业内部单 corp：解密 receiveId 须等于它，拒跨 corp 伪造（审计 P1）
  onEvent: async ({ syncToken, openKfId }) => {
    const db = getDb()
    // 观测（根因#8：整条 onEvent 链路可见，非敏感字段——不打 token/openid 内容）
    console.log('[kf] onEvent', { openKfId, hasSyncToken: !!syncToken })
    let token: string
    try {
      token = await getAccessToken(cfg())
    } catch (e) {
      console.error('[kf] getAccessToken threw', String(e)) // fetch 抛错（网络/IP）——kit errcode 路径另有告警
      return
    }
    // send/transfer 收口结果检查（补盲点：原来 send 失败静默无痕，气泡发不出也查不到）
    const send = async (payload: any) => {
      const res = await sendMsg(token, payload)
      if (res && res.errcode) alert('security', 'kfCallback', 'SENDMSG_FAILED', { errcode: res.errcode, msgtype: payload?.msgtype })
      else console.log('[kf] sent', { msgtype: payload?.msgtype })
      return res
    }
    const transfer = async (externalUserId: string) => {
      const res = await transferToServicer(token, { openKfId, externalUserId, servicerUserId: SERVICER() })
      if (res && res.errcode) alert('security', 'kfCallback', 'TRANSFER_FAILED', { errcode: res.errcode })
      return res
    }
    const ctx = { db, openKfId, cfg: cardCfg(), send, transfer }

    // cursor 持久化：从上次游标增量拉，处理完回写
    const cursorId = 'cursor:' + openKfId
    let cursor = ''
    const cur = await db.collection(COLLECTIONS.kfState).doc(cursorId).get().catch(() => null)
    if (cur && cur.data && typeof cur.data.cursor === 'string') cursor = cur.data.cursor
    console.log('[kf] cursor-read', { has: !!cursor }) // 观测：游标有没有读到（根因#8 定「为何每次重拉历史」）

    for (let guard = 0; guard < 20; guard++) {
      const r = await syncMsg(token, { cursor, token: syncToken, openKfId })
      // nc=本轮 sync 是否回了 next_cursor（定根因：empty 即 WeChat 没回、游标无从推进）
      console.log('[kf] sync', { errcode: r.errcode, msgs: r.msg_list.length, hasMore: r.has_more, nc: !!r.next_cursor })
      if (r.errcode) {
        alert('security', 'kfCallback', 'SYNCMSG_FAILED', { errcode: r.errcode })
        break
      }
      for (const msg of r.msg_list) {
        const msgid = String(msg.msgid || '')
        if (msgid && !(await firstSeen(db, msgid))) {
          console.log('[kf] dup-skip', { msgid })
          continue // 已处理
        }
        console.log('[kf] handle', { msgtype: msg.msgtype, hasText: !!msg.text?.content, hasMenuId: !!msg.text?.menu_id })
        if (msg.msgtype === 'event' && msg.event?.event_type === 'enter_session') {
          await send(buildMsgMenu(extUserId(msg), openKfId, rootMenu())) // 进会话欢迎（euid 在 event 子对象·根因#8）
          continue
        }
        const incoming = normalize(msg)
        if (incoming) await handleMessage(ctx, incoming)
        else console.log('[kf] not-dispatched', { msgtype: msg.msgtype })
      }
      cursor = r.next_cursor || cursor
      await db
        .collection(COLLECTIONS.kfState)
        .doc(cursorId)
        .set({ data: { _id: cursorId, cursor, updatedAt: Date.now() } })
        .catch(() => {})
      if (!r.has_more) break
    }
    void SEEN_TTL_NOTE
  },
})
