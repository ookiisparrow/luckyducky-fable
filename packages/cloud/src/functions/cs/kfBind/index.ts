import { ERR } from '@luckyducky/shared'
import { withOpenId, withRateLimit, ok, err, COLLECTIONS, getAccessToken, unionidToExternalUserid } from '../../../kit'

// 身份桥接·写侧（小程序主动触发·根因#3 不信前端·item 5）：小程序登录拿到 unionid 后调本函数，
// 后端用可信 openid + unionid 调企业微信转换 API 得 external_userid，建 external_userid→openid 映射，
// 供 kfCallback 在客服会话里查「你的订单」。转换 API 限频（须用户主动触发·禁批量）→ 叠 withRateLimit。
//
// 前置（靠人·用户做）：① 企业微信企业认证 ② 小程序绑微信开放平台（才有 unionid）③ 同一主体
// ④ login 链路存 unionid（parallel-b 前端侧·到位后传入）。前置未齐时 unionid 为空 → 直接 NO_UNIONID。
const env = (k: string) => process.env[k] || ''

export const main = withOpenId(
  withRateLimit('kfBind', { max: 5, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const unionid = String(event?.unionid || event?.data?.unionid || '')
    if (!unionid) return err(ERR.NO_UNIONID)

    const corpid = env('WXKF_CORPID')
    const secret = env('WXKF_SECRET')
    if (!corpid || !secret) return err(ERR.KF_NOT_CONFIGURED)

    let token: string
    try {
      token = await getAccessToken({ corpid, secret })
    } catch {
      return err(ERR.TOKEN_FAILED)
    }
    const externalUserId = await unionidToExternalUserid(token, unionid, OPENID)
    if (!externalUserId) return err(ERR.NO_EXTERNAL_USERID) // pending_id 或转换失败：暂无 48h 内会话身份

    // 确定性 _id 幂等映射（根因#1）：external_userid → openid，撞号即覆盖为最新 openid
    await db
      .collection(COLLECTIONS.kfIdentity)
      .doc('ext:' + externalUserId)
      .set({ data: { _id: 'ext:' + externalUserId, openid: OPENID, unionid, updatedAt: Date.now() } })
    return ok({ bound: true })
  })
)
