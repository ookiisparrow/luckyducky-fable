import { withOpenId, ok, err, getTempUrl } from '../../kit'

// 取分段视频播放地址（审计 P1：付费内容服务端保护）。
// fileID 不出公开接口；此处服务端定位分段 → 鉴权 → 换短时效临时 URL 下发。
// 鉴权：免费段（free）任何登录用户可看；付费段须本人已「确认进课」（activations.enteredAt 非空，
// 与 getMyCourses 同闸）。素材未剪（videoFileId 为空）→ url:null（前端回退占位）。
export const main = withOpenId(async ({ db, OPENID, event }) => {
  const courseId = String(event.courseId || '')
  const segmentId = String(event.segmentId || '')
  if (!courseId || !segmentId) return err('BAD_ARGS')

  const got = await db.collection('courses').doc(courseId).get().catch(() => null)
  if (!got || !got.data) return err('NO_COURSE')

  // 定位分段（chapter → lesson → segment）
  let seg: any = null
  for (const ch of got.data.chapters || []) {
    for (const l of ch.lessons || []) {
      const f = (l.segments || []).find((s: any) => s.id === segmentId)
      if (f) {
        seg = f
        break
      }
    }
    if (seg) break
  }
  if (!seg) return err('NO_SEGMENT')
  if (!seg.videoFileId) return ok({ url: null }) // 素材未剪：无视频

  // 付费段鉴权：本人已确认进课才发地址（免费段放行）
  if (!seg.free) {
    const _ = db.command
    const acts = await db
      .collection('activations')
      .where({ _openid: OPENID, courseId, enteredAt: _.neq(null) })
      .get()
    if (!acts.data.length) return err('NOT_ENTITLED')
  }

  return ok({ url: await getTempUrl(String(seg.videoFileId)) })
})
