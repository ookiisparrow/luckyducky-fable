// 按课程批量生成唯一激活码（管理操作，规格 §四-2：生成 → 打印 → 备货封码，码不绑订单）。
// 权限：管理通道 = CLI / 控制台 invoke（无 openid）；小程序端调用须 users.isAdmin（控制台手动标）。
// 唯一性：code 同时作文档 _id，add 撞重即抛错重试（库级唯一约束）。
// 小程序码图片（wxacode.getUnlimited + scene）按规格 §七 待确认延后到印刷阶段，本函数只产码。
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 易抄写字符表（无 0/O/1/I），LD 前缀 + 10 位 ≈ 1e15 空间，猜码不可行
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
function genCode() {
  const bytes = crypto.randomBytes(10)
  let s = 'LD'
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length]
  return s
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (OPENID) {
    const u = await db.collection('users').where({ _openid: OPENID }).get()
    if (!u.data.length || u.data[0].isAdmin !== true) return { ok: false, error: 'ADMIN_ONLY' }
  }

  // count 必须是显式合法正整数（审核批次B：原 Math.max(1,...) 会把漏传/非法静默夹成 1，
  // 误生成 1 个真实有效码）；合法后才钳到上限 500
  const courseId = String(event.courseId || '')
  const rawCount = parseInt(event.count, 10)
  if (!courseId || !Number.isInteger(rawCount) || rawCount < 1) return { ok: false, error: 'BAD_ARGS' }
  const count = Math.min(500, rawCount)
  // 课程必须存在，防止生成废码
  const course = await db.collection('courses').doc(courseId).get().catch(() => null)
  if (!course || !course.data) return { ok: false, error: 'UNKNOWN_COURSE:' + courseId }

  const now = Date.now()
  const d = new Date(now + 8 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  const batchId =
    `b-${courseId}-` +
    d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes())

  const codes = []
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
      } catch (e) {
        if (attempt === 4) throw e
      }
    }
  }
  return { ok: true, batchId, count: codes.length, codes }
}
