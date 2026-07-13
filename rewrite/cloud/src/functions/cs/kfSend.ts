import { ERR } from '@ldrw/shared'
import { isServerCall, ok, err, getAccessToken, sendMsg, getDb, getSecureConfigFields } from '../../kit'

// 客服主动发消息（黄金 cs-agent §四·服务端专用闸）：48h 接待窗口内经 send_msg 主动发出。
// 带 openid 的客户端调用一律拒——防任意登录用户借此向顾客发任意消息（越权发送面 fail-closed）。
// 坐席台落地时本闸升级为坐席 RBAC + 会话归属校验（adminApi v2 批）。
const db = getDb()

export const main = async (event: any) => {
  if (!isServerCall()) return err(ERR.SERVER_ONLY)
  const externalUserId = String(event?.externalUserId || '')
  const openKfId = String(event?.openKfId || '')
  const text = String(event?.text || '')
  if (!externalUserId || !openKfId || !text) return err(ERR.BAD_ARGS)

  const { corpId: corpid, secret } = await getSecureConfigFields(db, 'wxkf', ['corpId', 'secret'])
  if (!corpid || !secret) return err(ERR.KF_NOT_CONFIGURED)

  let token: string
  try {
    token = await getAccessToken({ corpid, secret })
  } catch {
    return err(ERR.TOKEN_FAILED)
  }
  const res = await sendMsg(token, { touser: externalUserId, open_kfid: openKfId, msgtype: 'text', text: { content: text } })
  return ok({ sent: !res?.errcode, errcode: res?.errcode || 0, msgid: res?.msgid || '' })
}
