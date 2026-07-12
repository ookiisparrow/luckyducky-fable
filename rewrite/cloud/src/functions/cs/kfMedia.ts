import { ERR } from '@ldrw/shared'
import { isServerCall, ok, err, getAccessToken, getKfMedia, getDb, getSecureConfig } from '../../kit'

// 顾客发图下载（B5·后台360工作站承面C 图片气泡·平台接缝单点#12：media/get 只在此调用，
// 与 kfCallback/kfSend 共用同一 getAccessToken 缓存·不新开第二条 token 路径）。服务端专用闸——
// 带 openid 的客户端调用一律拒（防任意登录用户借此下载任意 media_id）；坐席台经 adminApi
// getMediaUrl 转发（跨函数模式同 sendAgentMessage 调 kfSend）。
const db = getDb()

export const main = async (event: any) => {
  if (!isServerCall()) return err(ERR.SERVER_ONLY)
  const mediaId = String(event?.mediaId || '')
  if (!mediaId) return err(ERR.BAD_ARGS)

  const corpid = await getSecureConfig(db, 'wxkf', 'corpId')
  const secret = await getSecureConfig(db, 'wxkf', 'secret')
  if (!corpid || !secret) return err(ERR.KF_NOT_CONFIGURED)

  let token: string
  try {
    token = await getAccessToken({ corpid, secret })
  } catch {
    return err(ERR.TOKEN_FAILED)
  }
  const r = await getKfMedia(token, mediaId)
  if (!r.ok) return ok({ ok: false, expired: r.expired, errcode: r.errcode || 0 })
  // base64 传回（云函数间调用走 JSON 序列化，二进制不能原样带——调用方 adminApi.getMediaUrl 收到后转 Buffer 上传云存储）
  return ok({ ok: true, base64: r.buffer.toString('base64') })
}
