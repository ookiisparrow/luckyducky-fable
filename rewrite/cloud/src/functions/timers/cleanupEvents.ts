import cloud from 'wx-server-sdk'
import { getDb, ok, isServerCall, isVodFileId, callVodApi } from '../../kit'

// wx-server-sdk 类型声明缺 deleteFile（运行时存在·adminApi 侧经 Ctx any 传入故未显形），此处显式收窄
const storageCloud = cloud as unknown as { deleteFile: (o: { fileList: string[] }) => Promise<unknown> }

// 清理无界增长集合（待办债#9 + 外审 P2.14）。定时触发器（每日）。三类只增不删/会堆积的数据保留 90 天：
//  ① events 原始埋点流（只写不读·看板读 progress 折叠视图·删旧不损功能）；
//  ② rateLimit 频控窗口（窗 60s·锁 ≤30min·90 天前的 key 早已无锁/无窗·删了下次命中重建）；
//  ③ kfState 的 seen:<msgid> 客服去重痕（带 at 字段；cursor:*/token 文档无 at·不误删）。
// 另两类短周期清理（课程链路审计 2026-07-17）：
//  ⑤ courses.pendingGc 孤儿视频缓期删除（publishCourse 只入队不删——给在播学员留播放窗）：到期项
//    cloud.deleteFile 后从队列摘除，fail-soft（删失败留队下轮再试）。
//  ⑥ productsDraft.pendingGc 孤儿图册缓期删除（批B·saveDraft/publishProduct 换图/发布替换只入队不删——
//    admin listDrafts/mp 详情给旧图签过临时址，缓期内不断图）：与 ⑤ 同构，复用同一 gcPendingGc 消费器
//    （商品图恒 cloud://·无 VOD 分支·harmless no-op）。
// 仅服务端/定时触发（无 openid）；客户端带身份调用一律拒（根因#3：写库必过闸，防滥调）。
const RETAIN_MS = 90 * 24 * 3600 * 1000 // 保留 90 天

// 缓期孤儿 GC 消费器（⑤课程视频 / ⑥商品图册共用·单源防漂移）：逐文档处理 pendingGc 到期项——
// 双线分流（决策§31·同 getPlaybackUrl 的 isVodFileId 判据单源）：cloud:// 走云存储 deleteFile（整批），
// VOD FileId 走 DeleteMedia（官方单文件一调·商品图恒 cloud:// 故该分支恒 no-op）。逐项记成功：任一线失败
// 其项留队下轮再试（fail-soft）；VOD「媒资已不存在」(ResourceNotFound)视作删成功出队防永久重试。返回删除数。
async function gcPendingGc(db: any, coll: string, now: number): Promise<number> {
  let deleted = 0
  // 小集合上界（≤1000·同 getCourses 口径），逐文档处理到期项
  const docs = await db.collection(coll).limit(1000).get().catch(() => ({ data: [] }))
  for (const c of docs.data || []) {
    const q = Array.isArray(c.pendingGc) ? c.pendingGc : []
    const due = q.filter((en: any) => en && en.fileId && Number(en.deleteAfter) <= now)
    if (!due.length) continue
    const done = new Set<string>()
    const dueCos = due.filter((en: any) => !isVodFileId(String(en.fileId)))
    if (dueCos.length) {
      const r = await storageCloud.deleteFile({ fileList: dueCos.map((en: any) => String(en.fileId)) }).catch(() => null)
      if (r) for (const en of dueCos) done.add(String(en.fileId))
    }
    for (const en of due) {
      const id = String(en.fileId)
      if (!isVodFileId(id)) continue
      const resp = await callVodApi(db, 'DeleteMedia', { FileId: id })
      if (resp && (!resp.Error || String(resp.Error.Code || '').includes('ResourceNotFound'))) done.add(id)
    }
    if (!done.size) continue
    const remaining = q.filter((en: any) => !(en && done.has(String(en.fileId)) && Number(en.deleteAfter) <= now))
    await db.collection(coll).doc(c._id).update({ data: { pendingGc: remaining } }).catch(() => {})
    deleted += done.size
  }
  return deleted
}

export const main = async () => {
  if (!isServerCall()) return ok({ removed: 0 })
  const db = getDb()
  const _ = db.command
  const now = Date.now()
  const cutoff = now - RETAIN_MS
  // 服务端按条件批量删（与 closeExpiredOrders 同口径，每日一轮收敛；集合不存在则 0）
  const rm = (coll: string, field: string) =>
    db
      .collection(coll)
      .where({ [field]: _.lt(cutoff) })
      .remove()
      .then((x: any) => (x && x.stats && x.stats.removed) || 0, () => 0)
  // 五路各删各的集合、互不依赖，并发跑（定时器有超时上限）
  const [removed, rateLimit, kfSeen, videoGc, imageGc] = await Promise.all([
    rm('events', 'createdAt'),
    // 频控窗口 TTL（外审 P2.14）：按 updatedAt（throttle 每次写更新）删·非 createdAt（创建即定·活跃 key 会被误删）
    rm('rateLimit', 'updatedAt'),
    // 客服去重痕 TTL（外审 P2.14）：seen:<msgid> 带 at·按 at 删；cursor:*/token 无 at 字段故不误删
    rm('kfState', 'at'),
    // ⑤ 孤儿视频缓期删除（courses.pendingGc） + ⑥ 孤儿图册缓期删除（productsDraft.pendingGc）：同构·共用消费器
    gcPendingGc(db, 'courses', now),
    gcPendingGc(db, 'productsDraft', now),
  ])
  return ok({ removed, rateLimit, kfSeen, videoGc, imageGc })
}
