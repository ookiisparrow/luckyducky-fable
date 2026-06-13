import { reply, type Ctx } from '../lib'

export async function listBatches({ db, data }: Ctx) {
  const courseId = String(data.courseId || '')
  if (!courseId) return reply(400, { ok: false, error: 'NO_COURSE_ID' })
  const res = await db.collection('qrcodes').where({ courseId }).limit(1000).get()
  const map: Record<string, any> = {}
  for (const q of res.data) {
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
  const res = await db.collection('qrcodes').where({ batchId }).limit(1000).get()
  return reply(200, { ok: true, codes: res.data.map((q: any) => q._id) })
}
