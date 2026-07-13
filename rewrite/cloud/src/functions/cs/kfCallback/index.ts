import { COLLECTIONS } from '@ldrw/shared'
import {
  defineKfCallback,
  getAccessToken,
  syncMsg,
  sendMsg,
  ensureSmartAssistant,
  getDb,
  alert,
  kfCustomerBatchget,
  getSecureConfigFields,
} from '../../../kit'
import { handleMessage, rootMenu, buildMsgMenu, extUserId, processKfBatch, heldStatus, type Incoming } from './dispatch'
import { archiveInbound, archiveOutbound } from './archive' // 会话归档（B5.1·入站/出站落档·守卫 conversations-archived）

// 微信客服 in-chat 智能客服回调（HTTP 访问服务·类比 adminApi 的 /adminapi）。
// 验签 + AES 解密 + fail-closed 由 kit.defineKfCallback 强制（根因#3）；本函数只做「收到事件 → 拉消息
// → 分流回消息」。corpid/secret/token/aesKey + 小程序卡片 miniappAppId/thumbMediaId（配置清单审查批随迁）
// 经 kit/secureConfig 读库（决策 2026-07-12·/admin 人工配置清单页填写自动生效，无需再改环境变量+重新
// 部署·env 兜底迁移期不变）。读取合并为「外壳 creds 1 次 + onEvent 1 次」（原逐字段 5 次同文档 get·
// 配置清单审查批收敛），每事件仍取最新值——填写即生效语义不变。
const db = getDb()
const wxkfCfg = () => getSecureConfigFields(db, 'wxkf', ['corpId', 'secret', 'miniappAppId', 'thumbMediaId'])

const SEEN_TTL_NOTE = 'seen:<msgid> 去重痕只增（量级=客服消息数·远低于 events）；如需回收随 cleanupEvents 扩展'

// §查订单·平台原生身份桥接（根因#3 不信前端·best-effort 不反噬消息处理）：顾客的 external_userid 经微信客服
// `kf/customer/batchget` 反查 unionid → users 找 openid → 建 `ext→openid` 映射（dispatch.resolveOpenid 读它查订单）。
// **绕开客户联系 idconvert 的 48002 墙**（用微信客服自己的顾客接口·平台原生）。已建映射即跳（省 batchget）。
// 守卫 login-kf-identity-bridge 焊「login 存 unionid + 本处 batchget 建 kfIdentity」两端。
async function ensureKfIdentity(db: any, token: string, euid: string): Promise<void> {
  try {
    if (!euid) return
    const got = await db.collection(COLLECTIONS.kfIdentity).doc('ext:' + euid).get().catch(() => null)
    if (got && got.data && got.data.openid) return // 已建映射·不重复 batchget
    const unionid = await kfCustomerBatchget(token, euid)
    if (!unionid) {
      console.log('[kf-bind] no-unionid via batchget（顾客没绑开放平台/没授权）')
      return
    }
    const u = await db.collection('users').where({ unionid }).limit(1).get().catch(() => ({ data: [] }))
    const openid = u.data && u.data[0] && u.data[0]._openid
    if (!openid) {
      console.log('[kf-bind] unionid 不在 users（该顾客没登录过小程序·或与小程序不同开放平台主体）')
      return
    }
    await db.collection(COLLECTIONS.kfIdentity).doc('ext:' + euid).set({ data: { openid, unionid, updatedAt: Date.now() } })
    console.log('[kf-bind] bound via batchget')
  } catch {
    /* best-effort：身份桥接不反噬消息处理 */
  }
}

// 一条消息 → 规范化入站（wire 形状以真机为准·根因#8：兼容点击回传 menu_id 与自由打字 content）
function normalize(msg: any): Incoming | null {
  const externalUserId = extUserId(msg)
  if (!externalUserId) return null
  if (msg.msgtype === 'text') {
    return { externalUserId, menuId: String(msg.text?.menu_id || ''), text: String(msg.text?.content || '') }
  }
  return null // 非文本（图片/语音/事件）本期不进分流，由 onEvent 的进会话欢迎兜
}

