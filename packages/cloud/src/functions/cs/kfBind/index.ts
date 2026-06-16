import { ERR } from '@luckyducky/shared'
import { withOpenId, withRateLimit, ok, err, COLLECTIONS, getAccessToken, unionidToExternalUserid } from '../../../kit'

// 身份桥接·写侧（小程序主动触发·根因#3 不信前端·item 5）：小程序登录拿到 unionid 后调本函数，
// 后端用可信 openid + unionid 调企业微信转换 API 得 external_userid，建 external_userid→openid 映射，
// 供 kfCallback 在客服会话里查「你的订单」。转换 API 限频（须用户主动触发·禁批量）→ 叠 withRateLimit。
//
// 前置（靠人·用户做）：① 企业微信企业认证 ② 小程序绑微信开放平台（才有 unionid）③ 同一主体
// ④ login 链路存 unionid（parallel-b 前端侧·到位后传入）⑤ 真 API 确认 idconvert 对不匹配
// (unionid, openid) 返回错误（见下方安全锚点·根因#8）。前置未齐时 unionid 为空 → 直接 NO_UNIONID。
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
    // 🔒 安全锚点（巡检 P-002·根因#3/#8 信任边界）：本映射的完整性**依赖企业微信 idconvert 对
    // (unionid, openid) 的同主体校验**——传入 openid 正是为此（不只传 unionid）。设想攻击者拿他人
    // unionid + 自己 openid 调用：若 idconvert 只认 unionid、不校验 openid 是否同人，会返回他人的
    // external_userid → 误建「他人 ext → 攻击者 openid」，致他人客服会话查到攻击者订单（完整性/可用性
    // 问题·非他人数据外泄·攻击者自曝己单）。**当前 fail-closed**：external 空即 NO_EXTERNAL_USERID
    // 不写库 ⇒ idconvert 对不匹配对返回错误/空时天然安全（external 非空＝同主体确认）。
    // ⚠️ 靠人验（根因#8·真 API·见 [[wechat-kf-smart-cs-handoff]] 前置）：真机/真 API 确认 idconvert
    // 对不匹配 (unionid, openid) 返回错误（预期 60111 类）而非有效 external_userid；若发现 API 不校验
    // openid，须在此加服务端校验或拒绑（如比对 idconvert 反查 / openid↔unionid 一致性）。
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
