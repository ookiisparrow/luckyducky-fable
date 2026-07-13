import { reply, type Ctx } from '../lib'

// 分页全取（债#22：避免单次拉取封顶截断——批次/码增长后旧码被挤出工作台）。
// 按页 skip 取尽（每页 200），不足一页即止。makeQuery 每页重建，避免复用查询对象。
// 最大页数封顶（深审 P3·根因#7）：无上限 skip 循环在码量暴涨（一课累计数万码）时要跑上百次串行 DB 往返、
// 逼近云函数超时——封顶 SCAN_PAGES 页（=1 万条·管理端量级远不触）；真触顶属灾难态、靠人扩容而非静默无限跑。
const SCAN_PAGES = 50
async function fetchAll(makeQuery: () => any, pageSize = 200): Promise<any[]> {
  const out: any[] = []
  for (let page = 0; page < SCAN_PAGES; page++) {
    const r = await makeQuery()
      .skip(page * pageSize)
      .limit(pageSize)
      .get()
      .catch(() => ({ data: [] }))
    const batch = (r && r.data) || []
    out.push(...batch)
    if (batch.length < pageSize) break
  }
  return out
}

export async function listBatches({ db, data }: Ctx) {
  const courseId = String(data.courseId || '')
  if (!courseId) return reply(400, { ok: false, error: 'NO_COURSE_ID' })
  const all = await fetchAll(() => db.collection('qrcodes').where({ courseId }))
  const map: Record<string, any> = {}
  for (const q of all) {
    const b = (map[q.batchId] = map[q.batchId] || { batchId: q.batchId, total: 0, activated: 0, createdAt: q.createdAt || 0 })
    b.total++
    if (q.status === 'activated') b.activated++
  }
  const list = Object.values(map).sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0))
  return reply(200, { ok: true, list })
}

export async function createBatch({ cloud, data }: Ctx) {
  const courseId = String(data.courseId || '')
  const rawCount = parseInt(data.count, 10) // 漏传/非法不再静默成 1（审核批次B）
  if (!courseId || !Number.isInteger(rawCount) || rawCount < 1) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const count = Math.min(500, rawCount)
  // 服务端互调 genQrcodes（无 OPENID 即管理通道，复用既有生成与唯一性逻辑）
  const r = await cloud.callFunction({ name: 'genQrcodes', data: { courseId, count } })
  if (!r.result?.ok) return reply(400, { ok: false, error: r.result?.error || 'GEN_FAIL' })
  return reply(200, { ok: true, batchId: r.result.batchId, codes: r.result.codes })
}

export async function listBatchCodes({ db, data }: Ctx) {
  const batchId = String(data.batchId || '')
  if (!batchId) return reply(400, { ok: false, error: 'NO_BATCH' })
  const all = await fetchAll(() => db.collection('qrcodes').where({ batchId }))
  return reply(200, { ok: true, codes: all.map((q: any) => q._id) })
}
