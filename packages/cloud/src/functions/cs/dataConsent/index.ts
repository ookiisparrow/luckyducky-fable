import { withOpenId, withRateLimit, ok } from '../../../kit'

// 数据共享告知同意·写侧（后台360工作站 B3.3·承面C 车道 C·根因#3 不信前端·守卫 cs-data-share-consented）：
// 客户在小程序内对「外包/第三方客服（受托客服）可访问我的订单/物流/学习/咨询记录以提供服务」作出同意 / 撤回。
// 经 openid 闸只写本人，写 users.csDataShare（{ agreed, at }）。外包坐席读该客户 360 前经 kit/csAccess
// .assertDataShareConsent 校验此态（未同意即拒·fail-closed）。声明文案在协议/隐私页（pages/agreement·
// 法律定稿归律师·CC 只机械化）。**独立于** C 端微信隐私授权（usePrivacyGate·管系统级隐私接口）。
//
// 入参 { agree: boolean }：true=同意·false（或缺）=撤回。返回 { ok, agreed }。
export const main = withOpenId(
  // 频控（根因#13）：同意/撤回操作极少，单用户 20 次/分远超正常，超即拒
  withRateLimit('dataConsent', { max: 20, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const e: any = event
    const agree = !!(e?.agree ?? e?.data?.agree) // true=同意·false/缺=撤回（缺省即未同意·fail-safe）
    const now = Date.now()
    const csDataShare = { agreed: agree, at: now }
    const users = db.collection('users')
    // 先查后改（同 updateProfile·不用 where().update 的 stats 判建档·防误判重复建档）
    const found = await users
      .where({ _openid: OPENID })
      .get()
      .catch(() => ({ data: [] }))
    if (found.data.length) {
      await users.doc(found.data[0]._id).update({ data: { csDataShare, updatedAt: now } })
    } else {
      // 首次即建档：确定性 _id=OPENID（根因#1·并发首次撞号幂等）·_id 由 doc(id) 指定·data 不带 _id（真 sdk 约束）
      await users.doc(OPENID).set({ data: { _openid: OPENID, csDataShare, createdAt: now, updatedAt: now } })
    }
    return ok({ agreed: agree })
  }),
)
