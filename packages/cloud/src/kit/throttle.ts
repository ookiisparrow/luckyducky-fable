import { getDb } from './db'
import { err } from './reply'
import { alert } from './observe'
import type { OpenIdCtx } from './gate'

// 频控 / 锁定闸（根因账本 #13：无频控 → 暴力破解 / 滥用穿透）。
// 按 key 在 rateLimit 集合记 {fails, windowStart, lockedUntil}（失败计数）/{hits, hitWindowStart}
// （调用计数）：滚动窗口内累加，失败达 max → 锁定 lockMs；认证成功 → 清零。
//
// 并发原子性（债#21/#27，根因#13 并发面）：计数走**乐观并发（CAS 重试）**，单点收口 bumpWindowed
// ——读旧值后 where({_id, 旧值}).update 比较并设置，stats.updated=0 即并发已抢先改过 → 重读重试；
// 杜绝「读-改-写」在突发并发同 key 下读到同一旧值各自写回致计数偏小、限额/锁定漏过（与 kit/transition、
// 激活码一码一用抢占同范式·根因#1/#2）。failCount/hitCount 复用同一核、只差字段名与达阈动作（债#27 收口）。
// best-effort：写频控库失败/重试耗尽不阻断主流程（口令校验本身仍是硬闸）。
export interface ThrottleOpts {
  max: number // 滚动窗口内允许的失败次数
  windowMs: number // 失败计数滚动窗口
  lockMs: number // 触发后的锁定冷却
}

const COLL = 'rateLimit'
const rid = (key: string) => 'rl_' + key
// 乐观并发重试上限：突发并发同 key 下，每次抢失败即重读重试；真库 CAS 有网络往返、
// 单轮实际并发有限，20 足够收敛。耗尽即 best-effort（不阻断主流程）。
const CAS_RETRIES = 20

/**
 * 窗口计数器自增单点（CAS 重试·债#27 收口）。读旧值 → 算新计数（窗口翻滚）→
 * where(旧值).update 比较并设置，updated=0 重读重试。onPatch 可按新计数改 patch（如达阈锁定 /
 * 写时间戳）。返回新计数；首写撞号重试；重试耗尽返回 null（best-effort）。
 */
async function bumpWindowed(
  key: string,
  countField: string,
  windowField: string,
  windowMs: number,
  onPatch?: (count: number, patch: Record<string, unknown>, now: number) => void
): Promise<number | null> {
  const db = getDb()
  const _ = db.command
  const id = rid(key)
  for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
    const now = Date.now()
    const got = await db
      .collection(COLL)
      .doc(id)
      .get()
      .catch(() => null)
    const rec = got && got.data ? got.data : null
    const within = !!rec && typeof rec[windowField] === 'number' && now - rec[windowField] < windowMs
    const count = (within ? rec![countField] || 0 : 0) + 1
    const patch: Record<string, unknown> = within
      ? { [countField]: count }
      : { [countField]: count, [windowField]: now }
    if (onPatch) onPatch(count, patch, now)
    patch.updatedAt = now // TTL 清理锚（外审 P2.14·债#9）：每次写更新·cleanupEvents 按 updatedAt 删过期窗口（不入 CAS cond·不扰抢占）
    if (!rec) {
      try {
        await db.createCollection(COLL).catch(() => {})
        await db.collection(COLL).add({ data: { _id: id, createdAt: now, ...patch } })
        return count
      } catch {
        continue // 并发首写撞号 → 重试转 update 路径
      }
    }
    // CAS 前置：窗内连同计数、否则窗口起点须仍是读到的旧值（缺失则 exists(false)）
    const cond: Record<string, unknown> = { _id: id }
    if (within) {
      cond[windowField] = rec[windowField]
      cond[countField] = rec[countField] || 0
    } else {
      cond[windowField] = typeof rec[windowField] === 'number' ? rec[windowField] : _.exists(false)
    }
    const r = await db
      .collection(COLL)
      .where(cond)
      .update({ data: patch })
      .catch(() => null)
    if (r && r.stats && r.stats.updated === 1) return count
    // updated=0：并发抢先改过 → 重读重试
  }
  return null
}

/** 锁定中？是 → 返回剩余毫秒；否 → 0。调用方据此拒绝（429 + retryAfter）。 */
export async function throttleLocked(key: string): Promise<number> {
  const db = getDb()
  const got = await db
    .collection(COLL)
    .doc(rid(key))
    .get()
    .catch(() => null)
  const rec = got && got.data ? got.data : null
  const left = rec && typeof rec.lockedUntil === 'number' ? rec.lockedUntil - Date.now() : 0
  return left > 0 ? left : 0
}

/** 记一次失败：滚动窗口内累加；达 max → 锁定 lockMs 并清零计数 + 爆破告警（债#23）。 */
export async function throttleFail(key: string, opts: ThrottleOpts): Promise<void> {
  const n = await bumpWindowed(key, 'fails', 'windowStart', opts.windowMs, (count, patch, now) => {
    patch.updatedAt = now
    if (count >= opts.max) {
      patch.fails = 0
      patch.windowStart = now
      patch.lockedUntil = now + opts.lockMs
    }
  })
  if (n !== null && n >= opts.max) alert('security', 'throttle', 'LOCKOUT', { key, lockMs: opts.lockMs })
}

/** 认证成功：清零计数与锁定（仅在有残留时写，常态零开销）。 */
export async function throttleReset(key: string): Promise<void> {
  const db = getDb()
  const got = await db
    .collection(COLL)
    .doc(rid(key))
    .get()
    .catch(() => null)
  const rec = got && got.data ? got.data : null
  if (rec && ((rec.fails || 0) > 0 || (rec.lockedUntil || 0) > 0)) {
    await db
      .collection(COLL)
      .doc(rid(key))
      .update({ data: { fails: 0, lockedUntil: 0 } })
      .catch(() => {})
  }
}

/**
 * 调用频控（根因#13）：每次调用计一次（CAS 原子），滚动窗口内 > max → 返回 true（超限，调用方拒）。
 * 与失败计数（throttleFail）分用不同字段（hits/hitWindowStart），同 key 不互踩。
 */
export async function throttleHit(
  key: string,
  opts: { max: number; windowMs: number }
): Promise<boolean> {
  const n = await bumpWindowed(key, 'hits', 'hitWindowStart', opts.windowMs, (_c, patch, now) => {
    patch.hitAt = now
  })
  return n !== null && n > opts.max
}

/**
 * 频控装饰器（根因#13）：包住 withOpenId 的 handler，按 (name, openid) 限频；
 * 超频返回 err('RATE_LIMITED')、不执行 handler。用于高频/造数的用户端写函数。
 * 代价：每次调用多一对 get/update——高频函数（trackEvent）上这是为防刷付的开销，可接受。
 */
export function withRateLimit(
  name: string,
  opts: { max: number; windowMs: number },
  handler: (ctx: OpenIdCtx) => Promise<any>
) {
  return async (ctx: OpenIdCtx) => {
    const over = await throttleHit('fn:' + name + ':' + ctx.OPENID, opts)
    if (over) return err('RATE_LIMITED')
    return handler(ctx)
  }
}
