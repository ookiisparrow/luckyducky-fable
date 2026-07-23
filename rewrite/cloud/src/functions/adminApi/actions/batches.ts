import { randomBytes } from 'crypto'
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

// 易抄写字符表（无 0/O/1/I），LD 前缀 + 10 位 ≈ 1e15 空间（原 ops/genQrcodes.ts 收编·2026-07-23 拓扑收编批）。
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
function genCode(): string {
  const bytes = randomBytes(10)
  let s = 'LD'
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length]
  return s
}

// 批次 ID（外审 R1-R4·P1.9·根因#1 唯一标识粒度不足）：曾只到分钟（b-<course>-yyyyMMddHHmm），
// 同课同分钟生成两批撞同 batchId → 后台按 batchId 合并、批次追踪/核销混乱。改北京时间到秒 + 随机后缀，
// 同课同秒并发两批也必不同（batches.ts 按存库 batchId 字段分组、不解析串，加后缀不破坏分组）。
export function makeBatchId(courseId: string, now: number): string {
  const d = new Date(now + 8 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  const ts =
    String(d.getUTCFullYear()) +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds())
  const rand = randomBytes(3).toString('hex')
  return `b-${courseId}-${ts}-${rand}`
}

/**
 * 按课程批量生成唯一激活码（原 ops/genQrcodes.ts main 收编·2026-07-23 拓扑收编批·17→13）：校验/生成
 * 行为逐条不变（count 必须显式合法正整数、钳 500、课程须存在、撞 _id 重试 5 次）。原 kit.withAdminGate
 * 包装不迁——管理闸已在外层 adminApi（checkKey + ACTION_CAPS，见 index.ts）把关，本函数只做业务逻辑，
 * 不再需要第二层管理闸（唯一调用方 createBatch 已过 adminApi 网关）。
 */
export async function generateQrcodes(
  db: any,
  courseId: string,
  count: unknown
): Promise<{ ok: true; batchId: string; count: number; codes: string[] } | { ok: false; error: string }> {
  const cid = String(courseId || '')
  const rawCount = parseInt(count as any, 10)
  if (!cid || !Number.isInteger(rawCount) || rawCount < 1) return { ok: false, error: 'BAD_ARGS' }
  const clamped = Math.min(500, rawCount)
  const course = await db.collection('courses').doc(cid).get().catch(() => null)
  if (!course || !course.data) return { ok: false, error: 'UNKNOWN_COURSE:' + cid }

  const now = Date.now()
  const batchId = makeBatchId(cid, now)
  const codes: string[] = []
  for (let i = 0; i < clamped; i++) {
    // 撞重（_id 已存在）就换一个码重试，最多 5 次
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = genCode()
      try {
        await db.collection('qrcodes').add({
          data: { _id: code, code, courseId: cid, batchId, status: 'unused', activatedBy: null, activatedAt: null, createdAt: now },
        })
        codes.push(code)
        break
      } catch (e2) {
        if (attempt === 4) throw e2
      }
    }
  }
  return { ok: true, batchId, count: codes.length, codes }
}

export async function createBatch({ db, data }: Ctx) {
  const courseId = String(data.courseId || '')
  const rawCount = parseInt(data.count, 10) // 漏传/非法不再静默成 1（审核批次B）
  if (!courseId || !Number.isInteger(rawCount) || rawCount < 1) return reply(400, { ok: false, error: 'BAD_ARGS' })
  const count = Math.min(500, rawCount)
  // 域内直调 generateQrcodes（同进程·收编前经 cloud.callFunction 互调独立函数·2026-07-23 拓扑收编批）
  const r = await generateQrcodes(db, courseId, count)
  if (!r.ok) return reply(400, { ok: false, error: r.error || 'GEN_FAIL' })
  return reply(200, { ok: true, batchId: r.batchId, codes: r.codes })
}

export async function listBatchCodes({ db, data }: Ctx) {
  const batchId = String(data.batchId || '')
  if (!batchId) return reply(400, { ok: false, error: 'NO_BATCH' })
  const all = await fetchAll(() => db.collection('qrcodes').where({ batchId }))
  return reply(200, { ok: true, codes: all.map((q: any) => q._id) })
}
