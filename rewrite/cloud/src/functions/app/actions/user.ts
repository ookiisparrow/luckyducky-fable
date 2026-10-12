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
  isCollectionMissing,
} from '../../../kit'
import { ANON_REVIEW_NAME } from './reviews'
import { isOwnCheckpointFile, deleteOwnCheckpointFiles } from './checkpoint'

const CAPS = { nickname: 20, bio: 60, avatar: 256, phone: 11 }

// 头像只收 mp profile-edit 上传目录 avatars/ 下的单个文件（cloudPath 约定见该页）：内容安全会用管理权限把整个对象
// 下载进内存，不限目录就能填付费课视频之类的大文件拖垮函数，或把别处的私有文件设成公开头像。文件名不许以点开头，挡 '..'。
// ponytail: 该目录约定里没有 openid，挡得住跨目录，挡不住填别人的头像（本就公开）；要证本人得 mp 改传 avatars/<openid>/ 再收紧这里
const isAvatarFile = (f: string) => /^cloud:\/\/[^/]+\/avatars\/[\w-][\w.-]*$/.test(f)

/**
 * 微信登录（静默）：用可信 openid upsert users，返回用户。
 * 确定性 _id=OPENID（根因#1）：并发首登撞键即幂等；老随机 _id 档 where 命中即用（惰性迁移）。
 * unionid 桥接 best-effort：有则存进用户档（客服查订单反查用），绝不反噬登录。
 */
export const login = withOpenId(
  withRateLimit('login', { max: 30, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
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
    // 数据共享授权「登录即默认开启、可随时撤回」（老板 2026-09-30·决策记录 §40）：只在已同意协议的登录（agreed:true·
    // 静默识别不带）且用户从没自己选过时写；写失败不挡登录（授权页照常可开可撤）。
    if ((event as any)?.agreed === true && needsDefaultConsent(user)) {
      const csDataShare = { agreed: true, at: Date.now(), via: 'login' }
      const done = await db
        .collection(COLLECTIONS.users)
        .doc(user._id)
        .update({ data: { csDataShare } })
        .catch(() => null)
      if (done) return ok({ isNew, user: { ...user, csDataShare } })
    }
    return ok({ isNew, user })
  })
)

/** 从没自己选过＝没有授权记录；删资料时被重置的（at===deletedAt·同一时刻写）也按新用户算。主动撤回/开启过的不动。 */
function needsDefaultConsent(user: any): boolean {
  const cs = user && user.csDataShare
  if (!cs || typeof cs.agreed !== 'boolean') return true
  return cs.agreed === false && !!user.deletedAt && cs.at === user.deletedAt
}

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
 * 保存用户资料（白名单+截断+归属，不信前端）。
 * 白名单 {nickname,bio,avatar}；avatar 只接受 avatars/ 目录下的云存储文件或空串（清除），其余剔除。
 */
export const updateProfile = withOpenId(
  withRateLimit('updateProfile', { max: 20, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const e: any = event
    const patch: Record<string, unknown> = {}
    if (typeof e.nickname === 'string' && e.nickname.trim()) {
      patch.nickname = str(e.nickname.trim(), CAPS.nickname)
    }
    if (typeof e.bio === 'string') patch.bio = str(e.bio.trim(), CAPS.bio)
    const avatar = str(e.avatar, CAPS.avatar)
    if (e.avatar === '' || isAvatarFile(avatar)) patch.avatar = avatar
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
 * 自助删除个人资料（隐私政策第五/六条「删除资料后删除或匿名化个人资料」）：
 * 抹掉可识别个人资料（昵称/头像/签名/手机号/unionid）、摘掉客服身份桥；公开评价改匿名署名（评分与内容保留）、
 * 意见反馈删联系方式、节点拍照连文件一起删；订单行依法留存。
 * **已解锁课程、学习进度、激活卡归属一律保留**（老板 2026-09-30·决策记录 §39）：课程是付费购买的权益，
 * 和订单一样按交易与服务记录留存——同一微信再登，资料是空的，但课照样能看、进度接着学。
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
    // INTERNAL，绝不报已删除却留着客服身份桥（根因#14）。课程权限/进度/激活卡归属不在删除范围（§39）。
    await db.collection(COLLECTIONS.kfIdentity).where({ openid: OPENID }).remove()
    await db
      .collection(COLLECTIONS.reviews)
      .where({ _openid: OPENID })
      .update({ data: { name: ANON_REVIEW_NAME } })
      .catch(rethrowUnlessCollMissing)
    await db
      .collection(COLLECTIONS.feedback)
      .where({ _openid: OPENID })
      .update({ data: { contact: '' } })
      .catch(rethrowUnlessCollMissing)
    await removeCheckpointSubs(db, OPENID)
    return ok({ deleted: true })
  })
)

// 评价/反馈/节点集合都是第一次写时才建：集合没建＝本人本来就没有，不是删失败
function rethrowUnlessCollMissing(e: unknown): void {
  if (!isCollectionMissing(e)) throw e
}

/**
 * 节点拍照提交连文件一起删。先删文件再摘档：档一摘 fileId 就没了，文件再也找不回来删。
 * 每页 50 条＝deleteFile 单次上限；只摘文件确认没了的档，其余留给重试，本次整体抛错。
 * 不在本人目录下的 fileId 只摘档不删文件（不拿管理权限删别人的图）。
 */
async function removeCheckpointSubs(db: any, OPENID: string): Promise<void> {
  const coll = () => db.collection(COLLECTIONS.checkpoints)
  for (;;) {
    const page = await coll()
      .where({ type: 'sub', _openid: OPENID })
      .limit(50)
      .get()
      .catch((e: unknown) => (rethrowUnlessCollMissing(e), { data: [] }))
    const subs: any[] = page.data
    if (!subs.length) return
    const fileOf = (d: any) => String(d.fileId || '')
    const gone = await deleteOwnCheckpointFiles(subs.map(fileOf), OPENID)
    const done = subs.filter((d) => gone.has(fileOf(d)) || !isOwnCheckpointFile(fileOf(d), OPENID)).map((d) => d._id)
    if (done.length) {
      const rm = await coll().where({ _id: db.command.in(done) }).remove()
      // 删到 0 条可能是并发的另一次删除已经摘掉了：回读确认真没了才放行
      if (!rm?.stats?.removed) {
        const left = await coll().where({ _id: db.command.in(done) }).limit(1).get()
        if (left.data.length) throw new Error('CHECKPOINT_REMOVE_NOOP')
      }
    }
    if (done.length < subs.length) throw new Error('CHECKPOINT_FILE_DELETE_FAIL')
  }
}
