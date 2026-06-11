// 通用埋点 + 进度记忆（一次埋点两用，规格 §七 事件模型）。
// events：通用事件流水 { _openid, type, page, targetId, meta, createdAt }（运营热点/冷点，P5 看板聚合）。
// progress：segment_done / watch_at 两类事件同时折叠进「每用户每课一条」的紧凑进度文档
//   { _openid, courseId, done:{segId:true}, last:{lessonId,segmentId,at,dur}, updatedAt }，
//   目录角标 / 继续学习卡读这份，不扫 events 流水。
// 安全：openid 取 getWXContext；白名单字段 + 长度/大小上限；时间戳存 epoch 毫秒。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const str = (v, cap) => (typeof v === 'string' ? v.slice(0, cap) : '')

// 写入；集合不存在则建一次再重试（免手工 initDb 的时序依赖）
async function addTo(coll, data) {
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

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }

  const type = str(event.type, 32)
  if (!type) return { ok: false, error: 'NO_TYPE' }
  const page = str(event.page, 64)
  const targetId = str(event.targetId, 64)
  let meta = event.meta
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {}
  if (JSON.stringify(meta).length > 1024) return { ok: false, error: 'META_TOO_BIG' }

  const now = Date.now()
  await addTo('events', { _openid: OPENID, type, page, targetId, meta, createdAt: now })

  // 进度折叠：segment_done（一段看完）/ watch_at（离开播放页时的位置）
  const courseId = str(meta.courseId, 64)
  if ((type === 'segment_done' || type === 'watch_at') && courseId) {
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
    if (found.data.length) {
      const patch = { last, updatedAt: now }
      if (type === 'segment_done' && targetId) patch[`done.${targetId}`] = true
      await progress.doc(found.data[0]._id).update({ data: patch })
    } else {
      const doc = { _openid: OPENID, courseId, done: {}, last, createdAt: now, updatedAt: now }
      if (type === 'segment_done' && targetId) doc.done[targetId] = true
      await addTo('progress', doc)
    }
  }
  return { ok: true }
}
