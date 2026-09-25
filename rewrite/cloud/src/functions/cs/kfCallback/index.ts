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
  msgSecCheck,
  SCENE_COMMENT,
} from '../../../kit'
import { handleMessage, welcomeMenu, buildMsgMenu, extUserId, processKfBatch, heldStatus, resolveOpenid, type Incoming } from './dispatch'
import { archiveInbound, archiveOutbound } from './archive' // 会话归档（B5.1·入站/出站落档）

// 微信客服 in-chat 智能客服回调（HTTP 访问服务·类比 adminApi 的 /adminapi）。
// 验签 + AES 解密 + fail-closed 由 kit.defineKfCallback 强制（根因#3）；本函数只做「收到事件 → 拉消息
// → 分流回消息」。corpid/secret/token/aesKey + 小程序卡片 miniappAppId/thumbMediaId（配置清单审查批随迁）
// 经 kit/secureConfig 读库（/admin 人工配置清单页填写自动生效，无需再改环境变量+重新部署·env 兜底）。
// 外壳验签与 onEvent 用的是同一文档：每事件读一次、两处共用（见 main），每事件仍取最新值——填写即生效。
const db = getDb()

// §查订单·平台原生身份桥接（根因#3 不信前端·best-effort 不反噬消息处理）：顾客的 external_userid 经微信客服
// `kf/customer/batchget` 反查 unionid → users 找 openid → 建 `ext→openid` 映射（dispatch.resolveOpenid 读它查订单）。
// **绕开客户联系 idconvert 的 48002 墙**（用微信客服自己的顾客接口·平台原生）。已建映射即跳（省 batchget）。
// 两端配合：login 存 unionid，本处 batchget 建 kfIdentity。knownOpenid 是本条消息开头已读到的映射（'' = 未绑定）。
async function ensureKfIdentity(db: any, token: string, euid: string, knownOpenid: string): Promise<void> {
  try {
    if (!euid || knownOpenid) return // 已建映射·不重复 batchget
    const unionid = await kfCustomerBatchget(token, euid)
    if (!unionid) return
    const u = await db.collection(COLLECTIONS.users).where({ unionid }).limit(1).get().catch(() => ({ data: [] }))
    const openid = u.data && u.data[0] && u.data[0]._openid
    if (!openid) return
    await db.collection(COLLECTIONS.kfIdentity).doc('ext:' + euid).set({ data: { openid, unionid, updatedAt: Date.now() } })
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

export const main = async (event: any) => {
  // 外壳 creds 与 onEvent 共用这一次读；闭包按请求建，不留模块级状态（实例并发时不串请求）
  const f = await getSecureConfigFields(db, 'wxkf', ['token', 'aesKey', 'corpId', 'secret', 'miniappAppId', 'thumbMediaId'])
  return defineKfCallback({
    // corpid：企业内部单 corp——解密 receiveId 须等于它，拒跨 corp 伪造
    creds: () => ({ token: f.token, aesKey: f.aesKey, corpid: f.corpId }),
    onEvent: ({ syncToken, openKfId }) => onEvent(syncToken, openKfId, f),
  })(event)
}

async function onEvent(syncToken: string, openKfId: string, f: Record<string, string>): Promise<void> {
  // 失败采样走已有 alert（SENDMSG_FAILED / SYNCMSG_FAILED），不常开 debug 喷日志
  let token: string
  try {
    token = await getAccessToken({ corpid: f.corpId, secret: f.secret })
  } catch (e) {
    console.error('[kf] getAccessToken threw', String(e)) // fetch 抛错（网络/IP）——kit errcode 路径另有告警
    return
  }
  const cfg = { appid: f.miniappAppId, thumbMediaId: f.thumbMediaId }

  // cursor 持久化：从上次游标增量拉，处理完回写
  const cursorId = 'cursor:' + openKfId
  let cursor = ''
  const cur = await db.collection(COLLECTIONS.kfState).doc(cursorId).get().catch(() => null)
  if (cur && cur.data && typeof cur.data.cursor === 'string') cursor = cur.data.cursor

  // 单条消息处理（防吞单经 processKfBatch 包 try/catch·见 dispatch）：进会话欢迎 / 文本分流
  const handleOne = async (msg: any) => {
    const euid = extUserId(msg)
    // 本条消息的 kfIdentity 只读这一次：送审、入站/出站归档、分流（ctx.openid：查单/评分/有无近单）、身份桥接共用。
    // 桥接写入在本条末尾，之后本条不再读。
    const openid = (await resolveOpenid(db, euid)) || ''
    // send 收口结果检查（补盲点：send 失败静默无痕，气泡发不出也查不到）。发给别的顾客时不套用本条身份。
    const send = async (payload: any) => {
      const res = await sendMsg(token, payload)
      if (res && res.errcode) alert('security', 'kfCallback', 'SENDMSG_FAILED', { errcode: res.errcode, msgtype: payload?.msgtype })
      else await archiveOutbound(db, payload, openKfId, payload?.touser === euid ? openid : undefined) // 出站回复落档（仅记真发出的·fail-soft 不反噬发送）
      return res
    }
    // 转人工不再调平台 service_state 转接（根因#12·调试日志 AC）：
    // 平台会话恒智能助手态(1)，人工由承面C 自建工作台（csSession 队列）承接——转 3 会让坐席 send_msg 全被 95018 拒。
    const ctx = { db, openKfId, cfg, send, openid }
    // 自由打字过 msgSecCheck（Issue #113）：违规不归档不分流；接口抖动 fail-open 放行并记日志。
    // 菜单回传（menu_id）是我方预设文案，不送审。v2 必带 openid——尚未建身份桥则跳过（等同 fail-open，不打无意义 INFRA）。
    if (msg.msgtype === 'text' && !(msg.text && msg.text.menu_id)) {
      if (openid) {
        const sec = await msgSecCheck(String((msg.text && msg.text.content) || ''), openid, SCENE_COMMENT, 'open')
        if (!sec.ok) {
          if (euid)
            await send({
              touser: euid,
              open_kfid: openKfId,
              msgtype: 'text',
              text: { content: '这条消息未能发送，请换个说法再试' },
            })
          return
        }
      }
    }
    await archiveInbound(db, msg, openKfId, openid) // 入站客户消息落档（B5.1·有 msgid 才记·确定性 _id 幂等·fail-soft）
    // 回复前确保会话为「智能助手接待」态(service_state=1)：新会话默认 0未处理，不置态 send_msg 报 95018 静默无回复
    // （调试日志 AB·迁移到企业微信内后平台默认态漂移·根因#12）。人工/排队态 bot 不抢话（skip·仍尽力建身份桥接）。
    if (euid) {
      const gate = await ensureSmartAssistant(token, { openKfId, externalUserId: euid })
      if (gate === 'skip') {
        await ensureKfIdentity(db, token, euid, openid)
        return
      }
    }
    // 先回顾客（回复优先·batchget 延迟不拖累回复），再 best-effort 建身份桥接
    if (msg.msgtype === 'event' && msg.event?.event_type === 'enter_session') {
      // 深审 F3：排队/接待中顾客重开聊天窗（enter_session）不发欢迎菜单——bot 抢话且顾客点菜单又被
      // held 闸静默＝发了菜单点了没反应；「谁在接待」判定单源 heldStatus（与 handleMessage 同口径）。
      if (!(euid && (await heldStatus(db, openKfId, euid))))
        await send(buildMsgMenu(euid, openKfId, await welcomeMenu(db))) // 进会话欢迎（euid 在 event 子对象·根因#8）
    } else {
      const incoming = normalize(msg)
      if (incoming) await handleMessage(ctx, incoming)
    }
    await ensureKfIdentity(db, token, euid, openid) // §查订单·回复后再 batchget 反查建 ext→openid 映射（best-effort·不延迟回复）
  }

  // 防超时吞消息（外审 R1-R4·P1.5·根因#8）：函数超时见 cloudbaserc.json kfCallback.timeout，单批 limit 降到
  // KF_BATCH_LIMIT（旧默认 1000 一批逐条串行处理可能做不完）；KF_TIME_BUDGET_MS 墙钟预算在每条消息认领前查
  // （processKfBatch deadline）——临近超时即停、剩下的不认领，绝不在「已认领但副作用未完成」时被硬超时杀掉
  // （那会下次因 seen 跳过＝吞消息）。平台游标不透明、推不到批中间，所以只在整批处理完才推进+落库：
  // 停下时游标仍在上次落的位置，下次回调重拉这批，处理过的按 seen 跳过、没轮到的补上。
  // ponytail: 预算只挡「开始下一条」，单条自身超过余量（超时 − 预算）仍会被杀；要更稳就按单条最坏耗时调预算
  const KF_BATCH_LIMIT = 50
  const KF_TIME_BUDGET_MS = 15000
  const startedAt = Date.now()
  for (let guard = 0; guard < 20; guard++) {
    if (Date.now() - startedAt > KF_TIME_BUDGET_MS) {
      break // 临近超时：保留上次已落游标，剩余 backlog 下次续拉
    }
    const r = await syncMsg(token, { cursor, token: syncToken, openKfId, limit: KF_BATCH_LIMIT })
    if (r.errcode) {
      alert('security', 'kfCallback', 'SYNCMSG_FAILED', { errcode: r.errcode })
      break
    }
    // 防吞单（审计 P2）：单条失败不中断整批、撤回认领；本批没处理完（失败或预算用尽）则**保留旧游标**下次重拉
    const unfinished = await processKfBatch(db, r.msg_list, handleOne, startedAt + KF_TIME_BUDGET_MS)
    if (unfinished) {
      break // 不推进游标：下次重拉，成功项 seen 去重、失败项和没轮到的重试
    }
    cursor = r.next_cursor || cursor
    await db
      .collection(COLLECTIONS.kfState)
      .doc(cursorId)
      .set({ data: { cursor, updatedAt: Date.now() } }) // _id 由 doc(id) 指定·data 不带（真 sdk reject·根因#8）
      .catch(() => {})
    if (!r.has_more) break
  }
}
