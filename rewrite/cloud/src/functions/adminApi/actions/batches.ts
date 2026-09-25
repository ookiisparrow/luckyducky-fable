import { randomBytes } from 'crypto'
import { pageQuery, err } from '../../../kit'
import { reply, type Ctx } from '../lib'

// 分页全取（债#22：避免单次拉取封顶截断——批次/码增长后旧码被挤出工作台）。
// 按页 skip 取尽（每页 200），不足一页即止。makeQuery 每页重建，避免复用查询对象。
// 最大页数封顶（深审 P3·根因#7）：无上限 skip 循环在码量暴涨（一课累计数万码）时要跑上百次串行 DB 往返、
// 逼近云函数超时——封顶 SCAN_PAGES 页（=1 万条·管理端量级远不触）；真触顶属灾难态、靠人扩容而非静默无限跑。
// 触顶回 truncated，调用方据此告诉人计数不全；末页满时再探 1 条，码数正好封顶值时不误报。
const SCAN_PAGES = 50
async function fetchAll(makeQuery: () => any, pageSize = 200): Promise<{ rows: any[]; truncated: boolean }> {
  const out: any[] = []
  for (let page = 0; page < SCAN_PAGES; page++) {
    // 页失败 fail-loud（同 getInventory）：.catch 空页会命中「不足一页即止」，静默截成半份批次。
    const r = await makeQuery().skip(page * pageSize).limit(pageSize).get()
    const batch = (r && r.data) || []
    out.push(...batch)
    if (batch.length < pageSize) return { rows: out, truncated: false }
  }
  const more = await makeQuery().skip(SCAN_PAGES * pageSize).limit(1).get()
  return { rows: out, truncated: ((more && more.data) || []).length > 0 }
}

export async function listBatches({ db, data }: Ctx) {
  const courseId = String(data.courseId || '')
  if (!courseId) return reply(400, err('NO_COURSE_ID'))
  // 无 orderBy 时服务端不保证各页同序，skip 翻页会跨页漏/重；_id 唯一，是全序。
  const { rows, truncated } = await fetchAll(() =>
    db.collection('qrcodes').where({ courseId }).orderBy('_id', 'asc').field({ batchId: true, status: true, createdAt: true })
  )
  const map: Record<string, any> = {}
  for (const q of rows) {
    const b = (map[q.batchId] = map[q.batchId] || { batchId: q.batchId, total: 0, activated: 0, createdAt: q.createdAt || 0 })
    b.total++
    if (q.status === 'activated') b.activated++
  }
  const list = Object.values(map).sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0))
  return reply(200, { ok: true, list, truncated })
}

// 易抄写字符表（无 0/O/1/I），LD 前缀 + 10 位 ≈ 1e15 空间。
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
  const ts = new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 19).replace(/\D/g, '')
  return `b-${courseId}-${ts}-${randomBytes(3).toString('hex')}`
}

/**
 * 按课程批量生成唯一激活码：校验/生成
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
  if (!cid || !Number.isInteger(rawCount) || rawCount < 1) return err('BAD_ARGS')
  const clamped = Math.min(500, rawCount)
  const course = await db.collection('courses').doc(cid).get().catch(() => null)
  if (!course || !course.data) return err(`UNKNOWN_COURSE:${cid}`)

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

// 入参校验与钳 500 只在 generateQrcodes 一处（读库前就回 BAD_ARGS）。
export async function createBatch({ db, data }: Ctx) {
  const r = await generateQrcodes(db, String(data.courseId || ''), data.count)
  if (!r.ok) return reply(400, { ok: false, error: r.error })
  return reply(200, { ok: true, batchId: r.batchId, codes: r.codes })
}

const CODE_PAGE = 50

export async function listBatchCodes({ db, data }: Ctx) {
  const batchId = String(data.batchId || '')
  if (!batchId) return reply(400, err('NO_BATCH'))
  // 一批可有几百到几千张：默认一页 50、limit 钳到 200，cursor 翻页（根因#7）。
  // createdAt 同批同值（generate 一次 now），靠 kit 复合游标 {_id} 打破平局。
  const paged = await pageQuery(db, 'qrcodes', { batchId }, 'createdAt', data, CODE_PAGE, 'asc')
  return reply(200, {
    ok: true,
    codes: paged.list.map((q: any) => q._id),
    nextCursor: paged.nextCursor,
    hasMore: paged.hasMore,
  })
}
