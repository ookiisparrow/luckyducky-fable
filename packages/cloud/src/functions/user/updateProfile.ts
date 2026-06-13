import { withOpenId, ok, err, str } from '../../kit'

const CAPS = { nickname: 20, bio: 60, avatar: 256 }

// 保存用户资料（敏感：前端禁直写 users，一律走这里）。openid 闸 + 白名单 {nickname,bio,avatar}
// 截断；avatar 只接受云存储 fileID（cloud://）或空串（清除）。时间戳 epoch 毫秒。
export const main = withOpenId(async ({ db, OPENID, event }) => {
  const e: any = event
  const patch: Record<string, unknown> = {}
  if (typeof e.nickname === 'string' && e.nickname.trim()) {
    patch.nickname = str(e.nickname.trim(), CAPS.nickname)
  }
  if (typeof e.bio === 'string') patch.bio = str(e.bio.trim(), CAPS.bio)
  if (typeof e.avatar === 'string' && (e.avatar === '' || e.avatar.startsWith('cloud://'))) {
    patch.avatar = str(e.avatar, CAPS.avatar)
  }
  if (!Object.keys(patch).length) return err('EMPTY_PATCH')
  patch.updatedAt = Date.now()

  // 先查后改（不用 where().update 的 stats 判断建档：内容未变 updated 为 0，误判会重复建档）。
  const users = db.collection('users')
  const found = await users.where({ _openid: OPENID }).get()
  if (found.data.length) {
    const doc = found.data[0]
    await users.doc(doc._id).update({ data: patch })
    return ok({ user: { ...doc, ...patch } })
  }
  const doc = { _openid: OPENID, nickname: '', avatar: '', bio: '', createdAt: Date.now(), ...patch }
  const addRes = await users.add({ data: doc })
  return ok({ user: { _id: addRes._id, ...doc } })
})