export const main = defineKfCallback({
  // 单次合并读注入三凭证（corpid：企业内部单 corp——解密 receiveId 须等于它，拒跨 corp 伪造·审计 P1）
  creds: async () => {
    const f = await getSecureConfigFields(db, 'wxkf', ['token', 'aesKey', 'corpId'])
    return { token: f.token, aesKey: f.aesKey, corpid: f.corpId }
  },
  onEvent: async ({ syncToken, openKfId }) => {
    // 观测（根因#8：整条 onEvent 链路可见，非敏感字段——不打 token/openid 内容）
    console.log('[kf] onEvent', { openKfId, hasSyncToken: !!syncToken })
    const f = await wxkfCfg()
    let token: string
    try {
      token = await getAccessToken({ corpid: f.corpId, secret: f.secret })
    } catch (e) {
      console.error('[kf] getAccessToken threw', String(e)) // fetch 抛错（网络/IP）——kit errcode 路径另有告警
      return
    }
    // send/transfer 收口结果检查（补盲点：原来 send 失败静默无痕，气泡发不出也查不到）
    const send = async (payload: any) => {
      const res = await sendMsg(token, payload)
      if (res && res.errcode) alert('security', 'kfCallback', 'SENDMSG_FAILED', { errcode: res.errcode, msgtype: payload?.msgtype })
      else {
        console.log('[kf] sent', { msgtype: payload?.msgtype })
        await archiveOutbound(db, payload, openKfId) // 出站回复落档（B5.1·仅记真发出的·fail-soft 不反噬发送）
      }
      return res
    }
    // 转人工不再调平台 service_state 转接（守卫 agent-channel-stays-assistant·根因#12·调试日志 AC）：
    // 平台会话恒智能助手态(1)，人工由承面C 自建工作台（csSession 队列）承接——转 3 会让坐席 send_msg 全被 95018 拒。
    const ctx = { db, openKfId, cfg: { appid: f.miniappAppId, thumbMediaId: f.thumbMediaId }, send }

    // cursor 持久化：从上次游标增量拉，处理完回写
    const cursorId = 'cursor:' + openKfId
    let cursor = ''
    const cur = await db.collection(COLLECTIONS.kfState).doc(cursorId).get().catch(() => null)
    if (cur && cur.data && typeof cur.data.cursor === 'string') cursor = cur.data.cursor
    console.log('[kf] cursor-read', { has: !!cursor }) // 观测：游标有没有读到（根因#8 定「为何每次重拉历史」）

    // 单条消息处理（防吞单经 processKfBatch 包 try/catch·见 dispatch）：进会话欢迎 / 文本分流
    const handleOne = async (msg: any) => {
      console.log('[kf] handle', { msgtype: msg.msgtype, hasText: !!msg.text?.content, hasMenuId: !!msg.text?.menu_id })
      await archiveInbound(db, msg, openKfId) // 入站客户消息落档（B5.1·有 msgid 才记·确定性 _id 幂等·fail-soft）
      const euid = extUserId(msg)
      // 回复前确保会话为「智能助手接待」态(service_state=1)：新会话默认 0未处理，不置态 send_msg 报 95018 静默无回复
      // （调试日志 AB·迁移到企业微信内后平台默认态漂移·根因#12）。人工/排队态 bot 不抢话（skip·仍尽力建身份桥接）。
      if (euid) {
        const gate = await ensureSmartAssistant(token, { openKfId, externalUserId: euid })
        console.log('[kf] assistant-gate', { gate }) // 观测：实测会话态决策（根因#8 定「为何发不出」）
        if (gate === 'skip') {
          console.log('[kf] 人工/排队接待中 → bot 不抢话')
          await ensureKfIdentity(db, token, euid)
          return
        }
      }
      // 先回顾客（回复优先·batchget 延迟不拖累回复），再 best-effort 建身份桥接
      if (msg.msgtype === 'event' && msg.event?.event_type === 'enter_session') {
        // 深审 F3：排队/接待中顾客重开聊天窗（enter_session）不发欢迎菜单——bot 抢话且顾客点菜单又被
        // held 闸静默＝发了菜单点了没反应；「谁在接待」判定单源 heldStatus（与 handleMessage 同口径）。
        if (euid && (await heldStatus(db, openKfId, euid))) console.log('[kf] enter_session held → bot 不抢话')
        else await send(buildMsgMenu(euid, openKfId, rootMenu())) // 进会话欢迎（euid 在 event 子对象·根因#8）
      } else {
        const incoming = normalize(msg)
        if (incoming) await handleMessage(ctx, incoming)
        else console.log('[kf] not-dispatched', { msgtype: msg.msgtype })
      }
      await ensureKfIdentity(db, token, euid) // §查订单·回复后再 batchget 反查建 ext→openid 映射（best-effort·不延迟回复）
    }

    // 防超时吞消息（外审 R1-R4·P1.5·根因#8）：函数超时 20s，单批 limit 降到 KF_BATCH_LIMIT（旧默认 1000 一批
    // 逐条串行处理可能在 20s 内做不完）；并设 KF_TIME_BUDGET_MS 墙钟预算——临近超时即停、保留旧游标下次续拉，
    // 绝不在「已认领但副作用未完成」时被硬超时杀掉（那会下次因 seen 跳过＝吞消息）。游标只在整批成功后才推进+落库，
    // 故 budget break 时停在上次已落游标处，剩余 backlog 下次回调续拉，不丢。
    const KF_BATCH_LIMIT = 50
    const KF_TIME_BUDGET_MS = 15000
    const startedAt = Date.now()
    for (let guard = 0; guard < 20; guard++) {
      if (Date.now() - startedAt > KF_TIME_BUDGET_MS) {
        console.log('[kf] time-budget reached → 保留旧游标下次续拉（不吞单）')
        break // 临近超时：保留上次已落游标，剩余 backlog 下次续拉
      }
      const r = await syncMsg(token, { cursor, token: syncToken, openKfId, limit: KF_BATCH_LIMIT })
      // nc=本轮 sync 是否回了 next_cursor（定根因：empty 即 WeChat 没回、游标无从推进）
      console.log('[kf] sync', { errcode: r.errcode, msgs: r.msg_list.length, hasMore: r.has_more, nc: !!r.next_cursor })
      if (r.errcode) {
        alert('security', 'kfCallback', 'SYNCMSG_FAILED', { errcode: r.errcode })
        break
      }
      // 防吞单（审计 P2）：单条失败不中断整批、撤回认领；本批有失败则**保留旧游标**下次重拉重试
      const anyFailed = await processKfBatch(db, r.msg_list, handleOne)
      if (anyFailed) {
        console.log('[kf] batch-failed → 保留旧游标下次重试（不吞单）')
        break // 不推进游标：下次重拉，成功项 seen 去重、失败项重试
      }
      cursor = r.next_cursor || cursor
      await db
        .collection(COLLECTIONS.kfState)
        .doc(cursorId)
        .set({ data: { cursor, updatedAt: Date.now() } }) // _id 由 doc(id) 指定·data 不带（真 sdk reject·根因#8）
        .catch(() => {})
      if (!r.has_more) break
    }
    void SEEN_TTL_NOTE
  },
})
