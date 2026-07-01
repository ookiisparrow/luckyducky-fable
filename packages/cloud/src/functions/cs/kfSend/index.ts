import { ERR } from '@luckyducky/shared'
import { isServerCall, ok, err, getAccessToken, sendMsg } from '../../../kit'

// 客服主动发消息（§P0 ④ send_msg 接待窗口真机验 · 承面C 坐席回复 sendAgentMessage 雏形/验证版）：
// 给定顾客 external_userid + 客服账号 open_kfid + 文本，在 48h 接待窗口内经微信客服 send_msg 主动发出
// ——区别于 kfCallback 的「即时自动回复」，本函数验「非即时·坐席主动发」这一承面C 收发命门（根因#8 真机钉死）。
// **服务端专用闸（isServerCall·根因#3 信任边界 fail-closed）**：仅后端/CLI invoke 放行；带 openid 的客户端
// 调用一律拒——防任意登录用户借此向顾客发任意消息（越权发送面）。承面C 落地时本闸升级为坐席 RBAC
// （agent:handle）+ 会话归属校验（守卫 kf-send-server-gated 焊本闸·别退回无闸）。
const env = (k: string) => process.env[k] || ''

export const main = async (event: any) => {
  if (!isServerCall()) return err(ERR.SERVER_ONLY) // 带 openid（客户端）即拒·仅服务端/CLI 触发
  const externalUserId = String(event?.externalUserId || event?.data?.externalUserId || '')
  const openKfId = String(event?.openKfId || event?.data?.openKfId || '')
  const text = String(event?.text || event?.data?.text || '')
  if (!externalUserId || !openKfId || !text) return err(ERR.BAD_ARGS)

  const corpid = env('WXKF_CORPID')
  const secret = env('WXKF_SECRET')
  if (!corpid || !secret) return err(ERR.KF_NOT_CONFIGURED)

  let token: string
  try {
    token = await getAccessToken({ corpid, secret })
  } catch {
    return err(ERR.TOKEN_FAILED)
  }
  const res = await sendMsg(token, { touser: externalUserId, open_kfid: openKfId, msgtype: 'text', text: { content: text } })
  // 验证工具：微信 errcode 原样带回（0=成功·48h 窗外/无权限则非 0），便于真机联调看结果（根因#8·§P0 ④）
  return ok({ sent: !res?.errcode, errcode: res?.errcode || 0, msgid: res?.msgid || '' })
}
