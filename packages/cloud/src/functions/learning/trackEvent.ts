import { withOpenId, withRateLimit, ok, err, str, ensureDoc } from '../../kit'

// 通用埋点 + 进度记忆（一次埋点两用，规格 §七）。
// events：通用事件流水；progress：segment_done / watch_at 折叠进「每用户每课一条」紧凑文档。
// openid 闸 + 白名单字段 + 长度/大小上限；时间戳 epoch 毫秒。

// 写入；集合不存在则建一次再重试（免 initDb 时序依赖）
async function addTo(db: any, coll: string, data: any) {
  try {
    await db.collection(coll).add({ data })
  } catch {
    try {
      await db.createCollection(coll)
    } catch {
      /* 已存在则忽略 */
    }
    await db.collection(coll).add({ data })
  }
}

export const main = withOpenId(
  // 频控（根因#13）：埋点高频但单用户每分钟 60 次已远超正常播放，超即丢——挡刷库洪水
  withRateLimit('trackEvent', { max: 60, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const e: any = event
    const type = str(e.type, 32)
    if (!type) return err('NO_TYPE')
    const page = str(e.page, 64)
    const targetId = str(e.targetId, 64)
    let meta = e.meta
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {}
    if (JSON.stringify(meta).length > 1024) return err('META_TOO_BIG')

    const now = Date.now()
    await addTo(db, 'events', { _openid: OPENID, type, page, targetId, meta, createdAt: now })

    // 进度折叠：segment_done（一段看完）/ watch_at（离开播放页位置）
    const courseId = str(meta.courseId, 64)
    if ((type === 'segment_done' || type === 'watch_at') && courseId) {
      // 防刷（审计 P2-4·口径统一）：仅本人已**确认进课**（enteredAt 非空）才折叠进度——与播放鉴权
      // getPlaybackUrl / getMyCourses 同闸。否则「已激活未确认」用户直调 trackEvent 可污染自己进度 +
      // 后台统计、确认后还看到伪造的「继续观看/已学完」。
      const _ = db.command
      const owns = await db
        .collection('activations')
        .where({ _openid: OPENID, courseId, enteredAt: _.neq(null) })
        .get()
        .catch(() => ({ data: [] }))
      if (!owns.data.length) return ok()
      const last = {
        lessonId: str(meta.lessonId, 64),
        segmentId: targetId,
        at: Number(meta.at) || 0,
        dur: Number(meta.dur) || 0,
      }
      const progress = db.collection('progress')
      let found
      try {
        found = await progress.where({ _openid: OPENID, courseId }).get()
      } catch {
        found = { data: [] } // 集合未建 → 走 addTo 建档
      }
      const patch: Record<string, unknown> = { last, updatedAt: now }
      if (type === 'segment_done' && targetId) patch[`done.${targetId}`] = true
      if (found.data.length) {
        await progress.doc(found.data[0]._id).update({ data: patch }) // 老随机 _id 档命中即用
      } else {
        // 确定性 _id=openid__courseId（根因#1）：并发首个进度事件撞号即幂等、不重复建档；
        // ensureDoc 保证基档存在，再 update 落本次 done.<seg>/last（点路径累加，两段并发都不丢）。
        const pid = OPENID + '__' + courseId
        await ensureDoc('progress', pid, {
          _openid: OPENID,
          courseId,
          done: {},
          last,
          createdAt: now,
        })
        await progress.doc(pid).update({ data: patch })
      }
    }
    return ok()
  })
)
