import { ERR, COLLECTIONS } from '@ldrw/shared'
import {
  withOpenId,
  withRateLimit,
  ok,
  err,
  str,
  ensureDoc,
  currentUnionId,
  msgSecCheck,
  imgSecCheck,
  SCENE_PROFILE,
} from '../../../kit'

const CAPS = { nickname: 20, bio: 60, avatar: 256, phone: 11 }

/**
 * 微信登录（静默）：用可信 openid upsert users，返回用户（黄金 admin-misc §五）。
 * 确定性 _id=OPENID（设计约束#1）：并发首登撞键即幂等；老随机 _id 档 where 命中即用（惰性迁移）。
 * unionid 桥接 best-effort：有则存进用户档（客服查订单反查用），绝不反噬登录。
 */
export const login = withOpenId(
  withRateLimit('login', { max: 30, windowMs: 60_000 }, async ({ db, OPENID }) => {
    const users = db.collection(COLLECTIONS.users)
    const found = await users.where({ _openid: OPENID }).limit(1).get()
    const isNew = !found.data.length
    // 云函数是管理端，add 不自动写 _openid，必须显式写入（否则查不回）
    const user = isNew
      ? await ensureDoc(COLLECTIONS.users, OPENID, {
          _openid: OPENID,
          nickname: '',
          avatar: '',
          phone: '',
          createdAt: Date.now(), // 毫秒数字：与改资料/授权同形；后台 dateTime 只认数字，云端日期回读后注册时间是空白
        })
      : found.data[0]
    await storeUnionId(db, OPENID, user).catch(() => {})
    return ok({ isNew, user })
  })
)

async function storeUnionId(db: any, OPENID: string, user: any): Promise<void> {
  const unionid = currentUnionId()
  if (!unionid || (user && user.unionid === unionid)) return
  await db
    .collection(COLLECTIONS.users)
    .doc(OPENID)
    .update({ data: { unionid } })
    .catch(() => {})
}

/**
 * 保存用户资料（黄金 admin-misc §五：白名单+截断+归属，不信前端）。
 * 白名单 {nickname,bio,avatar}；avatar 只接受云存储地址（cloud://）或空串（清除）——拒注入任意 URL。
 */
export const updateProfile = withOpenId(
  withRateLimit('updateProfile', { max: 20, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const e: any = event
    const patch: Record<string, unknown> = {}
    if (typeof e.nickname === 'string' && e.nickname.trim()) {
      patch.nickname = str(e.nickname.trim(), CAPS.nickname)
    }
    if (typeof e.bio === 'string') patch.bio = str(e.bio.trim(), CAPS.bio)
    if (typeof e.avatar === 'string' && (e.avatar === '' || e.avatar.startsWith('cloud://'))) {
      patch.avatar = str(e.avatar, CAPS.avatar)
    }
    // 手机号（账户联系电话·供客服 360 检索·与地址电话独立）。**区分两类空**（防「纯非数字→误当清空→清掉旧号」）：
    // ① 真·空输入（trim 后为空）＝用户显式清空→存空串；② 非空输入归一化纯数字后按 7–11 位（与地址电话 ≥7 对齐）
    // 校验，合法才入·非法（含字母/过短/超长，归一化可能为空但用户本意是填号）一律剔除、**不覆盖旧号**。
    // 隐私铁律（CLAUDE.md）：手机号敏感——本 action 与任何 observe/alert/日志路径都不得记录 phone（anomaly SENSITIVE 已兜一层）。
    if (typeof e.phone === 'string') {
      const raw = e.phone.trim()
      if (raw === '') {
        patch.phone = '' // 显式清空
      } else {
        const d = raw.replace(/\D/g, '')
        if (d.length >= 7 && d.length <= CAPS.phone) patch.phone = d // 合法才入；否则剔除不改（含纯非数字）
      }
    }
    if (!Object.keys(patch).length) return err(ERR.EMPTY_PATCH)

    // UGC 内容安全（fail-closed·根因#3·守卫 ugc-imgsecchecked）：昵称/签名是无鉴权公开展示文本、
    // 头像是公开展示图，入库前必过内容安全——违规/校不了一律拒、不覆盖旧值（「证明安全」才放行）。
    const profileText = [patch.nickname, patch.bio]
      .filter((v) => typeof v === 'string' && v)
      .join(' ')
    if (profileText) {
      const tsec = await msgSecCheck(profileText, OPENID, SCENE_PROFILE)
      if (!tsec.ok) return err(ERR.SEC_CHECK_FAIL)
    }
    if (typeof patch.avatar === 'string' && patch.avatar) {
      const isec = await imgSecCheck(patch.avatar)
      if (!isec.ok) return err(isec.error === 'IMG_RISKY' ? ERR.IMG_RISKY : ERR.SEC_CHECK_FAIL)
    }

    patch.updatedAt = Date.now()
    const seed = { nickname: '', avatar: '', bio: '', createdAt: Date.now() }
    return ok({ user: await upsertUser(db, OPENID, patch, seed) })
  })
)

/**
 * 本人档 upsert：老随机 _id 档 where 命中即改；无档按确定性 _id=OPENID 建（seed 为缺省字段）。
 * 先查后改——不用 update 的 stats 判建档：内容未变 updated=0 会误判重复建档。
 */
async function upsertUser(db: any, OPENID: string, patch: Record<string, unknown>, seed: Record<string, unknown>) {
  const users = db.collection(COLLECTIONS.users)
  const found = await users.where({ _openid: OPENID }).limit(1).get()
  if (!found.data.length) return ensureDoc(COLLECTIONS.users, OPENID, { _openid: OPENID, ...seed, ...patch })
  await users.doc(found.data[0]._id).update({ data: patch })
  return { ...found.data[0], ...patch }
}

/**
 * 自助删除资料（隐私政策第六条「我的 / 删除资料」）：
 * 抹掉可识别个人资料，摘掉课程权限与客服身份桥，订单行依法留存。
 * 同一微信再登是空身份：资料空、课看不了；旧码不能凭本人身份抢回（activatedBy 改成 deleted:openid）。
 */
export const deleteAccount = withOpenId(
  withRateLimit('deleteAccount', { max: 5, windowMs: 60_000 }, async ({ db, OPENID }) => {
    const now = Date.now()
    const blank = {
      nickname: '',
      avatar: '',
      bio: '',
      phone: '',
      unionid: '',
      csDataShare: { agreed: false, at: now },
      deletedAt: now,
      updatedAt: now,
    }
    await upsertUser(db, OPENID, blank, { createdAt: now })

    // 服务端条件批删/批改（无上界·各一次往返），串行：前一步失败后面不动。任一步失败直接抛→网关记账回
    // INTERNAL，绝不报已删除却留着课权或旧码归属（根因#14：旧码仍归本人时重扫会走 activateCourse 自愈拿回课）。
    await db.collection(COLLECTIONS.activations).where({ _openid: OPENID }).remove()
    await db.collection(COLLECTIONS.progress).where({ _openid: OPENID }).remove()
    await db.collection(COLLECTIONS.kfIdentity).where({ openid: OPENID }).remove()
    await db
      .collection(COLLECTIONS.qrcodes)
      .where({ activatedBy: OPENID })
      .update({ data: { activatedBy: 'deleted:' + OPENID } })
    return ok({ deleted: true })
  })
)
