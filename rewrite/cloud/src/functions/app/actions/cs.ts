import { ERR, COLLECTIONS } from '@ldrw/shared'
import { withOpenId, withRateLimit, ok, err, getAccessToken, unionidToExternalUserid } from '../../../kit'

const env = (k: string) => process.env[k] || ''

/**
 * 身份桥接·写侧（黄金 cs-agent §九）：可信 openid + unionid 经企微转换 API 得 external_userid，
 * 建 ext→openid 映射（客服会话查「你的订单」用）。fail-closed：无 unionid/未配置/token 失败/转换空一律拒不写。
 * 完整性依赖 idconvert 对 (unionid, openid) 同主体校验——external 非空＝同主体确认（空即不写·天然安全）。
 */
export const kfBind = withOpenId(
  withRateLimit('kfBind', { max: 5, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const e: any = event
    const unionid = String(e?.unionid || '')
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
    if (!externalUserId) return err(ERR.NO_EXTERNAL_USERID)

    // 确定性 _id 幂等映射：ext:external_userid → openid，撞号即覆盖为最新
    await db
      .collection(COLLECTIONS.kfIdentity)
      .doc('ext:' + externalUserId)
      .set({ data: { openid: OPENID, unionid, updatedAt: Date.now() } })
    return ok({ bound: true })
  })
)

/**
 * 数据共享告知同意·写侧（黄金 cs-agent §三）：只写本人 users.csDataShare（{agreed, at}）；
 * true=同意 / false 或缺=撤回（缺省未同意·fail-safe）。外包读 360 前经 assertDataShareConsent 校验。
 */
export const dataConsent = withOpenId(
  withRateLimit('dataConsent', { max: 20, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const e: any = event
    const agree = !!e?.agree
    const now = Date.now()
    const csDataShare = { agreed: agree, at: now }
    const users = db.collection(COLLECTIONS.users)
    const found = await users
      .where({ _openid: OPENID })
      .get()
      .catch(() => ({ data: [] }))
    if (found.data.length) {
      await users.doc(found.data[0]._id).update({ data: { csDataShare, updatedAt: now } })
    } else {
      await users.doc(OPENID).set({ data: { _openid: OPENID, csDataShare, createdAt: now, updatedAt: now } })
    }
    return ok({ agreed: agree })
  })
)
