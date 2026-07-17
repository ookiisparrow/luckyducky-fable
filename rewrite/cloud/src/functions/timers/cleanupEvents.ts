import cloud from 'wx-server-sdk'
import { getDb, ok, isServerCall } from '../../kit'

// wx-server-sdk 类型声明缺 deleteFile（运行时存在·adminApi 侧经 Ctx any 传入故未显形），此处显式收窄
const storageCloud = cloud as unknown as { deleteFile: (o: { fileList: string[] }) => Promise<unknown> }

// 清理无界增长集合（待办债#9 + 外审 P2.14）。定时触发器（每日）。三类只增不删/会堆积的数据保留 90 天：
//  ① events 原始埋点流（只写不读·看板读 progress 折叠视图·删旧不损功能）；
//  ② rateLimit 频控窗口（窗 60s·锁 ≤30min·90 天前的 key 早已无锁/无窗·删了下次命中重建）；
//  ③ kfState 的 seen:<msgid> 客服去重痕（带 at 字段；cursor:*/token 文档无 at·不误删）。
// 另两类短周期清理（课程链路审计 2026-07-17）：
//  ④ uploadChunks 弃传分片（原只在「下次有人 uploadFinish 成功」时顺手清——中途放弃后若再没人传完，
//    大体积 base64 文档无限期堆积）：按 createdAt 超 24h 删，不再依赖偶然条件；
//  ⑤ courses.pendingGc 孤儿视频缓期删除（publishCourse 只入队不删——给在播学员留播放窗）：到期项
//    cloud.deleteFile 后从队列摘除，fail-soft（删失败留队下轮再试）。
// 仅服务端/定时触发（无 openid）；客户端带身份调用一律拒（根因#3：写库必过闸，防滥调）。
const RETAIN_MS = 90 * 24 * 3600 * 1000 // 保留 90 天
const CHUNK_RETAIN_MS = 24 * 3600 * 1000 // 弃传分片保留 24h（正常分片会话分钟级走完·uploadFinish 自清）

export const main = async () => {
  if (!isServerCall()) return ok({ removed: 0 })
  const db = getDb()
  const _ = db.command
  const cutoff = Date.now() - RETAIN_MS
  const n = (x: any) => (x && x.stats && x.stats.removed) || 0
  // 服务端按条件批量删（与 closeExpiredOrders 同口径，每日一轮收敛；集合不存在则 0）
  const rmEvents = await db
    .collection('events')
    .where({ createdAt: _.lt(cutoff) })
    .remove()
    .catch(() => ({ stats: { removed: 0 } }))
  // 频控窗口 TTL（外审 P2.14）：按 updatedAt（throttle 每次写更新）删·非 createdAt（创建即定·活跃 key 会被误删）
  const rmRate = await db
    .collection('rateLimit')
    .where({ updatedAt: _.lt(cutoff) })
    .remove()
    .catch(() => ({ stats: { removed: 0 } }))
  // 客服去重痕 TTL（外审 P2.14）：seen:<msgid> 带 at·按 at 删；cursor:*/token 无 at 字段故不误删
  const rmSeen = await db
    .collection('kfState')
    .where({ at: _.lt(cutoff) })
    .remove()
    .catch(() => ({ stats: { removed: 0 } }))
  // ④ 弃传分片 TTL（课程链路审计 2026-07-17）
  const rmChunks = await db
    .collection('uploadChunks')
    .where({ createdAt: _.lt(Date.now() - CHUNK_RETAIN_MS) })
    .remove()
    .catch(() => ({ stats: { removed: 0 } }))
  // ⑤ 孤儿视频缓期删除：课程数是小集合（≤1000 上界与 getCourses 同口径），逐课处理到期项
  let gcDeleted = 0
  const now = Date.now()
  const courses = await db
    .collection('courses')
    .limit(1000)
    .get()
    .catch(() => ({ data: [] }))
  for (const c of courses.data || []) {
    const q = Array.isArray(c.pendingGc) ? c.pendingGc : []
    const due = q.filter((en: any) => en && en.fileId && Number(en.deleteAfter) <= now)
    if (!due.length) continue
    const r = await storageCloud.deleteFile({ fileList: due.map((en: any) => String(en.fileId)) }).catch(() => null)
    if (!r) continue // 删失败整批留队下轮再试（fail-soft·不反噬其余清理）
    const remaining = q.filter((en: any) => !(en && en.fileId && Number(en.deleteAfter) <= now))
    await db
      .collection('courses')
      .doc(c._id)
      .update({ data: { pendingGc: remaining } })
      .catch(() => {})
    gcDeleted += due.length
  }
  return ok({ removed: n(rmEvents), rateLimit: n(rmRate), kfSeen: n(rmSeen), chunks: n(rmChunks), videoGc: gcDeleted })
}
