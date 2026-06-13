import { randomBytes } from 'crypto'
import { withAdminGate, ok, err } from '../../kit'

// 按课程批量生成唯一激活码（管理操作，规格 §四-2：生成→打印→备货封码，码不绑订单）。
// 管理闸（kit.withAdminGate）；唯一性：code 同时作文档 _id，撞重即抛错重试（库级唯一约束）。

// 易抄写字符表（无 0/O/1/I），LD 前缀 + 10 位 ≈ 1e15 空间
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
function genCode(): string {
  const bytes = randomBytes(10)
  let s = 'LD'
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length]
  return s
}

export const main = withAdminGate(async ({ db, event }) => {
  const e: any = event
  // count 必须显式合法正整数（审核批次B：漏传/非法不再静默夹成 1）；合法后才钳到上限 500
  const courseId = String(e.courseId || '')
  const rawCount = parseInt(e.count, 10)
  if (!courseId || !Number.isInteger(rawCount) || rawCount < 1) return err('BAD_ARGS')
  const count = Math.min(500, rawCount)
  // 课程必须存在，防止生成废码
  const course = await db.collection('courses').doc(courseId).get().catch(() => null)
  if (!course || !course.data) return err('UNKNOWN_COURSE:' + courseId)

  const now = Date.now()
  const d = new Date(now + 8 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  const batchId =
    `b-${courseId}-` +
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes())

  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    // 撞重（_id 已存在）就换一个码重试，最多 5 次
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = genCode()
      try {
        await db.collection('qrcodes').add({
          data: { _id: code, code, courseId, batchId, status: 'unused', activatedBy: null, activatedAt: null, createdAt: now },
        })
        codes.push(code)
        break
      } catch (e2) {
        if (attempt === 4) throw e2
      }
    }
  }
  return ok({ batchId, count: codes.length, codes })
})
